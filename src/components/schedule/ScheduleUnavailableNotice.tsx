import React from 'react';
import {
  AlertTriangle,
  Calendar,
  Compass,
  Monitor,
  RefreshCw,
  Sparkles,
  Tablet,
  Upload,
} from 'lucide-react';
import {
  getScheduleUnavailableMessage,
  type ScheduleNoticeReason,
} from '../../utils/scheduleAvailability';

export interface ScheduleUnavailableNoticeProps {
  availability: ScheduleNoticeReason;
  onNavigateToMap: () => void;
  errorDetail?: string | null;
  planName?: string | null;
  onRetry?: () => void;
  isRetrying?: boolean;
  onImportJson?: () => void;
}

export const ScheduleUnavailableNotice: React.FC<ScheduleUnavailableNoticeProps> = ({
  availability,
  onNavigateToMap,
  errorDetail,
  planName,
  onRetry,
  isRetrying = false,
  onImportJson,
}) => {
  const message = getScheduleUnavailableMessage(availability, {
    errorDetail,
    planName,
  });
  const isTablet = availability === 'wider-needed';
  const isBackendError = availability === 'backend-error';
  const isNoSchedule = availability === 'no-schedule';

  return (
    <div className="flex-1 w-full max-w-lg mx-auto px-4 py-8 sm:py-12 flex flex-col items-center justify-center text-center safe-area-pb safe-area-pt">
      {/* Decorative badge / icons */}
      <div className="relative mb-6 flex items-center justify-center">
        <div
          className={`w-20 h-20 sm:w-24 sm:h-24 rounded-3xl flex items-center justify-center shadow-xl ${
            isBackendError
              ? 'bg-rose-500/10 border border-rose-500/20 shadow-rose-950/30'
              : 'bg-indigo-500/10 border border-indigo-500/20 shadow-indigo-950/30'
          }`}
        >
          <Calendar
            className={`w-10 h-10 sm:w-12 sm:h-12 ${
              isBackendError ? 'text-rose-400' : 'text-indigo-400'
            }`}
          />
        </div>
        <div className="absolute -bottom-2 -right-2 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center shadow-lg">
          {isBackendError ? (
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-rose-400" />
          ) : isNoSchedule ? (
            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
          ) : isTablet ? (
            <Tablet className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
          ) : (
            <Monitor className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
          )}
        </div>
      </div>

      {/* Pill tag */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/80 text-[11px] font-semibold text-slate-300 mb-3">
        {isBackendError ? (
          <>
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>Error al cargar horarios</span>
          </>
        ) : isNoSchedule ? (
          <>
            <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Sin oferta horaria cargada</span>
          </>
        ) : isTablet ? (
          <>
            <Tablet className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Pantalla ancha requerida</span>
          </>
        ) : (
          <>
            <Monitor className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Disponible solo en computadora</span>
          </>
        )}
      </div>

      {/* Title with aria-live */}
      <h2
        aria-live="polite"
        className="text-xl sm:text-2xl font-black text-white tracking-tight mb-3"
      >
        {isBackendError
          ? 'No pudimos cargar los horarios'
          : isNoSchedule
          ? 'Horarios aún no disponibles'
          : 'Armador de horarios'}
      </h2>

      {/* Explanatory text */}
      <p className="text-sm sm:text-base text-slate-300 leading-relaxed mb-6 max-w-md break-words">
        {message}
      </p>

      {/* Action cards / hints */}
      <div className="w-full bg-slate-900/60 border border-slate-800 rounded-2xl p-4 mb-6 text-left space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <p className="text-xs text-slate-300 leading-normal">
            {isBackendError
              ? 'Tu progreso académico sigue intacto. Podés reintentar la carga de horarios ahora o volver al mapa mientras se restablece el servicio.'
              : isNoSchedule
              ? 'Cuando haya comisiones publicadas para este plan vas a verlas automáticamente acá. También podés importar un archivo JSON propio si ya tenés tus horarios.'
              : 'En computadora vas a poder comparar comisiones simultáneas, detectar superposiciones de franjas y exportar tu calendario semanal completo.'}
          </p>
        </div>
        {isTablet && (
          <div className="flex items-start gap-3 pt-2 border-t border-slate-800/80">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 mt-0.5">
              <Tablet className="w-4 h-4" />
            </div>
            <p className="text-xs text-amber-200/90 leading-normal font-medium">
              Consejo: si estás usando una tablet, simplemente rotá el dispositivo a posición horizontal.
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
        {isBackendError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <RefreshCw className={`w-5 h-5 shrink-0 ${isRetrying ? 'animate-spin' : ''}`} />
            <span>{isRetrying ? 'Reintentando...' : 'Reintentar'}</span>
          </button>
        )}

        {isNoSchedule && onImportJson && (
          <button
            type="button"
            onClick={onImportJson}
            className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span>Importar horarios (JSON)</span>
          </button>
        )}

        <button
          type="button"
          onClick={onNavigateToMap}
          className={`w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${
            isBackendError && onRetry
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25'
          }`}
        >
          <Compass className="w-5 h-5 shrink-0" />
          <span>Volver al mapa</span>
        </button>
      </div>
    </div>
  );
};
