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
const path = require('path');
const os = require('os');
const cookieParser = require('cookie-parser');
const db = require('./database');

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '24h';

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
                db.trackPluginUsage(session.key, deviceId, pluginName, action, ip);
            }

            if (action === 'HOME') {
                db.logAccess(session.key, 'HOME_ACCESS', ip, `plugin:${pluginName} device:${deviceId}`, deviceId);
            } else if (action === 'SWITCH') {
                db.logAccess(session.key, 'PLUGIN_SWITCH', ip, `plugin:${pluginName} device:${deviceId}`, deviceId);
            } else if (action === 'DOWNLOAD' || action === 'PLAY') {
                db.logAccess(session.key, action, ip, `plugin:${pluginName} data:${data} device:${deviceId}`, deviceId);
                if (data) {
                    db.trackPlayback(session.key, deviceId, pluginName, data,
                        action === 'DOWNLOAD' ? 'DOWNLOAD' : '', ip);
                }
            } else if (action === 'SEARCH') {
                db.logAccess(session.key, 'SEARCH', ip, `plugin:${pluginName} query:${data} device:${deviceId}`, deviceId);
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
        let key = cleanInput(req.body.key);
        const deviceId = cleanInput(req.body.device_id);
        const deviceModel = cleanInput(req.body.device_model); // Hardware Model
        const pluginName = safeDecodePlugin(req.body.plugin_name);
        const action = cleanInput(req.body.action || 'OPEN').toUpperCase();
        const data = cleanInput(req.body.data || '');
        const ip = getClientIP(req);

        if (!deviceId || deviceId.toLowerCase() === 'unknown' || deviceId.toLowerCase() === 'null') {
            return res.json({ status: 'error', message: 'Device ID tidak valid.' });
        }

        // AUTO-CORRECTION: If the provided key is invalid/revoked/missing, try to recover the correct key.
        const licCheck = db.getLicenseByKey(key);
        if (!key || !licCheck || licCheck.status !== 'active') {
            let recovered = false;

            // Strategy 1: Look up this device_id in the devices table to find its valid license
            if (!recovered && deviceId) {
                const devRecord = db.get("SELECT license_key FROM devices WHERE device_id = ? ORDER BY last_seen DESC LIMIT 1", [deviceId]);
                if (devRecord && devRecord.license_key) {
                    const validLic = db.getLicenseByKey(devRecord.license_key);
                    if (validLic && validLic.status === 'active') {
                        key = devRecord.license_key;
                        recovered = true;
                        console.log(`[AUTO-FIX] Recovered key for device ${deviceId}: ${key}`);
                    }
                }
            }

            // Strategy 2: Cookie-based session lookup (fallback for browser-like clients)
            if (!recovered) {
                const csDeviceId = req.cookies && req.cookies.cs_device_id;
                if (csDeviceId) {
                    const log = db.get("SELECT license_key FROM access_logs WHERE device_id = ? AND license_key != '' ORDER BY id DESC LIMIT 1", [csDeviceId]);
                    if (log && log.license_key) {
                        const validLic = db.getLicenseByKey(log.license_key);
                        if (validLic && validLic.status === 'active') {
                            key = log.license_key;
                            recovered = true;
                        }
                    }
                }
            }

            // Strategy 3: IP-based bridge (fallback for OkHttp clients without cookies that have the wrong key)
            if (!recovered && ip) {
                const recentLog = db.get("SELECT license_key FROM access_logs WHERE ip_address = ? AND license_key != '' AND created_at >= datetime('now', '-15 minutes') ORDER BY id DESC LIMIT 1", [ip]);
                if (recentLog && recentLog.license_key) {
                    const validLic = db.getLicenseByKey(recentLog.license_key);
                    if (validLic && validLic.status === 'active') {
                        key = recentLog.license_key;
                        recovered = true;
                        console.log(`[AUTO-FIX] Bridged key via IP ${ip}: ${key}`);
                    }
                }
            }
        }

        if (!key) {
            db.logAccess('', 'VERIFY_FAIL', ip, `device:${deviceId} plugin:${pluginName} reason:NO_KEY`, deviceId);
            return res.json({ status: 'error', message: 'Lisensi tidak ditemukan di plugin.' });
        }

        // 2. Main Validation
        const result = db.validateLicense(key, ip, deviceId, deviceModel || 'Android Device', action);

        if (!result.valid) {
            const msgs = {
                not_found: 'Lisensi tidak ditemukan',
                revoked: 'Lisensi telah dicabut oleh admin',
                expired: 'Lisensi telah kadaluarsa',
                max_devices: 'Batas perangkat maksimal tercapai',
                device_blocked: 'Perangkat ini diblokir',
                ip_blocked: 'IP ini diblokir'
            };
            db.logAccess(key, 'VERIFY_FAIL', ip, `reason:${result.reason} action:${action} plugin:${pluginName}`, deviceId);
            return res.json({ status: 'error', message: msgs[result.reason] || 'Akses ditolak', reason: result.reason });
        }

        // Log device registration if it's new
        if (result.isNewDevice) {
            db.logAccess(key, 'DEVICE_REGISTERED', ip, `device:${deviceId} model:${deviceModel} plugin:${pluginName} via verify_activity`, deviceId);
        }

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
        server_url: db.getSetting('server_url') || `http://${getLocalIP()}:${PORT}`,
        version: '2.0.0'
    });
});

// ============================================================
// PUBLIC API — Health Check
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ============================================================
// REPO GATING
// ============================================================

app.get('/r/:key/repo.json', rateLimit(60000, 60), (req, res) => {
    try {
        const key = req.params.key;
        const lic = db.getLicenseByKey(key);

        if (!lic || lic.status !== 'active') {
            return res.status(403).json({ status: 'error', message: 'Invalid or expired license' });
        }

        const expiry = new Date(lic.expires_at);
        if (new Date() > expiry) {
            db.updateLicenseStatus(lic.id, 'expired');
            return res.status(403).json({ status: 'error', message: 'License expired' });
        }

        const serverUrl = db.getSetting('server_url') || `http://${getLocalIP()}:${PORT}`;
        const ip = getClientIP(req);

        // We DO NOT validate devices on repo load anymore, only plugins validate.
        // This stops the 404/Not Found cookie conflict.

        const deviceId = getOrCreateDeviceCookie(req, res);
        db.logAccess(key, 'REPO_ACCESS', ip, `Browser / CloudStream`, deviceId);

        res.json({
            name: "Premium Extensions",
            description: "CloudStream Premium Extensions",
            manifestVersion: 1,
            pluginLists: [`${serverUrl}/r/${key}/plugins.json`]
        });
    } catch (e) {
        console.error('Repo error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// ============================================================
// TOKEN-BASED REPO GATING — /r/:key/:token/repo.json
// This is the RELIABLE method: token in URL = device identity.
// Works through VPN, WiFi, shared IP, carrier NAT — anything.
// ============================================================

app.get('/r/:key/:token/repo.json', rateLimit(60000, 60), (req, res) => {
    try {
        const key = req.params.key;
        const token = req.params.token;
        const ip = getClientIP(req);

        // 1. Full license validation (not just status check)
        const lic = db.getLicenseByKey(key);
        if (!lic) {
            db.logAccess(key, 'TOKEN_DENY', ip, `token:${token} reason:not_found`);
            return res.json({ status: 'error', message: 'Invalid license' });
        }
        if (lic.status === 'revoked') {
            db.logAccess(key, 'TOKEN_DENY', ip, `token:${token} reason:revoked`);
            return res.json({ status: 'error', message: 'License revoked' });
        }
        const now = new Date();
        if (now > new Date(lic.expires_at)) {
            db.updateLicenseStatus(lic.id, 'expired');
            db.logAccess(key, 'TOKEN_DENY', ip, `token:${token} reason:expired`);
            return res.json({ status: 'error', message: 'License expired. Please renew your subscription.' });
        }

        // 2. Validate device token
        const tokenResult = db.validateDeviceToken(key, token, ip);
        if (!tokenResult.valid) {
            const msgs = {
                invalid_token: 'Link device tidak valid. Minta link baru ke admin.',
                device_blocked: 'Device ini telah diblokir oleh admin.'
            };
            db.logAccess(key, 'TOKEN_DENY', ip, `token:${token} reason:${tokenResult.reason}`);
            return res.json({ status: 'error', message: msgs[tokenResult.reason] || 'Akses ditolak' });
        }
        const serverUrl = db.getSetting('server_url') || `http://${getLocalIP()}:${PORT}`;
        const deviceId = getOrCreateDeviceCookie(req, res);
        db.logAccess(key, 'TOKEN_REPO_ACCESS', ip, `token:${token} label:${tokenResult.token.label}`, deviceId);

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

app.get('/r/:key/:token/plugins.json', rateLimit(60000, 60), async (req, res) => {
    try {
        const key = req.params.key;
        const token = req.params.token;
        const ip = getClientIP(req);

        // Full license validation for download plugin gate
        const lic = db.getLicenseByKey(key);
        if (!lic) {
            db.logAccess(key, 'TOKEN_PLUGIN_DENY', ip, `token:${token} reason:not_found`);
            return res.json([]);
        }
        if (lic.status === 'revoked') {
            db.logAccess(key, 'LICENSE_REVOKED', ip, `token:${token}`);
            return res.json([]);
        }
        const nowCheck = new Date();
        if (nowCheck > new Date(lic.expires_at)) {
            db.updateLicenseStatus(lic.id, 'expired');
            db.logAccess(key, 'LICENSE_EXPIRED', ip, `token:${token}`);
            return res.json([]);
        }

        // Validate device token
        const tokenResult = db.validateDeviceToken(key, token, ip);
        if (!tokenResult.valid) {
            db.logAccess(key, 'TOKEN_PLUGIN_DENY', ip, `token:${token} reason:${tokenResult.reason}`);
            return res.json([]);
        }

        const deviceId = getOrCreateDeviceCookie(req, res);
        db.logAccess(key, 'TOKEN_PLUGIN_LIST_ACCESS', ip, `token:${token} label:${tokenResult.token.label}`, deviceId);

        // Fetch from upstream repositories
        let upstreamUrls = [];
        try {
            const repos = db.getRepositories();
            if (repos && repos.length > 0) {
                upstreamUrls = repos.map(r => ({ url: r.url, active: true }));
            }
        } catch (e) {
            console.error('Failed to get repositories', e);
        }

        if (!Array.isArray(upstreamUrls) || upstreamUrls.length === 0) {
            upstreamUrls = [{ url: 'https://raw.githubusercontent.com/Makairamei/CS/builds/plugins.json', active: true }];
        }

        const fetchPromises = upstreamUrls
            .filter(u => u.active && u.url)
            .map(async (u) => {
                try {
                    const r = await fetch(u.url, { signal: AbortSignal.timeout(5000) });
                    if (!r.ok) return [];
                    const json = await r.json();
                    return Array.isArray(json) ? json : [];
                } catch (err) {
                    console.error(`Failed to fetch upstream ${u.url}:`, err.message);
                    return [];
                }
            });

        const results = await Promise.all(fetchPromises);
        const pluginMap = new Map();
        results.flat().forEach(p => { if (p && p.internalName) pluginMap.set(p.internalName, p); });
        res.json(Array.from(pluginMap.values()));
    } catch (e) {
        console.error('Token plugins error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});


app.get('/r/:key/plugins.json', rateLimit(60000, 60), async (req, res) => {
    try {
        const key = req.params.key;
        const lic = db.getLicenseByKey(key);

        if (!lic || lic.status !== 'active') {
            return res.status(403).json({ status: 'error', message: 'Invalid license' });
        }

        const expiry = new Date(lic.expires_at);
        if (new Date() > expiry) {
            db.updateLicenseStatus(lic.id, 'expired');
            return res.status(403).json({ status: 'error', message: 'License expired' });
        }

        const ip = getClientIP(req);

        // STRICT COOKIE TRACKING: Ensure the Cookie ID is sent and logged
        const deviceId = getOrCreateDeviceCookie(req, res);
        db.logAccess(key, 'PLUGIN_LIST_ACCESS', ip, `device:${deviceId}`, deviceId);

        // Fetch from upstream repositories
        let upstreamUrls = [];
        try {
            const repos = db.getRepositories();
            if (repos && repos.length > 0) {
                upstreamUrls = repos.map(r => ({ url: r.url, active: true }));
            }
        } catch (e) {
            console.error('Failed to get repositories', e);
        }

        if (!Array.isArray(upstreamUrls) || upstreamUrls.length === 0) {
            // Default fallback
            upstreamUrls = [{ url: 'https://raw.githubusercontent.com/Makairamei/CS/builds/plugins.json', active: true }];
        }

        // Fetch all active upstreams in parallel
        const fetchPromises = upstreamUrls
            .filter(u => u.active && u.url)
            .map(async (u) => {
                try {
                    const res = await fetch(u.url, { signal: AbortSignal.timeout(5000) }); // 5s timeout
                    if (!res.ok) return [];
                    const json = await res.json();
                    return Array.isArray(json) ? json : [];
                } catch (err) {
                    console.error(`Failed to fetch upstream ${u.url}:`, err.message);
                    return [];
                }
            });

        const results = await Promise.all(fetchPromises);

        // Merge and Deduplicate (by internalName)
        const pluginMap = new Map();
        results.flat().forEach(p => {
            if (p && p.internalName) {
                // Later sources overwrite earlier ones if duplicate (allows overriding)
                pluginMap.set(p.internalName, p);
            }
        });

        const plugins = Array.from(pluginMap.values());
        res.json(plugins);
    } catch (e) {
        console.error('Plugins.json error:', e.message);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Test Upstream URL
app.post('/api/admin/test-repo', authMiddleware, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ status: 'error', message: 'URL required' });

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return res.status(400).json({ status: 'error', message: `Status ${response.status}` });

        const json = await response.json();
        if (!Array.isArray(json)) return res.status(400).json({ status: 'error', message: 'Invalid JSON: expected array' });

        res.json({ status: 'ok', count: json.length });
    } catch (e) {
        res.status(400).json({ status: 'error', message: 'Fetch failed: ' + e.message });
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
        const { settings } = req.body;
        if (settings && typeof settings === 'object') {
            for (const [k, v] of Object.entries(settings)) {
                db.setSetting(k, v);
            }
        }
        db.logAccess('', 'SETTINGS_UPDATE', getClientIP(req), `by ${req.admin.username}`);
        const settingsText = settings ? Object.keys(settings).map(k => `${k}: ${settings[k]}`).join('\n') : '';
        db.logAdminAction(req.admin.username, 'UPDATE_SETTINGS', `Updated global system settings: \n\n${settingsText}`, getClientIP(req));
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

        // Node 18+ has native fetch
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();

        let plugins = [];
        if (Array.isArray(data)) {
            plugins = data;
        } else if (data.plugins && Array.isArray(data.plugins)) {
            plugins = data.plugins;
        } else {
            throw new Error('Invalid JSON structure: Expected array of plugins');
        }

        // Return first 50 for preview
        res.json({
            status: 'ok',
            valid: true,
            count: plugins.length,
            plugins: plugins.slice(0, 50).map(p => ({
                name: p.name || p.Name || 'Unknown',
                package: p.internalName || p.package || 'unknown.package',
                version: p.version || '0.0.0',
                url: p.url || '',
                icon: p.icon || ''
            }))
        });

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

