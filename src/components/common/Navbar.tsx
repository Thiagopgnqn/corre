import React, { useState, useRef } from 'react';
import {
  Compass,
  Kanban,
  CalendarDays,
  Sparkles,
  BarChart3,
  Search,
  Volume2,
  VolumeX,
  FlaskConical,
  Download,
  Upload,
  RotateCcw,
  MoreVertical,
  GraduationCap,
  Layers,
  Award,
  HelpCircle,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';

export type AppView = 'graph' | 'kanban' | 'planner' | 'electives' | 'stats';

interface NavbarProps {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, setCurrentView }) => {
  const {
    isSimulationMode,
    toggleSimulationMode,
    soundEnabled,
    toggleSound,
    setIsSearchOpen,
    setIsOnboardingOpen,
    exportData,
    importData,
    resetAll,
    loadSample,
    computedProgress,
    settings,
    updateSettings,
    startTutorial,
  } = useCareer();

  const [menuOpen, setMenuOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mi-carrera-plan2023-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      const res = importData(content);
      if (!res.success) {
        alert(res.error || 'Error al importar datos');
      }
    };
    reader.readAsText(file);
    setMenuOpen(false);
  };

  const navItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'graph', label: 'Mapa de Correlativas', icon: Compass },
    { id: 'kanban', label: 'Niveles & Tablero', icon: Kanban },
    { id: 'planner', label: 'Armá tu Cuatrimestre', icon: CalendarDays },
    { id: 'electives', label: 'Electivas', icon: Sparkles },
    { id: 'stats', label: 'Estadísticas & Camino Crítico', icon: BarChart3 },
  ];

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16 gap-4">
          {/* Logo & Plan */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center text-cyan-400">
                <GraduationCap className="w-5 h-5" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-white m-0 p-0 leading-none whitespace-nowrap">
                  Mi Carrera
                </h1>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 whitespace-nowrap">
                  Plan 2023
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium whitespace-nowrap hidden sm:block">
                UTN • Ing. en Sistemas de Información
              </p>
              <p className="text-[10px] text-slate-400 font-medium whitespace-nowrap sm:hidden">
                UTN ISI
              </p>
            </div>
          </div>

          {/* Desktop Nav Tabs */}
          <nav
            data-tour="nav-tabs"
            className="hidden lg:flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Actions & Utilities */}
          <div className="flex items-center gap-2">
            {/* Analista / Seminario Toggle Button */}
            <button
              data-tour="analista-button"
              onClick={() => updateSettings({ includeAnalistaTrack: !settings.includeAnalistaTrack })}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 border ${
                settings.includeAnalistaTrack
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                  : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border-slate-700/80 hover:border-slate-600'
              }`}
              title={
                settings.includeAnalistaTrack
                  ? 'Seminario Integrador y Título Analista: ACTIVADO (Click para desactivar)'
                  : 'Seminario Integrador y Título Analista: DESACTIVADO (Click para activar)'
              }
            >
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden xl:inline">Analista (99)</span>
              <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${
                settings.includeAnalistaTrack ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-400'
              }`}>
                {settings.includeAnalistaTrack ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* Simulation Mode Toggle Button */}
            <button
              data-tour="simulation-button"
              onClick={toggleSimulationMode}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                isSimulationMode
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/30 animate-pulse'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700/80 hover:border-amber-500/50'
              }`}
              title="Modo simulación hipotética"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">¿Y si...?</span>
            </button>

            {/* Quick Search Ctrl+K */}
            <button
              data-tour="search-button"
              onClick={() => setIsSearchOpen(true)}
              className="p-2 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-medium bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-all flex items-center gap-1.5"
              title="Buscar materias (Ctrl+K)"
            >
              <Search className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Buscar</span>
              <kbd className="hidden md:inline px-1.5 py-0.2 text-[10px] bg-slate-800 rounded border border-slate-700 text-slate-400">
                Ctrl K
              </kbd>
            </button>

            {/* Tutorial Launcher Button */}
            <button
              onClick={() => startTutorial(0)}
              className="p-2 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5 shadow-sm"
              title="Ver tutorial guiado interactivo"
            >
              <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Tutorial</span>
            </button>

            {/* Sound toggle */}
            <button
              onClick={toggleSound}
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 transition-colors"
              title={soundEnabled ? 'Sonido activado (click para silenciar)' : 'Sonido silenciado'}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {/* Carga Rápida Button */}
            <button
              onClick={() => setIsOnboardingOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-all"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Carga rápida</span>
            </button>

            {/* More Menu Dropdown */}
            <div className="relative">
              <button
                data-tour="more-menu-btn"
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl py-1 z-50 text-xs">
                  <div className="px-3 py-2 border-b border-slate-800 text-[11px] text-slate-400">
                    Progreso: <span className="font-bold text-white">{computedProgress.careerPercentageBySubjects}%</span> de materias
                  </div>

                  <button
                    onClick={() => {
                      updateSettings({ includeAnalistaTrack: !settings.includeAnalistaTrack });
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <Award className="w-4 h-4 text-amber-400" />
                      <span>Seminario / Título Analista</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      settings.includeAnalistaTrack ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {settings.includeAnalistaTrack ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      startTutorial(0);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                  >
                    <HelpCircle className="w-4 h-4 text-amber-400" />
                    <span>Ver tutorial interactivo</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsOnboardingOpen(true);
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                  >
                    <Layers className="w-4 h-4 text-indigo-400" />
                    <span>Carga rápida por nivel</span>
                  </button>

                  <button
                    onClick={() => {
                      loadSample();
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Cargar demo (3er año)</span>
                  </button>

                  <button
                    onClick={handleExport}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4 text-emerald-400" />
                    <span>Exportar carrera (JSON)</span>
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>Importar carrera (JSON)</span>
                  </button>

                  <div className="border-t border-slate-800 my-1" />

                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setResetConfirmOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-rose-950/40 text-rose-400 flex items-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Reiniciar carrera...</span>
                  </button>
                </div>
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportFile}
              accept=".json"
              className="hidden"
            />
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="lg:hidden border-t border-slate-800/80 bg-slate-950/90 overflow-x-auto px-2 py-1.5 flex items-center gap-1 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Mobile Tutorial Button */}
          <button
            onClick={() => startTutorial(0)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 bg-amber-500/10 text-amber-300 border border-amber-500/20"
            title="Ver tutorial interactivo"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Tutorial</span>
          </button>
        </div>
      </header>

      {/* Reset Confirmation Dialog */}
      {resetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">¿Reiniciar todos los datos?</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Esta acción borrará todas las materias marcadas, notas y selecciones guardadas en este navegador. Se recomienda exportar un respaldo JSON antes de continuar.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setResetConfirmOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  resetAll();
                  setResetConfirmOpen(false);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl shadow-lg shadow-rose-600/30 transition-all"
              >
                Confirmar reinicio
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
