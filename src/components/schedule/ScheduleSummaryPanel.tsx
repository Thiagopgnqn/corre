import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Sparkles,
  PlayCircle,
  Copy,
  Download,
  Trash2,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import type { Commission, ScheduleConflict, DayOfWeek } from '../../types/schedule';
import { calculateScheduleSummary, DAY_LABELS } from '../../utils/scheduleLogic';

interface ScheduleSummaryPanelProps {
  selections: Record<number, Commission>;
  conflicts: ScheduleConflict[];
  subjectNamesMap: Map<number, string>;
  onOpenCombinationsModal: () => void;
  onApplyToEnrolled: () => void;
  onClearAll: () => void;
  onSelectConflict: (conflictId: string) => void;
}

export const ScheduleSummaryPanel: React.FC<ScheduleSummaryPanelProps> = ({
  selections,
  conflicts,
  subjectNamesMap,
  onOpenCombinationsModal,
  onApplyToEnrolled,
  onClearAll,
  onSelectConflict,
}) => {
  const [copied, setCopied] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  const selectedCommissions = useMemo(() => Object.values(selections), [selections]);
  const selectedCount = Object.keys(selections).length;

  const summary = useMemo(() => {
    return calculateScheduleSummary(selectedCommissions);
  }, [selectedCommissions]);

  // Copy plain text summary to clipboard
  const handleCopyText = () => {
    if (selectedCount === 0) return;

    let text = '📅 MI HORARIO DE CURSADA — UTN ISI (Plan 2023)\n';
    text += '═══════════════════════════════════════════════\n\n';

    Object.entries(selections).forEach(([sIdStr, comm]) => {
      const sId = Number(sIdStr);
      const name = subjectNamesMap.get(sId) || `Materia #${sId}`;
      text += `📌 ${name} — Comisión ${comm.code}\n`;
      if (comm.professors.length > 0) {
        text += `   Docentes: ${comm.professors.join(', ')}\n`;
      }
      comm.slots.forEach((s) => {
        text += `   • ${s.day} ${s.start} a ${s.end}${s.room ? ` (Aula: ${s.room})` : ''}${s.mode === 'virtual' ? ' [Virtual]' : ''}\n`;
      });
      text += '\n';
    });

    text += `⏱️ Carga horaria semanal: ${summary.totalHours} hs\n`;
    text += `🌴 Días libres: ${summary.freeDays.map((d) => DAY_LABELS[d]).join(', ') || 'Ninguno'}\n`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Trigger print dialog (users can print or save as PDF directly from the browser)
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="w-full flex flex-col gap-3 sm:gap-4 overflow-y-auto pr-0.5">
      {/* Overview Metrics Card */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 shadow-xl backdrop-blur-md space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Calendar className="w-4 h-4" />
            </span>
            <span className="text-xs font-black uppercase tracking-wider text-white">
              Resumen Semanal
            </span>
          </div>

          <span className="text-xs font-mono font-bold text-indigo-400">
            {selectedCount} materia{selectedCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Big metrics row */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-semibold uppercase">Horas / semana</span>
            <span className="text-xl font-black text-white">{summary.totalHours} hs</span>
          </div>

          <div
            className={`p-3 rounded-xl border ${
              conflicts.length > 0
                ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <span className="text-[10px] block font-semibold uppercase">Choques</span>
            <span className="text-xl font-black">
              {conflicts.length === 0 ? '0' : conflicts.length}
            </span>
          </div>
        </div>

        {/* Active & Free days */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Días con cursada:</span>
            <span className="font-mono font-bold text-white">
              {summary.distinctDays.length > 0 ? summary.distinctDays.join(', ') : 'Ninguno'}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-300">
            <span className="text-slate-400">Días libres:</span>
            <span className="font-mono font-bold text-emerald-400">
              {summary.freeDays.length > 0 ? summary.freeDays.join(', ') : 'Ninguno'}
            </span>
          </div>
        </div>

        {/* Earliest start & latest end per day accordion */}
        {summary.distinctDays.length > 0 && (
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60 space-y-1.5 text-[11px]">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Franja de ingreso y salida
            </span>
            {summary.distinctDays.map((d: DayOfWeek) => (
              <div key={d} className="flex items-center justify-between font-mono text-slate-300">
                <span className="text-indigo-300 font-bold">{DAY_LABELS[d]}:</span>
                <span>
                  {summary.earliestByDay[d]} — {summary.latestByDay[d]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conflicts List Card (if any conflicts exist) */}
      {conflicts.length > 0 && (
        <div className="bg-rose-950/30 rounded-2xl border border-rose-500/40 p-4 shadow-xl backdrop-blur-md space-y-3 animate-pulse">
          <div className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider">
              {conflicts.length} Choque{conflicts.length > 1 ? 's' : ''} Detectado{conflicts.length > 1 ? 's' : ''}
            </span>
          </div>

          <p className="text-[11px] text-rose-200/80 leading-relaxed">
            Hacé click en cualquiera para resaltarlo en la grilla y cambiar de comisión:
          </p>

          <div className="space-y-1.5">
            {conflicts.map((conf, cIdx) => (
              <button
                key={cIdx}
                onClick={() => onSelectConflict(`${conf.commissionId1}-${conf.commissionId2}`)}
                className="w-full p-2 rounded-xl bg-rose-900/40 hover:bg-rose-900/70 border border-rose-500/30 text-left text-xs transition-colors flex items-center justify-between"
              >
                <div className="min-w-0 pr-2">
                  <span className="font-bold text-white block truncate">
                    {conf.subjectName1} × {conf.subjectName2}
                  </span>
                  <span className="text-[10px] font-mono text-rose-300">
                    {conf.day} • {conf.overlapStart} - {conf.overlapEnd}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons Panel */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 shadow-xl backdrop-blur-md space-y-2.5">
        {/* Suggest combinations generator */}
        <button
          onClick={onOpenCombinationsModal}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>Sugerir combinaciones</span>
        </button>

        {/* Mark as enrolled in career button */}
        <button
          onClick={() => setConfirmApplyOpen(true)}
          disabled={selectedCount === 0}
          className="w-full py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 hover:text-white font-bold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <PlayCircle className="w-4 h-4 text-emerald-400" />
          <span>Pasar elegidas a "Cursando"</span>
        </button>

        {/* Copy text summary button */}
        <button
          onClick={handleCopyText}
          disabled={selectedCount === 0}
          className="w-full py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400">¡Copiado al portapapeles!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>Copiar resumen en texto</span>
            </>
          )}
        </button>

        {/* Print / Export PDF button */}
        <button
          onClick={handlePrint}
          disabled={selectedCount === 0}
          className="w-full py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          <span>Descargar / Imprimir horario</span>
        </button>

        {/* Clear all selections */}
        <button
          onClick={() => setConfirmClearOpen(true)}
          disabled={selectedCount === 0}
          className="w-full py-2 rounded-xl bg-transparent hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Limpiar todo</span>
        </button>
      </div>

      {/* Confirmation Modal: Apply to enrolled */}
      {confirmApplyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-emerald-400" />
              <span>¿Pasar a "Cursando"?</span>
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Las {selectedCount} materias seleccionadas pasarán al estado <strong>Cursando</strong> en tu plan de carrera y se actualizarán el mapa, el tablero y las estadísticas.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmApplyOpen(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setConfirmApplyOpen(false);
                  onApplyToEnrolled();
                }}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Clear all */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-400" />
              <span>¿Limpiar toda la selección?</span>
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              Se desmarcarán todas las comisiones elegidas en este borrador.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setConfirmClearOpen(false);
                  onClearAll();
                }}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30"
              >
                Limpiar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
