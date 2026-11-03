import React, { useState, useEffect } from 'react';
import { catalogApi, type Institution } from '../../api/catalog.api';
import { useCareer } from '../../context/CareerContext';
import { GraduationCap, Check, Building2, BookOpen, Loader2, X } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';

interface PlanSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PlanSelectorModal: React.FC<PlanSelectorModalProps> = ({ isOpen, onClose }) => {
  const { currentPlanName, reloadServerState } = useCareer();
  const isMobile = useIsMobile();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      catalogApi
        .getCareers()
        .then((res) => {
          if (res.success && res.data) {
            setInstitutions(res.data);
          }
        })
        .catch((err) => console.error('Error fetching careers:', err))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectPlan = async (planId: string) => {
    setSwitchingId(planId);
    try {
      const res = await catalogApi.updateSelectedPlan(planId);
      if (res.success) {
        await reloadServerState();
        onClose();
      }
    } catch (e) {
      console.error('Error selecting plan:', e);
    } finally {
      setSwitchingId(null);
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
      <div className={`space-y-4 ${isMobileView ? 'pb-6' : 'max-h-[60vh] overflow-y-auto pr-1'}`}>
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
                        const isCurrent = p.name === currentPlanName;
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
                                  onClick={() => handleSelectPlan(p.id)}
                                  disabled={switchingId === p.id}
                                  className={`w-full sm:w-auto ${
                                    isMobileView ? 'min-h-[48px] px-4' : 'px-3 py-1.5'
                                  } text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95`}
                                >
                                  {switchingId === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  <span>Elegir plan</span>
                                </button>
                              ) : (
                                <span className="text-xs font-semibold text-indigo-400 px-2 py-1">
                                  Seleccionado
                                </span>
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

  // Mobile Render: BottomSheet
  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title="Catálogo de Carreras y Planes"
        subtitle="Seleccioná tu plan de estudios activo"
        maxHeightDvh={90}
      >
        <div className="pt-2">{renderPlansList(true)}</div>
      </BottomSheet>
    );
  }

  // Desktop Render: Centered Modal
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-6 text-slate-100 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Catálogo de Carreras y Planes</h3>
            <p className="text-xs text-slate-400">Seleccioná tu plan de estudios activo</p>
          </div>
        </div>

        {renderPlansList(false)}
      </div>
    </div>
  );
};
