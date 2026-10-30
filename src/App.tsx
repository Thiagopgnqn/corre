import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CareerProvider, useCareer } from './context/CareerContext';
import { Navbar, type AppView } from './components/common/Navbar';
import { SimulationBar } from './components/graph/SimulationBar';
import { CorrelativeGraph } from './components/graph/CorrelativeGraph';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { SemesterPlanner } from './components/planner/SemesterPlanner';
import { ScheduleBuilder } from './components/schedule/ScheduleBuilder';
import { ElectivesPicker } from './components/electives/ElectivesPicker';
import { StatsDashboard } from './components/stats/StatsDashboard';
import { QuickStatusModal } from './components/common/QuickStatusModal';
import { SearchModal } from './components/common/SearchModal';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { TutorialSpotlight } from './components/tutorial/TutorialSpotlight';
import { AuthScreen } from './components/auth/AuthScreen';
import { LocalStorageMigrationModal } from './components/migration/LocalStorageMigrationModal';
import { Loader2 } from 'lucide-react';

const VALID_VIEWS: AppView[] = ['graph', 'kanban', 'planner', 'schedule', 'electives', 'stats'];

const getInitialView = (): AppView => {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash.replace('#', '') as AppView;
    if (VALID_VIEWS.includes(hash)) return hash;
  }
  return 'graph';
};

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { showMigrationModal, setShowMigrationModal, reloadServerState } = useCareer();
  const [currentView, setCurrentView] = useState<AppView>(getInitialView);

  const handleSetView = (view: AppView) => {
    setCurrentView(view);
    if (typeof window !== 'undefined') {
      window.location.hash = view;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center text-slate-100">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mb-4 text-indigo-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
        <p className="text-sm font-medium text-slate-300">Cargando Mi Carrera Cloud...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Simulation banner if active */}
      <SimulationBar />

      {/* Main navigation header */}
      <Navbar currentView={currentView} setCurrentView={handleSetView} />

      {/* Main content body with smooth transitions */}
      <main className="flex-1 flex flex-col overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex-1 flex flex-col"
          >
            {currentView === 'graph' && <CorrelativeGraph />}
            {currentView === 'kanban' && <KanbanBoard />}
            {currentView === 'planner' && (
              <SemesterPlanner onNavigateToSchedule={() => handleSetView('schedule')} />
            )}
            {currentView === 'schedule' && <ScheduleBuilder />}
            {currentView === 'electives' && <ElectivesPicker />}
            {currentView === 'stats' && <StatsDashboard />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Post-login migration modal if user has local data */}
      {showMigrationModal && (
        <LocalStorageMigrationModal
          onSuccess={() => {
            setShowMigrationModal(false);
            reloadServerState();
          }}
          onDismiss={() => setShowMigrationModal(false)}
        />
      )}

      {/* Global Modals & Interactive Tour */}
      <QuickStatusModal />
      <SearchModal />
      <OnboardingModal />
      <TutorialSpotlight currentView={currentView} onNavigateView={setCurrentView} />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <CareerProvider>
        <AppContent />
      </CareerProvider>
    </AuthProvider>
  );
}
