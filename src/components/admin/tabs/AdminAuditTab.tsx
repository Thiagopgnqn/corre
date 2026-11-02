import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Eye,
  ChevronLeft,
  ChevronRight,
  Shield,
  Loader2,
  X,
  Lock,
} from 'lucide-react';
import { adminApi, type AdminAuditLogItem } from '../../../api/admin.api';

export const AdminAuditTab: React.FC = () => {
  const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
  });
  const [actionFilter, setActionFilter] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Detail Modal
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogItem | null>(null);

  const fetchLogs = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const res = await adminApi.listAuditLogs({
          page,
          pageSize: 25,
          action: actionFilter || undefined,
          adminUserId: adminFilter || undefined,
        });
        if (res.success && res.data) {
          setLogs(res.data.logs);
          setPagination(res.data.pagination);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al obtener registros de auditoría.');
      } finally {
        setIsLoading(false);
      }
    },
    [actionFilter, adminFilter]
  );

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-between text-xs text-red-300">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Info Notice about Inmutability */}
      <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 flex items-start gap-3 text-xs text-slate-300">
        <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-semibold text-white">Registro Inmutable y Auditado:</span> Los registros de esta tabla son generados automáticamente en cada acción sensible del panel y protegidos a nivel base de datos mediante triggers PostgreSQL que impiden modificaciones (UPDATE o DELETE). Ningún hash ni credencial secreta se almacena.
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 text-xs">
        <div className="flex flex-1 items-center gap-3">
          <input
            type="text"
            placeholder="Filtrar por acción (ej. user.suspend, commission.retire)..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />

          <input
            type="text"
            placeholder="Filtrar por ID de Administrador..."
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value)}
            className="w-64 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <button
          type="button"
          onClick={() => fetchLogs(1)}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors cursor-pointer"
        >
          Filtrar
        </button>
      </div>

      {/* Audit Log Table */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Fecha y Hora</th>
                <th className="py-3 px-4">Administrador</th>
                <th className="py-3 px-4">Acción</th>
                <th className="py-3 px-4">Destino</th>
                <th className="py-3 px-4">IP</th>
                <th className="py-3 px-4 text-right">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
                    Cargando registros de auditoría...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No hay registros de auditoría que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Timestamp */}
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                      {new Date(log.createdAt).toLocaleString([], {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>

                    {/* Admin */}
                    <td className="py-3 px-4 font-medium text-white">
                      <div className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate max-w-[180px]">{log.adminEmail}</span>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 font-mono text-indigo-300">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/20 text-[11px]">
                        {log.action}
                      </span>
                    </td>

                    {/* Target */}
                    <td className="py-3 px-4 text-slate-300">
                      <div className="text-[11px]">
                        <span className="text-slate-400 capitalize">{log.targetType}</span>
                        {log.targetEmail && <span className="ml-1 text-white">({log.targetEmail})</span>}
                        {log.targetId && !log.targetEmail && (
                          <span className="ml-1 font-mono text-[10px] text-slate-400">
                            #{log.targetId.substring(0, 8)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* IP */}
                    <td className="py-3 px-4 font-mono text-[10px] text-slate-400">
                      {log.ipAddress || '—'}
                    </td>

                    {/* Details button */}
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedLog(log)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        title="Ver payload sanitizado"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Total: <span className="font-semibold text-white">{pagination.total}</span> acciones auditadas
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => fetchLogs(pagination.page - 1)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Página {pagination.page} de {Math.max(1, pagination.totalPages)}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => fetchLogs(pagination.page + 1)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Detail JSON Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  Detalle del Evento de Auditoría
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  ID: {selectedLog.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs mb-4">
              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[10px]">Acción:</span>
                  <span className="font-mono text-indigo-300 font-semibold">{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Admin:</span>
                  <span className="text-white font-medium">{selectedLog.adminEmail}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Destino:</span>
                  <span className="text-slate-200">
                    {selectedLog.targetType} {selectedLog.targetEmail ? `(${selectedLog.targetEmail})` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">IP:</span>
                  <span className="font-mono text-slate-300">{selectedLog.ipAddress || '—'}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 block font-semibold mb-1">Payload Registrado (JSON):</span>
                <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto text-[11px] font-mono text-emerald-400 max-h-60">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedLog(null)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
