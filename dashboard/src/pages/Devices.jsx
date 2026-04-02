import { useState, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, put, del, formatWIB } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import {
    Search, ChevronLeft, ChevronRight, RefreshCw, X,
    Monitor, ShieldOff, ShieldCheck, Trash2, Clock, Globe, Activity, Eye,
    CheckSquare, Square, Check
} from 'lucide-react';
import { AreaChart, Area } from 'recharts';
import LicenseDrawer from '../components/LicenseDrawer';
import { cleanPluginName } from '../lib/api';

const LIMIT = 10;


export default function Devices() {
    const toast = useToast();
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [drawer, setDrawer] = useState(null);
    const [drawerData, setDrawerData] = useState(null);
    const [drawerLoading, setDrawerLoading] = useState(false);
    const [editModal, setEditModal] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [selected, setSelected] = useState(new Set());

    const { data, loading, refetch } = useApi(
        `/admin/devices?page=${page}&limit=${LIMIT}&search=${encodeURIComponent(search)}&status=${statusFilter}`,
        [page, search, statusFilter]
    );

    const devices = data?.devices || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / LIMIT);
    const counts = data?.counts || { all: 0, online: 0, offline: 0, blocked: 0 };

    /* ── bulk actions ── */
    const toggleSelect = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const toggleAll = () => {
        if (selected.size === devices.length && devices.length > 0) {
            setSelected(new Set());
        } else {
            setSelected(new Set(devices.map(d => d.id)));
        }
    };
    const allSelected = devices.length > 0 && selected.size === devices.length;

    const doBulk = useCallback(async (action) => {
        try {
            await put('/admin/devices/bulk', { ids: Array.from(selected), action });
            toast(`Action ${action} successful`, 'success');
            setSelected(new Set());
            refetch();
        } catch { toast('Bulk action failed', 'error'); }
    }, [selected, toast, refetch]);

    /* ── open license drawer ── */
    const openDrawer = useCallback(async (devOrLic) => {
        // Since we want to open the *license* detail, and we have device row
        // we can construct a fake license object or fetch it if needed.
        // Actually, it's better to fetch by license id directly or let the drawer do it.
        // The drawer expects a license object with at least id, license_key.
        const lic = {
            id: devOrLic.license_id || devOrLic.id,
            license_key: devOrLic.license_key,
            name: devOrLic.license_name,
            status: devOrLic.license_status || 'active',
            expires_at: devOrLic.expires_at || null
        };

        setDrawer(lic);
        setDrawerData(null);
        setDrawerLoading(true);
        try {
            const d = await get(`/admin/licenses/${lic.id}/details`);
            setDrawerData(d);
        } catch { toast('Could not load license details', 'error'); }
        finally { setDrawerLoading(false); }
    }, [toast]);

    /* ── actions ── */
    const doAction = useCallback(async (id, action, msg) => {
        try {
            await put(`/admin/devices/${id}`, { action });
            toast(msg, 'success');
            refetch();
            if (drawer?.id === id) setDrawer(p => ({ ...p, is_blocked: action === 'block' ? 1 : 0 }));
        } catch { toast('Action failed', 'error'); }
    }, [toast, refetch, drawer]);

    const doDelete = useCallback(async (id) => {
        try {
            await put(`/admin/devices/${id}`, { action: 'delete' });
            toast('Device removed', 'success');
            refetch();
            if (drawer?.id === id) setDrawer(null);
        } catch { toast('Delete failed', 'error'); }
    }, [toast, refetch, drawer]);

    const handleSearch = (e) => {
        e.preventDefault();
        setSearch(searchInput);
        setPage(1);
    };

    /* ── group devices ── */
    const groupedDevices = devices.reduce((acc, d) => {
        const lid = d.license_id || 'unknown';
        if (!acc[lid]) acc[lid] = {
            id: d.license_id,
            key: d.license_key,
            name: d.license_name,
            status: d.license_status,
            expires_at: d.expires_at,
            devices: []
        };
        acc[lid].devices.push(d);
        return acc;
    }, {});

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2.5 toolbar-row">
                <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[220px]">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Search device, license, IP…"
                            className="form-input pl-8"
                        />
                    </div>
                </form>
                <button onClick={refetch} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Status Filters */}
            <div className="flex items-center gap-2 overflow-x-auto custom-scroll pb-1">
                {[
                    { key: '', label: 'All', color: 'slate' },
                    { key: 'online', label: 'Online', color: 'emerald' },
                    { key: 'offline', label: 'Offline', color: 'amber' },
                    { key: 'blocked', label: 'Blocked', color: 'red' }
                ].map(s => {
                    const isActive = statusFilter === s.key;
                    const count = s.key === '' ? counts.all : counts[s.key];
                    const colorMap = {
                        slate: isActive ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
                        emerald: isActive ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20',
                        amber: isActive ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20',
                        red: isActive ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20'
                    };
                    return (
                        <button key={s.key} onClick={() => { setStatusFilter(s.key); setPage(1); setSelected(new Set()); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200 whitespace-nowrap ${colorMap[s.color]}`}>
                            {s.label}
                            {count !== undefined && <span className={`ml-0.5 text-[10px] font-bold ${isActive ? 'opacity-80' : 'opacity-60'}`}>{count}</span>}
                        </button>
                    );
                })}
            </div>

            {/* Bulk action bar */}
            {selected.size > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-xl text-[12px] font-medium text-indigo-700 dark:text-indigo-300 fade-in">
                    <Check className="w-3.5 h-3.5" />
                    <span>{selected.size} selected</span>
                    <div className="flex-1" />
                    <button onClick={() => setConfirm({ title: 'Unblock Selected', msg: `Unblock ${selected.size} device(s)?`, action: () => doBulk('unblock') })} className="px-3 py-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600">Unblock</button>
                    <button onClick={() => setConfirm({ title: 'Block Selected', msg: `Block ${selected.size} device(s)?`, action: () => doBulk('block'), danger: true })} className="px-3 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600">Block</button>
                    <button onClick={() => setConfirm({ title: 'Remove Selected', msg: `Remove ${selected.size} device(s)?`, action: () => doBulk('delete'), danger: true })} className="px-3 py-1 rounded-lg bg-slate-500 text-white hover:bg-slate-600">Remove</button>
                    <button onClick={() => setSelected(new Set())} className="p-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* Table */}
            <div className="glass-card overflow-hidden">
                <div className="table-responsive-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th className="w-8">
                                    <button onClick={toggleAll} className="text-slate-400 hover:text-slate-600">
                                        {allSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                                    </button>
                                </th>
                                <th>Device</th>
                                <th className="hide-mobile">IP Address</th>
                                <th>Status</th>
                                <th className="hide-mobile">Activity (7d)</th>
                                <th className="hide-mobile">Last Seen</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(LIMIT)].map((_, i) => (
                                    <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 rounded w-20" /></td>)}</tr>
                                ))
                            ) : Object.keys(groupedDevices).length === 0 ? (
                                <tr><td colSpan={7} className="py-16 text-center text-[13px] text-slate-400">No devices found</td></tr>
                            ) : Object.values(groupedDevices).map((group) => (
                                <Fragment key={`group-${group.id}`}>
                                    {/* Group Header */}
                                    <tr className="bg-slate-50/80 dark:bg-slate-800/40 border-y border-slate-100 dark:border-slate-800">
                                        <td colSpan={7} className="py-2.5 px-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                                                    <Globe className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                                                        {group.name || 'Unnamed License'}
                                                    </span>
                                                    <span className="text-slate-300 dark:text-slate-600 mx-1">•</span>
                                                    <button onClick={() => navigate(`/licenses?search=${encodeURIComponent(group.key)}`)} className="font-mono text-[11px] text-indigo-500 hover:text-indigo-600 hover:underline">
                                                        {group.key}
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                    {/* Devices in group */}
                                    {group.devices.map(d => (
                                        <tr key={d.id} className={selected.has(d.id) ? 'bg-indigo-50/40 dark:bg-indigo-500/10' : ''}>
                                            <td>
                                                <button onClick={() => toggleSelect(d.id)} className="text-slate-400 hover:text-slate-600">
                                                    {selected.has(d.id) ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                                                </button>
                                            </td>
                                            <td>
                                                <div className="flex flex-col gap-0.5">
                                                    <button onClick={() => openDrawer(d)} className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-600 hover:underline text-left">
                                                        {d.display_name || d.device_name || 'Unnamed Device'}
                                                    </button>
                                                    <span className="font-mono text-[10px] text-slate-400">{d.device_id?.substring(0, 18)}…</span>
                                                </div>
                                            </td>
                                            <td className="hide-mobile font-mono text-[11px] text-slate-500">{d.ip_address || '—'}</td>
                                            <td>
                                                {d.is_blocked
                                                    ? <span className="badge badge-blocked">Blocked</span>
                                                    : d.is_online
                                                        ? <span className="badge badge-active">Online</span>
                                                        : <span className="badge badge-expired">Offline</span>
                                                }
                                            </td>
                                            <td className="hide-mobile w-20">
                                                {d.activity7d && d.activity7d.some(a => a.count > 0) ? (
                                                    <div className="w-[60px] h-[24px]">
                                                        <AreaChart width={60} height={24} data={d.activity7d} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                                            <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#c7d2fe" isAnimationActive={false} />
                                                        </AreaChart>
                                                    </div>
                                                ) : <span className="text-[10px] text-slate-400">—</span>}
                                            </td>
                                            <td className="hide-mobile">
                                                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                    <Clock className="w-3 h-3 shrink-0" />
                                                    {formatWIB(d.last_seen)}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => openDrawer(d)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-600" title="View License details">
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                    {d.is_blocked
                                                        ? <button onClick={() => setConfirm({ title: 'Unblock Device', msg: `Unblock this device?`, action: () => doAction(d.id, 'unblock', 'Device unblocked') })} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-500" title="Unblock"><ShieldCheck className="w-3.5 h-3.5" /></button>
                                                        : <button onClick={() => setConfirm({ title: 'Block Device', msg: 'Block this device? It will not be able to use any license.', action: () => doAction(d.id, 'block', 'Device blocked'), danger: true })} className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-500" title="Block"><ShieldOff className="w-3.5 h-3.5" /></button>
                                                    }
                                                    <button onClick={() => setConfirm({ title: 'Remove Device', msg: 'Remove this device? The license slot will be freed.', action: () => doDelete(d.id), danger: true })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-600" title="Delete">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-[12px] text-slate-500">
                    <span className="pager-text">{total} total · Page {page}/{totalPages || 1}</span>
                    <div className="flex items-center gap-1.5">
                        <button disabled={page <= 1} onClick={() => setPage(1)} className="px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">«</button>
                        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                            let p;
                            if (totalPages <= 7) p = i + 1;
                            else if (page <= 4) p = i + 1;
                            else if (page >= totalPages - 3) p = totalPages - 6 + i;
                            else p = page - 3 + i;
                            if (p < 1 || p > totalPages) return null;
                            return <button key={p} onClick={() => setPage(p)} className={`w-7 h-7 rounded-lg text-[12px] font-medium ${p === page ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{p}</button>;
                        })}
                        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                        <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">»</button>
                    </div>
                </div>
            </div>

            {/* ══ License Drawer ══ */}
            <LicenseDrawer
                drawer={drawer}
                setDrawer={setDrawer}
                setConfirm={setConfirm}
                setEditModal={setEditModal}
                openDrawer={openDrawer}
                drawerLoading={drawerLoading}
                drawerData={drawerData}
            />

            {/* Confirm Modal */}
            <ConfirmModal
                open={!!confirm}
                title={confirm?.title}
                message={confirm?.msg}
                danger={confirm?.danger}
                onConfirm={confirm?.action}
                onClose={() => setConfirm(null)}
            />
        </div>
    );
}
