import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { catalogApi, type Institution } from '../../api/catalog.api';
import { useCareer } from '../../context/CareerContext';
import { isPlanSelected } from '../../utils/planViewSelectors';
import { GraduationCap, Check, Building2, BookOpen, Loader2, X } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';

export const PLAN_SELECTOR_DIALOG_LABEL = 'Catálogo de Carreras y Planes';

export function shouldCloseOnPlanSelectorKeyDown(key: string, canClose: boolean): boolean {
  return canClose && key === 'Escape';
}

export function shouldCloseOnPlanSelectorOverlayClick(
  target: unknown,
  currentTarget: unknown,
  canClose: boolean
): boolean {
  return canClose && target === currentTarget;
}

export async function executePlanSelection(params: {
  planId: string;
  currentPlanId?: string | null;
  updateSelectedPlan: (planId: string) => Promise<{ success: boolean }>;
  reloadServerState: () => Promise<void>;
  onClose: () => void;
}): Promise<'same-plan-closed' | 'switched' | 'failed'> {
  const { planId, currentPlanId, updateSelectedPlan, reloadServerState, onClose } = params;
  if (isPlanSelected(planId, currentPlanId)) {
    onClose();
    return 'same-plan-closed';
  }
  const res = await updateSelectedPlan(planId);
  if (res.success) {
    await reloadServerState();
    onClose();
    return 'switched';
  }
  return 'failed';
}

export interface PlanSelectorModalViewProps {
  isOpen: boolean;
  isMobile: boolean;
  institutions: Institution[];
  loading: boolean;
  switchingId: string | null;
  currentPlanId?: string | null;
  canClose?: boolean;
  subtitle?: string;
  onClose: () => void;
  onSelectPlan: (planId: string) => void;
  dialogRef?: React.RefObject<HTMLDivElement | null>;
}

export const PlanSelectorModalView: React.FC<PlanSelectorModalViewProps> = ({
  isOpen,
  isMobile,
  institutions,
  loading,
  switchingId,
  currentPlanId,
  canClose = true,
  subtitle = 'Seleccioná tu plan de estudios activo',
  onClose,
  onSelectPlan,
  dialogRef,
}) => {
  const handleRequestClose = () => {
    if (canClose) {
      onClose();
    }
  };

  const renderPlansList = (isMobileView: boolean) => {
    if (loading) {
      return (
        <div className="py-12 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="text-xs text-slate-400">Cargando catálogo universitario...</span>
        </div>
      );
    }

    if (institutions.length === 0) {
      return (
        <div className="py-8 text-center text-xs text-slate-400">
          No se encontraron planes disponibles.
        </div>
      );
    }

    return (
      <div className={`space-y-4 ${isMobileView ? 'pb-6' : 'pr-1'}`}>
        {institutions.map((inst) => (
          <div key={inst.id} className="space-y-3">
            {inst.faculties.map((fac) => (
              <div key={fac.id} className="space-y-2.5">
                {fac.careers.map((career) => (
                  <div
                    key={career.id}
                    className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-200">
                          {inst.code} • {fac.code}
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium shrink-0">
                        {career.code}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-white break-words">{career.name}</div>

                    <div className="space-y-2 pt-1">
                      {career.plans.map((p) => {
                        const isCurrent = isPlanSelected(p.id, currentPlanId);
                        return (
                          <div
                            key={p.id}
                            className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                              isCurrent
                                ? 'bg-indigo-600/15 border-indigo-500/40'
                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <BookOpen
                                className={`w-4 h-4 shrink-0 ${
                                  isCurrent ? 'text-indigo-400' : 'text-slate-400'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white flex items-center gap-2 flex-wrap">
                                  <span>{p.name}</span>
                                  {isCurrent && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-bold">
                                      <Check className="w-2.5 h-2.5" /> Activo
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Año de inicio: {p.year} • {p.config.requiredElectiveCredits} cr. electivas
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center">
                              {!isCurrent ? (
                                <button
                                  type="button"
                                  onClick={() => onSelectPlan(p.id)}
                                  disabled={switchingId === p.id}
                                  className={`w-full sm:w-auto ${
                                    isMobileView ? 'min-h-[48px] px-4' : 'px-3 py-1.5'
                                  } text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95`}
                                >
                                  {switchingId === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  <span>Elegir plan</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onSelectPlan(p.id)}
                                  className={`w-full sm:w-auto ${
                                    isMobileView ? 'min-h-[48px] px-4' : 'min-h-[36px] px-3 py-1.5'
                                  } text-xs font-semibold rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 transition-colors flex items-center justify-center cursor-pointer active:scale-95`}
                                >
                                  Seleccionado
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Mobile Render: BottomSheet (portalizado fuera de header)
  if (isMobile) {
    const sheetNode = (
      <BottomSheet
        isOpen={isOpen}
        onClose={handleRequestClose}
        title={PLAN_SELECTOR_DIALOG_LABEL}
        subtitle={subtitle}
        maxHeightDvh={88}
        footer={
          canClose ? (
            <button
              type="button"
              onClick={handleRequestClose}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white transition-colors flex items-center justify-center cursor-pointer active:scale-95"
            >
              Cancelar
            </button>
          ) : undefined
        }
      >
        <div className="pt-2">{renderPlansList(true)}</div>
      </BottomSheet>
    );

    if (typeof document !== 'undefined' && document.body) {
      return createPortal(sheetNode, document.body);
    }
    return sheetNode;
  }

  if (!isOpen) return null;

  // Desktop Render: Centered Modal (portalizado en document.body)
  const modalNode = (
    <div
      data-testid="plan-selector-overlay"
      onClick={(e) => {
        if (shouldCloseOnPlanSelectorOverlayClick(e.target, e.currentTarget, canClose)) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={PLAN_SELECTOR_DIALOG_LABEL}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full max-h-[calc(100dvh-2rem)] flex flex-col text-slate-100 shadow-2xl relative outline-none overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-800/80 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white">{PLAN_SELECTOR_DIALOG_LABEL}</h3>
              <p className="text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>

          {canClose && (
            <button
              type="button"
              onClick={handleRequestClose}
              aria-label="Cerrar selector de carreras y planes"
              className="w-11 h-11 min-w-[44px] min-h-[44px] -mr-1.5 -mt-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto">{renderPlansList(false)}</div>

        {canClose && (
          <div className="px-6 py-3.5 border-t border-slate-800/80 bg-slate-950/50 flex justify-end shrink-0">
            <button
              type="button"
              onClick={handleRequestClose}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
};

interface PlanSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PlanSelectorModal: React.FC<PlanSelectorModalProps> = ({ isOpen, onClose }) => {
  const { activePlan, reloadServerState } = useCareer();
  const isMobile = useIsMobile();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    catalogApi
      .getCareers()
      .then((res) => {
        if (!cancelled && res.success && res.data) {
          setInstitutions(res.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error fetching careers:', err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldCloseOnPlanSelectorKeyDown(e.key, true)) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMobile, onClose]);

  const handleSelectPlan = async (planId: string) => {
    if (isPlanSelected(planId, activePlan?.plan.id)) {
      onClose();
      return;
    }
    setSwitchingId(planId);
    try {
      await executePlanSelection({
        planId,
        currentPlanId: activePlan?.plan.id,
        updateSelectedPlan: catalogApi.updateSelectedPlan,
        reloadServerState: async () => {
          await reloadServerState();
        },
        onClose,
      });
    } catch (e) {
      console.error('Error selecting plan:', e);
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <PlanSelectorModalView
      isOpen={isOpen}
      isMobile={isMobile}
      institutions={institutions}
      loading={loading}
      switchingId={switchingId}
      currentPlanId={activePlan?.plan.id}
      canClose={true}
      onClose={onClose}
      onSelectPlan={handleSelectPlan}
    />
  );
};
