import React, { useState, useRef, useEffect } from 'react';
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
  Clock,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCareer } from '../../context/CareerContext';
import { SyncStatusBadge } from './SyncStatusBadge';
import { UserMenu } from './UserMenu';
import { PlanSelectorModal } from './PlanSelectorModal';

export type AppView = 'graph' | 'kanban' | 'planner' | 'schedule' | 'electives' | 'stats';

interface NavbarProps {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, setCurrentView }) => {
  const { user, logout } = useAuth();
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
    syncStatus,
    currentPlanName,
  } = useCareer();

  const [menuOpen, setMenuOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [isPlanSelectorOpen, setIsPlanSelectorOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  const handleExport = () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mi-carrera-${currentPlanName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
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

  const navItems: Array<{
    id: AppView;
    label: string;
    fullLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'graph', label: 'Mapa', fullLabel: 'Mapa de Correlativas', icon: Compass },
    { id: 'kanban', label: 'Niveles', fullLabel: 'Niveles & Tablero', icon: Kanban },
    { id: 'planner', label: 'Cuatrimestre', fullLabel: 'Armá tu Cuatrimestre', icon: CalendarDays },
    { id: 'schedule', label: 'Horarios', fullLabel: 'Armador de Horarios', icon: Clock },
    { id: 'electives', label: 'Electivas', fullLabel: 'Catálogo de Electivas', icon: Sparkles },
    { id: 'stats', label: 'Estadísticas', fullLabel: 'Estadísticas & Camino Crítico', icon: BarChart3 },
  ];

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40 w-full">
        <div className="w-full max-w-[1920px] mx-auto px-2.5 sm:px-6 flex items-center justify-between h-14 sm:h-16 gap-1.5 sm:gap-4 min-w-0">
          {/* Logo & Plan */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center shrink-0">
              <div className="w-full h-full bg-slate-950 rounded-[9px] sm:rounded-[10px] flex items-center justify-center text-cyan-400">
                <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-sm sm:text-base md:text-lg font-black tracking-tight text-white m-0 p-0 leading-none whitespace-nowrap">
                  Mi Carrera
                </h1>
                <button
                  type="button"
                  onClick={() => setIsPlanSelectorOpen(true)}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 hover:border-indigo-400 transition-all cursor-pointer whitespace-nowrap max-w-[95px] sm:max-w-none truncate"
                  title="Cambiar carrera o plan de estudios"
                >
                  {currentPlanName}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 font-medium whitespace-nowrap hidden lg:block">
                UTN • Ing. en Sistemas de Información
              </p>
            </div>
          </div>

          {/* Desktop Nav Tabs: icon + label at >= 1440px, icon-only below 1440px */}
          <nav
            data-tour="nav-tabs"
            className="hidden md:flex items-center gap-0.5 lg:gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800 shrink-0"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id)}
                  title={item.fullLabel}
                  className={`flex items-center gap-1.5 px-2 lg:px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden min-[1440px]:inline whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Actions & Utilities */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Secondary Actions (Visible only on ultra-wide screens >= 1850px, otherwise in More Menu) */}
            <div className="hidden min-[1850px]:flex items-center gap-2 shrink-0">
              {/* Analista / Seminario Toggle Button */}
              <button
                data-tour="analista-button"
                onClick={() => updateSettings({ includeAnalistaTrack: !settings.includeAnalistaTrack })}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 border shrink-0 ${
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
                <span>Analista (99)</span>
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
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border shrink-0 ${
                  isSimulationMode
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/30 animate-pulse'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700/80 hover:border-amber-500/50'
                }`}
                title="Modo simulación hipotética"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>¿Y si...?</span>
              </button>

              {/* Sound toggle */}
              <button
                onClick={toggleSound}
                className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 transition-colors shrink-0"
                title={soundEnabled ? 'Sonido activado (click para silenciar)' : 'Sonido silenciado'}
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                )}
              </button>
            </div>

            {/* Quick Search */}
            <button
              data-tour="search-button"
              onClick={() => setIsSearchOpen(true)}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-medium bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-all flex items-center gap-1.5 shrink-0"
              title="Buscar materias (Ctrl+K)"
            >
              <Search className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="hidden 2xl:inline whitespace-nowrap">Buscar</span>
              <kbd className="hidden 2xl:inline px-1.5 py-0.2 text-[10px] bg-slate-800 rounded border border-slate-700 text-slate-400">
                Ctrl K
              </kbd>
            </button>

            {/* Cloud Sync Status */}
            <SyncStatusBadge status={syncStatus} />

            {/* User Profile & Account Menu */}
            <UserMenu currentPlanName={currentPlanName} onOpenPlanSelector={() => setIsPlanSelectorOpen(true)} />

            {/* Tutorial Launcher Button: Visible on xl+ (also in More menu on all screens) */}
            <button
              onClick={() => startTutorial(0)}
              className="hidden xl:flex p-2 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all items-center gap-1.5 shrink-0 shadow-sm"
              title="Ver tutorial guiado interactivo"
            >
              <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="whitespace-nowrap">Tutorial</span>
            </button>

            {/* More Menu Dropdown ("El desplegable") */}
            <div className="relative shrink-0" ref={menuRef}>
              <button
                data-tour="more-menu-btn"
                onClick={() => setMenuOpen(!menuOpen)}
                className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border transition-all shrink-0 cursor-pointer shadow-sm flex items-center justify-center ${
                  menuOpen
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                    : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-300 hover:text-white'
                }`}
                title="Más opciones y menú"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 sm:w-72 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl py-1.5 z-50 text-xs divide-y divide-slate-800/80 backdrop-blur-xl animate-fade-in">
                  {user && (
                    <div className="px-3.5 py-2.5 bg-slate-950/40">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold uppercase text-[11px] shrink-0">
                          {user.email.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate">{user.email}</p>
                          <p className="text-[10px] text-indigo-400">{currentPlanName}</p>
                        </div>
                        {user.role === 'admin' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold shrink-0">
                            Admin
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="px-3.5 py-2 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Progreso de carrera:</span>
                    <span className="font-bold text-white">{computedProgress.careerPercentageBySubjects}%</span>
                  </div>

                  <div className="py-1">
                    {/* Analista toggle in dropdown */}
                    <button
                      onClick={() => {
                        updateSettings({ includeAnalistaTrack: !settings.includeAnalistaTrack });
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Título Analista (99)</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        settings.includeAnalistaTrack ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {settings.includeAnalistaTrack ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {/* Simulation toggle in dropdown */}
                    <button
                      onClick={() => {
                        toggleSimulationMode();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Modo ¿Y si...? (Simulación)</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        isSimulationMode ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {isSimulationMode ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {/* Sound toggle in dropdown */}
                    <button
                      onClick={toggleSound}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        {soundEnabled ? (
                          <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <VolumeX className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                        <span>Efectos de sonido</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        soundEnabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {soundEnabled ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>

                  <div className="py-1">
                    {/* Carga rápida por nivel */}
                    <button
                      onClick={() => {
                        setIsOnboardingOpen(true);
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                    >
                      <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span>Carga rápida por nivel</span>
                    </button>

                    {/* Cargar muestra */}
                    <button
                      onClick={() => {
                        loadSample();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Cargar demo (3er año)</span>
                    </button>

                    {/* Tutorial */}
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        startTutorial(0);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                    >
                      <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Ver tutorial interactivo</span>
                    </button>
                  </div>

                  <div className="py-1">
                    {/* Export */}
                    <button
                      onClick={handleExport}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                    >
                      <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Exportar carrera (JSON)</span>
                    </button>

                    {/* Import */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Importar carrera (JSON)</span>
                    </button>
                  </div>

                  <div className="py-1">
                    {/* Reset */}
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setResetConfirmOpen(true);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-rose-950/40 text-rose-400 flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4 shrink-0" />
                      <span>Reiniciar carrera...</span>
                    </button>
                  </div>

                  {user && (
                    <div className="py-1">
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          logout();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <LogOut className="w-4 h-4 text-slate-400" />
                        <span>Cerrar Sesión</span>
                      </button>
                    </div>
                  )}
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
        <PlanSelectorModal isOpen={isPlanSelectorOpen} onClose={() => setIsPlanSelectorOpen(false)} />
      </header>

      {/* Mobile Bottom Navigation Bar (Fixed at bottom on screens < md) */}
      <nav
        data-tour="nav-tabs-mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/90 px-1 py-1.5 flex items-center justify-around shadow-2xl safe-area-pb"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-1 rounded-xl text-[10px] font-semibold transition-all ${
                isActive
                  ? 'text-indigo-400 font-bold bg-indigo-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
              <span className="leading-tight text-[9px] truncate max-w-full text-center">{item.label}</span>
            </button>
          );
        })}
      </nav>

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
