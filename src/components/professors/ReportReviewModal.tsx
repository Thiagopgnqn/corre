import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Flag, Loader2, X } from 'lucide-react';
import { professorsApi } from '../../api/professors.api';
import type { ReportReason } from '../../types/professor';

interface ReportReviewModalProps {
  reviewId: string | null;
  professorName?: string;
  onClose: () => void;
  onReported: (result: { autoHidden: boolean; reviewId: string }) => void;
}

const REPORT_REASONS: Array<{
  value: ReportReason;
  title: string;
  description: string;
}> = [
  {
    value: 'ofensiva',
    title: 'Lenguaje ofensivo o agresión personal',
    description: 'Contiene insultos, descalificaciones personales o acoso.',
  },
  {
    value: 'datos personales',
    title: 'Expone datos personales',
    description: 'Incluye teléfonos, correos, direcciones o enlaces privados.',
  },
  {
    value: 'falsa o spam',
    title: 'Reseña falsa o spam',
    description: 'Contenido repetitivo, promocional o ajeno a la cursada.',
  },
  {
    value: 'otra',
    title: 'Otro motivo',
    description: 'Incumple las normas de convivencia por otra razón.',
  },
];

export const ReportReviewModal: React.FC<ReportReviewModalProps> = ({
  reviewId,
  professorName,
  onClose,
  onReported,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [reason, setReason] = useState<ReportReason>('ofensiva');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!reviewId) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const res = await professorsApi.reportReview(reviewId, {
        reason,
        note: note.trim() ? note.trim() : undefined,
      });
      setSuccessMsg(res.data.message);
      onReported({ autoHidden: res.data.autoHidden, reviewId });
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo enviar el reporte.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-review-title"
      >
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.16 }}
          className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden"
        >
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
                <Flag className="w-4 h-4" />
              </span>
              <div>
                <h3 id="report-review-title" className="text-sm font-black text-white">
                  Reportar reseña
                </h3>
                {professorName && (
                  <p className="text-[11px] text-slate-400 truncate max-w-[260px]">
                    Docente: {professorName}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar ventana de reporte"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {successMsg ? (
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">{successMsg}</p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
              >
                Entendido
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-300 block">
                  Seleccioná el motivo del reporte:
                </span>
                {REPORT_REASONS.map((opt) => {
                  const selected = reason === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="report-reason"
                        value={opt.value}
                        checked={selected}
                        onChange={() => setReason(opt.value)}
                        className="mt-0.5 accent-indigo-500"
                      />
                      <div className="text-xs">
                        <span className="font-bold block">{opt.title}</span>
                        <span className="text-[11px] text-slate-400">{opt.description}</span>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <label htmlFor="report-note" className="font-semibold text-slate-300">
                    Detalle adicional (opcional)
                  </label>
                  <span className="font-mono text-slate-500">{note.length}/300</span>
                </div>
                <textarea
                  id="report-note"
                  rows={2}
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Aclaración breve para moderación..."
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {errorMsg && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-rose-600/25 transition-all"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Enviar reporte</span>
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

