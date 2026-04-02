import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Globe, Clock, Activity, Play, Server, Trash2, Ban, ShieldCheck, ShieldOff, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { put, del, formatWIB, cleanPluginName } from '../lib/api';

const DRAWER_PAGE_SIZE = 10;

function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
}

function getRepoUrl(key) {
    return `${window.location.origin}/plugin/${key}/repo.json`;
}

export function statusBadge(status) {
    if (status === 'active') return <span className="badge badge-active">Active</span>;
    if (status === 'revoked') return <span className="badge badge-error">Revoked</span>;
    if (status === 'expired') return <span className="badge badge-expired">Expired</span>;
    return <span className="badge">{status}</span>;
}

export function expiryBadge(dateStr) {
    if (!dateStr) return <span className="text-[11px] text-slate-400">—</span>;
    const exp = new Date(dateStr);
    const days = Math.ceil((exp - new Date()) / 86400000);
    if (days < 0) return <span className="badge badge-expired px-1.5 min-w-[50px] justify-center">{Math.abs(days)}d ago</span>;
    if (days <= 3) return <span className="badge badge-warning px-1.5 min-w-[50px] justify-center">{days}d left</span>;
    return <span className="badge badge-info px-1.5 min-w-[50px] justify-center">{days}d left</span>;
}

export default function LicenseDrawer({ drawer, setDrawer, setConfirm, setEditModal, openDrawer, drawerLoading, drawerData }) {
    const [activeDrawerTab, setActiveDrawerTab] = useState('devices');
    const [pluginPage, setPluginPage] = useState(1);
    const [playbackPage, setPlaybackPage] = useState(1);

    const doAction = async (id, action, msg) => {
        // Simple callback defined here, but usually passed in or handles via its own fetch
        await put(`/admin/licenses/${id}`, { action });
        // After action, refresh the drawer
        openDrawer(drawer);
    };

    const doDelete = async (id) => {
        await del(`/admin/licenses/${id}`);
        setDrawer(null); // Close drawer after delete
        // Should trigger refetch on parent, but depends on how callback is wired
        // Parent should manage this typically, but for simplification we just close the drawer
    };

    if (!drawer) return null;

    return createPortal(
        <>
            <div className="drawer-overlay" onClick={() => setDrawer(null)} />
            <div className="drawer-panel">
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-slate-100 dark:border-slate-800">
                    <div>
                        {drawer.name && <div className="text-[15px] font-bold text-slate-900 dark:text-white mb-0.5">{drawer.name}</div>}
                        <button onClick={() => copyText(drawer.license_key)} className="flex items-center gap-1.5 font-mono text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline">
                            {drawer.license_key} <Copy className="w-3 h-3 opacity-50" />
                        </button>
                        <div className="flex items-center gap-2 mt-1.5">
                            {statusBadge(drawer.status)}
                            {expiryBadge(drawer.expires_at)}
                        </div>
                    </div>
                    <button onClick={() => setDrawer(null)} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 m-4 mb-0 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl">
                    {[
                        { id: 'devices', label: 'Devices', icon: Server },
                        { id: 'plugins', label: 'Plugins', icon: Activity },
                        { id: 'playback', label: 'Playback', icon: Play },
                        { id: 'info', label: 'Info', icon: Globe },
                    ].map(t => (
                        <button key={t.id} onClick={() => setActiveDrawerTab(t.id)}
                            className={`flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${activeDrawerTab === t.id ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                            <t.icon className="w-3 h-3" /> {t.label}
                        </button>
                    ))}
                </div>

                {drawerLoading ? (
                    <div className="p-5 space-y-3">
                        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}
                    </div>
                ) : !drawerData ? (
                    <div className="p-8 text-center text-[13px] text-slate-400">Failed to load details</div>
                ) : (
                    <div className="p-4">
                        {/* Devices Tab */}
                        {activeDrawerTab === 'devices' && (
                            <div className="space-y-2">
                                {drawerData.devices?.length === 0 && (
                                    <div className="py-8 text-center text-[13px] text-slate-400">No devices registered</div>
                                )}
                                {drawerData.devices?.map((d, i) => (
                                    <div key={d.id} className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 flex items-center justify-center text-[11px] font-bold">
                                                    {i + 1}
                                                </div>
                                                <div>
                                                    <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                                                        {d.display_name || d.device_name || `Device ${i + 1}`}
                                                    </div>
                                                    {d.device_alias && d.device_alias.trim() && (
                                                        <div className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">
                                                            alias: {d.device_alias}
                                                        </div>
                                                    )}
                                                    <div className="text-[10px] font-mono text-slate-400 mt-0.5">{d.device_id?.substring(0, 20)}…</div>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1.5">
                                                {d.is_blocked
                                                    ? <span className="badge badge-blocked py-0.5 px-1.5 text-[9px]">Blocked</span>
                                                    : d.is_online
                                                        ? <span className="badge badge-active py-0.5 px-1.5 text-[9px]">Online</span>
                                                        : <span className="badge badge-expired py-0.5 px-1.5 text-[9px]">Offline</span>
                                                }
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={() => setConfirm({
                                                            title: d.is_blocked ? 'Unblock Device' : 'Block Device',
                                                            msg: d.is_blocked ? 'Allow this device to access the license again?' : 'Block this device from using the license?',
                                                            action: async () => {
                                                                await put(`/admin/devices/${d.id}`, { action: d.is_blocked ? 'unblock' : 'block' });
                                                                openDrawer(drawerData); // Refresh
                                                            }
                                                        })}
                                                        className={`p-1.5 rounded-lg text-white transition-colors ${d.is_blocked ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'}`}
                                                        title={d.is_blocked ? "Unblock" : "Block"}
                                                    >
                                                        {d.is_blocked ? <ShieldCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                                                    </button>

                                                    <button
                                                        onClick={() => setConfirm({
                                                            title: 'Remove Device',
                                                            msg: 'Remove this device from the license? This will free up 1 slot.',
                                                            danger: true,
                                                            action: async () => {
                                                                await del(`/admin/devices/${d.id}`);
                                                                if (drawerData && drawerData.devices) {
                                                                    const updatedDevices = drawerData.devices.filter(x => x.id !== d.id);
                                                                    openDrawer({ ...drawerData, devices: updatedDevices });
                                                                } else {
                                                                    openDrawer(drawer);
                                                                }
                                                            }
                                                        })}
                                                        className="p-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
                                                        title="Remove / Unlink"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                            <span>IP: <span className="font-mono text-slate-700 dark:text-slate-300">{d.ip_address || '—'}</span></span>
                                            <span>Last seen: {formatWIB(d.last_seen)}</span>
                                            <span>First seen: {formatWIB(d.first_seen)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Plugins Tab */}
                        {activeDrawerTab === 'plugins' && (() => {
                            const allPlugins = drawerData.pluginUsage || [];
                            const totalPluginPages = Math.max(1, Math.ceil(allPlugins.length / DRAWER_PAGE_SIZE));
                            const pStart = (pluginPage - 1) * DRAWER_PAGE_SIZE;
                            const pagePlugins = allPlugins.slice(pStart, pStart + DRAWER_PAGE_SIZE);
                            return (
                                <div className="space-y-1">
                                    {allPlugins.length === 0 ? (
                                        <div className="py-8 text-center text-[13px] text-slate-400">No plugin activity</div>
                                    ) : (
                                        <>
                                            <div className="text-[11px] text-slate-400 mb-2 px-1">
                                                Showing {pStart + 1}–{Math.min(pStart + DRAWER_PAGE_SIZE, allPlugins.length)} of {allPlugins.length} entries
                                            </div>
                                            {pagePlugins.map((p, i) => (
                                                <div key={pStart + i} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                                    <div className="min-w-0 flex-1">
                                                        <span className="text-[12px] font-medium text-slate-800 dark:text-slate-200">{cleanPluginName(p.plugin_name)}</span>
                                                        <span className="ml-2 badge badge-info text-[9px]">{p.action}</span>
                                                        {p.device_name && (
                                                            <span className="ml-2 text-[10px] text-slate-400" title={p.device_id ? `ID: ${p.device_id}` : ''}>
                                                                {p.device_name}
                                                                {p.device_id && <span className="opacity-50 ml-1">({p.device_id.substring(0, 8)}…)</span>}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">{formatWIB(p.used_at)}</span>
                                                </div>
                                            ))}
                                            {/* Pagination */}
                                            {totalPluginPages > 1 && (
                                                <div className="flex items-center justify-center gap-1 pt-3 pb-1">
                                                    <button disabled={pluginPage <= 1} onClick={() => setPluginPage(p => p - 1)}
                                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors">
                                                        <ChevronLeft className="w-3.5 h-3.5" />
                                                    </button>
                                                    {Array.from({ length: Math.min(totalPluginPages, 5) }, (_, i) => {
                                                        let pg;
                                                        if (totalPluginPages <= 5) pg = i + 1;
                                                        else if (pluginPage <= 3) pg = i + 1;
                                                        else if (pluginPage >= totalPluginPages - 2) pg = totalPluginPages - 4 + i;
                                                        else pg = pluginPage - 2 + i;
                                                        if (pg < 1 || pg > totalPluginPages) return null;
                                                        return (
                                                            <button key={pg} onClick={() => setPluginPage(pg)}
                                                                className={`w-7 h-7 rounded-lg text-[11px] font-semibold transition-colors ${pg === pluginPage ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                                                {pg}
                                                            </button>
                                                        );
                                                    })}
                                                    <button disabled={pluginPage >= totalPluginPages} onClick={() => setPluginPage(p => p + 1)}
                                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors">
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Playback Tab */}
                        {activeDrawerTab === 'playback' && (() => {
                            const allPlaybacks = drawerData.playbackLogs || [];
                            const totalPlaybackPages = Math.max(1, Math.ceil(allPlaybacks.length / DRAWER_PAGE_SIZE));
                            const pbStart = (playbackPage - 1) * DRAWER_PAGE_SIZE;
                            const pagePlaybacks = allPlaybacks.slice(pbStart, pbStart + DRAWER_PAGE_SIZE);
                            return (
                                <div className="space-y-2">
                                    {allPlaybacks.length === 0 ? (
                                        <div className="py-8 text-center text-[13px] text-slate-400">No playback activity</div>
                                    ) : (
                                        <>
                                            <div className="text-[11px] text-slate-400 mb-2 px-1">
                                                Showing {pbStart + 1}–{Math.min(pbStart + DRAWER_PAGE_SIZE, allPlaybacks.length)} of {allPlaybacks.length} entries
                                            </div>
                                            {pagePlaybacks.map((p, i) => (
                                                <div key={pbStart + i} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
                                                    <div className="flex items-start gap-2">
                                                        <div className="mt-0.5 p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10">
                                                            <Play className="w-3 h-3 text-amber-500" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-[12px] font-medium text-slate-800 dark:text-slate-200 truncate">{p.video_title || 'Unknown'}</div>
                                                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                                                <span>{cleanPluginName(p.plugin_name)}</span>
                                                                {p.source_provider && <><span>·</span><span>{p.source_provider}</span></>}
                                                                {p.device_name && (
                                                                    <>
                                                                        <span>·</span>
                                                                        <span title={p.device_id ? `ID: ${p.device_id}` : ''}>
                                                                            {p.device_name}
                                                                            {p.device_id && <span className="opacity-50 ml-1">({p.device_id.substring(0, 8)}…)</span>}
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400 shrink-0">{formatWIB(p.played_at)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {/* Pagination */}
                                            {totalPlaybackPages > 1 && (
                                                <div className="flex items-center justify-center gap-1 pt-3 pb-1">
                                                    <button disabled={playbackPage <= 1} onClick={() => setPlaybackPage(p => p - 1)}
                                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors">
                                                        <ChevronLeft className="w-3.5 h-3.5" />
                                                    </button>
                                                    {Array.from({ length: Math.min(totalPlaybackPages, 5) }, (_, i) => {
                                                        let pg;
                                                        if (totalPlaybackPages <= 5) pg = i + 1;
                                                        else if (playbackPage <= 3) pg = i + 1;
                                                        else if (playbackPage >= totalPlaybackPages - 2) pg = totalPlaybackPages - 4 + i;
                                                        else pg = playbackPage - 2 + i;
                                                        if (pg < 1 || pg > totalPlaybackPages) return null;
                                                        return (
                                                            <button key={pg} onClick={() => setPlaybackPage(pg)}
                                                                className={`w-7 h-7 rounded-lg text-[11px] font-semibold transition-colors ${pg === playbackPage ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                                                {pg}
                                                            </button>
                                                        );
                                                    })}
                                                    <button disabled={playbackPage >= totalPlaybackPages} onClick={() => setPlaybackPage(p => p + 1)}
                                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors">
                                                        <ChevronRight className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Info Tab */}
                        {activeDrawerTab === 'info' && (
                            <div className="space-y-3">
                                {[
                                    { label: 'License ID', value: `#${drawerData.id}` },
                                    { label: 'Repo URL', value: <button onClick={() => copyText(getRepoUrl(drawerData.license_key))} className="flex items-center gap-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 break-all text-left">{getRepoUrl(drawerData.license_key)} <Copy className="w-3 h-3 opacity-50 shrink-0" /></button> },
                                    { label: 'License Key', value: <button onClick={() => copyText(drawerData.license_key)} className="flex items-center gap-1 font-mono text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 break-all">{drawerData.license_key} <Copy className="w-3 h-3 opacity-50" /></button> },
                                    { label: 'Name', value: drawerData.name || '—' },
                                    { label: 'Max Devices', value: `${drawerData.max_devices}` },
                                    { label: 'Created', value: formatWIB(drawerData.created_at) },
                                    { label: 'Expires', value: formatWIB(drawerData.expires_at) },
                                    { label: 'Note', value: drawerData.note || '—' },
                                ].map(r => (
                                    <div key={r.label} className="flex items-start justify-between py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</span>
                                        <span className="text-[12px] text-slate-700 dark:text-slate-300 text-right max-w-[55%] break-words">{r.value}</span>
                                    </div>
                                ))}
                                {/* Actions */}
                                <div className="flex gap-2 flex-wrap pt-2">
                                    {drawer.status === 'revoked'
                                        ? <button onClick={() => setConfirm({ title: 'Activate', msg: 'Activate this license?', action: () => doAction(drawer.id, 'activate', 'Activated') })} className="btn-ghost text-emerald-600 text-[12px] py-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Activate</button>
                                        : <button onClick={() => setConfirm({ title: 'Revoke', msg: 'Revoke this license?', action: () => doAction(drawer.id, 'revoke', 'Revoked'), danger: true })} className="btn-ghost text-red-600 text-[12px] py-1.5"><ShieldOff className="w-3.5 h-3.5" /> Revoke</button>
                                    }
                                    <button onClick={() => setEditModal ? setEditModal({ ...drawer }) : null} className="btn-ghost text-[12px] py-1.5"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                                    <button onClick={() => setConfirm({ title: 'Delete', msg: 'Move to trash?', action: () => doDelete(drawer.id), danger: true })} className="btn-ghost text-red-600 text-[12px] py-1.5"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>,
        document.body
    );
}
