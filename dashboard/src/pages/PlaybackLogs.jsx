import { useState } from 'react';
import { get, formatWIB, truncKey, copyText } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Search, ChevronLeft, ChevronRight, RefreshCw, Copy, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PlaybackLogs() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const navigate = useNavigate();

    const { data, loading, refetch } = useApi(
        `/admin/playback-logs?page=${page}&limit=20&search=${encodeURIComponent(search)}`,
        [page, search]
    );
    const logs = data?.logs || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / 20);

    const openDrawer = (log) => {
        if (!log.license_key) return;
        navigate(`/licenses?search=${encodeURIComponent(log.license_key)}&openLicense=${encodeURIComponent(log.license_key)}`);
    };

    const exportCsv = () => {
        if (!logs.length) return;
        const cols = ['license_key', 'plugin_name', 'video_title', 'source', 'ip_address', 'created_at'];
        const rows = [cols.join(','), ...logs.map(l => cols.map(c => `"${l[c] || ''}"`).join(','))].join('\n');
        const win = window.open('', '_blank');
        win.document.write(`<pre>${rows}</pre>`);
    };

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1); } }}
                            placeholder="Search plugin, license, title, device…"
                            className="form-input pl-8 w-64"
                        />
                    </div>
                    <button onClick={refetch} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><RefreshCw className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[12px] text-slate-400">{total} total records</span>
                    <button onClick={exportCsv} className="btn-ghost py-1.5 text-[12px]">
                        <Download className="w-3.5 h-3.5" /> Export CSV
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>License Info</th>
                                <th>Device & IP</th>
                                <th>Plugin</th>
                                <th>Content Title</th>
                                <th>Source</th>
                                <th>Timestamp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [...Array(8)].map((_, i) => (
                                    <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-24 rounded" /></td>)}</tr>
                                ))
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-12 text-[13px] text-slate-400">No playback logs found</td></tr>
                            ) : logs.map((l, i) => {
                                // display_name is alias-aware from server
                                const devDisplay = l.display_name || l.device_name || '';
                                return (
                                    <tr key={i}>
                                        <td>
                                            <div className="flex flex-col">
                                                <button onClick={() => openDrawer(l)} className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-600 hover:underline text-left">
                                                    {l.license_name || 'Unnamed License'}
                                                </button>
                                                <button onClick={() => copyText(l.license_key)} className="flex items-center gap-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline w-fit">
                                                    {truncKey(l.license_key)} <Copy className="w-3 h-3 opacity-40" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="text-[12px] text-slate-600 dark:text-slate-400">
                                            <div className="flex flex-col gap-0.5">
                                                {devDisplay ? (
                                                    <button
                                                        onClick={() => openDrawer(l)}
                                                        className="font-medium text-[11px] text-slate-700 dark:text-slate-300 hover:text-indigo-600 hover:underline text-left"
                                                    >
                                                        {devDisplay}
                                                    </button>
                                                ) : (
                                                    <span className="font-medium text-[11px] text-slate-400">Unknown Device</span>
                                                )}
                                                <span className="font-mono text-[10px] text-slate-500">
                                                    {l.ip_address || '—'}
                                                </span>
                                                {l.device_id && (
                                                    <span className="font-mono text-[9px] text-slate-400/80" title="Raw Device ID">
                                                        ID: {l.device_id.length > 12 ? l.device_id.substring(0, 12) + '…' : l.device_id}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="font-medium text-[13px]">{l.plugin_name || '—'}</td>
                                        <td className="text-[12px] text-slate-600 dark:text-slate-400 max-w-[180px] truncate">{l.video_title || '—'}</td>
                                        <td className="text-[12px] text-slate-500">{l.source_provider || l.video_url?.split('/')?.[2] || '—'}</td>
                                        <td className="text-[11px] text-slate-400 whitespace-nowrap">{formatWIB(l.played_at)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800 text-[12px] text-slate-500">
                    <span>{total} records</span>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                            <span>Page {page} / {totalPages}</span>
                            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}
