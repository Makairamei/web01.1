import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInterval } from '../hooks/useApi';
import { get, formatNumber, truncKey } from '../lib/api';
import {
    AreaChart, Area, BarChart, Bar,
    XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
    PieChart, Pie, Cell, Legend
} from 'recharts';
import {
    Key, CheckCircle, Clock, AlertTriangle, XCircle, TrendingUp,
    Wifi, WifiOff, Smartphone, Shield, Plus, LogIn, AlertOctagon,
    PlayCircle, Activity, Server, ShieldAlert,
    Users, Package, Film, Monitor, RefreshCw, Copy,
    BarChart3, LayoutGrid, ChevronRight
} from 'lucide-react';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function cleanTitle(raw) {
    if (!raw) return '—';
    if (raw.startsWith('http')) {
        try {
            const url = new URL(raw);
            const parts = url.pathname.split('/').filter(Boolean);
            const last = parts[parts.length - 1] || url.hostname;
            return decodeURIComponent(last)
                .replace(/[-_]/g, ' ')
                .replace(/\.(mp4|mkv|avi|m3u8)$/i, '')
                .replace(/\b\w/g, c => c.toUpperCase())
                .trim() || raw;
        } catch { return raw; }
    }
    return raw;
}

const PIE_COLORS_MAP = {
    active: '#10b981', expired: '#ef4444', revoked: '#f59e0b', trial: '#6366f1',
    on: '#10b981', off: '#94a3b8', blocked: '#ef4444'
};

// ─────────────────────────────────────────────
// SHARED: Chart Tooltip
// ─────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-xl px-3.5 py-2.5 min-w-[120px] pointer-events-none z-50">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{label}</p>
            {payload.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
                        <span className="text-[11px] text-slate-500">{e.name}</span>
                    </div>
                    <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{formatNumber(e.value)}</span>
                </div>
            ))}
        </div>
    );
};

// ─────────────────────────────────────────────
// SHARED: KPI Card (Clickable)
// ─────────────────────────────────────────────
const ICON_COLORS = {
    indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-500/10',  text: 'text-indigo-500',  border: 'border-l-indigo-500', hover: 'hover:border-l-indigo-400' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-500', border: 'border-l-emerald-500', hover: 'hover:border-l-emerald-400' },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-500/10',       text: 'text-rose-500',    border: 'border-l-rose-500', hover: 'hover:border-l-rose-400'    },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-500',   border: 'border-l-amber-500', hover: 'hover:border-l-amber-400'   },
    blue:    { bg: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-500',    border: 'border-l-blue-500', hover: 'hover:border-l-blue-400'    },
    violet:  { bg: 'bg-violet-50 dark:bg-violet-500/10',   text: 'text-violet-500',  border: 'border-l-violet-500', hover: 'hover:border-l-violet-400'  },
    cyan:    { bg: 'bg-cyan-50 dark:bg-cyan-500/10',       text: 'text-cyan-500',    border: 'border-l-cyan-500', hover: 'hover:border-l-cyan-400'    },
    slate:   { bg: 'bg-slate-50 dark:bg-slate-800',        text: 'text-slate-400',   border: 'border-l-slate-300', hover: 'hover:border-l-slate-400'   },
    orange:  { bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-500',  border: 'border-l-orange-500', hover: 'hover:border-l-orange-400'  },
    teal:    { bg: 'bg-teal-50 dark:bg-teal-500/10',       text: 'text-teal-500',    border: 'border-l-teal-500', hover: 'hover:border-l-teal-400'    },
    pink:    { bg: 'bg-pink-50 dark:bg-pink-500/10',       text: 'text-pink-500',    border: 'border-l-pink-500', hover: 'hover:border-l-pink-400'    },
};

function KpiCard({ label, value, icon: Icon, color = 'indigo', sub, path }) {
    const nav = useNavigate();
    const c = ICON_COLORS[color] || ICON_COLORS.indigo;
    const display = typeof value === 'number' ? formatNumber(value)
        : (value !== null && value !== undefined ? String(value) : '—');
        
    return (
        <div 
            onClick={() => path && nav(path)}
            className={`glass-card p-4 border-l-[3px] transition-all duration-200 ${c.border} ${path ? `cursor-pointer hover:shadow-md hover:-translate-y-0.5 group ${c.hover}` : ''}`}
        >
            <div className="flex items-start justify-between gap-2 mb-3">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest leading-tight flex items-center gap-1">
                    {label}
                    {path && <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity -ml-1" />}
                </span>
                <div className={`p-1.5 rounded-lg shrink-0 ${c.bg}`}>
                    <Icon className={`w-3.5 h-3.5 ${c.text}`} />
                </div>
            </div>
            <div className="flex items-baseline gap-2">
                <span className="text-[26px] font-extrabold text-slate-800 dark:text-white leading-none tracking-tight group-hover:text-indigo-500 transition-colors">{display}</span>
                {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// SHARED: Top List Row (Clickable)
// ─────────────────────────────────────────────
function RankRow({ rank, title, subtitle, count, unit = 'aktivitas', isUrl, onClick }) {
    const displayTitle = isUrl ? cleanTitle(title) : title;
    return (
        <div 
            onClick={onClick}
            className={`flex items-center gap-3 py-2.5 border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 rounded-lg px-2 transition-colors ${onClick ? 'cursor-pointer group' : ''}`}
        >
            <span className="text-[12px] font-bold text-slate-300 dark:text-slate-600 w-5 text-right shrink-0 tabular-nums">{rank}</span>
            <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate ${onClick ? 'group-hover:text-indigo-500 transition-colors' : ''}`} title={title}>{displayTitle}</p>
                {subtitle && <p className="text-[11px] text-slate-400 truncate mt-0.5">{subtitle}</p>}
            </div>
            <div className="text-right shrink-0 flex items-center gap-2">
                <div>
                    <p className="text-[14px] font-extrabold text-slate-700 dark:text-slate-200 tabular-nums group-hover:text-indigo-500 transition-colors">{formatNumber(count)}</p>
                    <p className="text-[9px] text-slate-400 uppercase tracking-wide">{unit}</p>
                </div>
                {onClick && <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all -mr-1" />}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// SHARED: Empty panel
// ─────────────────────────────────────────────
function Empty({ text = 'Belum ada data' }) {
    return (
        <div className="flex flex-col items-center gap-2 py-10">
            <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-[12px] text-slate-400">{text}</p>
        </div>
    );
}

// ─────────────────────────────────────────────
// TAB PANELS
// ─────────────────────────────────────────────

// ── OVERVIEW TAB ──────────────────────────────
function OverviewTab({ stats, period }) {
    const nav = useNavigate();
    const chartLabel = period === 'today' ? '24h' : period === 'month' ? '30 Days' : period === 'year' ? '12 Months' : period === 'all' ? 'All Time' : '7 Days';

    const trendData = (() => {
        const map = {};
        (stats?.dailyValidations || []).forEach(d => {
            const k = d.day; if (!map[k]) map[k] = { day: d.day?.slice(5) || k };
            map[k].Validasi = d.count || 0;
        });
        (stats?.dailyPlaybacks || []).forEach(d => {
            const k = d.day; if (!map[k]) map[k] = { day: d.day?.slice(5) || k };
            map[k].Playback = d.count || 0;
        });
        (stats?.dailyFailures || []).forEach(d => {
            const k = d.day; if (!map[k]) map[k] = { day: d.day?.slice(5) || k };
            map[k].Gagal = d.count || 0;
        });
        return Object.values(map).sort((a, b) => a.day > b.day ? 1 : -1)
            .map(d => ({ day: d.day, Validasi: d.Validasi || 0, Playback: d.Playback || 0, Gagal: d.Gagal || 0 }));
    })();

    const hourly = (stats?.hourlyActivity || []).map(d => ({
        hour: `${String(d.hour).padStart(2, '0')}`, count: d.count || 0,
    }));

    const pie = ['active', 'expired', 'revoked', 'trial']
        .map(k => ({
            name: { active: 'Aktif', expired: 'Expired', revoked: 'Suspended', trial: 'Trial' }[k],
            key: k,
            value: ({
                active: stats?.activeLicenses, expired: stats?.expiredLicenses,
                revoked: stats?.revokedLicenses, trial: stats?.trialLicenses,
            })[k] || 0
        })).filter(d => d.value > 0);

    return (
        <div className="space-y-5">
            {/* Quick summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard label="Total Lisensi"      value={stats?.totalLicenses}    icon={Key}        color="indigo"  path="/licenses" />
                <KpiCard label="Total Device"       value={stats?.totalDevices}     icon={Monitor}    color="blue"    path="/devices" />
                <KpiCard label="Playback Hari Ini"  value={stats?.todayPlaybacks}   icon={PlayCircle} color="emerald" path="/activity/playback" />
                <KpiCard label="API Request"        value={stats?.apiRequestCount}  icon={Server}     color="violet"  path="/activity/live" sub="Hari ini" />
            </div>

            {/* 3 Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Trend */}
                <div className="glass-card p-5">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 mb-0.5">Activity Trend</p>
                    <p className="text-[11px] text-slate-400 mb-4">Validasi & Playback ({chartLabel})</p>
                    {trendData.length === 0 ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={210}>
                            <AreaChart data={trendData} margin={{ left: -16, right: 4, top: 4, bottom: 0 }}>
                                <defs>
                                    {[['gV','#6366f1'],['gP','#10b981'],['gF','#ef4444']].map(([id, color]) => (
                                        <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                                        </linearGradient>
                                    ))}
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.4} />
                                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} tickFormatter={formatNumber} />
                                <Tooltip content={<ChartTooltip />} />
                                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                                <Area type="monotone" dataKey="Validasi" stroke="#6366f1" strokeWidth={2.5} fill="url(#gV)" dot={false} />
                                <Area type="monotone" dataKey="Playback" stroke="#10b981" strokeWidth={2.5} fill="url(#gP)" dot={false} />
                                <Area type="monotone" dataKey="Gagal"    stroke="#ef4444" strokeWidth={2}   fill="url(#gF)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Hourly */}
                <div className="glass-card p-5">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 mb-0.5">Aktivitas per Jam</p>
                    <p className="text-[11px] text-slate-400 mb-4">Distribusi trafik 24 jam terakhir</p>
                    {hourly.length === 0 ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={210}>
                            <BarChart data={hourly} margin={{ left: -16, right: 4, top: 4, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#818cf8" />
                                        <stop offset="100%" stopColor="#4f46e5" />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.4} />
                                <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={3} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} tickFormatter={formatNumber} />
                                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)', radius: 4 }}/>
                                <Bar dataKey="count" name="Aktivitas" fill="url(#gB)" radius={[4, 4, 0, 0]} barSize={16} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Pie */}
                <div className="glass-card p-5">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 mb-0.5">Distribusi Lisensi</p>
                    <p className="text-[11px] text-slate-400 mb-4">Komposisi status semua lisensi</p>
                    {pie.length === 0 ? <Empty /> : (
                        <div className="flex flex-col items-center justify-center gap-6 mt-4">
                            <PieChart width={150} height={150}>
                                <Pie data={pie} cx={75} cy={75} innerRadius={50} outerRadius={75}
                                    paddingAngle={3} dataKey="value" strokeWidth={0}>
                                    {pie.map(e => <Cell key={e.key} fill={PIE_COLORS_MAP[e.key] || '#94a3b8'} />)}
                                </Pie>
                                <Tooltip content={<ChartTooltip />} />
                            </PieChart>
                            <div className="w-full space-y-2">
                                {pie.map(e => (
                                    <div key={e.key} onClick={() => nav(e.key === 'active' ? '/licenses?status=active' : e.key === 'expired' ? '/licenses?status=expired' : '/licenses')} className="flex items-center justify-between p-1.5 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS_MAP[e.key] }} />
                                            <span className="text-[12px] font-medium text-slate-600 dark:text-slate-400 group-hover:text-indigo-500 transition-colors">{e.name}</span>
                                        </div>
                                        <span className="text-[13px] font-extrabold text-slate-700 dark:text-slate-200 tabular-nums">{formatNumber(e.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── LICENSE TAB ───────────────────────────────
function LicenseTab({ stats }) {
    const nav = useNavigate();
    const pie = ['active', 'expired', 'revoked', 'trial']
        .map(k => ({
            name: { active: 'Aktif', expired: 'Expired', revoked: 'Suspended', trial: 'Trial' }[k],
            key: k,
            value: ({
                active: stats?.activeLicenses, expired: stats?.expiredLicenses,
                revoked: stats?.revokedLicenses, trial: stats?.trialLicenses,
            })[k] || 0
        })).filter(d => d.value > 0);

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Total Lisensi"   value={stats?.totalLicenses}   icon={Key}          color="indigo"  path="/licenses" />
                <KpiCard label="Aktif"           value={stats?.activeLicenses}  icon={CheckCircle}  color="emerald" path="/licenses?status=active" />
                <KpiCard label="Expired"         value={stats?.expiredLicenses} icon={XCircle}      color="rose"    path="/licenses?status=expired" />
                <KpiCard label="Expiring Soon"   value={stats?.expiringSoon}    icon={Clock}        color="amber"   path="/licenses" sub="≤ 7 hari" />
                <KpiCard label="Suspended"       value={stats?.revokedLicenses} icon={Shield}       color="pink"    path="/security" />
                <KpiCard label="Trial"           value={stats?.trialLicenses}   icon={Key}          color="teal"    path="/licenses?status=active" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Chart section */}
                <div className="glass-card p-5 lg:col-span-1">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 mb-0.5">Komposisi Terkini</p>
                    <p className="text-[11px] text-slate-400 mb-6">Status seluruh lisensi saat ini</p>
                    {pie.length === 0 ? <Empty /> : (
                        <div className="flex flex-col items-center justify-center gap-6">
                            <PieChart width={160} height={160}>
                                <Pie data={pie} cx={80} cy={80} innerRadius={55} outerRadius={80}
                                    paddingAngle={3} dataKey="value" strokeWidth={0}>
                                    {pie.map(e => <Cell key={e.key} fill={PIE_COLORS_MAP[e.key] || '#94a3b8'} />)}
                                </Pie>
                                <Tooltip content={<ChartTooltip />} />
                            </PieChart>
                            <div className="w-full space-y-1">
                                {pie.map(e => (
                                    <div key={e.key} onClick={() => nav(e.key === 'active' ? '/licenses?status=active' : e.key === 'expired' ? '/licenses?status=expired' : '/licenses')} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors">
                                        <div className="flex items-center gap-2">
                                            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PIE_COLORS_MAP[e.key] }} />
                                            <span className="text-[12px] font-medium text-slate-600 dark:text-slate-400">{e.name}</span>
                                        </div>
                                        <span className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{formatNumber(e.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Top List */}
                <div className="glass-card overflow-hidden lg:col-span-2 flex flex-col">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Lisensi dengan Device Terbanyak</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Rata-rata {stats?.avgDevicesPerLicense ?? '—'} device per lisensi</p>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 flex-1 overflow-auto custom-scroll p-2">
                        {stats?.mostDevicesPerUser?.length > 0
                            ? stats.mostDevicesPerUser.slice(0, 10).map((item, i) => (
                                <div key={i} onClick={() => nav(`/devices?search=${encodeURIComponent(item.license_key)}`)} className="flex items-center gap-4 py-2.5 px-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/50 cursor-pointer rounded-lg transition-colors group">
                                    <span className="text-[12px] font-bold text-slate-300 dark:text-slate-600 w-5 text-right shrink-0">{i + 1}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate group-hover:text-indigo-500 transition-colors">{item.license_name || 'Unnamed'}</p>
                                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">{truncKey(item.license_key)}</p>
                                    </div>
                                    <div className="flex items-center gap-3 w-40 shrink-0">
                                        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-indigo-500 rounded-full transition-all duration-700" style={{
                                                width: `${Math.min(100, (item.device_count / (stats.mostDevicesPerUser[0]?.device_count || 1)) * 100)}%`
                                            }} />
                                        </div>
                                        <span className="text-[13px] font-extrabold text-slate-700 dark:text-slate-200 w-8 text-right tabular-nums group-hover:text-indigo-500">{item.device_count}</span>
                                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity -ml-1" />
                                    </div>
                                </div>
                            ))
                            : <Empty text="Belum ada data lisensi" />
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── DEVICE TAB ────────────────────────────────
function DeviceTab({ stats, period, setPeriod }) {
    const nav = useNavigate();
    const periodLabel = period === 'today' ? 'Hari Ini' : period === 'month' ? '30 Hari' : period === 'year' ? '1 Tahun' : period === 'all' ? 'All Time' : '7 Hari';
    
    // Fallback devices based on timeframe
    const devices = (period === 'today') ? stats?.topDevicesToday 
        : (period === 'week' || period === 'month' || period === 'year' || period === 'all') 
        ? stats?.topDevicesWeek : [];

    const barData = [
        { name: 'Online', count: stats?.devicesOnline, color: '#10b981' },
        { name: 'Offline', count: stats?.devicesOffline, color: '#94a3b8' },
        { name: 'Blocked', count: stats?.devicesBlocked, color: '#ef4444' },
    ];

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Device ON"       value={stats?.devicesOnline}    icon={Wifi}         color="emerald" path="/devices" />
                <KpiCard label="Device OFF"      value={stats?.devicesOffline}   icon={WifiOff}      color="slate"   path="/devices" />
                <KpiCard label="Device Expired"  value={stats?.devicesExpired}   icon={Clock}        color="orange"  path="/devices" />
                <KpiCard label="Device Blocked"  value={stats?.devicesBlocked}   icon={XCircle}      color="rose"    path="/security" />
                <KpiCard label="Baru Hari Ini"   value={stats?.newDevicesToday}  icon={Plus}         color="cyan"    path="/devices?" />
                <KpiCard label="Login Hari Ini"  value={stats?.deviceLoginToday} icon={LogIn}        color="blue"    path="/activity/live?filter=LOGIN" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Chart section */}
                <div className="glass-card p-5 lg:col-span-1">
                    <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 mb-0.5">Status Perangkat</p>
                    <p className="text-[11px] text-slate-400 mb-6">Distribusi status device yang terdaftar</p>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={barData} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.4} />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={42} tickFormatter={formatNumber} />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)', radius: 4 }} />
                            <Bar dataKey="count" name="Devices" radius={[4, 4, 0, 0]} maxBarSize={40}>
                                {barData.map((e, index) => <Cell key={`cell-${index}`} fill={e.color} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Top List */}
                <div className="glass-card overflow-hidden lg:col-span-2 flex flex-col">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div>
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Device Paling Aktif</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">Berdasarkan aktivitas pada periode</p>
                        </div>
                        <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer shadow-sm hover:border-indigo-400 transition-colors"
                        >
                            <option value="today">Today</option>
                            <option value="week">Last 7 Days</option>
                            <option value="month">Last 30 Days</option>
                            <option value="year">This Year</option>
                            <option value="all">All Time</option>
                        </select>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 flex-1 overflow-auto custom-scroll p-2">
                        {devices?.length > 0
                            ? devices.slice(0, 10).map((d, i) => (
                                <RankRow key={i} rank={i + 1}
                                    title={d.device_alias || d.device_name || 'Unknown Device'}
                                    subtitle={d.license_name || truncKey(d.license_key)}
                                    count={d.activity} unit="aktivitas"
                                    onClick={() => nav(`/activity/live?search=${encodeURIComponent(d.device_id || d.device_name)}`)}
                                />
                            ))
                            : <Empty text="Belum ada data device aktif" />
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── ACTIVITY TAB ──────────────────────────────
function ActivityTab({ stats, period }) {
    const nav = useNavigate();
    const chartDays = period === 'today' ? 1 : period === 'month' ? 30 : period === 'year' ? 365 : period === 'all' ? 3650 : 7;
    const isSingleDay = chartDays === 1;

    // Use hourly for today, daily otherwise
    const trendData = isSingleDay 
        ? (stats?.hourlyActivity || []).map(d => ({ label: `${String(d.hour).padStart(2, '0')}:00`, Aktivitas: d.count || 0 }))
        : (stats?.dailyValidations || []).map(d => ({ label: d.day?.slice(5), Aktivitas: d.count || 0 }));

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Playback Hari Ini"   value={stats?.todayPlaybacks}   icon={PlayCircle}   color="indigo"  path="/activity/playback" />
                <KpiCard label="Validasi Hari Ini"   value={stats?.todayValidations} icon={CheckCircle}  color="emerald" path="/activity/live?filter=VALIDATE_OK" />
                <KpiCard label="Playback Berhasil"   value={stats?.playbackSuccess}  icon={CheckCircle}  color="teal"    path="/activity/playback" />
                <KpiCard label="Playback Gagal"      value={stats?.playbackFailed}   icon={AlertOctagon} color="rose"    path="/activity/live?filter=VALIDATE_FAIL" />
                <KpiCard label="Validasi Gagal"      value={stats?.validationFailed} icon={ShieldAlert}  color="amber"   path="/activity/live?filter=VALIDATE_FAIL" />
                <KpiCard label="Total API Request"   value={stats?.apiRequestCount}  icon={Server}       color="violet"  path="/activity/live" sub="Hari ini" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Area Chart Activity Summary */}
                <div className="glass-card p-5 lg:col-span-3">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Volume Aktivitas</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">Total permintaan dalam rentang {isSingleDay ? '24 Jam (Hari Ini)' : 'waktu terpilih'}</p>
                        </div>
                    </div>
                    {trendData.length === 0 ? <Empty /> : (
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={trendData} margin={{ left: -16, right: 10, top: 10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.3} />
                                        <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" strokeOpacity={0.4} />
                                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={36} tickFormatter={formatNumber} />
                                <Tooltip content={<ChartTooltip />} />
                                <Area type="monotone" dataKey="Aktivitas" stroke="#4f46e5" strokeWidth={3} fill="url(#gAct)" dot={false} activeDot={{ r: 6, strokeWidth: 0, fill: '#4f46e5' }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Top Users */}
                <div className="glass-card overflow-hidden lg:col-span-1 flex flex-col">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">User Paling Aktif</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Lisensi dengan hit API tertinggi (7 hari)</p>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 flex-1 overflow-auto custom-scroll p-2">
                        {stats?.topUsersWeek?.length > 0
                            ? stats.topUsersWeek.slice(0, 8).map((u, i) => (
                                <RankRow key={i} rank={i + 1}
                                    title={u.license_name || 'Unnamed License'}
                                    subtitle={truncKey(u.license_key)}
                                    count={u.activity} unit="aktivitas"
                                    onClick={() => nav(`/activity/live?search=${encodeURIComponent(u.license_key)}`)}
                                />
                            ))
                            : <Empty text="Belum ada data user" />
                        }
                    </div>
                </div>

                {/* Top Videos */}
                <div className="glass-card overflow-hidden lg:col-span-2 flex flex-col">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Video Paling Banyak Diputar</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Konten dengan jumlah playback terbanyak (7 hari)</p>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 flex-1 overflow-auto custom-scroll p-2 lg:columns-2 gap-0">
                        {stats?.topVideosWeek?.length > 0
                            ? stats.topVideosWeek.slice(0, 10).map((v, i) => (
                                <div className="break-inside-avoid">
                                    <RankRow key={i} rank={i + 1}
                                        title={v.video_title}
                                        subtitle={v.plugin_name}
                                        count={v.play_count} unit="diputar" isUrl
                                        onClick={() => nav(`/activity/playback?search=${encodeURIComponent(v.video_title || v.plugin_name)}`)}
                                    />
                                </div>
                            ))
                            : <Empty text="Belum ada data video" />
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── INSIGHT TAB ───────────────────────────────
function InsightTab({ stats, period, setPeriod }) {
    const nav = useNavigate();
    
    // We map global period to the specific data objects
    const users   = period === 'today' ? stats?.topUsersToday   : stats?.topUsersWeek;
    // For insights period matching we fallback week to topPluginsWeek and others to mostPopular
    const plugins = period === 'today' ? stats?.topPluginsToday : period === 'week' ? stats?.topPluginsWeek : stats?.mostPopularPlugin;
    const videos  = period === 'today' ? stats?.topVideosToday  : period === 'week' ? stats?.topVideosWeek  : stats?.mostPopularVideo;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-end">
                <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-[13px] font-semibold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer shadow-sm hover:border-indigo-400 transition-colors"
                >
                    <option value="today">Today</option>
                    <option value="week">Last 7 Days</option>
                    <option value="month">Last 30 Days</option>
                    <option value="year">This Year</option>
                    <option value="all">All Time</option>
                </select>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Top Users */}
                <div className="glass-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-indigo-500" />
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Top Users</p>
                        </div>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 p-2 overflow-auto custom-scroll max-h-[600px]">
                        {users?.length > 0
                            ? users.slice(0, 50).map((u, i) => (
                                <RankRow key={i} rank={i + 1}
                                    title={u.license_name || 'Unnamed License'}
                                    subtitle={truncKey(u.license_key)}
                                    count={u.activity} unit="aktivitas"
                                    onClick={() => nav(`/activity/live?search=${encodeURIComponent(u.license_key)}`)}
                                />
                            ))
                            : <Empty text="Belum ada aktivitas user" />
                        }
                    </div>
                </div>

                {/* Top Plugins */}
                <div className="glass-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-emerald-500" />
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Top Plugin</p>
                        </div>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 p-2 overflow-auto custom-scroll max-h-[600px]">
                        {plugins?.length > 0
                            ? plugins.slice(0, 50).map((p, i) => (
                                <RankRow key={i} rank={i + 1}
                                    title={p.plugin_name}
                                    count={p.count} unit="penggunaan"
                                    onClick={() => nav(`/activity/plugins?search=${encodeURIComponent(p.plugin_name)}`)}
                                />
                            ))
                            : <Empty text="Belum ada data plugin" />
                        }
                    </div>
                </div>

                {/* Top Videos */}
                <div className="glass-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Film className="w-4 h-4 text-amber-500" />
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Top Video</p>
                        </div>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-800 p-2 overflow-auto custom-scroll max-h-[600px]">
                        {videos?.length > 0
                            ? videos.slice(0, 50).map((v, i) => (
                                <RankRow key={i} rank={i + 1}
                                    title={v.video_title}
                                    subtitle={v.plugin_name}
                                    count={v.play_count} unit="diputar" isUrl
                                    onClick={() => nav(`/activity/playback?search=${encodeURIComponent(v.video_title)}`)}
                                />
                            ))
                            : <Empty text="Belum ada data video" />
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════
const TABS = [
    { id: 'overview',  label: 'Overview',          icon: LayoutGrid },
    { id: 'license',   label: 'License Analytics', icon: Key },
    { id: 'device',    label: 'Device Analytics',  icon: Smartphone },
    { id: 'activity',  label: 'Activity Analytics',icon: Activity },
    { id: 'insight',   label: 'Insight & Ranking', icon: TrendingUp },
];

export default function Analytics() {
    const [tab,        setTab]        = useState('overview');
    const [period,     setPeriod]     = useState('week');
    const [stats,      setStats]      = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);

    const fetchData = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true); else setRefreshing(true);
            const data = await get(`/admin/analytics/overview?period=${period}`);
            setStats(data);
            setLastUpdate(new Date());
        } catch (e) {
            console.error('Analytics error:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [period]);

    useEffect(() => { fetchData(); }, [fetchData]);
    useInterval(() => { fetchData(true); }, 10000);

    if (loading && !stats) return (
        <div className="space-y-5 animate-pulse">
            <div className="h-10 skeleton rounded-2xl w-72" />
            <div className="h-12 skeleton rounded-xl w-96" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-56 rounded-2xl" />)}
            </div>
        </div>
    );

    return (
        <div className="space-y-5">

            {/* ── HEADER ─────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-[20px] font-extrabold text-slate-800 dark:text-white tracking-tight">Analytics</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[12px] text-slate-400">Auto-refresh setiap 10s</span>
                        {lastUpdate && (
                            <>
                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                <span className="text-[12px] text-emerald-500 font-medium flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot inline-block" />
                                    Live · {lastUpdate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Select Dropdown (Dashboard Style) */}
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-slate-500 hidden sm:block">Filter:</span>
                        <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer shadow-sm hover:border-indigo-400 transition-colors w-32"
                        >
                            <option value="today">Today</option>
                            <option value="week">Last 7 Days</option>
                            <option value="month">Last 30 Days</option>
                            <option value="year">This Year</option>
                            <option value="all">All Time</option>
                        </select>
                    </div>
                    {/* Refresh Button */}
                    <button onClick={() => fetchData(true)}
                        className={`p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-400 hover:text-indigo-500 hover:border-indigo-300 dark:hover:border-indigo-700 shadow-sm transition-all ${refreshing ? 'animate-spin text-indigo-500' : ''}`}>
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* ── TABS ──────── */}
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/60 p-1.5 rounded-xl w-full sm:w-fit overflow-x-auto custom-scroll flex-nowrap">
                {TABS.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold transition-all whitespace-nowrap shrink-0 ${
                            tab === t.id
                                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}>
                        <t.icon className="w-4 h-4" />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── TAB CONTENT ─────────────────────────── */}
            <div className="fade-in">
                {tab === 'overview'  && <OverviewTab  stats={stats} period={period} />}
                {tab === 'license'   && <LicenseTab   stats={stats} period={period} setPeriod={setPeriod} />}
                {tab === 'device'    && <DeviceTab    stats={stats} period={period} setPeriod={setPeriod} />}
                {tab === 'activity'  && <ActivityTab  stats={stats} period={period} setPeriod={setPeriod} />}
                {tab === 'insight'   && <InsightTab   stats={stats} period={period} setPeriod={setPeriod} />}
            </div>
        </div>
    );
}
