import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Check, RotateCcw, X } from 'lucide-react';
import { useCareer } from '../../context/CareerContext';

export const SimulationBar: React.FC = () => {
  const {
    isSimulationMode,
    simulationChangedCount,
    applySimulation,
    resetSimulation,
    toggleSimulationMode,
  } = useCareer();

  if (!isSimulationMode) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -50, opacity: 0 }}
        className="w-full bg-gradient-to-r from-amber-600 via-purple-600 to-indigo-600 p-[1px] shadow-lg shadow-indigo-950/40 sticky top-0 z-30"
      >
        <div className="bg-slate-950/95 backdrop-blur-md px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-white">Modo Simulación "¿Y si...?"</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {simulationChangedCount} materias modificadas
              </span>
            </div>
            <span className="hidden md:inline text-xs text-slate-400">
              Probá aprobar o regularizar materias para previsualizar los nuevos desbloqueos en tiempo real sin alterar tus datos guardados.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={resetSimulation}
              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reiniciar cambios</span>
            </button>

            <button
              onClick={applySimulation}
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition-all flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Guardar en mi plan</span>
            </button>

            <button
              onClick={toggleSimulationMode}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1"
              title="Salir de simulación"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
