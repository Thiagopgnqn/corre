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
  Layers,
  Award,
  HelpCircle,
  Clock,
  LogOut,
  Star,
  BookOpen,
  Menu,
  Shield,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCareer } from '../../context/CareerContext';
import { libraryApi } from '../../api/library.api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SyncStatusBadge } from './SyncStatusBadge';
import { UserMenu } from './UserMenu';
import { PlanSelectorModal } from './PlanSelectorModal';
import { BrandLogo } from './BrandLogo';
import { BottomSheet } from './BottomSheet';

export type AppView =
  | 'graph'
  | 'kanban'
  | 'planner'
  | 'schedule'
  | 'professors'
  | 'library'
  | 'electives'
  | 'stats'
  | 'admin';

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
    unseenRecommendationsCount,
    isMoreMenuOpen,
    setIsMoreMenuOpen,
    isTutorialOpen,
  } = useCareer();

  const isMobile = useIsMobile();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [isPlanSelectorOpen, setIsPlanSelectorOpen] = useState(false);
  const [hasLibraryNovelty, setHasLibraryNovelty] = useState(false);
  const [isMobileMoreSheetOpen, setIsMobileMoreSheetOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Consulta novedades de Biblioteca para el usuario autenticado
  useEffect(() => {
    if (user) {
      libraryApi
        .peekMyUploads()
        .then((res) => {
          if (res.success && res.data?.hasStatusUpdates) {
            setHasLibraryNovelty(true);
          } else {
            setHasLibraryNovelty(false);
          }
        })
        .catch(() => {});
    }
  }, [user, currentView]);

  // Cerrar menú desktop al hacer click afuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (isTutorialOpen) return;
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    }
    if (isMoreMenuOpen && !isMobile) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen, isTutorialOpen, setIsMoreMenuOpen, isMobile]);

  const handleExport = () => {
    const json = exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mi-carrera-${currentPlanName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIsMoreMenuOpen(false);
    setIsMobileMoreSheetOpen(false);
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
    setIsMoreMenuOpen(false);
    setIsMobileMoreSheetOpen(false);
  };

  // Lista completa de navegación de escritorio (8 destinos)
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
    { id: 'professors', label: 'Profesores', fullLabel: 'Reseñas de Profesores', icon: Star },
    { id: 'library', label: 'Biblioteca', fullLabel: 'Biblioteca de Material de Estudio', icon: BookOpen },
    { id: 'electives', label: 'Electivas', fullLabel: 'Catálogo de Electivas', icon: Sparkles },
    { id: 'stats', label: 'Estadísticas', fullLabel: 'Estadísticas & Camino Crítico', icon: BarChart3 },
  ];

  // Destinos primarios de la barra inferior móvil (4 destinos principales + "Más")
  const mobilePrimaryNav: Array<{
    id: AppView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'graph', label: 'Mapa', icon: Compass },
    { id: 'schedule', label: 'Horarios', icon: Clock },
    { id: 'library', label: 'Biblioteca', icon: BookOpen },
    { id: 'professors', label: 'Profesores', icon: Star },
  ];

  // Destinos secundarios alojados dentro de la hoja "Más" en mobile
  const mobileSecondaryViews: Array<{
    id: AppView;
    label: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'kanban', label: 'Niveles & Tablero', desc: 'Vista Kanban por nivel o estado de materias', icon: Kanban },
    { id: 'planner', label: 'Armá tu Cuatrimestre', desc: 'Simulá horas semanales y elegí qué cursar', icon: CalendarDays },
    { id: 'electives', label: 'Catálogo de Electivas', desc: 'Créditos electivos libres por nivel', icon: Sparkles },
    { id: 'stats', label: 'Estadísticas & Camino Crítico', desc: 'Promedios, porcentaje de carrera y avance', icon: BarChart3 },
  ];

  const handleMobileNavigate = (view: AppView) => {
    setCurrentView(view);
    setIsMobileMoreSheetOpen(false);
  };

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40 w-full">
        <div className="w-full max-w-[1920px] mx-auto px-2.5 sm:px-6 flex items-center justify-between h-14 sm:h-16 gap-1.5 sm:gap-4 min-w-0">
          {/* Logo & Plan */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 min-w-0">
            <BrandLogo variant="full" size="md" responsiveText />
            <button
              type="button"
              onClick={() => setIsPlanSelectorOpen(true)}
              className="text-[10px] font-bold px-2 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 hover:border-indigo-400 transition-all cursor-pointer whitespace-nowrap max-w-[95px] sm:max-w-none truncate min-h-[36px] flex items-center active:scale-95"
              title="Cambiar carrera o plan de estudios"
            >
              {currentPlanName}
            </button>
          </div>

          {/* Desktop Nav Tabs (Hidden on mobile < md) */}
          <nav
            data-tour="nav-tabs"
            className="hidden md:flex items-center gap-0.5 bg-slate-900/60 p-1 rounded-xl border border-slate-800 shrink-0"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id)}
                  title={item.fullLabel}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer relative ${
                    isActive
                      ? 'bg-gradient-to-r from-[#2A2E8A] to-[#171A52] text-white shadow-md shadow-[#171A52]/40 border border-indigo-400/25'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.id === 'professors' && unseenRecommendationsCount > 0 && (
                      <span
                        aria-label="Recomendaciones de reseñas pendientes"
                        className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-slate-950 animate-pulse"
                      />
                    )}
                    {item.id === 'library' && hasLibraryNovelty && (
                      <span
                        aria-label="Novedades en tus aportes de biblioteca"
                        className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-slate-950 animate-pulse"
                      />
                    )}
                  </div>
                  <span className="hidden min-[1500px]:inline whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Actions & Utilities */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Secondary Actions (Desktop >= 1900px) */}
            <div className="hidden min-[1900px]:flex items-center gap-2 shrink-0">
              <button
                data-tour="analista-button"
                onClick={() => updateSettings({ includeAnalistaTrack: !settings.includeAnalistaTrack })}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 border shrink-0 cursor-pointer ${
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
                <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="whitespace-nowrap">Analista (99)</span>
                <span className={`text-[10px] px-1 py-0.2 rounded font-bold ${
                  settings.includeAnalistaTrack ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-400'
                }`}>
                  {settings.includeAnalistaTrack ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>

            {/* Simulation Mode Toggle Button ("¿Y si...?") */}
            <button
              data-tour="simulation-button"
              onClick={toggleSimulationMode}
              className={`p-2 sm:px-2.5 sm:py-1.5 min-h-[44px] min-w-[44px] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border shrink-0 cursor-pointer active:scale-95 ${
                isSimulationMode
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/30 animate-pulse'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700/80 hover:border-amber-500/50'
              }`}
              title="Modo simulación hipotética"
              aria-label="Alternar modo simulación"
            >
              <FlaskConical className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden sm:inline whitespace-nowrap">¿Y si...?</span>
            </button>

            {/* Quick Search Button (Target táctil garantizado >= 44x44px en mobile) */}
            <button
              data-tour="search-button"
              onClick={() => setIsSearchOpen(true)}
              className="p-2 sm:px-2.5 sm:py-1.5 min-h-[44px] min-w-[44px] rounded-xl text-xs font-medium bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer active:scale-95"
              title="Buscar materias (Ctrl+K)"
              aria-label="Buscar materias en el plan de estudios"
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
            <UserMenu
              currentPlanName={currentPlanName}
              onOpenPlanSelector={() => setIsPlanSelectorOpen(true)}
              onNavigateAdmin={() => setCurrentView('admin')}
            />

            {/* Tutorial Launcher (Desktop >= 1650px) */}
            <button
              onClick={() => startTutorial(0)}
              className="hidden min-[1650px]:flex p-2 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all items-center gap-1.5 shrink-0 shadow-sm cursor-pointer"
              title="Ver tutorial guiado interactivo"
            >
              <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="whitespace-nowrap">Tutorial</span>
            </button>

            {/* More Menu Dropdown Desktop (hidden en mobile) */}
            <div className="relative shrink-0 hidden md:block" ref={menuRef}>
              <button
                data-tour="more-menu-btn"
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border transition-all shrink-0 cursor-pointer shadow-sm flex items-center justify-center ${
                  isMoreMenuOpen
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                    : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-300 hover:text-white'
                }`}
                title="Más opciones y menú"
                aria-label="Más opciones de carrera"
                aria-expanded={isMoreMenuOpen}
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {isMoreMenuOpen && (
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
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2 cursor-pointer"
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
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2 cursor-pointer"
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
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center justify-between gap-2 cursor-pointer"
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
                      data-tour="onboarding-menu-item"
                      onClick={() => {
                        setIsOnboardingOpen(true);
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
                    >
                      <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span>Carga rápida por nivel</span>
                    </button>

                    {/* Cargar muestra */}
                    <button
                      onClick={() => {
                        loadSample();
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Cargar demo (3er año)</span>
                    </button>

                    {/* Tutorial */}
                    <button
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        startTutorial(0);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
                    >
                      <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Ver tutorial interactivo</span>
                    </button>
                  </div>

                  <div className="py-1">
                    {/* Export */}
                    <button
                      onClick={handleExport}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Exportar carrera (JSON)</span>
                    </button>

                    {/* Import */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-300 flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Importar carrera (JSON)</span>
                    </button>
                  </div>

                  <div className="py-1">
                    {/* Reset */}
                    <button
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setResetConfirmOpen(true);
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-rose-950/40 text-rose-400 flex items-center gap-2 cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4 shrink-0" />
                      <span>Reiniciar carrera...</span>
                    </button>
                  </div>

                  {user && (
                    <div className="py-1">
                      <button
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          logout();
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center gap-2 cursor-pointer transition-colors"
                      >
                        <LogOut className="w-4 h-4 text-slate-400" />
                        <span>Cerrar Sesión</span>
                      </button>
                    </div>
                  )}

                  <div className="mt-1 pt-2 pb-1 border-t border-slate-800/80 px-3 text-center">
                    <span className="text-[10.5px] text-slate-400 font-medium">
                      Hecho por estudiantes de la UTN
                    </span>
                  </div>
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

      {/* MOBILE BOTTOM NAVIGATION BAR (Fixed at bottom on < md, exactly 5 thumb-friendly items) */}
      <nav
        data-tour="nav-tabs-mobile"
        aria-label="Navegación principal móvil"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/90 flex items-stretch justify-around shadow-2xl safe-area-pb"
      >
        {mobilePrimaryNav.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentView(item.id)}
              className={`flex-1 min-w-0 min-h-[52px] py-1.5 flex flex-col items-center justify-center gap-1 transition-all relative cursor-pointer active:scale-95 ${
                isActive
                  ? 'text-indigo-400 font-bold bg-indigo-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-6 h-6 shrink-0 transition-transform ${isActive ? 'scale-110 text-indigo-400' : 'text-slate-400'}`} />
                {item.id === 'professors' && unseenRecommendationsCount > 0 && (
                  <span
                    aria-label="Recomendaciones de reseñas pendientes"
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-950 animate-pulse"
                  />
                )}
                {item.id === 'library' && hasLibraryNovelty && (
                  <span
                    aria-label="Novedades en tus aportes de biblioteca"
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-950 animate-pulse"
                  />
                )}
              </div>
              <span className="leading-tight text-[11px] font-semibold truncate max-w-full text-center">
                {item.label}
              </span>
            </button>
          );
        })}

        {/* 5th Tab: "Más" Button */}
        <button
          type="button"
          data-tour="more-menu-btn"
          onClick={() => setIsMobileMoreSheetOpen(true)}
          className={`flex-1 min-w-0 min-h-[52px] py-1.5 flex flex-col items-center justify-center gap-1 transition-all relative cursor-pointer active:scale-95 ${
            isMobileMoreSheetOpen
              ? 'text-indigo-400 font-bold bg-indigo-500/15'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-label="Más secciones y herramientas"
          aria-haspopup="dialog"
          aria-expanded={isMobileMoreSheetOpen}
        >
          <Menu className={`w-6 h-6 shrink-0 ${isMobileMoreSheetOpen ? 'text-indigo-400' : 'text-slate-400'}`} />
          <span className="leading-tight text-[11px] font-semibold truncate max-w-full text-center">
            Más
          </span>
        </button>
      </nav>

      {/* MOBILE: BottomSheet "Más" (Acceso a las vistas y utilidades secundarias) */}
      <BottomSheet
        isOpen={isMobileMoreSheetOpen}
        onClose={() => setIsMobileMoreSheetOpen(false)}
        title="Más Secciones & Herramientas"
        subtitle={`Progreso de carrera: ${computedProgress.careerPercentageBySubjects}% de materias`}
      >
        <div className="space-y-4 py-2">
          {/* 1. Vistas Secundarias */}
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Vistas de Carrera
            </h3>
            <div className="space-y-1.5">
              {mobileSecondaryViews.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleMobileNavigate(item.id)}
                    className={`w-full min-h-[48px] px-4 py-3 rounded-2xl flex items-center justify-between text-left transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                        : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{item.label}</div>
                        <div className="text-[11px] text-slate-400 truncate">{item.desc}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 ml-2" />
                  </button>
                );
              })}

              {/* Acceso exclusivo a Admin para administradores */}
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => handleMobileNavigate('admin')}
                  className={`w-full min-h-[48px] px-4 py-3 rounded-2xl flex items-center justify-between text-left transition-colors cursor-pointer ${
                    currentView === 'admin'
                      ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200'
                      : 'bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/30 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <Shield className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">Panel de Administración</div>
                      <div className="text-[11px] text-amber-400/80 truncate">Gestión de usuarios, biblioteca y reportes</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-amber-400/60 shrink-0 ml-2" />
                </button>
              )}
            </div>
          </div>

          {/* 2. Preferencias e Interruptores */}
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Preferencias
            </h3>
            <div className="space-y-1.5">
              {/* Analista switch */}
              <div className="min-h-[48px] px-4 py-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Award className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white">Título Analista (99)</div>
                    <div className="text-[11px] text-slate-400">Seminario Integrador y 4 cr. electivas</div>
                  </div>
                </div>
                <button
                  type="button"
                  data-tour="analista-button"
                  role="switch"
                  aria-checked={settings.includeAnalistaTrack}
                  onClick={() => updateSettings({ includeAnalistaTrack: !settings.includeAnalistaTrack })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.includeAnalistaTrack ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.includeAnalistaTrack ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Simulation switch */}
              <div className="min-h-[48px] px-4 py-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FlaskConical className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white">Modo ¿Y si...? (Simulación)</div>
                    <div className="text-[11px] text-slate-400">Proyectá escenarios sin alterar tu historia</div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isSimulationMode}
                  onClick={toggleSimulationMode}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isSimulationMode ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isSimulationMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Sound switch */}
              <div className="min-h-[48px] px-4 py-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {soundEnabled ? (
                    <Volume2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <VolumeX className="w-5 h-5 text-slate-500 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white">Efectos de Sonido</div>
                    <div className="text-[11px] text-slate-400">Sonidos de desbloqueo y festejos</div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundEnabled}
                  onClick={toggleSound}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    soundEnabled ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      soundEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* 3. Utilidades y Carga Rápida */}
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
              Herramientas
            </h3>
            <div className="space-y-1.5">
              <button
                type="button"
                data-tour="onboarding-menu-item"
                onClick={() => {
                  setIsMobileMoreSheetOpen(false);
                  setIsOnboardingOpen(true);
                }}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <Layers className="w-5 h-5 text-indigo-400 shrink-0" />
                <span>Carga rápida por nivel</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMobileMoreSheetOpen(false);
                  loadSample();
                }}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
                <span>Cargar demo (3er año)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMobileMoreSheetOpen(false);
                  startTutorial(0);
                }}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <HelpCircle className="w-5 h-5 text-amber-400 shrink-0" />
                <span>Ver tutorial interactivo</span>
              </button>

              <button
                type="button"
                onClick={handleExport}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <Download className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Exportar carrera (JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-200 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <Upload className="w-5 h-5 text-cyan-400 shrink-0" />
                <span>Importar carrera (JSON)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMobileMoreSheetOpen(false);
                  setResetConfirmOpen(true);
                }}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <RotateCcw className="w-5 h-5 text-rose-400 shrink-0" />
                <span>Reiniciar carrera...</span>
              </button>
            </div>
          </div>

          {/* 4. Sesión */}
          {user && (
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsMobileMoreSheetOpen(false);
                  logout();
                }}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer"
              >
                <LogOut className="w-5 h-5 text-slate-400 shrink-0" />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          )}
        </div>
      </BottomSheet>

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
                className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  resetAll();
                  setResetConfirmOpen(false);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
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
