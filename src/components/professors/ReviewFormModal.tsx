import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Eye,
  HeartHandshake,
  Loader2,
  Lock,
  MessageSquarePlus,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { professorsApi } from '../../api/professors.api';
import type {
  OwnReviewItem,
  ReviewableData,
  ReviewablePair,
} from '../../types/professor';
import { StarRating } from './StarRating';

interface ReviewFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProfessorId?: string | null;
  editingReview?: OwnReviewItem | null;
  onSaved: () => void;
}

const OVERALL_LABELS: Record<number, string> = {
  1: '1 · Muy floja experiencia',
  2: '2 · Regular / a mejorar',
  3: '3 · Aceptable / cumple',
  4: '4 · Muy buen docente',
  5: '5 · Excelente docente',
};

let guidelinesAcceptedInMemory = false;

export const ReviewFormModal: React.FC<ReviewFormModalProps> = ({
  isOpen,
  onClose,
  initialProfessorId,
  editingReview,
  onSaved,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [reviewable, setReviewable] = useState<ReviewableData | null>(null);
  const [isLoadingReviewable, setIsLoadingReviewable] = useState(false);
  const [showGuidelinesStep, setShowGuidelinesStep] = useState(false);

  // Selección de (profesor, materia) al crear
  const [pairSearch, setPairSearch] = useState('');
  const [selectedPairKey, setSelectedPairKey] = useState<string>('');
  const [showBlockedList, setShowBlockedList] = useState(false);

  // Campos del formulario
  const [overall, setOverall] = useState<number>(0);
  const [clarity, setClarity] = useState<number>(0);
  const [treatment, setTreatment] = useState<number>(0);
  const [availability, setAvailability] = useState<number>(0);
  const [difficulty, setDifficulty] = useState<number>(0);
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [academicYear, setAcademicYear] = useState<string>('');
  const [term, setTerm] = useState<'' | '1C' | '2C' | 'A'>('');
  const [comment, setComment] = useState<string>('');
  const [showPreview, setShowPreview] = useState<boolean>(false);

  // Estado de envío
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(
    () => Array.from({ length: 12 }, (_, idx) => currentYear - idx),
    [currentYear]
  );

  // Inicializar valores cuando se abre el modal
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setSavedSuccess(false);
    setShowPreview(false);
    setPairSearch('');

    if (editingReview) {
      setShowGuidelinesStep(false);
      setOverall(editingReview.overall);
      setClarity(editingReview.clarity ?? 0);
      setTreatment(editingReview.treatment ?? 0);
      setAvailability(editingReview.availability ?? 0);
      setDifficulty(editingReview.difficulty ?? 0);
      setWouldRecommend(editingReview.wouldRecommend);
      setAcademicYear(editingReview.academicYear ? String(editingReview.academicYear) : '');
      setTerm(editingReview.term ?? '');
      setComment(editingReview.comment ?? '');
      return;
    }

    // Modo nueva reseña: resetear campos y consultar elegibilidad en vivo
    setOverall(0);
    setClarity(0);
    setTreatment(0);
    setAvailability(0);
    setDifficulty(0);
    setWouldRecommend(null);
    setAcademicYear('');
    setTerm('');
    setComment('');
    setSelectedPairKey('');

    let active = true;
    setIsLoadingReviewable(true);
    professorsApi
      .getReviewable()
      .then((res) => {
        if (!active || !res.success) return;
        const d = res.data;
        setReviewable(d);

        // Mostrar guía rápida de convivencia antes de publicar la primera reseña
        if (d.myReviews.length === 0 && !guidelinesAcceptedInMemory) {
          setShowGuidelinesStep(true);
        } else {
          setShowGuidelinesStep(false);
        }

        // Si viene preseleccionado un profesor, elegir su primer par disponible no reseñado
        const availableEligible = d.eligible.filter((p) => !p.alreadyReviewed);
        if (initialProfessorId) {
          const match = availableEligible.find((p) => p.professorId === initialProfessorId);
          if (match) {
            setSelectedPairKey(`${match.professorId}::${match.subjectId}`);
            setShowBlockedList(false);
          } else {
            const hasBlocked = d.blocked.some((b) => b.professorId === initialProfessorId);
            if (hasBlocked) setShowBlockedList(true);
          }
        } else if (availableEligible.length === 1) {
          const only = availableEligible[0];
          setSelectedPairKey(`${only.professorId}::${only.subjectId}`);
        }
      })
      .catch((err: any) => {
        if (active) setErrorMsg(err?.message || 'Error al verificar materias habilitadas.');
      })
      .finally(() => {
        if (active) setIsLoadingReviewable(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, editingReview, initialProfessorId]);

  const unreviewedEligible = useMemo(() => {
    if (!reviewable) return [];
    const base = reviewable.eligible.filter((p) => !p.alreadyReviewed);
    if (!pairSearch.trim()) return base;
    const q = pairSearch.toLowerCase().trim();
    return base.filter(
      (p) =>
        p.professorName.toLowerCase().includes(q) ||
        p.subjectName.toLowerCase().includes(q)
    );
  }, [reviewable, pairSearch]);

  const selectedPair: ReviewablePair | null = useMemo(() => {
    if (!reviewable || !selectedPairKey) return null;
    return (
      reviewable.eligible.find(
        (p) => `${p.professorId}::${p.subjectId}` === selectedPairKey
      ) || null
    );
  }, [reviewable, selectedPairKey]);

  const relevantBlocked = useMemo(() => {
    if (!reviewable) return [];
    if (initialProfessorId) {
      const forInitial = reviewable.blocked.filter((b) => b.professorId === initialProfessorId);
      if (forInitial.length > 0) return forInitial;
    }
    if (pairSearch.trim()) {
      const q = pairSearch.toLowerCase().trim();
      return reviewable.blocked
        .filter(
          (b) =>
            b.professorName.toLowerCase().includes(q) ||
            b.subjectName.toLowerCase().includes(q)
        )
        .slice(0, 25);
    }
    return reviewable.blocked.slice(0, 20);
  }, [reviewable, initialProfessorId, pairSearch]);

  if (!isOpen) return null;

  const targetProfessorName = editingReview
    ? editingReview.professorName
    : selectedPair?.professorName || 'Seleccioná un docente';
  const targetSubjectName = editingReview
    ? editingReview.subjectName
    : selectedPair?.subjectName || 'Materia';

  const nowMonthLabel = new Intl.DateTimeFormat('es-AR', {
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!editingReview && !selectedPair) {
      setErrorMsg('Seleccioná un docente y materia habilitados para reseñar.');
      return;
    }
    if (overall < 1 || overall > 5) {
      setErrorMsg('Elegí una calificación general de 1 a 5 estrellas.');
      return;
    }

    setIsSubmitting(true);
    try {
      const commonPayload = {
        overall,
        clarity: clarity > 0 ? clarity : null,
        treatment: treatment > 0 ? treatment : null,
        availability: availability > 0 ? availability : null,
        difficulty: difficulty > 0 ? difficulty : null,
        wouldRecommend,
        academicYear: academicYear ? Number(academicYear) : null,
        term: term ? term : null,
        comment: comment.trim() ? comment.trim() : null,
      };

      if (editingReview) {
        await professorsApi.updateReview(editingReview.id, commonPayload);
      } else if (selectedPair) {
        await professorsApi.createReview({
          professorId: selectedPair.professorId,
          subjectId: selectedPair.subjectId,
          ...commonPayload,
        });
      }

      setSavedSuccess(true);
      onSaved();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo guardar la reseña.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[65] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-form-modal-title"
      >
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-2xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                <MessageSquarePlus className="w-4 h-4" />
              </span>
              <div>
                <h2 id="review-form-modal-title" className="text-sm sm:text-base font-black text-white">
                  {editingReview ? 'Editar mi reseña' : 'Dejar una reseña anónima'}
                </h2>
                <p className="text-[11px] text-slate-400">
                  Tu correo e identidad nunca se muestran públicamente.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar formulario de reseña"
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Pantalla 1: Confirmación animada al publicar */}
          {savedSuccess ? (
            <div className="p-8 text-center space-y-4">
              <motion.div
                initial={shouldReduceMotion ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="w-8 h-8" />
              </motion.div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-white">
                  {editingReview ? '¡Reseña actualizada!' : '¡Gracias por aportar a la comunidad!'}
                </h3>
                <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                  Tu calificación anónima para <strong>{targetProfessorName}</strong> en{' '}
                  <strong>{targetSubjectName}</strong> ya fue registrada y las estadísticas del
                  armador de horarios se actualizaron.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          ) : showGuidelinesStep ? (
            /* Pantalla 2: Guía breve de convivencia antes de la primera reseña */
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="flex items-center gap-2.5 text-indigo-300">
                <HeartHandshake className="w-5 h-5 text-indigo-400 shrink-0" />
                <h3 className="text-sm sm:text-base font-extrabold text-white">
                  Guía rápida de convivencia y privacidad
                </h3>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Antes de publicar tu primera reseña, tené en cuenta estas pautas pensadas para que
                la sección sea útil, justa y segura para estudiantes y docentes:
              </p>

              <ul className="space-y-2.5 text-xs text-slate-300 bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Enfocate en lo académico:</strong> comentá sobre la claridad al
                    explicar, modalidad de evaluación, trato en clase y exigencia.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Sin agresiones ni datos privados:</strong> el filtro rechaza
                    automáticamente insultos, ataques personales, teléfonos, correos y enlaces.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>100% anónima:</strong> solo se muestra{' '}
                    <em>&ldquo;Estudiante de [Materia]&rdquo;</em> con mes y año, y el período de
                    cursada se oculta si el docente tiene menos de 5 reseñas.
                  </span>
                </li>
              </ul>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    guidelinesAcceptedInMemory = true;
                    setShowGuidelinesStep(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  Acepto las pautas, continuar
                </button>
              </div>
            </div>
          ) : (
            /* Pantalla 3: Formulario completo */
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {isLoadingReviewable && !editingReview ? (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Verificando tus materias regularizadas y aprobadas...</span>
                </div>
              ) : (
                <>
                  {/* Selector de Profesor + Materia (solo en creación) */}
                  {editingReview ? (
                    <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-indigo-400 block">
                          Docente y materia
                        </span>
                        <span className="font-extrabold text-white">
                          {editingReview.professorName}
                        </span>
                        <span className="text-slate-400"> · {editingReview.subjectName}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="review-pair-select"
                          className="text-xs font-bold text-slate-200"
                        >
                          1. Docente y materia que cursaste *
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowGuidelinesStep(true)}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                        >
                          Ver normas de convivencia
                        </button>
                      </div>

                      {/* Buscador rápido de pares */}
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={pairSearch}
                          onChange={(e) => setPairSearch(e.target.value)}
                          placeholder="Filtrar docente o materia habilitada..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      {unreviewedEligible.length > 0 ? (
                        <select
                          id="review-pair-select"
                          value={selectedPairKey}
                          onChange={(e) => setSelectedPairKey(e.target.value)}
                          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">Seleccioná docente y materia...</option>
                          {unreviewedEligible.map((p) => {
                            const key = `${p.professorId}::${p.subjectId}`;
                            return (
                              <option key={key} value={key}>
                                {p.professorName} — {p.subjectName} ({p.userSubjectStatus})
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                          No tenés pares (docente, materia) pendientes de reseñar con ese filtro.
                          Recordá que solo podés reseñar docentes de materias que tengas en estado{' '}
                          <strong>regularizada, aprobada o promocionada</strong>.
                        </div>
                      )}

                      {/* Explicación de profesores/materias bloqueados */}
                      {reviewable && reviewable.blocked.length > 0 && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setShowBlockedList(!showBlockedList)}
                            className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5">
                              <Lock className="w-3 h-3 text-amber-400" />
                              <span>
                                ¿Por qué algunos docentes aparecen bloqueados? (
                                {relevantBlocked.length})
                              </span>
                            </span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${
                                showBlockedList ? 'rotate-180' : ''
                              }`}
                            />
                          </button>

                          {showBlockedList && (
                            <div className="px-3 pb-2.5 pt-1 border-t border-slate-800/80 max-h-36 overflow-y-auto space-y-1.5">
                              {relevantBlocked.map((b) => (
                                <div
                                  key={`${b.professorId}-${b.subjectId}`}
                                  className="text-[11px] p-2 rounded-lg bg-slate-900/80 border border-slate-800/70"
                                >
                                  <div className="font-bold text-slate-300">
                                    {b.professorName} ·{' '}
                                    <span className="text-slate-400">{b.subjectName}</span>
                                  </div>
                                  <div className="text-[10px] text-amber-300/90 mt-0.5">
                                    {b.blockedReason}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Calificación general obligatoria */}
                  <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white">
                        2. Calificación general *
                      </span>
                      {overall > 0 && (
                        <span className="text-xs font-bold text-amber-300">
                          {OVERALL_LABELS[overall]}
                        </span>
                      )}
                    </div>
                    <StarRating
                      value={overall}
                      onChange={setOverall}
                      size="lg"
                      label="Calificación general del profesor"
                    />
                  </div>

                  {/* Métricas opcionales y ¿Lo recomendarías? */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-1">
                      <span className="text-[11px] font-semibold text-slate-300 block">
                        Claridad al explicar (opcional)
                      </span>
                      <StarRating
                        value={clarity}
                        onChange={setClarity}
                        allowClear
                        onClear={() => setClarity(0)}
                        size="md"
                        label="Claridad al explicar"
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-1">
                      <span className="text-[11px] font-semibold text-slate-300 block">
                        Trato estudiantil (opcional)
                      </span>
                      <StarRating
                        value={treatment}
                        onChange={setTreatment}
                        allowClear
                        onClear={() => setTreatment(0)}
                        size="md"
                        label="Trato estudiantil"
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-1">
                      <span className="text-[11px] font-semibold text-slate-300 block">
                        Disponibilidad / consultas (opcional)
                      </span>
                      <StarRating
                        value={availability}
                        onChange={setAvailability}
                        allowClear
                        onClear={() => setAvailability(0)}
                        size="md"
                        label="Disponibilidad y consultas"
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-1">
                      <span className="text-[11px] font-semibold text-slate-300 block">
                        Nivel de exigencia (1 baja · 5 alta)
                      </span>
                      <StarRating
                        value={difficulty}
                        onChange={setDifficulty}
                        allowClear
                        onClear={() => setDifficulty(0)}
                        size="md"
                        label="Nivel de exigencia"
                      />
                    </div>
                  </div>

                  {/* ¿Lo recomendarías? + Período de cursada opcional */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-2">
                      <span className="text-[11px] font-semibold text-slate-300 block">
                        ¿Volverías a cursar con este docente?
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setWouldRecommend(wouldRecommend === true ? null : true)
                          }
                          className={`flex-1 py-1.5 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                            wouldRecommend === true
                              ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Sí</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setWouldRecommend(wouldRecommend === false ? null : false)
                          }
                          className={`flex-1 py-1.5 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                            wouldRecommend === false
                              ? 'bg-rose-600/25 border-rose-500/50 text-rose-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>No</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-300 block">
                        Período de cursada (opcional)
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label="Año de cursada"
                          value={academicYear}
                          onChange={(e) => setAcademicYear(e.target.value)}
                          className="flex-1 rounded-xl bg-slate-900 border border-slate-800 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                        >
                          <option value="">Año...</option>
                          {availableYears.map((yr) => (
                            <option key={yr} value={yr}>
                              {yr}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Modalidad o cuatrimestre de cursada"
                          value={term}
                          onChange={(e) => setTerm(e.target.value as '' | '1C' | '2C' | 'A')}
                          className="flex-1 rounded-xl bg-slate-900 border border-slate-800 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                        >
                          <option value="">Período...</option>
                          <option value="1C">1° Cuatr.</option>
                          <option value="2C">2° Cuatr.</option>
                          <option value="A">Anual</option>
                        </select>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Por anonimato solo se exhibe cuando el docente tiene 5 o más reseñas.
                      </p>
                    </div>
                  </div>

                  {/* Comentario breve con contador /600 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor="review-comment" className="font-bold text-slate-200">
                        3. Comentario sobre la cursada (opcional)
                      </label>
                      <span
                        className={`font-mono text-[11px] ${
                          comment.length >= 560 ? 'text-amber-400 font-bold' : 'text-slate-400'
                        }`}
                      >
                        {comment.length} / 600
                      </span>
                    </div>
                    <textarea
                      id="review-comment"
                      rows={3}
                      maxLength={600}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="¿Cómo son sus clases, parciales, trabajos prácticos o consultas?"
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Vista previa anónima */}
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{showPreview ? 'Ocultar vista previa' : 'Ver vista previa pública'}</span>
                    </button>

                    {showPreview && (
                      <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-indigo-500/30 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="text-xs font-bold text-white block">
                              Estudiante de {targetSubjectName}
                            </span>
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Calendar className="w-2.5 h-2.5" />
                              <span>Publicado en {nowMonthLabel}</span>
                            </span>
                          </div>
                          <StarRating value={overall} readOnly size="sm" />
                        </div>
                        <p className="text-xs text-slate-300 whitespace-pre-line">
                          {comment.trim() || 'Calificación con estrellas sin comentario escrito.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {/* Footer botones */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                    <span className="text-[11px] text-slate-500">
                      {reviewable && !editingReview
                        ? `Cupo diario disponible: ${reviewable.dailyLimit.remainingToday}/${reviewable.dailyLimit.maxPerDay}`
                        : 'Podés editar o borrar tu reseña cuando quieras'}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting || (!editingReview && !selectedPair) || overall < 1}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{editingReview ? 'Guardar cambios' : 'Publicar reseña'}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

