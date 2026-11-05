import React from 'react';
import { Calendar, Monitor, Compass, Sparkles, Tablet } from 'lucide-react';
import { getScheduleUnavailableMessage } from '../../utils/scheduleAvailability';

export interface ScheduleUnavailableNoticeProps {
  availability: 'wider-needed' | 'desktop-only';
  onNavigateToMap: () => void;
}

export const ScheduleUnavailableNotice: React.FC<ScheduleUnavailableNoticeProps> = ({
  availability,
  onNavigateToMap,
}) => {
  const message = getScheduleUnavailableMessage(availability);
  const isTablet = availability === 'wider-needed';

  return (
    <div className="flex-1 w-full max-w-lg mx-auto px-4 py-8 sm:py-12 flex flex-col items-center justify-center text-center safe-area-pb safe-area-pt">
      {/* Decorative badge / icons */}
      <div className="relative mb-6 flex items-center justify-center">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shadow-xl shadow-indigo-950/30">
          <Calendar className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-400" />
        </div>
        <div className="absolute -bottom-2 -right-2 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center shadow-lg">
          {isTablet ? (
            <Tablet className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
          ) : (
            <Monitor className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
          )}
        </div>
      </div>

      {/* Pill tag */}
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/80 text-[11px] font-semibold text-slate-300 mb-3">
        {isTablet ? (
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
        Armador de horarios
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
            En computadora vas a poder comparar comisiones simultáneas, detectar superposiciones de franjas y exportar tu calendario semanal completo.
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

      {/* Primary Action Button */}
      <button
        type="button"
        onClick={onNavigateToMap}
        className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
      >
        <Compass className="w-5 h-5 shrink-0" />
        <span>Volver al mapa</span>
      </button>
    </div>
  );
};
