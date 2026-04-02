import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Smartphone, Globe, Clock, Activity, Play, ShieldCheck, ShieldOff, Pencil, Check, Ban, Trash2 } from 'lucide-react';
import { get, put, del, formatWIB } from '../lib/api';

/**
 * A minimal drawer that shows device + license details
 * when clicking a device or license row in activity tables.
 * Accepts: { licenseKey, deviceId } or just { licenseKey } to load full license drawer.
 */
export default function ActivityDetailDrawer({ isOpen, onClose, licenseKey, deviceId }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [editAlias, setEditAlias] = useState(false);
    const [aliasInput, setAliasInput] = useState('');
    const [device, setDevice] = useState(null);

    useEffect(() => {
        if (!isOpen || !licenseKey) return;
        setLoading(true);
        setData(null);
        setDevice(null);
        setEditAlias(false);
        get(`/admin/licenses/by-key/${encodeURIComponent(licenseKey)}`)
            .then(res => {
                if (res.status === 'ok') {
                    return get(`/admin/licenses/${res.id}/details`);
                }
                throw new Error('License not found');
            })
            .then(res => {
                if (res.status === 'ok') {
                    setData(res);
                    if (deviceId) {
                        const dev = res.devices?.find(d => d.device_id === deviceId);
                        if (dev) {
                            setDevice(dev);
                            setAliasInput(dev.device_alias || '');
                        }
                    }
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [isOpen, licenseKey, deviceId]);

    const saveAlias = async () => {
        if (!device) return;
        await put(`/admin/devices/${device.id}`, { action: 'rename', name: aliasInput });
        setDevice(d => ({ ...d, device_alias: aliasInput }));
        setEditAlias(false);
    };

    if (!isOpen) return null;

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[998]"
                onClick={onClose}
            />
            <div className="fixed top-0 right-0 h-full w-[400px] max-w-full bg-white dark:bg-slate-900 shadow-2xl z-[999] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
                    <div>
                        <div className="text-[14px] font-bold text-slate-900 dark:text-white mb-0.5">
                            {loading ? 'Loading…' : (data?.name || 'License Detail')}
                        </div>
                        <div className="font-mono text-[11px] text-indigo-500 dark:text-indigo-400">
                            {licenseKey}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {loading && (
                        <div className="space-y-3">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="skeleton h-14 rounded-xl" />
                            ))}
                        </div>
                    )}

                    {!loading && data && (
                        <>
                            {/* License Info */}
                            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">License Info</div>
                                <InfoRow label="Status">
                                    <span className={`badge ${data.status === 'active' ? 'badge-active' : data.status === 'revoked' ? 'badge-error' : 'badge-expired'}`}>
                                        {data.status}
                                    </span>
                                </InfoRow>
                                <InfoRow label="Name">{data.name || '—'}</InfoRow>
                                <InfoRow label="Max Devices">{data.max_devices}</InfoRow>
                                <InfoRow label="Expires">{formatWIB(data.expires_at)}</InfoRow>
                            </div>

                            {/* Device Info (if specific device clicked) */}
                            {device && (
                                <div className="p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/5 space-y-2">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Smartphone className="w-4 h-4 text-indigo-500" />
                                        <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500">Device Detail</span>
                                    </div>
                                    <InfoRow label="Model">{device.device_name || '—'}</InfoRow>
                                    <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Alias/Nama</span>
                                        <div className="flex items-center gap-1.5">
                                            {editAlias ? (
                                                <>
                                                    <input
                                                        value={aliasInput}
                                                        onChange={e => setAliasInput(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && saveAlias()}
                                                        className="form-input text-[12px] py-0.5 px-2 w-32"
                                                        placeholder="e.g. dimas"
                                                        autoFocus
                                                    />
                                                    <button onClick={saveAlias} className="p-1 rounded-lg bg-indigo-500 text-white">
                                                        <Check className="w-3 h-3" />
                                                    </button>
                                                    <button onClick={() => setEditAlias(false)} className="p-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-[12px] text-slate-700 dark:text-slate-300">
                                                        {device.device_alias || <span className="text-slate-400 italic">belum diset</span>}
                                                    </span>
                                                    <button onClick={() => setEditAlias(true)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                                                        <Pencil className="w-3 h-3" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <InfoRow label="IP Address">{device.ip_address || '—'}</InfoRow>
                                    <InfoRow label="First Seen">{formatWIB(device.first_seen)}</InfoRow>
                                    <InfoRow label="Last Seen">{formatWIB(device.last_seen)}</InfoRow>
                                    <InfoRow label="Status">
                                        <span className={`badge ${device.is_blocked ? 'badge-blocked' : device.is_online ? 'badge-active' : 'badge-expired'}`}>
                                            {device.is_blocked ? 'Blocked' : device.is_online ? 'Online' : 'Offline'}
                                        </span>
                                    </InfoRow>
                                    <div className="font-mono text-[9px] text-slate-400/70 mt-1" title="Raw Device ID">
                                        ID: {device.device_id}
                                    </div>
                                </div>
                            )}

                            {/* All Devices on this license */}
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Semua Device ({data.devices?.length || 0})</div>
                                <div className="space-y-2">
                                    {(data.devices || []).length === 0 && (
                                        <div className="text-center py-6 text-[13px] text-slate-400">No devices</div>
                                    )}
                                    {(data.devices || []).map((d, i) => (
                                        <div key={d.id}
                                            className={`p-3 rounded-xl border transition-colors cursor-pointer ${device?.id === d.id ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-500/10' : 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 hover:border-slate-200 dark:hover:border-slate-700'}`}
                                            onClick={() => { setDevice(d); setAliasInput(d.device_alias || ''); setEditAlias(false); }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                                                        {i + 1}
                                                    </div>
                                                    <div>
                                                        <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-200">
                                                            {d.device_name || `Device ${i + 1}`}
                                                            {d.device_alias && d.device_alias.trim() && (
                                                                <span className="ml-1.5 text-indigo-500 font-normal">({d.device_alias})</span>
                                                            )}
                                                        </div>
                                                        <div className="font-mono text-[9px] text-slate-400 truncate max-w-[200px]">
                                                            {d.device_id}
                                                        </div>
                                                    </div>
                                                </div>
                                                <span className={`badge py-0.5 px-1.5 text-[9px] ${d.is_blocked ? 'badge-blocked' : d.is_online ? 'badge-active' : 'badge-expired'}`}>
                                                    {d.is_blocked ? 'Blocked' : d.is_online ? 'Online' : 'Offline'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Recent Playback */}
                            {data.playbackLogs?.length > 0 && (
                                <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Playback Terbaru</div>
                                    <div className="space-y-1.5">
                                        {data.playbackLogs.slice(0, 5).map((p, i) => (
                                            <div key={i} className="flex items-start gap-2 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                <Play className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[12px] text-slate-800 dark:text-slate-200 truncate">{p.video_title}</div>
                                                    <div className="text-[10px] text-slate-400">{p.plugin_name} · {formatWIB(p.played_at)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>,
        document.body
    );
}

function InfoRow({ label, children }) {
    return (
        <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
            <span className="text-[12px] text-slate-700 dark:text-slate-300 text-right max-w-[55%] break-words">{children}</span>
        </div>
    );
}
