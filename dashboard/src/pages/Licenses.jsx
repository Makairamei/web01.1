import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { get, del, put, post, formatWIB, daysUntil, copyText, truncKey } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import {
    Search, ChevronLeft, ChevronRight, RefreshCw, X, Plus,
    Copy, MoreVertical, CheckSquare, Square, ShieldOff, ShieldCheck,
    Trash2, Pencil, Eye, Server, Activity, Play, Globe, Check, Download, Ban,
    Clock, Calendar, AlertTriangle, Filter
} from 'lucide-react';
import { cleanPluginName } from '../lib/api';
import LicenseDrawer, { statusBadge, expiryBadge } from '../components/LicenseDrawer';

/* ─── helpers ─────────────────────────────────────────────── */

const LIMIT = 10;

/* ─── main component ─────────────────────────────────────── */
export default function Licenses() {
    const toast = useToast();

    // state
    const [searchParams, setSearchParams] = useSearchParams();
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState(() => searchParams.get('search') || '');
    const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || '');
    const [statusFilter, setStatus] = useState('');
    const [dateRange, setDateRange] = useState('');
    const [selected, setSelected] = useState(new Set());
    const [drawer, setDrawer] = useState(null);    // license obj for detail view
    const [drawerData, setDrawerData] = useState(null);  // enriched from API
    const [drawerLoading, setDrawerLoading] = useState(false);
    const [editModal, setEditModal] = useState(null);
    const [genModal, setGenModal] = useState(false);
    const [confirm, setConfirm] = useState(null);    // { title, msg, action }

    // Compute date_from ISO string from dateRange
    const dateFrom = (() => {
        if (!dateRange) return '';
        const now = new Date();
        if (dateRange === '7d') return new Date(now - 7 * 86400000).toISOString();
        if (dateRange === '30d') return new Date(now - 30 * 86400000).toISOString();
        if (dateRange === '90d') return new Date(now - 90 * 86400000).toISOString();
        if (dateRange === 'year') return new Date(now.getFullYear(), 0, 1).toISOString();
        return '';
    })();

    const { data, loading, refetch } = useApi(
        `/admin/licenses?page=${page}&limit=${LIMIT}&search=${encodeURIComponent(search)}&status=${statusFilter}&date_from=${encodeURIComponent(dateFrom)}`,
        [page, search, statusFilter, dateFrom]
    );

    const licenses = data?.licenses || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / LIMIT);
    const counts = data?.counts || {};
    const allSelected = licenses.length > 0 && licenses.every(l => selected.has(l.id));

    /* ─── drawer ──────────────────────────────────────────── */
    const openDrawer = useCallback(async (lic) => {
        setDrawer(lic);
        setDrawerData(null);
        setDrawerLoading(true);
        try {
            const d = await get(`/admin/licenses/${lic.id}/details`);
            setDrawerData(d);
        } catch { toast('Could not load license details', 'error'); }
        finally { setDrawerLoading(false); }
    }, [toast]);

    // Handle auto-open drawer via URL
    useEffect(() => {
        const autoOpen = searchParams.get('openLicense');
        if (autoOpen && !drawerLoading && !drawer) {
            get(`/admin/licenses/by-key/${encodeURIComponent(autoOpen)}`)
                .then(res => {
                    if (res.status === 'ok') openDrawer(res);
                }).catch(() => {});
            // remove param to avoid re-trigger
            setSearchParams(p => { p.delete('openLicense'); return p; }, { replace: true });
        }
    }, [searchParams, drawer, drawerLoading, openDrawer, setSearchParams]);

    /* ─── selection ──────────────────────────────────────── */
    const toggleAll = () => {
        if (allSelected) { const s = new Set(selected); licenses.forEach(l => s.delete(l.id)); setSelected(s); }
        else { const s = new Set(selected); licenses.forEach(l => s.add(l.id)); setSelected(s); }
    };
    const toggleOne = (id) => {
        const s = new Set(selected);
        s.has(id) ? s.delete(id) : s.add(id);
        setSelected(s);
    };

    /* ─── actions ─────────────────────────────────────────── */
    const doAction = useCallback(async (id, action, successMsg) => {
        try {
            await put(`/admin/licenses/${id}`, { action });
            toast(successMsg, 'success');
            refetch();
            if (drawer?.id === id) setDrawer(p => ({ ...p, status: action === 'revoke' ? 'revoked' : 'active' }));
        } catch { toast('Action failed', 'error'); }
    }, [toast, refetch, drawer]);

    const doDelete = useCallback(async (id, force = false) => {
        try {
            await del(`/admin/licenses/${id}${force ? '?force=true' : ''}`);
            toast(force ? 'License permanently deleted' : 'License moved to trash', 'success');
            refetch();
            if (drawer?.id === id) setDrawer(null);
        } catch { toast('Delete failed', 'error'); }
    }, [toast, refetch, drawer]);

    const doBulk = useCallback(async (action) => {
        const ids = [...selected];
        try {
            await post('/admin/licenses/bulk', { ids, action });
            toast(`${ids.length} license(s) ${action}d`, 'success');
            setSelected(new Set());
            refetch();
        } catch { toast('Bulk action failed', 'error'); }
    }, [selected, toast, refetch]);

    const doEdit = useCallback(async (form) => {
        try {
            await put(`/admin/licenses/${editModal.id}`, form);
            toast('License updated', 'success');
            setEditModal(null);
            refetch();
        } catch { toast('Update failed', 'error'); }
    }, [editModal, toast, refetch]);

    /* ─── generate license ───────────────────────────────── */
    const [genResult, setGenResult] = useState(null);
    const [genForm, setGenForm] = useState({ name: '', duration_days: 30, max_devices: 2, count: 1, note: '' });
    const [genLoading, setGenLoading] = useState(false);

    const doGenerate = async (e) => {
        e.preventDefault();
        setGenLoading(true);
        try {
            const d = await post('/admin/licenses', genForm);
            setGenResult(d);
            refetch();
        } catch { toast('Failed to create license', 'error'); }
        finally { setGenLoading(false); }
    };

    /* ─── search ──────────────────────────────────────────── */
    const handleSearch = (e) => {
        e.preventDefault();
        setSearch(searchInput);
        setPage(1);
    };

    const getRepoUrl = (key) => `${window.location.origin}/r/${key}/repo.json`;

    const doExport = () => {
        const token = localStorage.getItem('cs_token');
        window.open(`/api/admin/export/licenses?token=${token}`, '_blank');
    };

    /* ─── render ──────────────────────────────────────────── */
    return (
        <div className="space-y-4">
            {/* ── Toolbar ── */}
            <div className="flex flex-wrap items-center gap-2.5 toolbar-row">
                <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-[220px]">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            placeholder="Search key, name, note…"
                            className="form-input pl-8"
                        />
                    </div>
                </form>
                <select value={dateRange} onChange={e => { setDateRange(e.target.value); setPage(1); }} className="form-select text-[12px]">
                    <option value="">All Time</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="90d">Last 90 Days</option>
                    <option value="year">This Year</option>
                </select>
                <button onClick={doExport} className="btn-ghost text-[12px] py-2 whitespace-nowrap hidden sm:flex">
                    <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
                <button onClick={refetch} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { setGenModal(true); setGenResult(null); setGenForm({ name: '', duration_days: 30, max_devices: 2, count: 1, note: '' }); }} className="btn-primary text-[12px] py-2">
                    <Plus className="w-3.5 h-3.5" /> New License
                </button>
            </div>

            {/* ── Status Filter Pills ── */}
            <div className="flex flex-wrap items-center gap-1.5">
                {[
                    { key: '', label: 'All', color: 'slate', icon: null },
                    { key: 'active', label: 'Active', color: 'emerald', icon: null },
                    { key: 'expiring_soon', label: 'Expiring Soon', color: 'amber', icon: AlertTriangle },
                    { key: 'expired', label: 'Expired', color: 'red', icon: null },
                    { key: 'revoked', label: 'Revoked', color: 'purple', icon: null },
                ].map(s => {
                    const isActive = statusFilter === s.key;
                    const count = s.key === '' ? counts.all : counts[s.key];
                    const colorMap = {
                        slate: isActive ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
                        emerald: isActive ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20',
                        amber: isActive ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20',
                        red: isActive ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20',
                        purple: isActive ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20',
                    };
                    return (
                        <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200 ${colorMap[s.color]}`}>
                            {s.icon && <s.icon className="w-3 h-3" />}
                            {s.label}
                            {count !== undefined && <span className={`ml-0.5 text-[10px] font-bold ${isActive ? 'opacity-80' : 'opacity-60'}`}>{count}</span>}
                        </button>
                    );
                })}
            </div>

            {/* ── Bulk action bar ── */}
            {selected.size > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-xl text-[12px] font-medium text-indigo-700 dark:text-indigo-300 fade-in">
                    <Check className="w-3.5 h-3.5" />
                    <span>{selected.size} selected</span>
                    <div className="flex-1" />
                    <button onClick={() => setConfirm({ title: 'Activate Selected', msg: `Activate ${selected.size} license(s)?`, action: () => doBulk('activate') })} className="px-3 py-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600">Activate</button>
                    <button onClick={() => setConfirm({ title: 'Revoke Selected', msg: `Revoke ${selected.size} license(s)?`, action: () => doBulk('revoke'), danger: true })} className="px-3 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600">Revoke</button>
                    <button onClick={() => setConfirm({ title: 'Delete Selected', msg: `Move ${selected.size} license(s) to trash?`, action: () => doBulk('delete'), danger: true })} className="px-3 py-1 rounded-lg bg-slate-500 text-white hover:bg-slate-600">Delete</button>
                    <button onClick={() => setSelected(new Set())} className="p-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/20"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* ── Table ── */}
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
                                <th>License</th>
                                <th>Status</th>
                                <th>Expires</th>
                                <th className="hide-mobile">Devices</th>
                                <th className="hide-mobile">Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(LIMIT)].map((_, i) => (
                                    <tr key={i}>
                                        {[...Array(7)].map((_, j) => (
                                            <td key={j}><div className="skeleton h-4 rounded w-20" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : licenses.length === 0 ? (
                                <tr><td colSpan={7} className="py-16 text-center text-[13px] text-slate-400">No licenses found</td></tr>
                            ) : licenses.map(l => (
                                <tr key={l.id} className={selected.has(l.id) ? 'bg-indigo-50/60 dark:bg-indigo-500/5' : ''}>
                                    <td>
                                        <button onClick={() => toggleOne(l.id)} className="text-slate-400">
                                            {selected.has(l.id) ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                                        </button>
                                    </td>
                                    <td>
                                        {/* Name above key */}
                                        <div className="flex flex-col gap-0.5">
                                            {l.name && (
                                                <button onClick={() => openDrawer(l)} className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-600 hover:underline text-left leading-tight">
                                                    {l.name}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => copyText(getRepoUrl(l.license_key))}
                                                title="Copy Repo URL"
                                                className="flex items-center gap-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 transition-colors w-fit text-left break-all"
                                            >
                                                {l.license_key}
                                                <Copy className="w-3 h-3 opacity-50 shrink-0" />
                                            </button>
                                        </div>
                                    </td>
                                    <td>{statusBadge(l.status)}</td>
                                    <td className="whitespace-nowrap">{expiryBadge(l.expires_at)}</td>
                                    <td className="hide-mobile">
                                        <span className="text-[12px] text-slate-600 dark:text-slate-400">
                                            {l.device_count}/{l.max_devices}
                                        </span>
                                    </td>
                                    <td className="hide-mobile text-[11px] text-slate-400">{formatWIB(l.created_at)}</td>
                                    <td>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => openDrawer(l)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-600" title="Details">
                                                <Eye className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => setEditModal({ ...l })} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-600" title="Edit">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            {l.status === 'revoked'
                                                ? <button onClick={() => setConfirm({ title: 'Activate License', msg: 'Activate this license?', action: () => doAction(l.id, 'activate', 'License activated') })} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-500" title="Activate"><ShieldCheck className="w-3.5 h-3.5" /></button>
                                                : <button onClick={() => setConfirm({ title: 'Revoke License', msg: 'Revoke this license? Users will lose access immediately.', action: () => doAction(l.id, 'revoke', 'License revoked'), danger: true })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" title="Revoke"><ShieldOff className="w-3.5 h-3.5" /></button>
                                            }
                                            <button onClick={() => setConfirm({ title: 'Delete License', msg: 'Move this license to trash?', action: () => doDelete(l.id), danger: true })} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-600" title="Delete">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* ── Pagination ── */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-[12px] text-slate-500">
                    <span className="pager-text">{total} total · Page {page}/{totalPages || 1}</span>
                    <span className="text-slate-400 sm:hidden">{page}/{totalPages || 1}</span>
                    <div className="flex items-center gap-1.5">
                        <button disabled={page <= 1} onClick={() => setPage(1)} className="px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">«</button>
                        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                        {/* Page numbers */}
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                            let p;
                            if (totalPages <= 7) p = i + 1;
                            else if (page <= 4) p = i + 1;
                            else if (page >= totalPages - 3) p = totalPages - 6 + i;
                            else p = page - 3 + i;
                            if (p < 1 || p > totalPages) return null;
                            return (
                                <button key={p} onClick={() => setPage(p)}
                                    className={`w-7 h-7 rounded-lg text-[12px] font-medium ${p === page ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                    {p}
                                </button>
                            );
                        })}
                        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                        <button disabled={page >= totalPages} onClick={() => setPage(totalPages)} className="px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">»</button>
                    </div>
                </div>
            </div>

            {/* ══════════════════════════════════════
                DETAIL DRAWER
                ══════════════════════════════════════ */}
            <LicenseDrawer
                drawer={drawer}
                setDrawer={setDrawer}
                setConfirm={setConfirm}
                setEditModal={setEditModal}
                openDrawer={openDrawer}
                drawerLoading={drawerLoading}
                drawerData={drawerData}
            />

            {/* ══════════════════════════════════════
                EDIT MODAL
                ══════════════════════════════════════ */}
            {editModal && (
                <EditLicenseModal
                    license={editModal}
                    onClose={() => setEditModal(null)}
                    onSave={doEdit}
                />
            )}

            {/* ══════════════════════════════════════
                GENERATE MODAL
                ══════════════════════════════════════ */}
            {genModal && createPortal(
                <div className="modal-overlay" onClick={() => setGenModal(false)}>
                    <div className="modal-box max-w-[440px]" onClick={e => e.stopPropagation()}>
                        <div className="modal-content">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20">
                                        <Plus className="w-5 h-5 text-white" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-[-0.01em]">Generate License</h2>
                                        <p className="text-[13px] text-slate-500 dark:text-slate-400 font-medium tracking-tight mt-0.5">Create a new license key</p>
                                    </div>
                                </div>
                                <button onClick={() => setGenModal(false)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-150 relative -top-1">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            {genResult ? (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 shadow-sm">
                                        <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mb-2 uppercase tracking-wide">
                                            {genResult.keys ? `${genResult.keys.length} Licenses Created` : 'License Created!'}
                                        </div>
                                        {genResult.key ? (
                                            <button onClick={() => copyText(genResult.key)} className="flex items-center gap-2 font-mono text-[13px] font-bold text-emerald-800 dark:text-emerald-300 break-all hover:underline group">
                                                {getRepoUrl(genResult.key)}
                                                <Copy className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" />
                                            </button>
                                        ) : (
                                            <div className="space-y-1.5 max-h-[180px] overflow-y-auto custom-scroll pr-1">
                                                {genResult.keys?.map(k => (
                                                    <button key={k} onClick={() => copyText(getRepoUrl(k))} className="flex items-center gap-2 font-mono text-[11px] text-emerald-800 dark:text-emerald-300 hover:underline w-full text-left group bg-white/50 dark:bg-black/20 p-2 rounded-md transition-colors">
                                                        {getRepoUrl(k)} <Copy className="w-3 h-3 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="form-divider" />
                                    <div className="flex gap-3">
                                        <button onClick={() => { setGenResult(null); }} className="btn-ghost flex-1 justify-center">Generate Another</button>
                                        <button onClick={() => copyText(genResult.key ? getRepoUrl(genResult.key) : genResult.keys?.map(k => getRepoUrl(k)).join('\n'))} className="btn-primary flex-1 justify-center shadow-indigo-500/25">
                                            <Copy className="w-3.5 h-3.5 mr-2" /> Copy All
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <form onSubmit={doGenerate}>
                                    <div className="form-group">
                                        <label className="form-label">Label / Name (optional)</label>
                                        <input value={genForm.name} onChange={e => setGenForm(p => ({ ...p, name: e.target.value }))} className="form-input" placeholder="e.g. John Doe" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 form-group">
                                        <div>
                                            <label className="form-label">Duration (days)</label>
                                            <input type="number" value={genForm.duration_days} onChange={e => setGenForm(p => ({ ...p, duration_days: parseInt(e.target.value) || 30 }))} className="form-input" min={1} max={3650} />
                                        </div>
                                        <div>
                                            <label className="form-label">Max Devices</label>
                                            <input type="number" value={genForm.max_devices} onChange={e => setGenForm(p => ({ ...p, max_devices: parseInt(e.target.value) || 1 }))} className="form-input" min={1} max={20} />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Quantity (bulk)</label>
                                        <input type="number" value={genForm.count} onChange={e => setGenForm(p => ({ ...p, count: Math.min(parseInt(e.target.value) || 1, 100) }))} className="form-input" min={1} max={100} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Note (optional)</label>
                                        <input value={genForm.note} onChange={e => setGenForm(p => ({ ...p, note: e.target.value }))} className="form-input" placeholder="Internal reference…" />
                                    </div>
                                    <div className="form-divider pt-1" />
                                    <div className="flex justify-end pt-1">
                                        <button type="submit" disabled={genLoading} className="btn-primary w-full justify-center shadow-lg shadow-indigo-500/25 text-white bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 border-none">
                                            {genLoading ? 'Generating…' : `Generate ${genForm.count > 1 ? `${genForm.count} Keys` : 'Key'}`}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Confirm Modal ── */}
            <ConfirmModal
                open={!!confirm}
                title={confirm?.title}
                message={confirm?.msg}
                confirmLabel={confirm?.danger ? 'Confirm' : 'Yes'}
                danger={confirm?.danger}
                onConfirm={confirm?.action}
                onClose={() => setConfirm(null)}
            />
        </div>
    );
}

/* ─── Edit License Modal ────────────────────────────────────── */
function EditLicenseModal({ license, onClose, onSave }) {
    const [form, setForm] = useState({
        name: license.name || '',
        note: license.note || '',
        max_devices: license.max_devices || 2,
        expires_at: license.expires_at ? license.expires_at.slice(0, 10) : '',
        status: license.status || 'active',
    });
    const [saving, setSaving] = useState(false);

    const handle = async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave({ ...form, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined });
        setSaving(false);
    };

    return createPortal(
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-[15px] font-bold text-slate-900 dark:text-white">Edit License</h2>
                    <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </div>
                <div className="mb-3 text-[11px] font-mono text-slate-400 break-all">{license.license_key}</div>
                <form onSubmit={handle} className="space-y-4">
                    <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Name</label>
                        <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="form-input" placeholder="License label" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Devices</label>
                            <input type="number" value={form.max_devices} onChange={e => setForm(p => ({ ...p, max_devices: parseInt(e.target.value) || 1 }))} className="form-input" min={1} max={20} />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Status</label>
                            <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className="form-select w-full">
                                <option value="active">Active</option>
                                <option value="revoked">Revoked</option>
                                <option value="expired">Expired</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Expires At</label>
                        <input type="date" value={form.expires_at} onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))} className="form-input" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">Note</label>
                        <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} className="form-input" placeholder="Internal note…" />
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose} className="btn-ghost flex-1 justify-center text-[12px]">Cancel</button>
                        <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center text-[12px]">{saving ? 'Saving…' : 'Save Changes'}</button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
