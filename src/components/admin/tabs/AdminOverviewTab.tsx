import React, { useState, useEffect } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Shield,
  UserPlus,
  Calendar,
  BookOpen,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Clock,
  Server,
  Activity,
  HardDrive,
} from 'lucide-react';
import { adminApi, type AdminStatsResponse } from '../../../api/admin.api';

export const AdminOverviewTab: React.FC = () => {
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStats = async (selectedRange = range) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminApi.getStats(selectedRange);
      if (res.success && res.data) {
        setStats(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al cargar las métricas del panel.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(range);
  }, [range]);

  const maxSignup = Math.max(
    1,
    ...(stats?.charts?.signupsByDay?.map((d) => d.count) || [1])
  );

  const maxActive = Math.max(
    1,
    ...(stats?.charts?.activeUsersByDay?.map((d) => d.count) || [1])
  );

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            Resumen General y Métricas
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Caché en memoria de 60 segundos para alto rendimiento.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          {/* Range Selector */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            {(['7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  range === r
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r === '7d' ? '7 días' : r === '30d' ? '30 días' : '90 días'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchStats(range)}
            disabled={isLoading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
            title="Refrescar métricas"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Usuarios Totales</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {stats?.overview?.totalUsers ?? '—'}
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1 font-medium">
            <UserPlus className="w-3 h-3" />
            +{stats?.overview?.newUsersInRange ?? 0} en los últimos {range}
          </div>
        </div>

        {/* Active vs Suspended */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Activos / Suspendidos</span>
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white flex items-baseline gap-2">
            <span>{stats?.overview?.activeUsersCount ?? '—'}</span>
            <span className="text-xs font-normal text-slate-400">activos</span>
          </div>
          <div className="text-[11px] text-red-400 flex items-center gap-1 mt-1 font-medium">
            <UserX className="w-3 h-3" />
            {stats?.overview?.suspendedUsersCount ?? 0} cuentas suspendidas
          </div>
        </div>

        {/* Activity: Enrollments & Reviews */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Cursadas Guardadas</span>
            <Calendar className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {stats?.overview?.totalEnrollments ?? '—'}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
            <BookOpen className="w-3 h-3 text-indigo-400" />
            En materias de toda la carrera
          </div>
        </div>

        {/* Reviews & Reports */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Reseñas y Reportes</span>
            <MessageSquare className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {stats?.overview?.totalReviews ?? '—'}
          </div>
          <div
            className={`text-[11px] flex items-center gap-1 mt-1 font-medium ${
              (stats?.overview?.pendingReportsCount || 0) > 0
                ? 'text-amber-400 font-bold'
                : 'text-slate-400'
            }`}
          >
            <AlertTriangle className="w-3 h-3" />
            {stats?.overview?.pendingReportsCount ?? 0} reportes pendientes
          </div>
        </div>
      </div>

      {/* Library & Cloudflare R2 KPI row */}
      {stats?.library && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Biblioteca: Aprobados</span>
              <BookOpen className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {stats.library.approvedCount}
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
              Catálogo público disponible
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Biblioteca: Pendientes</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {stats.library.pendingCount}
            </div>
            <div className="text-[11px] text-amber-400 flex items-center gap-1 mt-1 font-medium">
              En cola de moderación humana
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Almacenamiento R2</span>
              <HardDrive className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {stats.library.totalSizeBytes > 1024 * 1024 * 1024
                ? `${(stats.library.totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
                : `${(stats.library.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB`}
            </div>
            <div
              className={`text-[11px] flex items-center gap-1 mt-1 font-medium ${
                stats.library.warningNearLimit ? 'text-rose-400 font-bold' : 'text-slate-400'
              }`}
            >
              {stats.library.warningNearLimit ? '⚠️ Cerca del límite gratuito (10 GB)' : 'Tier gratuito Cloudflare R2'}
            </div>
          </div>
        </div>
      )}

      {/* R2 Storage Warning Banner */}
      {stats?.library?.warningNearLimit && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-3 text-xs text-amber-300">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="font-bold text-amber-200">Alerta preventiva de cuota Cloudflare R2</p>
            <p className="mt-0.5">
              El almacenamiento total ocupado ha superado los 8 GB (umbral cercano al límite del tier gratuito de 10 GB de Cloudflare R2).
            </p>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Signups by day */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-400" />
              Nuevos Registros por Día
            </h3>
            <span className="text-xs text-slate-400">{stats?.charts?.signupsByDay?.length || 0} puntos</span>
          </div>

          <div className="h-44 flex items-end gap-1.5 pt-4 overflow-x-auto pb-2 border-b border-slate-800">
            {stats?.charts?.signupsByDay && stats.charts.signupsByDay.length > 0 ? (
              stats.charts.signupsByDay.map((item, idx) => {
                const heightPct = Math.round((item.count / maxSignup) * 100);
                return (
                  <div
                    key={idx}
                    className="flex-1 min-w-[14px] flex flex-col items-center gap-1 group relative"
                  >
                    <div className="text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 bg-slate-800 px-1.5 py-0.5 rounded shadow z-10 whitespace-nowrap">
                      {item.date}: {item.count} reg.
                    </div>
                    <div
                      className="w-full bg-indigo-500/80 hover:bg-indigo-400 rounded-t-sm transition-all"
                      style={{ height: `${Math.max(4, heightPct)}%` }}
                    />
                  </div>
                );
              })
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                Sin datos de registros para este período.
              </div>
            )}
          </div>
          <div className="flex justify-between items-center text-[10px] text-slate-500 mt-2">
            <span>Inicio del período</span>
            <span>Hoy</span>
          </div>
        </div>

        {/* Active users by day */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Usuarios Activos (Last Seen)
            </h3>
            <span className="text-xs text-slate-400">Actualizado con debounce de 1 hora</span>
          </div>

          <div className="h-44 flex items-end gap-1.5 pt-4 overflow-x-auto pb-2 border-b border-slate-800">
            {stats?.charts?.activeUsersByDay && stats.charts.activeUsersByDay.length > 0 ? (
              stats.charts.activeUsersByDay.map((item, idx) => {
                const heightPct = Math.round((item.count / maxActive) * 100);
                return (
                  <div
                    key={idx}
                    className="flex-1 min-w-[14px] flex flex-col items-center gap-1 group relative"
                  >
                    <div className="text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 bg-slate-800 px-1.5 py-0.5 rounded shadow z-10 whitespace-nowrap">
                      {item.date}: {item.count} act.
                    </div>
                    <div
                      className="w-full bg-emerald-500/80 hover:bg-emerald-400 rounded-t-sm transition-all"
                      style={{ height: `${Math.max(4, heightPct)}%` }}
                    />
                  </div>
                );
              })
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                Sin datos de actividad reciente.
              </div>
            )}
          </div>
          <div className="flex justify-between items-center text-[10px] text-slate-500 mt-2">
            <span>Inicio del período</span>
            <span>Hoy</span>
          </div>
        </div>
      </div>

      {/* Catalog & System Health Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quality Alerts */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Alertas de Calidad del Catálogo
          </h3>

          {stats?.catalog?.qualityAlerts && stats.catalog.qualityAlerts.length > 0 ? (
            <div className="space-y-2.5">
              {stats.catalog.qualityAlerts.map((alert, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3 text-xs text-amber-200"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{alert.message}</p>
                    {alert.details && (
                      <p className="text-[11px] text-amber-300/80 mt-0.5 font-mono">
                        {typeof alert.details === 'string'
                          ? alert.details
                          : JSON.stringify(alert.details)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                El catálogo no presenta alertas críticas: comisiones y docentes se encuentran consistentes.
              </span>
            </div>
          )}

          {/* Quick catalog totals */}
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-800 text-xs">
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Materias</span>
              <span className="text-base font-bold text-white">{stats?.catalog?.totalSubjects ?? '—'}</span>
            </div>
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Comisiones</span>
              <span className="text-base font-bold text-white">{stats?.catalog?.totalCommissions ?? '—'}</span>
            </div>
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Docentes</span>
              <span className="text-base font-bold text-white">{stats?.catalog?.totalProfessors ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* System Health */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
              <Server className="w-4 h-4 text-indigo-400" />
              Salud del Sistema
            </h3>

            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-slate-400">PostgreSQL (Neon):</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Conectado
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-slate-400">Tiempo en línea:</span>
                <span className="font-mono text-slate-200">
                  {stats?.health?.uptimeSeconds ? formatUptime(stats.health.uptimeSeconds) : '—'}
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-slate-400">Admins Activos:</span>
                <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                  <Shield className="w-3.5 h-3.5" />
                  {stats?.overview?.adminsCount ?? 1}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Última caché:</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {stats?.health?.cachedAt
                    ? new Date(stats.health.cachedAt).toLocaleTimeString()
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/60 text-[10px] text-slate-400 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>Las consultas de métricas se actualizan de forma programada en segundo plano.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
