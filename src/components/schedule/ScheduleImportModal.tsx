import React, { useState } from 'react';
import {
  Upload,
  X,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { SubjectSchedule, ScheduleValidationResult } from '../../types/schedule';
import { validateScheduleData } from '../../utils/scheduleLogic';

interface ScheduleImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportValidSchedules: (schedules: SubjectSchedule[]) => void;
  onResetDefault: () => void;
  hasCustomSchedules: boolean;
  knownSubjectIds: Set<number | string>;
}

export const ScheduleImportModal: React.FC<ScheduleImportModalProps> = ({
  isOpen,
  onClose,
  onImportValidSchedules,
  onResetDefault,
  hasCustomSchedules,
  knownSubjectIds,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [validationResult, setValidationResult] = useState<ScheduleValidationResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  if (!isOpen) return null;

  const handleValidateString = (text: string) => {
    setJsonText(text);
    if (!text.trim()) {
      setValidationResult(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      const res = validateScheduleData(parsed, knownSubjectIds);
      setValidationResult(res);
    } catch {
      setValidationResult({
        valid: false,
        errors: ['El texto ingresado no es un JSON válido o tiene errores de sintaxis.'],
        warnings: [],
        schedulesCount: 0,
        commissionsCount: 0,
      });
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      handleValidateString(text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleApply = () => {
    if (validationResult?.valid && validationResult.validSchedules) {
      onImportValidSchedules(validationResult.validSchedules);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Upload className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white">
                Importar Oferta de Horarios
              </h3>
              <p className="text-xs text-slate-400">
                Subí tu archivo JSON con comisiones y horarios reales del cuatrimestre.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Drag & Drop Box */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`p-6 border-2 border-dashed rounded-2xl text-center transition-all ${
              dragActive
                ? 'border-indigo-400 bg-indigo-500/10'
                : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
            }`}
          >
            <FileCode className="w-8 h-8 mx-auto text-indigo-400 mb-2" />
            <p className="text-xs font-bold text-white mb-1">
              Arrastrá y soltá acá tu archivo .json de horarios
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              O seleccioná el archivo desde tu dispositivo
            </p>

            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white cursor-pointer border border-slate-700 transition-all">
              <span>Examinar archivo</span>
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                }}
              />
            </label>
          </div>

          {/* Paste JSON Text Area */}
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              O pegar contenido JSON directamente:
            </label>
            <textarea
              rows={4}
              value={jsonText}
              onChange={(e) => handleValidateString(e.target.value)}
              placeholder='[ { "subjectId": 1, "term": "1C", "commissions": [ ... ] } ]'
              className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Validation Result Box */}
          {validationResult && (
            <div
              className={`p-3.5 rounded-2xl border text-xs leading-relaxed space-y-1.5 ${
                validationResult.valid
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {validationResult.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>¡Archivo válido! Listo para importar</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>Se detectaron errores en el archivo JSON</span>
                  </>
                )}
              </div>

              {validationResult.valid && (
                <p className="text-[11px] text-emerald-300">
                  Se encontraron <strong>{validationResult.schedulesCount}</strong> materias con un total de{' '}
                  <strong>{validationResult.commissionsCount}</strong> comisiones válidas.
                </p>
              )}

              {/* Error messages list */}
              {validationResult.errors.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-rose-300">
                  {validationResult.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {validationResult.errors.length > 5 && (
                    <li>...y {validationResult.errors.length - 5} errores más.</li>
                  )}
                </ul>
              )}

              {/* Warning messages list */}
              {validationResult.warnings.length > 0 && (
                <div className="pt-1 text-[11px] text-amber-300 space-y-0.5">
                  <span className="font-semibold block">Avisos informativos:</span>
                  <ul className="list-disc pl-4">
                    {validationResult.warnings.slice(0, 3).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2">
          {hasCustomSchedules ? (
            <button
              onClick={() => {
                onResetDefault();
                onClose();
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar horarios de ejemplo</span>
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
            >
              Cancelar
            </button>

            <button
              onClick={handleApply}
              disabled={!validationResult?.valid}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Importar horarios</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
