// ============================================================
// CloudStream Premium — API Server
// Production-grade Express + JWT + Helmet
// ============================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cookieParser = require('cookie-parser');
const db = require('./database');
const SELECTOR_CONFIG = require('./selector_config');

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '24h';
const PLUGIN_SESSION_EXPIRY = '5m';

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());   // ← parse cookies from CloudStream requests

// === TEMPORARY DEBUG LOGGER ===
app.use((req, res, next) => {
    // Skip static files
    if (!req.path.startsWith('/api') && !req.path.startsWith('/r/')) return next();
    const info = {
        method: req.method,
        path: req.path,
        query: req.query,
        body_keys: req.body ? Object.keys(req.body) : [],
        device_id: req.query.device_id || req.body?.device_id || '(none)',
        key: req.query.key || req.body?.key || req.params?.key || '(none)',
        ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip
    };
    console.log(`[REQ] ${req.method} ${req.path}`, JSON.stringify(info));
    next();
});
// === END DEBUG LOGGER ===

// Ensure we don't aggressively cache index.html
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, pathStr) => {
        if (pathStr.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (pathStr.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// ============================================================
// RATE LIMITING
// ============================================================

const rateBuckets = new Map();

function rateLimit(windowMs = 60000, max = 60) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${ip}:${req.route?.path || req.path}`;
        const now = Date.now();
        let bucket = rateBuckets.get(key);

        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            rateBuckets.set(key, bucket);
        }

        bucket.count++;
        if (bucket.count > max) {
            return res.status(429).json({ status: 'error', message: 'Too many requests' });
        }
        next();
    };
}

// Cleanup rate buckets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateBuckets) {
        if (now > v.resetAt) rateBuckets.delete(k);
    }
}, 300000);

// ============================================================
// JWT AUTH MIDDLEWARE
// ============================================================

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
    }
}

// ============================================================
// HELPERS
// ============================================================

const https = require('https');
const http = require('http');

function fetchJson(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, { headers: { 'User-Agent': 'CloudStreamPremium/2.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Status ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        request.on('error', reject);
        request.setTimeout(timeoutMs, () => { request.abort(); reject(new Error('Timeout')); });
    });
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection.remoteAddress || '';
}

function cleanInput(val) {
    if (typeof val !== 'string') return '';
    return val.trim().substring(0, 500);
}

// Safely decode URL-encoded plugin names and strip non-ASCII characters (like emojis)
function safeDecodePlugin(val) {
    if (!val) return val;
    let decoded = val;
    try { decoded = decodeURIComponent(val.trim()); } catch { decoded = val.trim(); }
    return decoded.replace(/[^\x00-\x7F]/g, "").trim().substring(0, 500);
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function getBaseServerUrl(req) {
    return `${req.protocol}://${req.get('host') || `127.0.0.1:${PORT}`}`;
}

function issuePluginSession({ licenseKey, deviceId, pluginName }) {
    return jwt.sign({
        type: 'plugin',
        license_key: licenseKey,
        device_id: deviceId,
        plugin_name: pluginName
    }, JWT_SECRET, { expiresIn: PLUGIN_SESSION_EXPIRY });
}

function pluginSessionMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : cleanInput(req.headers['x-plugin-session'] || '');
    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Plugin session required' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'plugin') {
            return res.status(401).json({ status: 'error', message: 'Invalid plugin session' });
        }
        const requestedPlugin = safeDecodePlugin(req.body?.plugin_name || req.query?.plugin_name || '');
        if (requestedPlugin && decoded.plugin_name && requestedPlugin !== decoded.plugin_name) {
            return res.status(403).json({ status: 'error', message: 'Plugin mismatch' });
        }
        req.pluginSession = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired plugin session' });
    }
}

function requireActivePluginSession(req, res) {
    const session = req.pluginSession || {};
    const licenseKey = cleanInput(session.license_key || '');
    const deviceId = cleanInput(session.device_id || '');
    const pluginName = safeDecodePlugin(session.plugin_name || req.body?.plugin_name || req.query?.plugin_name || '');

    if (!licenseKey || !deviceId || !pluginName) {
        return { ok: false, statusCode: 401, error: { status: 'error', message: 'Invalid plugin session' } };
    }

    const result = db.validateLicense(licenseKey, getClientIP(req), deviceId, 'Android Device', 'PLUGIN_SESSION');
    if (!result.valid) {
        const messages = {
            not_found: 'Lisensi tidak ditemukan',
            revoked: 'Lisensi telah dicabut oleh admin',
            expired: 'Lisensi telah kadaluarsa',
            max_devices: 'Batas perangkat maksimal tercapai',
            device_blocked: 'Perangkat ini diblokir'
        };
        db.logAccess(licenseKey, 'PLUGIN_SESSION_FAIL', getClientIP(req), `reason:${result.reason} plugin:${pluginName}`, deviceId);
        return {
            ok: false,
            statusCode: 403,
            error: { status: 'error', message: messages[result.reason] || 'Akses ditolak', reason: result.reason }
        };
    }

    return { ok: true, licenseKey, deviceId, pluginName, result };
}

function getSafeDeviceId(req, rawDeviceId) {
    const deviceId = cleanInput(rawDeviceId);
    if (deviceId && deviceId.toLowerCase() !== 'unknown' && deviceId.toLowerCase() !== 'null') {
        return deviceId;
    }
    return req.cookies?.cs_device_id || '';
}

// Keep a short-lived IP bridge so recent validation traffic can be correlated.
const ipSessions = new Map();

function createIPSession(ip, key) {
    if (!ip || !key) return;
    ipSessions.set(ip, { key, expiresAt: Date.now() + (15 * 60 * 1000) });
}

function cleanupExpiredIPSessions() {
    const now = Date.now();
    for (const [ip, session] of ipSessions.entries()) {
        if (!session || now > session.expiresAt) {
            ipSessions.delete(ip);
        }
    }
}

setInterval(cleanupExpiredIPSessions, 5 * 60 * 1000);

function resolveLicenseForRequest(req, {
    key,
    deviceId,
    deviceModel = '',
    action = 'VERIFY',
    pluginName = '',
    allowRecovery = true
}) {
    const ip = getClientIP(req);
    let resolvedKey = cleanInput(key);
    const cleanDeviceId = cleanInput(deviceId);
    const cleanDeviceModel = cleanInput(deviceModel || 'Android Device');
    const cleanPluginName = safeDecodePlugin(pluginName || '');

    if (!cleanDeviceId || cleanDeviceId.toLowerCase() === 'unknown' || cleanDeviceId.toLowerCase() === 'null') {
        return { ok: false, statusCode: 400, error: { status: 'error', message: 'Device ID tidak valid.', reason: 'invalid_device' } };
    }

    if (allowRecovery) {
        const licCheck = db.getLicenseByKey(resolvedKey);
        if (!resolvedKey || !licCheck || licCheck.status !== 'active') {
            if (cleanDeviceId) {
                const devRecord = db.get("SELECT license_key FROM devices WHERE device_id = ? ORDER BY last_seen DESC LIMIT 1", [cleanDeviceId]);
                if (devRecord?.license_key) {
                    const validLic = db.getLicenseByKey(devRecord.license_key);
                    if (validLic?.status === 'active') {
                        resolvedKey = devRecord.license_key;
                    }
                }
            }

            if (!resolvedKey) {
                const csDeviceId = req.cookies?.cs_device_id;
                if (csDeviceId) {
                    const log = db.get("SELECT license_key FROM access_logs WHERE device_id = ? AND license_key != '' ORDER BY id DESC LIMIT 1", [csDeviceId]);
                    if (log?.license_key) {
                        const validLic = db.getLicenseByKey(log.license_key);
                        if (validLic?.status === 'active') {
                            resolvedKey = log.license_key;
                        }
                    }
                }
            }

            if (!resolvedKey && ip) {
                const recentLog = db.get("SELECT license_key FROM access_logs WHERE ip_address = ? AND license_key != '' AND created_at >= datetime('now', '-15 minutes') ORDER BY id DESC LIMIT 1", [ip]);
                if (recentLog?.license_key) {
                    const validLic = db.getLicenseByKey(recentLog.license_key);
                    if (validLic?.status === 'active') {
                        resolvedKey = recentLog.license_key;
                    }
                }
            }
        }
    }

    if (!resolvedKey) {
        db.logAccess('', 'VERIFY_FAIL', ip, `device:${cleanDeviceId} plugin:${cleanPluginName} reason:NO_KEY`, cleanDeviceId);
        return { ok: false, statusCode: 401, error: { status: 'error', message: 'Lisensi tidak ditemukan di plugin.', reason: 'no_key' } };
    }

    const result = db.validateLicense(resolvedKey, ip, cleanDeviceId, cleanDeviceModel, action);
    if (!result.valid) {
        const messages = {
            not_found: 'Lisensi tidak ditemukan',
            revoked: 'Lisensi telah dicabut oleh admin',
            expired: 'Lisensi telah kadaluarsa',
            max_devices: 'Batas perangkat maksimal tercapai',
            device_blocked: 'Perangkat ini diblokir',
            ip_blocked: 'IP ini diblokir'
        };
        db.logAccess(resolvedKey, 'VERIFY_FAIL', ip, `reason:${result.reason} action:${action} plugin:${cleanPluginName}`, cleanDeviceId);
        return {
            ok: false,
            statusCode: 403,
            error: {
                status: 'error',
                message: messages[result.reason] || 'Akses ditolak',
                reason: result.reason
            }
        };
    }

    if (result.isNewDevice) {
        db.logAccess(resolvedKey, 'DEVICE_REGISTERED', ip, `device:${cleanDeviceId} model:${cleanDeviceModel} plugin:${cleanPluginName} via ${action.toLowerCase()}`, cleanDeviceId);
    }

    createIPSession(ip, resolvedKey);
    return {
        ok: true,
        key: resolvedKey,
        deviceId: cleanDeviceId,
        deviceModel: cleanDeviceModel,
        pluginName: cleanPluginName,
        ip,
        result
    };
}

function validateRepoAccess(req) {
    const key = cleanInput(req.params.key || '');
    const token = cleanInput(req.params.token || '');
    const ip = getClientIP(req);

    if (!key) {
        return { ok: false, statusCode: 400, error: 'License key required' };
    }

    const lic = db.getLicenseByKey(key);
    if (!lic || lic.status !== 'active') {
        return { ok: false, statusCode: 403, error: 'License inactive' };
    }

    if (token) {
        const tokenCheck = db.validateDeviceToken(key, token, ip);
        if (!tokenCheck.valid) {
            return { ok: false, statusCode: 403, error: 'Invalid device token' };
        }
    }

    return { ok: true, key, token, license: lic };
}

// ============================================================
// DEVICE IDENTIFICATION (COOKIE-BASED TRACKING)
// ============================================================
// STRICT COOKIE TRACKING
// ============================================================
// To completely eradicate IP tracking, we generate a permanent Cookie-based Device ID 
// the absolute FIRST time CloudStream accesses the repository (repo.json).
// This cookie replaces the Native Sandbox ID and is the only absolute truth for device identity.

function getOrCreateDeviceCookie(req, res) {
    let deviceId = req.cookies && req.cookies.cs_device_id;

    // If no cookie exists, generate a new one and tell CloudStream to save it forever
    if (!deviceId) {
        deviceId = 'cs_' + crypto.randomBytes(8).toString('hex');
        if (res && typeof res.cookie === 'function') {
            res.cookie('cs_device_id', deviceId, {
                maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
                httpOnly: true,
                sameSite: 'None',
                secure: true
            });
        }
    }
    return deviceId;
}

// Function to clear cookies for testing or manual wipe
function clearDeviceCookie(res) {
    if (res && typeof res.clearCookie === 'function') {
        res.clearCookie('cs_device_id');
    }
}

// Removed ipSessions cleanup// ============================================================
// PUBLIC API — License Validation
// ============================================================

app.post('/api/validate', rateLimit(60000, 30), (req, res) => {
    try {
        const key = cleanInput(req.body.key);
        let deviceId = cleanInput(req.body.device_id);
        const deviceName = cleanInput(req.body.device_name);
        const ip = getClientIP(req);

        if (!deviceId || deviceId.toLowerCase() === 'unknown' || deviceId.toLowerCase() === 'null') {
            return res.json({ status: 'error', message: 'Device ID required. Please enter Repo URL first.' });
        }

        if (!key) {
            return res.json({ status: 'error', message: 'License key required' });
        }

        const result = db.validateLicense(key, ip, deviceId, deviceName, 'VALIDATE');

        if (!result.valid) {
            const messages = {
                not_found: 'License key not found',
                revoked: 'License has been revoked',
                expired: 'License has expired',
                max_devices: 'Maximum device limit reached',
                device_blocked: 'This device has been blocked'
            };
            db.logAccess(key, 'VALIDATE_FAIL', ip, `reason:${result.reason} device:${deviceId}`, deviceId);
            return res.json({ status: 'error', message: messages[result.reason] || 'Access denied', reason: result.reason });
        }

        const action = result.isNewDevice ? 'DEVICE_REGISTERED' : 'VALIDATE_OK';
        db.logAccess(key, action, ip, `device:${deviceId} name:${deviceName}`, deviceId);

        res.json({
            status: 'active',
            message: 'License valid',
            expires_at: result.license.expires_at,
            days_left: result.daysLeft,
            max_devices: result.license.max_devices
        });
    } catch (e) {
        console.error('Validate error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Heartbeat
// ============================================================

app.post('/api/heartbeat', rateLimit(60000, 60), (req, res) => {
    try {
        const key = cleanInput(req.body.key);
        let deviceId = cleanInput(req.body.device_id);
        const ip = getClientIP(req);

        if (!deviceId || deviceId.toLowerCase() === 'unknown' || deviceId.toLowerCase() === 'null') {
            return res.json({ status: 'error', message: 'Device ID required' });
        }

        if (!key) return res.json({ status: 'error', message: 'Key required' });

        // Full license re-validation on every heartbeat
        const result = db.validateLicense(key, ip, deviceId, '', 'HEARTBEAT');
        if (!result.valid) {
            return res.json({ status: 'error', reason: result.reason });
        }

        // Refresh IP session
        createIPSession(ip, key);
        db.logAccess(key, 'HEARTBEAT', ip, `device:${deviceId}`, deviceId);

        res.json({ status: 'active', days_left: result.daysLeft });
    } catch (e) {
        console.error('Heartbeat error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Quick IP Check
// ============================================================

app.get('/api/check-ip', rateLimit(60000, 120), (req, res) => {
    try {
        const ip = getClientIP(req);
        let deviceId = cleanInput(req.query.device_id || '');

        // The plugin now sends a persistent UUID via SharedPreferences.
        // If it still sends 'unknown' (old plugin version), reject it.
        if (!deviceId || deviceId.toLowerCase() === 'unknown' || deviceId.toLowerCase() === 'null') {
            return res.json({ status: 'error', message: 'Device ID tidak valid. Update plugin terbaru.' });
        }

        const pluginName = cleanInput(req.query.plugin || '');
        const action = cleanInput(req.query.action || '').toUpperCase();
        const data = cleanInput(req.query.data || '');
        const key = cleanInput(req.query.key || '');

        if (!key) {
            db.logAccess('', 'NO_KEY', ip, `device:${deviceId} plugin:${pluginName} action:${action}`, deviceId);
            return res.json({ status: 'error', message: 'Lisensi tidak ditemukan di plugin.' });
        }

        // Full license validation
        const result = db.validateLicense(key, ip, deviceId, 'CloudStream Sandbox', 'CHECK_IP');
        if (!result.valid) {
            const messages = {
                not_found: 'Lisensi tidak ditemukan',
                revoked: 'Lisensi telah dicabut oleh admin',
                expired: 'Lisensi telah kadaluarsa. Silakan perpanjang.',
                max_devices: 'Batas perangkat tercapai untuk lisensi ini',
                device_blocked: 'Perangkat ini telah diblokir'
            };
            db.logAccess(key, 'CHECK_IP_FAIL', ip, `reason:${result.reason} plugin:${pluginName} action:${action}`, deviceId);
            return res.json({ status: 'error', message: messages[result.reason] || 'Access denied', reason: result.reason });
        }

        if (result.isNewDevice) {
            db.logAccess(key, 'DEVICE_REGISTERED', ip, `device:${deviceId} plugin:${pluginName} via check-ip`, deviceId);
        }

        const lic = result.license;
        const now = new Date();
        const expiry = new Date(lic.expires_at);
        const daysLeft = Math.ceil((expiry - now) / 86400000);

        // Track all plugin actions with full detail
        if (action && action !== 'CHECK') {
            const trackableActions = ['HOME', 'OPEN', 'SEARCH', 'LOAD', 'PLAY', 'SWITCH', 'DOWNLOAD'];
            if (pluginName && trackableActions.includes(action)) {
                db.trackPluginUsage(key, deviceId, pluginName, action, ip);
            }

            if (action === 'HOME') {
                db.logAccess(key, 'HOME_ACCESS', ip, `plugin:${pluginName} device:${deviceId}`, deviceId);
            } else if (action === 'SWITCH') {
                db.logAccess(key, 'PLUGIN_SWITCH', ip, `plugin:${pluginName} device:${deviceId}`, deviceId);
            } else if (action === 'DOWNLOAD' || action === 'PLAY') {
                db.logAccess(key, action, ip, `plugin:${pluginName} data:${data} device:${deviceId}`, deviceId);
                if (data) {
                    db.trackPlayback(key, deviceId, pluginName, data,
                        action === 'DOWNLOAD' ? 'DOWNLOAD' : '', ip);
                }
            } else if (action === 'SEARCH') {
                db.logAccess(key, 'SEARCH', ip, `plugin:${pluginName} query:${data} device:${deviceId}`, deviceId);
            }
        }

        res.json({ status: 'active', message: 'Valid', expiry: lic.expires_at, days_left: daysLeft });
    } catch (e) {
        console.error('Check-IP error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Auto-discover license key via Cookie (Replaces IP)
// ============================================================

app.get('/api/discover', rateLimit(60000, 30), (req, res) => {
    try {
        const ip = getClientIP(req);
        if (db.isIPBlocked(ip)) {
            return res.json({ status: 'error', message: 'IP blocked' });
        }

        // Strategy 1: Look up by device_id from query parameter (Android plugin sends this)
        const deviceId = cleanInput(req.query.device_id || '');
        if (deviceId && deviceId.toLowerCase() !== 'unknown') {
            const devRecord = db.get("SELECT license_key FROM devices WHERE device_id = ? ORDER BY last_seen DESC LIMIT 1", [deviceId]);
            if (devRecord && devRecord.license_key) {
                const lic = db.getLicenseByKey(devRecord.license_key);
                if (lic && lic.status === 'active') {
                    console.log(`[DISCOVER] Found key for device ${deviceId}: ${devRecord.license_key}`);
                    return res.json({ status: 'active', key: devRecord.license_key, expires_at: lic.expires_at });
                }
            }
        }

        // Strategy 1b: In-memory IP bridge (fastest, populated on repo.json access)
        const memSession = ip ? ipSessions.get(ip) : null;
        if (memSession && memSession.key && Date.now() < memSession.expiresAt) {
            const lic = db.getLicenseByKey(memSession.key);
            if (lic && lic.status === 'active') {
                return res.json({ status: 'active', key: memSession.key, expires_at: lic.expires_at });
            }
        }

        // Strategy 2: Cookie-based session lookup
        const csDeviceId = req.cookies && req.cookies.cs_device_id;
        if (csDeviceId) {
            const log = db.get("SELECT license_key FROM access_logs WHERE device_id = ? AND license_key != '' ORDER BY id DESC LIMIT 1", [csDeviceId]);
            if (log && log.license_key) {
                const lic = db.getLicenseByKey(log.license_key);
                if (lic && lic.status === 'active') {
                    return res.json({ status: 'active', key: log.license_key, expires_at: lic.expires_at });
                }
            }
        }

        // Strategy 3: IP-based bridge (OkHttp does not send WebView cookies)
        // If the user setup the repository in the last 15 minutes from this IP, hand over the key.
        if (ip) {
            const recentLog = db.get("SELECT license_key FROM access_logs WHERE ip_address = ? AND license_key != '' AND created_at >= datetime('now', '-15 minutes') ORDER BY id DESC LIMIT 1", [ip]);
            if (recentLog && recentLog.license_key) {
                const lic = db.getLicenseByKey(recentLog.license_key);
                if (lic && lic.status === 'active') {
                    console.log(`[DISCOVER] Bridged key via IP ${ip}: ${recentLog.license_key}`);
                    return res.json({ status: 'active', key: recentLog.license_key, expires_at: lic.expires_at });
                }
            }
        }

        return res.json({ status: 'error', message: 'No active session for this device' });
    } catch (e) {
        console.error('Discover API error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Plugin Tracking & Verification (Unified)
// ============================================================

app.post('/api/verify_activity', rateLimit(60000, 120), (req, res) => {
    try {
        const deviceId = cleanInput(req.body.device_id);
        const deviceModel = cleanInput(req.body.device_model); // Hardware Model
        const pluginName = safeDecodePlugin(req.body.plugin_name);
        const action = cleanInput(req.body.action || 'OPEN').toUpperCase();
        const data = cleanInput(req.body.data || '');
        const resolved = resolveLicenseForRequest(req, {
            key: req.body.key,
            deviceId,
            deviceModel,
            action,
            pluginName,
            allowRecovery: true
        });

        if (!resolved.ok) {
            return res.status(resolved.statusCode).json(resolved.error);
        }

        const key = resolved.key;
        const ip = resolved.ip;
        const result = resolved.result;

        // Track plugin usage & playback
        if (pluginName && action) {
            if (action === 'PLAY' || action === 'DOWNLOAD') {
                db.trackPlayback(key, deviceId, pluginName, data || 'Unknown Video', action, ip);
                db.logAccess(key, action, ip, `plugin:${pluginName} data:${data} device:${deviceId}`, deviceId);
            } else {
                db.trackPluginUsage(key, deviceId, pluginName, action, ip);
                if (action !== 'OPEN' && action !== 'CHECK') {
                    db.logAccess(key, action, ip, `plugin:${pluginName} data:${data} device:${deviceId}`, deviceId);
                }
            }
        }

        res.json({ status: 'active', message: 'Valid', days_left: result.daysLeft });

        // Run abuse checks asynchronously (non-blocking)
        setImmediate(() => db.runAbuseChecks(key, deviceId, ip));
    } catch (e) {
        console.error('Verify activity error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/plugin/session', rateLimit(60000, 120), (req, res) => {
    try {
        const pluginName = safeDecodePlugin(req.body.plugin_name);
        const action = cleanInput(req.body.action || 'SESSION').toUpperCase();
        const resolved = resolveLicenseForRequest(req, {
            key: req.body.key,
            deviceId: req.body.device_id,
            deviceModel: req.body.device_model,
            action,
            pluginName,
            allowRecovery: true
        });

        if (!resolved.ok) {
            return res.status(resolved.statusCode).json(resolved.error);
        }

        const sessionToken = issuePluginSession({
            licenseKey: resolved.key,
            deviceId: resolved.deviceId,
            pluginName: resolved.pluginName
        });

        res.json({
            status: 'ok',
            session_token: sessionToken,
            expires_in: 300,
            plugin_name: resolved.pluginName
        });
    } catch (e) {
        console.error('Plugin session error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Legacy Plugin Tracking (Fallback)
// ============================================================

app.post('/api/track/plugin', rateLimit(60000, 60), (req, res) => {
    try {
        const key = cleanInput(req.body.key);
        const ip = getClientIP(req);
        const deviceId = getSafeDeviceId(req, req.body.device_id);
        const pluginName = safeDecodePlugin(req.body.plugin_name);
        const action = cleanInput(req.body.action || 'OPEN');

        if (!key || !pluginName) {
            return res.json({ status: 'error', message: 'Missing fields' });
        }

        const result = db.validateLicense(key, ip, deviceId, 'Android');
        if (!result.valid) {
            return res.json({ status: 'error', message: result.reason });
        }

        db.trackPluginUsage(key, deviceId, pluginName, action.toUpperCase(), ip);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Track plugin error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Playback Tracking
// ============================================================

app.post('/api/track/playback', rateLimit(60000, 60), (req, res) => {
    try {
        const key = cleanInput(req.body.key);
        const ip = getClientIP(req);
        const deviceId = getSafeDeviceId(req, req.body.device_id);

        const pluginName = safeDecodePlugin(req.body.plugin_name);
        const videoTitle = cleanInput(req.body.video_title);
        const sourceProvider = cleanInput(req.body.source_provider);

        if (!key || !pluginName || !videoTitle) {
            return res.json({ status: 'error', message: 'Missing fields' });
        }

        const result = db.validateLicense(key, ip, deviceId, 'Android');
        if (!result.valid) {
            return res.json({ status: 'error', message: result.reason });
        }

        db.trackPlayback(key, deviceId, pluginName, videoTitle, sourceProvider, ip);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Track playback error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// PUBLIC API — Config
// ============================================================

app.get('/api/config', (req, res) => {
    res.json({
        server_url: db.getSetting('server_url') || `${req.protocol}://${req.get('host')}`,
        version: '2.0.0'
    });
});

// ============================================================
// PUBLIC API — Health Check
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/r/:key/repo.json', (req, res) => {
    const access = validateRepoAccess(req);
    if (!access.ok) {
        return res.status(access.statusCode).json({ status: 'error', message: access.error });
    }
    const key = req.params.key;
    const ip = getClientIP(req);
    // Bridge IP -> license_key so /api/discover (strategy 3) can hand the key
    // to the plugin which has no cookie jar.
    try {
        createIPSession(ip, key);
        db.logAccess(key, 'REPO_ACCESS', ip, 'repo.json', '');
    } catch (e) {}
    const serverUrl = getBaseServerUrl(req);
    res.json({
        name: "CS Premium (Fixed)",
        description: "CloudStream Premium Extensions",
        manifestVersion: 1,
        pluginLists: [`${serverUrl}/r/${key}/plugins.json`]
    });
});


// ============================================================
// TOKEN-BASED REPO GATING — /r/:key/:token/repo.json
// ============================================================

app.get('/r/:key/:token/repo.json', (req, res) => {
    try {
        const access = validateRepoAccess(req);
        if (!access.ok) {
            return res.status(access.statusCode).json({ status: 'error', message: access.error });
        }
        const key = req.params.key;
        const token = req.params.token;
        const ip = getClientIP(req);
        try {
            createIPSession(ip, key);
            db.logAccess(key, 'REPO_ACCESS', ip, 'token-repo.json', '');
        } catch (e) {}
        const serverUrl = getBaseServerUrl(req);

        res.json({
            name: "Premium Extensions",
            description: "CloudStream Premium Extensions",
            manifestVersion: 1,
            pluginLists: [`${serverUrl}/r/${key}/${token}/plugins.json`]
        });
    } catch (e) {
        console.error('Token repo error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// UNIVERSAL PLUGINS LIST (CATCH-ALL BYPASS)
app.get(['/r/:key/plugins.json', '/r/:key/:token/plugins.json'], async (req, res) => {
    try {
        const access = validateRepoAccess(req);
        if (!access.ok) {
            return res.status(access.statusCode).json({ status: 'error', message: access.error });
        }
        // Refresh IP bridge so /api/discover can hand the key back to the plugin.
        try {
            const ip = getClientIP(req);
            createIPSession(ip, access.key);
            db.logAccess(access.key, 'REPO_ACCESS', ip, 'plugins.json', '');
        } catch (e) {}
        let finalPlugins = [];
        
        // 1. ALWAYS ADD LOCAL PLUGINS FIRST
        try {
            const localFile = path.join(__dirname, 'plugins.json');
            if (fs.existsSync(localFile)) {
                const localData = JSON.parse(fs.readFileSync(localFile, 'utf8'));
                if (Array.isArray(localData)) {
                    localData.forEach(p => {
                        if (p && p.internalName) finalPlugins.push(p);
                    });
                }
            }
        } catch (err) {}

        // 2. TRY GITHUB AS BACKUP
        try {
            const upstreams = [{ url: 'https://raw.githubusercontent.com/Makairamei/CS01.1/builds/plugins.json' }];
            const fetchPromises = upstreams.map(u => fetchJson(u.url, 3000).catch(() => []));
            const remoteResults = await Promise.all(fetchPromises);
            remoteResults.flat().forEach(p => {
                if (p && p.internalName) finalPlugins.push(p);
            });
        } catch (e) {}

        // 3. DEDUPLICATE & SEND
        const pluginMap = new Map();
        finalPlugins.forEach(p => pluginMap.set(p.internalName, p));

        res.json(Array.from(pluginMap.values()));
    } catch (e) {
        console.error('Plugins error:', e.message);
        res.json([]);
    }
});





app.get(['/r/:key/:filename', '/r/:key/:token/:filename'], (req, res) => {
    const access = validateRepoAccess(req);
    if (!access.ok) {
        return res.status(access.statusCode).send(access.error);
    }
    const filename = path.basename(req.params.filename || '');
    if (!filename || filename === 'repo.json' || filename === 'plugins.json') {
        return res.status(404).send('Not found');
    }

    const githubUrl = `https://raw.githubusercontent.com/Makairamei/CS01.1/builds/${filename}`;
    https.get(githubUrl, (response) => {
        if (response.statusCode !== 200) {
            return res.status(404).send('Plugin not found on GitHub');
        }
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        response.pipe(res);
    }).on('error', () => {
        res.status(500).send('Download error');
    });
});

// Test Upstream URL
app.post('/api/admin/test-repo', authMiddleware, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ status: 'error', message: 'URL required' });

        const json = await fetchJson(url, 5000);
        if (!Array.isArray(json)) return res.status(400).json({ status: 'error', message: 'Invalid JSON: expected array' });

        res.json({ status: 'ok', count: json.length });
    } catch (e) {
        res.status(400).json({ status: 'error', message: 'Fetch failed: ' + e.message });
    }
});

// ============================================================
// PUBLIC API — Plugin Selectors (Hybrid Security Layer)
// Returns CSS selectors / secret keys ONLY if license is valid.
// This is the core of the anti-bypass protection:
// Even if someone removes requireLicense() from the plugin,
// they still cannot scrape videos without these selectors.
// ============================================================

app.post('/api/selectors', pluginSessionMiddleware, (req, res) => {
    try {
        const active = requireActivePluginSession(req, res);
        if (!active.ok) return res.status(active.statusCode).json(active.error);

        const config = SELECTOR_CONFIG[active.pluginName];
        if (!config || config.type === 'api_secret') {
            return res.status(404).json({ status: 'error', message: 'Selector config not found' });
        }

        const { secret_key_default, secret_key_alt, ...safeConfig } = config;
        db.logAccess(active.licenseKey, 'SELECTORS_OK', getClientIP(req), `plugin:${active.pluginName}`, active.deviceId);
        return res.json({
            status: 'ok',
            plugin: active.pluginName,
            selectors: safeConfig,
            expires_at: Date.now() + (5 * 60 * 1000)
        });
    } catch (e) {
        console.error('Selectors error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});


// ============================================================
// PUBLIC API — Secret Key (for API-based plugins like MovieBox)
// Returns HMAC secret keys ONLY if license is valid.
// MovieBox uses these keys to generate request signatures.
// ============================================================

app.post('/api/secret', pluginSessionMiddleware, (req, res) => {
    try {
        const active = requireActivePluginSession(req, res);
        if (!active.ok) return res.status(active.statusCode).json(active.error);

        let config = SELECTOR_CONFIG[active.pluginName];
        if (!config && active.pluginName.includes('MovieBox')) {
            config = SELECTOR_CONFIG['MovieBox📦'];
        }

        if (!config || config.type !== 'api_secret') {
            return res.status(404).json({ status: 'error', message: 'Secret config not found' });
        }

        db.logAccess(active.licenseKey, 'SECRET_OK', getClientIP(req), `plugin:${active.pluginName}`, active.deviceId);
        return res.json({
            status: 'ok',
            secret_key_default: config.secret_key_default,
            secret_key_alt: config.secret_key_alt,
            k1: config.secret_key_default,
            k2: config.secret_key_alt,
            expires_at: Date.now() + (5 * 60 * 1000)
        });
    } catch (e) {
        console.error('Secret error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});


// ============================================================
// ADMIN AUTH
// ============================================================


app.post('/api/auth/login', rateLimit(300000, 20), (req, res) => {
    try {
        const { username, password } = req.body;
        const ip = getClientIP(req);

        if (!username || !password) {
            return res.status(400).json({ status: 'error', message: 'Missing credentials' });
        }

        // Check if IP blocked
        if (db.isIPBlocked(ip)) {
            return res.status(403).json({ status: 'error', message: 'IP blocked' });
        }

        const admin = db.getAdminByUsername(username);
        if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
            db.recordFailedLogin(ip);
            db.logAccess('', 'LOGIN_FAIL', ip, `username: ${username}`);
            db.logAdminAction(username, 'LOGIN_FAILED', 'Invalid credentials', ip);
            return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }

        // Clear failed logins on success
        db.clearFailedLogins(ip);

        const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        db.logAccess('', 'LOGIN_OK', ip, `admin: ${username}`);
        db.logAdminAction(admin.username, 'LOGIN', 'Successful login', ip);

        res.json({ status: 'ok', token, username: admin.username });
    } catch (e) {
        console.error('Login error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Dashboard
// ============================================================

app.get('/api/admin/dashboard', authMiddleware, (req, res) => {
    try {
        const stats = db.getDashboardStats();
        res.json({ status: 'ok', ...stats });
    } catch (e) {
        console.error('Dashboard error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — License Management
// ============================================================

app.post('/api/admin/licenses', authMiddleware, (req, res) => {
    try {
        const { duration_days, name, note, max_devices, count } = req.body;
        const ip = getClientIP(req);

        if (count && count > 1) {
            const keys = db.createBulkLicenses({
                count: Math.min(count, 100),
                durationDays: duration_days || 30,
                maxDevices: max_devices || 2,
                note: note || ''
            });
            db.logAccess('', 'BULK_CREATE', ip, `${keys.length} licenses created by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'CREATE_BULK_LICENSES', `Created ${keys.length} licenses (${duration_days || 30} days, ${max_devices || 2} max devices).\n\nGenerated Keys:\n${keys.join('\n')}`, ip);
            return res.json({ status: 'ok', keys });
        }

        const result = db.createLicense({
            durationDays: duration_days || 30,
            name: name || '',
            note: note || '',
            maxDevices: max_devices || 2
        });

        db.logAccess(result.key, 'LICENSE_CREATE', ip, `by ${req.admin.username}`);
        db.logAdminAction(req.admin.username, 'CREATE_LICENSE', `Created license ${result.key} (${name || 'Unnamed'} - ${duration_days || 30} days)`, ip);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('Create license error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/licenses', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const search = cleanInput(req.query.search || '');
        const status = cleanInput(req.query.status || '');
        const trashed = req.query.trashed === 'true';
        const dateFrom = cleanInput(req.query.date_from || '');

        const result = db.getLicensesPaginated(page, limit, search, status, trashed, dateFrom);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('List licenses error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Look up license by key (for device → license navigation)
app.get('/api/admin/licenses/by-key/:key', authMiddleware, (req, res) => {
    try {
        const lic = db.getLicenseByKey(req.params.key);
        if (!lic) return res.status(404).json({ status: 'error', message: 'License not found' });
        res.json({ status: 'ok', id: lic.id, license_key: lic.license_key, name: lic.name, status: lic.status });
    } catch (e) {
        console.error('License by key error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/licenses/:id/details', authMiddleware, (req, res) => {
    try {
        const details = db.getLicenseDetails(parseInt(req.params.id));
        if (!details) return res.status(404).json({ status: 'error', message: 'Not found' });
        res.json({ status: 'ok', ...details });
    } catch (e) {
        console.error('License details error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.put('/api/admin/licenses/:id', authMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, note, max_devices, expires_at, status: newStatus, action } = req.body;
        const ip = getClientIP(req);

        if (action === 'revoke') {
            db.updateLicenseStatus(id, 'revoked');
            db.logAccess('', 'LICENSE_REVOKE', ip, `id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'REVOKE_LICENSE', `Revoked license ID: ${id}`, ip);
        } else if (action === 'activate') {
            db.updateLicenseStatus(id, 'active');
            db.logAccess('', 'LICENSE_ACTIVATE', ip, `id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'ACTIVATE_LICENSE', `Activated license ID: ${id}`, ip);
        } else if (action === 'restore') {
            db.restoreLicense(id);
            db.logAccess('', 'LICENSE_RESTORE', ip, `id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'RESTORE_LICENSE', `Restored license ID: ${id}`, ip);
        } else {
            db.updateLicense(id, {
                name, note,
                maxDevices: max_devices,
                expiresAt: expires_at,
                status: newStatus
            });
            db.logAccess('', 'LICENSE_UPDATE', ip, `id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'UPDATE_LICENSE', `Updated details for license ID: ${id}.\nNew values: Status=${newStatus}, MaxDevices=${max_devices}, Expires=${expires_at}`, ip);
        }

        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Update license error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.delete('/api/admin/licenses/:id', authMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const force = req.query.force === 'true';
        const ip = getClientIP(req);

        if (force) {
            db.forceDeleteLicense(id);
            db.logAccess('', 'LICENSE_FORCE_DELETE', ip, `id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'FORCE_DELETE_LICENSE', `Permanently deleted license ID: ${id}`, ip);
        } else {
            db.softDeleteLicense(id);
            db.logAccess('', 'LICENSE_SOFT_DELETE', ip, `id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'DELETE_LICENSE', `Moved license ID: ${id} to trash`, ip);
        }

        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Delete license error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Bulk License Operations
// ============================================================

app.post('/api/admin/licenses/bulk', authMiddleware, (req, res) => {
    try {
        const { ids, action } = req.body;
        const ip = getClientIP(req);
        if (!Array.isArray(ids) || !ids.length || !action) {
            return res.status(400).json({ status: 'error', message: 'ids array and action required' });
        }
        const validActions = ['revoke', 'activate', 'delete', 'force_delete'];
        if (!validActions.includes(action)) {
            return res.status(400).json({ status: 'error', message: 'Invalid action' });
        }
        let processed = 0;
        for (const id of ids.slice(0, 100)) {
            const numId = parseInt(id);
            if (isNaN(numId)) continue;
            if (action === 'revoke') db.updateLicenseStatus(numId, 'revoked');
            else if (action === 'activate') db.updateLicenseStatus(numId, 'active');
            else if (action === 'delete') db.softDeleteLicense(numId);
            else if (action === 'force_delete') db.forceDeleteLicense(numId);
            processed++;
        }
        db.logAccess('', `BULK_${action.toUpperCase()}`, ip, `${processed} licenses by ${req.admin.username}`);
        db.logAdminAction(req.admin.username, `BULK_${action.toUpperCase()}`, `Processed ${processed} licenses.\n\nAffected License IDs: ${ids.join(', ')}`, ip);
        res.json({ status: 'ok', processed });
    } catch (e) {
        console.error('Bulk action error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Device Management
// ============================================================

app.get('/api/admin/devices', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const search = cleanInput(req.query.search || '');
        const status = cleanInput(req.query.status || '');

        const result = db.getDevicesPaginated(page, limit, search, status);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('List devices error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.put('/api/admin/devices/bulk', authMiddleware, (req, res) => {
    try {
        const { ids, action } = req.body;
        const ip = getClientIP(req);

        if (!Array.isArray(ids) || !ids.length || !action) {
            return res.status(400).json({ status: 'error', message: 'ids array and action required' });
        }
        const validActions = ['block', 'unblock', 'delete'];
        if (!validActions.includes(action)) {
            return res.status(400).json({ status: 'error', message: 'Invalid action' });
        }

        let processed = 0;
        for (const id of ids.slice(0, 500)) {
            const numId = parseInt(id);
            if (isNaN(numId)) continue;

            if (action === 'delete') {
                db.deleteDevice(numId);
            } else if (action === 'block') {
                db.blockDevice(numId);
            } else if (action === 'unblock') {
                db.unblockDevice(numId);
            }
            processed++;
        }

        db.logAdminAction(req.admin.username, `BULK_DEVICE_${action.toUpperCase()}`, `Processed ${processed} devices.\n\nAffected Device IDs: ${ids.join(', ')}`, ip);
        res.json({ status: 'ok', processed });
    } catch (e) {
        console.error('Bulk device action error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.put('/api/admin/devices/:id', authMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { action, name } = req.body;
        const ip = getClientIP(req);

        if (action === 'block') {
            db.blockDevice(id);
            db.logAccess('', 'DEVICE_BLOCK', ip, `device_id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'BLOCK_DEVICE', `Blocked device ID: ${id}`, ip);
        } else if (action === 'unblock') {
            db.unblockDevice(id);
            db.logAccess('', 'DEVICE_UNBLOCK', ip, `device_id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'UNBLOCK_DEVICE', `Unblocked device ID: ${id}`, ip);
        } else if (action === 'rename') {
            db.renameDevice(id, name || '');
            db.logAdminAction(req.admin.username, 'RENAME_DEVICE', `Renamed device ID: ${id} to ${name}`, ip);
        } else if (action === 'delete') {
            db.deleteDevice(id);
            db.logAccess('', 'DEVICE_DELETE', ip, `device_id:${id} by ${req.admin.username}`);
            db.logAdminAction(req.admin.username, 'DELETE_DEVICE', `Deleted device ID: ${id}`, ip);
        }

        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Device action error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.delete('/api/admin/devices/:id', authMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const ip = getClientIP(req);
        db.deleteDevice(id);
        db.logAccess('', 'DEVICE_DELETE', ip, `device_id:${id} by ${req.admin.username}`);
        db.logAdminAction(req.admin.username, 'DELETE_DEVICE', `Deleted device ID: ${id}`, ip);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Device delete error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Device Token Management
// ============================================================

// List tokens for a license
app.get('/api/admin/licenses/:id/tokens', authMiddleware, (req, res) => {
    try {
        const lic = db.getLicenseById(parseInt(req.params.id));
        if (!lic) return res.status(404).json({ status: 'error', message: 'License not found' });
        const tokens = db.getDeviceTokensByLicense(lic.license_key);
        const serverUrl = db.getSetting('server_url') || `http://${getLocalIP()}:${PORT}`;
        // Attach full repo URL + plugins URL per token
        const withUrls = tokens.map(t => ({
            ...t,
            repo_url: `${serverUrl}/r/${lic.license_key}/${t.token}/repo.json`,
            plugins_url: `${serverUrl}/r/${lic.license_key}/${t.token}/plugins.json`
        }));
        res.json({ status: 'ok', tokens: withUrls, license_key: lic.license_key });
    } catch (e) {
        console.error('List tokens error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Create new device token for a license
app.post('/api/admin/licenses/:id/tokens', authMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const lic = db.getLicenseById(id);
        if (!lic) return res.status(404).json({ status: 'error', message: 'License not found' });

        const label = cleanInput(req.body.label || '');
        const currentCount = db.getDeviceTokenCount(lic.license_key);

        if (lic.max_devices > 0 && currentCount >= lic.max_devices) {
            return res.json({ status: 'error', message: `Sudah ${currentCount} token. Hapus dulu atau naikkan max_devices.` });
        }

        const token = db.createDeviceToken(lic.license_key, label || `Device ${currentCount + 1}`);
        const serverUrl = db.getSetting('server_url') || `http://${getLocalIP()}:${PORT}`;
        const ip = getClientIP(req);

        db.logAdminAction(req.admin.username, 'CREATE_DEVICE_TOKEN', `Created token for license ${lic.license_key} label:${label}`, ip);

        res.json({
            status: 'ok',
            token,
            repo_url: `${serverUrl}/r/${lic.license_key}/${token}/repo.json`,
            plugins_url: `${serverUrl}/r/${lic.license_key}/${token}/plugins.json`
        });
    } catch (e) {
        console.error('Create token error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Block/Unblock/Rename/Delete a device token
app.put('/api/admin/device-tokens/:id', authMiddleware, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { action, label } = req.body;
        const ip = getClientIP(req);

        if (action === 'block') {
            db.blockDeviceToken(id);
            db.logAdminAction(req.admin.username, 'BLOCK_DEVICE_TOKEN', `Blocked token ID:${id}`, ip);
        } else if (action === 'unblock') {
            db.unblockDeviceToken(id);
            db.logAdminAction(req.admin.username, 'UNBLOCK_DEVICE_TOKEN', `Unblocked token ID:${id}`, ip);
        } else if (action === 'rename') {
            db.renameDeviceToken(id, cleanInput(label || ''));
            db.logAdminAction(req.admin.username, 'RENAME_DEVICE_TOKEN', `Renamed token ID:${id} to ${label}`, ip);
        } else if (action === 'delete') {
            db.deleteDeviceToken(id);
            db.logAdminAction(req.admin.username, 'DELETE_DEVICE_TOKEN', `Deleted token ID:${id}`, ip);
        }

        res.json({ status: 'ok' });
    } catch (e) {
        console.error('Token action error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Analytics
// ============================================================

app.get('/api/admin/plugin-usage', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = cleanInput(req.query.search || '');

        const result = db.getPluginUsagePaginated(page, limit, search);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('Plugin usage error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/playback-logs', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = cleanInput(req.query.search || '');

        const result = db.getPlaybackLogsPaginated(page, limit, search);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('Playback logs error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/export/licenses', authMiddleware, (req, res) => {
    try {
        const result = db.getLicensesPaginated(1, 10000, '', '', false);
        const licenses = result.licenses;
        const header = 'ID,License Key,Name,Max Devices,Status,Expires At,Created At,Note\n';
        const rows = licenses.map(l =>
            `${l.id},${l.license_key},"${l.name || ''}",${l.max_devices},${l.status},${l.expires_at},${l.created_at},"${(l.note || '').replace(/"/g, '""')}"`
        ).join('\n');

        db.logAdminAction(req.admin.username, 'EXPORT_LICENSES', `Exported ${licenses.length} licenses to CSV`, getClientIP(req));

        res.header('Content-Type', 'text/csv');
        res.attachment(`licenses-export-${new Date().toISOString().split('T')[0]}.csv`);
        res.send(header + rows);
    } catch (e) {
        console.error('Export licenses error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/admin-logs', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = cleanInput(req.query.search || '');

        const result = db.getAdminLogsPaginated(page, limit, search);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('Admin logs error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/logs', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = cleanInput(req.query.search || '');
        const action = cleanInput(req.query.action || '');

        const result = db.getAccessLogsPaginated(page, limit, search, action);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('Access logs error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Analytics Overview (Comprehensive)
// ============================================================

app.get('/api/admin/analytics/overview', authMiddleware, (req, res) => {
    try {
        const period = req.query.period || 'week';
        const data = db.getAnalyticsData(period);
        res.json({ status: 'ok', ...data });
    } catch (e) {
        console.error('Analytics overview error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Enhanced Analytics
// ============================================================

// Real-time activity feed (last N minutes)
app.get('/api/admin/activity-feed', authMiddleware, (req, res) => {
    try {
        const minutes = Math.min(parseInt(req.query.minutes) || 30, 1440);
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);

        const pluginActivity = db.all(
            `SELECT pu.license_key, pu.device_id, pu.plugin_name, pu.action, pu.ip_address, pu.used_at,
                    l.name as license_name,
                    COALESCE(d.device_name, '') as device_name,
                    COALESCE(d.device_alias, '') as device_alias,
                    d.id as device_db_id
             FROM plugin_usage pu
             LEFT JOIN licenses l ON pu.license_key = l.license_key
             LEFT JOIN devices d ON pu.license_key = d.license_key AND pu.device_id = d.device_id
             WHERE pu.used_at > datetime('now', '-${minutes} minutes')
             ORDER BY pu.used_at DESC LIMIT ?`, [limit]
        );

        const playbackActivity = db.all(
            `SELECT pl.license_key, pl.device_id, pl.plugin_name, pl.video_title, pl.source_provider, 
                    pl.ip_address, pl.played_at,
                    l.name as license_name,
                    COALESCE(d.device_name, '') as device_name,
                    COALESCE(d.device_alias, '') as device_alias,
                    d.id as device_db_id
             FROM playback_logs pl
             LEFT JOIN licenses l ON pl.license_key = l.license_key
             LEFT JOIN devices d ON pl.license_key = d.license_key AND pl.device_id = d.device_id
             WHERE pl.played_at > datetime('now', '-${minutes} minutes')
             ORDER BY pl.played_at DESC LIMIT ?`, [limit]
        );

        // Helper to build display name
        const displayName = (row) => {
            if (row.device_alias && row.device_alias.trim()) {
                return `${row.device_name || 'Unknown'} (${row.device_alias.trim()})`;
            }
            return row.device_name || '';
        };

        // Merge and sort by time
        const feed = [
            ...pluginActivity.map(a => ({ ...a, type: 'plugin', timestamp: a.used_at, display_name: displayName(a) })),
            ...playbackActivity.map(a => ({ ...a, type: 'playback', timestamp: a.played_at, display_name: displayName(a) }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);

        res.json({ status: 'ok', feed, count: feed.length });
    } catch (e) {
        console.error('Activity feed error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Sales & License Analytics
app.get('/api/admin/analytics/sales', authMiddleware, (req, res) => {
    try {
        const days = req.query.days || '14';
        const data = db.getSalesAnalytics(days);

        res.json({
            status: 'ok',
            ...data,
            period: days
        });
    } catch (e) {
        console.error('Analytics sales error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Plugin breakdown statistics
app.get('/api/admin/analytics/plugins', authMiddleware, (req, res) => {
    try {
        const daysParam = req.query.days;
        const isAll = daysParam === 'all';
        const days = isAll ? 36500 : Math.min(parseInt(daysParam) || 7, 365);

        // Usage by plugin
        const byPlugin = db.all(
            `SELECT plugin_name, action, COUNT(*) as count 
             FROM plugin_usage 
             WHERE used_at > datetime('now', '-${days} days')
             GROUP BY plugin_name, action
             ORDER BY count DESC`
        );

        // Unique users per plugin
        const uniqueUsers = db.all(
            `SELECT plugin_name, COUNT(DISTINCT license_key) as unique_users
             FROM plugin_usage
             WHERE used_at > datetime('now', '-${days} days')
             GROUP BY plugin_name
             ORDER BY unique_users DESC`
        );

        // Hourly activity pattern (last 24h)
        const hourlyPattern = db.all(
            `SELECT strftime('%H', used_at) as hour, COUNT(*) as count
             FROM plugin_usage
             WHERE used_at > datetime('now', '-1 day')
             GROUP BY hour
             ORDER BY hour`
        );

        // Most watched content
        const topContent = db.all(
            `SELECT video_title, plugin_name, COUNT(*) as play_count
             FROM playback_logs
             WHERE played_at > datetime('now', '-${days} days')
             GROUP BY video_title, plugin_name
             ORDER BY play_count DESC
             LIMIT 20`
        );

        // Download statistics
        const downloads = db.all(
            `SELECT plugin_name, COUNT(*) as download_count
             FROM playback_logs
             WHERE source_provider = 'DOWNLOAD' AND played_at > datetime('now', '-${days} days')
             GROUP BY plugin_name
             ORDER BY download_count DESC`
        );

        // Daily trends (last N days)
        const dailyTrends = db.all(
            `SELECT date(used_at) as day, plugin_name, action, COUNT(*) as count
             FROM plugin_usage
             WHERE used_at > datetime('now', '-${days} days')
             GROUP BY day, plugin_name, action
             ORDER BY day DESC`
        );

        res.json({
            status: 'ok',
            byPlugin, uniqueUsers, hourlyPattern,
            topContent, downloads, dailyTrends,
            period: `${days} days`
        });
    } catch (e) {
        console.error('Analytics plugins error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Per-user activity
app.get('/api/admin/analytics/user/:key', authMiddleware, (req, res) => {
    try {
        const key = req.params.key;
        const days = Math.min(parseInt(req.query.days) || 7, 90);

        const license = db.getLicenseByKey(key);
        if (!license) return res.status(404).json({ status: 'error', message: 'License not found' });

        const pluginUsage = db.all(
            `SELECT pu.plugin_name, pu.action, pu.device_id,
            COALESCE(d.device_name, '') as device_name,
            COUNT(*) as count, MAX(pu.used_at) as last_used
             FROM plugin_usage pu
             LEFT JOIN devices d ON pu.license_key = d.license_key AND pu.device_id = d.device_id
             WHERE pu.license_key = ? AND pu.used_at > datetime('now', '-${days} days')
             GROUP BY pu.plugin_name, pu.action, pu.device_id
             ORDER BY count DESC`, [key]
        );

        const playbackHistory = db.all(
            `SELECT pl.plugin_name, pl.video_title, pl.source_provider, pl.played_at,
            pl.device_id, pl.ip_address,
            COALESCE(d.device_name, '') as device_name
             FROM playback_logs pl
             LEFT JOIN devices d ON pl.license_key = d.license_key AND pl.device_id = d.device_id
             WHERE pl.license_key = ? AND pl.played_at > datetime('now', '-${days} days')
             ORDER BY pl.played_at DESC
             LIMIT 100`, [key]
        );

        const devices = db.all(
            `SELECT * FROM devices WHERE license_key = ? `, [key]
        );

        const recentLogs = db.all(
            `SELECT al.*, COALESCE(d.device_name, '') as device_name FROM access_logs al
             LEFT JOIN devices d ON al.license_key = d.license_key AND al.device_id = d.device_id
             WHERE al.license_key = ?
            ORDER BY al.created_at DESC LIMIT 50`, [key]
        );

        res.json({
            status: 'ok',
            license,
            pluginUsage,
            playbackHistory,
            devices,
            recentLogs,
            period: `${days} days`
        });
    } catch (e) {
        console.error('User analytics error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Active sessions overview
app.get('/api/admin/active-sessions', authMiddleware, (req, res) => {
    try {
        const sessions = [];
        res.json({ status: 'ok', sessions, count: sessions.length });
    } catch (e) {
        console.error('Active sessions error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Security
// ============================================================

app.get('/api/admin/security/failed-logins', authMiddleware, (req, res) => {
    try {
        const logs = db.getFailedLogins();
        res.json({ status: 'ok', logs });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/security/blocked-ips', authMiddleware, (req, res) => {
    try {
        const ips = db.getBlockedIPs();
        res.json({ status: 'ok', ips });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/admin/security/block-ip', authMiddleware, (req, res) => {
    try {
        const { ip, reason } = req.body;
        if (!ip) return res.status(400).json({ status: 'error', message: 'IP required' });
        db.blockIP(ip, reason || '');
        db.logAccess('', 'IP_BLOCK', getClientIP(req), `blocked ${ip} by ${req.admin.username}`);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/admin/security/unblock-ip', authMiddleware, (req, res) => {
    try {
        const { ip } = req.body;
        if (!ip) return res.status(400).json({ status: 'error', message: 'IP required' });
        db.unblockIP(ip);
        db.logAccess('', 'IP_UNBLOCK', getClientIP(req), `unblocked ${ip} by ${req.admin.username}`);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/admin/security/unblock-ips-bulk', authMiddleware, (req, res) => {
    try {
        const { ips } = req.body;
        if (!Array.isArray(ips) || !ips.length) {
            return res.status(400).json({ status: 'error', message: 'ips array required' });
        }
        let processed = 0;
        for (const ip of ips.slice(0, 100)) {
            if (typeof ip === 'string') {
                db.unblockIP(ip);
                processed++;
            }
        }
        db.logAccess('', 'BULK_IP_UNBLOCK', getClientIP(req), `${processed} IPs unblocked by ${req.admin.username}`);
        res.json({ status: 'ok', processed });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/security/blocked-devices', authMiddleware, (req, res) => {
    try {
        const blockedDevices = db.getBlockedDevices ? db.getBlockedDevices() : [];
        res.json({ status: 'ok', blocked_devices: blockedDevices });
    } catch (e) {
        console.error('Blocked devices error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});


app.post('/api/admin/security/block-license', authMiddleware, (req, res) => {
    try {
        const { license_key } = req.body;
        if (!license_key) return res.status(400).json({ status: 'error', message: 'License key required' });

        const lic = db.getLicenseByKey(license_key);
        if (!lic) return res.status(404).json({ status: 'error', message: 'License not found' });

        db.updateLicenseStatus(lic.id, 'revoked');
        db.logAdminAction(req.admin.username, 'BLOCK_LICENSE', `Blocked license key: ${license_key}`, getClientIP(req));
        res.json({ status: 'ok', message: 'License blocked successfully' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/admin/security/block-device', authMiddleware, (req, res) => {
    try {
        const { device_id } = req.body;
        if (!device_id) return res.status(400).json({ status: 'error', message: 'Device ID required' });

        const device = db.get('SELECT id FROM devices WHERE device_id = ? ORDER BY last_seen DESC LIMIT 1', [device_id]);
        if (!device) return res.status(404).json({ status: 'error', message: 'Device not found' });

        db.blockDevice(device.id);
        db.logAdminAction(req.admin.username, 'BLOCK_DEVICE', `Blocked device ID: ${device_id}`, getClientIP(req));
        res.json({ status: 'ok', message: 'Device blocked successfully' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Settings
// ============================================================

app.get('/api/admin/settings', authMiddleware, (req, res) => {
    try {
        const settings = db.getAllSettings();
        const obj = {};
        settings.forEach(s => { obj[s.key] = s.value; });
        res.json({ status: 'ok', settings: obj });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.put('/api/admin/settings', authMiddleware, (req, res) => {
    try {
        const settings = req.body.settings || req.body;
        if (settings && typeof settings === 'object') {
            for (const [k, v] of Object.entries(settings)) {
                db.setSetting(k, v);
                // If the setting key looks like a repository URL, ensure it's also in the repos table
                if (k.includes('repo') && v.startsWith('http')) {
                    try { db.addRepository('Settings Repo', v, 0); } catch (e) { }
                }
            }
        }
        db.logAccess('', 'SETTINGS_UPDATE', getClientIP(req), `by ${req.admin.username}`);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Password Change
// ============================================================

app.put('/api/admin/password', authMiddleware, (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ status: 'error', message: 'Both passwords required' });
        }
        if (new_password.length < 6) {
            return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
        }

        const admin = db.getAdminByUsername(req.admin.username);
        if (!bcrypt.compareSync(current_password, admin.password_hash)) {
            return res.status(401).json({ status: 'error', message: 'Current password incorrect' });
        }

        const hash = bcrypt.hashSync(new_password, 12);
        db.updateAdminPassword(admin.id, hash);
        db.logAccess('', 'PASSWORD_CHANGE', getClientIP(req), `admin: ${req.admin.username}`);
        db.logAdminAction(req.admin.username, 'UPDATE_PASSWORD', `Changed superadmin password`, getClientIP(req));

        res.json({ status: 'ok', message: 'Password updated' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Change Password (alias: /admin/change-password)
// ============================================================

app.post('/api/admin/change-password', authMiddleware, (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password)
            return res.status(400).json({ status: 'error', message: 'Both passwords required' });
        if (new_password.length < 6)
            return res.status(400).json({ status: 'error', message: 'Password too short (min 6)' });
        const admin = db.getAdminByUsername(req.admin.username);
        if (!bcrypt.compareSync(current_password, admin.password_hash))
            return res.status(401).json({ status: 'error', message: 'Current password incorrect' });
        const hash = bcrypt.hashSync(new_password, 12);
        db.updateAdminPassword(admin.id, hash);
        db.logAccess('', 'PASSWORD_CHANGE', getClientIP(req), `admin: ${req.admin.username}`);
        res.json({ status: 'ok', message: 'Password updated' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Failed Validations Feed
// ============================================================

app.get('/api/admin/failed-validations', authMiddleware, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const feed = db.getFailedValidations ? db.getFailedValidations(limit) : [];
        res.json({ status: 'ok', logs: feed, total: feed.length });
    } catch (e) {
        console.error('Failed validations error:', e.message);
        // Fallback: grab activity logs filtered by type
        try {
            const stmt = db.db.prepare(
                `SELECT * FROM access_logs WHERE action LIKE '%FAIL%' OR action LIKE '%BLOCK%' OR action LIKE '%INVALID%'
                 ORDER BY created_at DESC LIMIT ? `
            );
            const rows = stmt.getAsObject ? [] : db.db.exec(
                `SELECT * FROM access_logs WHERE action LIKE '%FAIL%' OR action LIKE '%BLOCK%' OR action LIKE '%INVALID%'
                 ORDER BY created_at DESC LIMIT 50`
            );
            const results = rows.length ? rows[0].values.map(r => ({
                action: r[2], license_key: r[1], ip_address: r[3], detail: r[4], timestamp: r[5]
            })) : [];
            res.json({ status: 'ok', logs: results, total: results.length });
        } catch {
            res.json({ status: 'ok', logs: [], total: 0 });
        }
    }
});

// NOTE: Primary bulk license route is defined earlier at /api/admin/licenses/bulk.
// This duplicate definition has been removed to prevent Express route conflicts.

// ============================================================
// ADMIN — Blocked IPs (alias path)
// ============================================================

app.get('/api/admin/blocked-ips', authMiddleware, (req, res) => {
    try {
        const blocked = db.getBlockedIPs ? db.getBlockedIPs() : [];
        res.json({ status: 'ok', blocked_ips: blocked });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

// ============================================================
// ADMIN — Repositories
// ============================================================

app.get('/api/admin/repos', authMiddleware, (req, res) => {
    try {
        const repos = db.getRepositories();
        res.json({ status: 'ok', repos });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/admin/repos', authMiddleware, (req, res) => {
    try {
        const { name, url, count } = req.body;
        if (!url) return res.status(400).json({ status: 'error', message: 'URL required' });

        const result = db.addRepository(name || 'Unknown Plugin Repo', url, count || 0);
        if (result.success) {
            db.logAccess('', 'ADD_REPO', getClientIP(req), `${url} by ${req.admin.username}`);
            res.json({ status: 'ok', message: 'Repository added successfully' });
        } else {
            res.status(400).json({ status: 'error', message: result.error });
        }
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.delete('/api/admin/repos/:id', authMiddleware, (req, res) => {
    try {
        const id = req.params.id;
        db.deleteRepository(id);
        db.logAccess('', 'DELETE_REPO', getClientIP(req), `Repo ID ${id} by ${req.admin.username}`);
        res.json({ status: 'ok', message: 'Repository deleted' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.post('/api/admin/repos/validate', authMiddleware, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ status: 'error', message: 'URL required' });

        // Node 18+ has native fetch, but we use a safer method for compatibility
        const https = require('https');
        https.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    let plugins = Array.isArray(json) ? json : (json.plugins || []);
                    res.json({
                        status: 'ok',
                        valid: true,
                        count: plugins.length,
                        plugins: plugins.slice(0, 50)
                    });
                } catch (e) { res.status(400).json({ status: 'error', message: 'Invalid JSON' }); }
            });
        }).on('error', (e) => { res.status(400).json({ status: 'error', message: e.message }); });
        return; // Exit async function

    } catch (e) {
        res.status(400).json({ status: 'error', message: 'Validation failed: ' + e.message });
    }
});

app.get('/api/admin/backup', authMiddleware, (req, res) => {
    try {
        const dbPath = path.join(__dirname, 'database.sqlite');
        const fileName = `cs-premium-backup-${new Date().toISOString().split('T')[0]}.sqlite`;

        db.logAdminAction(req.admin.username, 'DOWNLOAD_BACKUP', 'Downloaded database backup', getClientIP(req));

        res.download(dbPath, fileName, (err) => {
            if (err) {
                console.error('Backup download error:', err.message);
                if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Failed to download backup' });
            }
        });
    } catch (e) {
        console.error('Backup error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// ADMIN — Abuse Detection Alerts
// ============================================================

app.get('/api/admin/abuse-alerts', authMiddleware, (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const alertType = cleanInput(req.query.type || '');
        const isRead = req.query.is_read !== undefined ? req.query.is_read : '';

        const result = db.getAbuseAlertsPaginated(page, limit, alertType, isRead);
        res.json({ status: 'ok', ...result });
    } catch (e) {
        console.error('Abuse alerts error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.get('/api/admin/abuse-alerts/count', authMiddleware, (req, res) => {
    try {
        const count = db.getUnreadAlertCount();
        res.json({ status: 'ok', count });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.put('/api/admin/abuse-alerts/:id/read', authMiddleware, (req, res) => {
    try {
        db.markAlertRead(req.params.id);
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

app.put('/api/admin/abuse-alerts/read-all', authMiddleware, (req, res) => {
    try {
        db.markAllAlertsRead();
        db.logAdminAction(req.admin.username, 'MARK_ALL_ALERTS_READ', 'Marked all abuse alerts as read', getClientIP(req));
        res.json({ status: 'ok' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// START SERVER
// ============================================================

db.initDatabase().then(() => {
    const lanIP = getLocalIP();
    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('  ╔══════════════════════════════════════════╗');
        console.log('  ║   CloudStream Premium License Server     ║');
        console.log('  ╠══════════════════════════════════════════╣');
        console.log(`  ║  Local: http://localhost:${PORT}          ║`);
        console.log(`  ║  Network:  http://${lanIP}:${PORT}    ║`);
        console.log('  ╚══════════════════════════════════════════╝');
        console.log('');

        // Force ensure CS01.1 repository is present
        try {
            db.addRepository('CS01.1', 'https://raw.githubusercontent.com/Makairamei/CS01.1/builds/plugins.json', 0);
            console.log('  [AUTO] CS01.1 repository verified/added.');
        } catch (e) { /* ignore duplicate errors */ }
    });

    // ── Log Cleanup: delete records older than 90 days ──
    // Run once 30 seconds after startup, then every 24 hours
    setTimeout(() => {
        try {
            const deleted = db.cleanupOldLogs();
            if (deleted > 0) console.log(`  [CLEANUP] Startup cleanup removed ${deleted} old log entries`);
        } catch (e) { console.error('Startup cleanup error:', e.message); }
    }, 30000);

    setInterval(() => {
        try {
            const deleted = db.cleanupOldLogs();
            if (deleted > 0) console.log(`  [CLEANUP] Daily cleanup removed ${deleted} old log entries`);
        } catch (e) { console.error('Daily cleanup error:', e.message); }
    }, 24 * 60 * 60 * 1000);
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

// ============================================================
// FALLBACK — SPA (Must be last)
// ============================================================

app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

