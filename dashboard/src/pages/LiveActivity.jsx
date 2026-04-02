import { useState, useEffect, useCallback, useRef } from 'react';
import { get, timeAgo, truncKey, copyText } from '../lib/api';
import { Activity, Radio, Copy, Pause, Play, RefreshCw, Wifi } from 'lucide-react';
import ActivityDetailDrawer from '../components/ActivityDetailDrawer';

const EVENT_TYPES = ['All', 'VALIDATE_OK', 'VALIDATE_FAIL', 'PLUGIN_USE', 'PLAY', 'LOGIN_OK', 'LOGIN_FAIL'];

const EVENT_COLORS = {
    VALIDATE_OK: { bg: 'event-validate', badge: 'badge-info', icon: Activity },
    VALIDATE_FAIL: { bg: 'event-error', badge: 'badge-blocked', icon: Activity },
    PLUGIN_USE: { bg: 'event-plugin', badge: 'badge-active', icon: Radio },
    PLAY: { bg: 'event-play', badge: 'badge-warning', icon: Play },
    LOGIN_OK: { bg: 'event-device', badge: 'badge-info', icon: Wifi },
    LOGIN_FAIL: { bg: 'event-error', badge: 'badge-blocked', icon: Wifi },
};

export default function LiveActivity() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [paused, setPaused] = useState(false);
    const [filter, setFilter] = useState('All');
    const [counter, setCounter] = useState(0);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerLicense, setDrawerLicense] = useState(null);
    const [drawerDevice, setDrawerDevice] = useState(null);

    const openDrawer = (ev) => {
        if (!ev.license_key) return;
        setDrawerLicense(ev.license_key);
        setDrawerDevice(ev.device_id || null);
        setDrawerOpen(true);
    };

    const fetchFeed = useCallback(async () => {
        try {
            const data = await get('/admin/activity-feed?minutes=60&limit=100');
            const feed = data.feed || [];
            if (!paused) {
                setEvents(prev => {
                    const existingKeys = new Set(prev.map(e => `${e.timestamp}|${e.action}|${e.license_key}`));
                    const newEvts = feed.filter(e => !existingKeys.has(`${e.timestamp}|${e.action}|${e.license_key}`));
                    const merged = [...newEvts, ...prev].slice(0, 200);
                    setCounter(merged.filter(e => {
                        const d = new Date(e.timestamp);
                        return Date.now() - d.getTime() < 60000;
                    }).length);
                    return merged;
                });
            }
        } catch { } finally { setLoading(false); }
    }, [paused]);

    useEffect(() => { fetchFeed(); }, []);
    useEffect(() => {
        const id = setInterval(fetchFeed, 5000);
        return () => clearInterval(id);
    }, [fetchFeed]);

    const filtered = events.filter(e => {
        if (filter === 'All') return true;
        return (e.action || '').toUpperCase().includes(filter.replace('_', ''));
    });

    const getColor = (action) => {
        const a = (action || '').toUpperCase();
        for (const [key, val] of Object.entries(EVENT_COLORS)) {
            if (a.includes(key.split('_')[0])) return val;
        }
        return { bg: '', badge: 'badge-info', icon: Activity };
    };

    return (
        <div className="space-y-4">
            {/* Header bar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 pulse-dot" />
                        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">Live Feed</span>
                    </div>
                    <span className="badge badge-info">{counter} / min</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 overflow-x-auto custom-scroll pb-1">
                        {[
                            { key: 'All', label: 'All', color: 'slate' },
                            { key: 'VALIDATE_OK', label: 'Validate OK', color: 'emerald' },
                            { key: 'VALIDATE_FAIL', label: 'Validate Fail', color: 'red' },
                            { key: 'PLAY', label: 'Play', color: 'indigo' },
                            { key: 'PLUGIN_USE', label: 'Plugin', color: 'amber' }
                        ].map(t => {
                            const isActive = filter === t.key;
                            const colorMap = {
                                slate: isActive ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
                                emerald: isActive ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20',
                                red: isActive ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20',
                                indigo: isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20',
                                amber: isActive ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20'
                            };
                            return (
                                <button key={t.key} onClick={() => setFilter(t.key)}
                                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${colorMap[t.color]}`}>
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={() => setPaused(v => !v)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${paused ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                        {paused ? <><Play className="w-3 h-3" />Resume</> : <><Pause className="w-3 h-3" />Pause</>}
                    </button>
                    <button onClick={fetchFeed} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Feed */}
            <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>License Info</th>
                                <th>Event Type</th>
                                <th>Device & IP</th>
                                <th>Plugin</th>
                                <th>Content Title</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(8)].map((_, i) => (
                                    <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-24 rounded" /></td>)}</tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-12 text-[13px] text-slate-400">No events yet — waiting for activity…</td></tr>
                            ) : filtered.map((ev, i) => {
                                const { badge } = getColor(ev.action);
                                // display_name: alias-aware from server, fallback to device_name
                                const devDisplay = ev.display_name || ev.device_name || '';
                                return (
                                    <tr key={i} className="fade-in">
                                        <td>
                                            {ev.license_key ? (
                                                <div className="flex flex-col">
                                                    <button onClick={() => openDrawer(ev)} className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-600 hover:underline text-left">
                                                        {ev.license_name || 'Unnamed License'}
                                                    </button>
                                                    <button onClick={() => copyText(ev.license_key)} className="flex items-center gap-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline w-fit">
                                                        {truncKey(ev.license_key)} <Copy className="w-3 h-3 opacity-40" />
                                                    </button>
                                                </div>
                                            ) : <span className="text-slate-400 text-[12px]">—</span>}
                                        </td>
                                        <td><span className={`badge ${badge}`}>{ev.action || ev.type || 'EVENT'}</span></td>
                                        <td className="text-[12px] text-slate-600 dark:text-slate-400">
                                            {ev.ip_address || devDisplay || ev.device_id ? (
                                                <div className="flex flex-col gap-0.5">
                                                    {devDisplay ? (
                                                        <button
                                                            onClick={() => openDrawer(ev)}
                                                            className="font-medium text-[11px] text-slate-700 dark:text-slate-300 hover:text-indigo-600 hover:underline text-left"
                                                        >
                                                            {devDisplay}
                                                        </button>
                                                    ) : (
                                                        <span className="font-medium text-[11px] text-slate-500">Unknown Device</span>
                                                    )}
                                                    <span className="font-mono text-[10px] text-slate-500">
                                                        {ev.ip_address || '—'}
                                                    </span>
                                                    {ev.device_id && (
                                                        <span className="font-mono text-[9px] text-slate-400/80" title="Raw Device ID">
                                                            ID: {ev.device_id.length > 12 ? ev.device_id.substring(0, 12) + '…' : ev.device_id}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td className="text-[12px] text-slate-600 dark:text-slate-400">{ev.plugin_name || '—'}</td>
                                        <td className="text-[12px] text-slate-600 dark:text-slate-400 max-w-[200px] truncate">{ev.video_title || ev.detail || '—'}</td>
                                        <td className="text-[11px] text-slate-400 whitespace-nowrap">{timeAgo(ev.timestamp)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {paused && (
                    <div className="flex items-center justify-center gap-2 py-3 bg-amber-50 dark:bg-amber-500/5 text-[12px] text-amber-600 dark:text-amber-400 border-t border-amber-100 dark:border-amber-500/10">
                        <Pause className="w-3.5 h-3.5" /> Feed paused — click Resume to continue
                    </div>
                )}
            </div>

            {/* Detail Drawer */}
            <ActivityDetailDrawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                licenseKey={drawerLicense}
                deviceId={drawerDevice}
            />
        </div>
    );
}
