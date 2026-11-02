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
import { ProfessorsDirectory } from './components/professors/ProfessorsDirectory';
import { ElectivesPicker } from './components/electives/ElectivesPicker';
import { StatsDashboard } from './components/stats/StatsDashboard';
import { QuickStatusModal } from './components/common/QuickStatusModal';
import { SearchModal } from './components/common/SearchModal';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { TutorialSpotlight } from './components/tutorial/TutorialSpotlight';
import { AuthScreen } from './components/auth/AuthScreen';
import { VerifyEmailScreen } from './components/auth/VerifyEmailScreen';
import { LocalStorageMigrationModal } from './components/migration/LocalStorageMigrationModal';
import { EnrollmentModal } from './components/enrollments/EnrollmentModal';
import { ReviewRecommendationToast } from './components/enrollments/ReviewRecommendationToast';
import { ReviewFormModal } from './components/professors/ReviewFormModal';
import { Loader2 } from 'lucide-react';
import { APP_NAME } from './config/brand';

const AdminDashboard = React.lazy(() => import('./components/admin/AdminDashboard'));

const VALID_VIEWS: AppView[] = [
  'graph',
  'kanban',
  'planner',
  'schedule',
  'professors',
  'electives',
  'stats',
  'admin',
];

const getInitialView = (): AppView => {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash.replace('#', '') as AppView;
    if (VALID_VIEWS.includes(hash)) return hash;
  }
  return 'graph';
};

const AppContent: React.FC = () => {
  const { isAuthenticated, isEmailVerified, isLoading, user } = useAuth();
  const {
    showMigrationModal,
    setShowMigrationModal,
    reloadServerState,
    globalReviewModalTarget,
    closeGlobalReviewModal,
    refreshReviewableSummary,
    startTutorial,
  } = useCareer();
  const [currentView, setCurrentView] = useState<AppView>(getInitialView);
  const headerAreaRef = React.useRef<HTMLDivElement>(null);
  const isScheduleView = currentView === 'schedule';

  React.useEffect(() => {
    (window as unknown as { __startTutorial?: (step?: number) => void }).__startTutorial = startTutorial;
    return () => {
      delete (window as unknown as { __startTutorial?: (step?: number) => void }).__startTutorial;
    };
  }, [startTutorial]);

  // Route guard: el panel de administración es exclusivo para usuarios con rol admin
  React.useEffect(() => {
    if (!isLoading && currentView === 'admin' && user?.role !== 'admin') {
      setCurrentView('graph');
      if (typeof window !== 'undefined') {
        window.location.hash = 'graph';
      }
    }
  }, [currentView, user, isLoading]);

  // Medir dinámicamente la altura del área de encabezado (Navbar + SimulationBar + Banners)
  React.useEffect(() => {
    const el = headerAreaRef.current;
    if (!el) return;

    const updateHeaderHeight = () => {
      const h = el.offsetHeight;
      if (h > 0) {
        document.documentElement.style.setProperty('--app-header-height', `${h}px`);
      }
    };

    updateHeaderHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        updateHeaderHeight();
      });
      ro.observe(el);
      return () => ro.disconnect();
    } else {
      window.addEventListener('resize', updateHeaderHeight);
      return () => window.removeEventListener('resize', updateHeaderHeight);
    }
  }, []);

  const handleSetView = (view: AppView) => {
    setCurrentView(view);
    if (typeof window !== 'undefined') {
      window.location.hash = view;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center text-slate-100">
        <div className="w-12 h-12 rounded-2xl bg-[#171A52]/60 border border-indigo-500/30 flex items-center justify-center mb-4 text-[#FFB938] shadow-lg shadow-[#171A52]/50">
          <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
        </div>
        <p className="text-sm font-medium text-slate-300">Cargando {APP_NAME}...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  if (!isEmailVerified) {
    return <VerifyEmailScreen />;
  }

  return (
    <div
      className={`bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200 ${
        isScheduleView ? 'h-[100dvh] max-h-[100dvh] overflow-hidden' : 'min-h-screen'
      }`}
    >
      {/* Top Header Area monitored by ResizeObserver (oculto en panel de administración) */}
      {currentView !== 'admin' && (
        <div ref={headerAreaRef} className="sticky top-0 z-40 w-full shrink-0">
          {/* Simulation banner if active */}
          <SimulationBar />

          {/* Main navigation header */}
          <Navbar currentView={currentView} setCurrentView={handleSetView} />
        </div>
      )}

      {/* Main content body with smooth transitions */}
      <main
        className={`flex-1 flex flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-0 ${
          isScheduleView ? 'min-h-0 overflow-hidden' : 'overflow-x-hidden'
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`flex-1 flex flex-col ${isScheduleView ? 'min-h-0 h-full overflow-hidden' : ''}`}
          >
            {currentView === 'graph' && <CorrelativeGraph />}
            {currentView === 'kanban' && <KanbanBoard />}
            {currentView === 'planner' && (
              <SemesterPlanner onNavigateToSchedule={() => handleSetView('schedule')} />
            )}
            {currentView === 'schedule' && <ScheduleBuilder />}
            {currentView === 'professors' && <ProfessorsDirectory />}
            {currentView === 'electives' && <ElectivesPicker />}
            {currentView === 'stats' && <StatsDashboard />}
            {currentView === 'admin' && (
              <React.Suspense
                fallback={
                  <div className="flex-1 flex items-center justify-center p-12 text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  </div>
                }
              >
                <AdminDashboard onNavigateHome={() => handleSetView('graph')} />
              </React.Suspense>
            )}
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
      <EnrollmentModal />
      <ReviewRecommendationToast />
      {globalReviewModalTarget && (
        <ReviewFormModal
          isOpen={true}
          onClose={closeGlobalReviewModal}
          initialProfessorId={globalReviewModalTarget.professorId}
          initialSubjectId={globalReviewModalTarget.subjectId}
          initialAcademicYear={globalReviewModalTarget.academicYear}
          initialTerm={globalReviewModalTarget.term}
          onSaved={refreshReviewableSummary}
        />
      )}
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
