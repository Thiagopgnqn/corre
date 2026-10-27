import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CareerProvider } from './context/CareerContext';
import { Navbar, type AppView } from './components/common/Navbar';
import { SimulationBar } from './components/graph/SimulationBar';
import { CorrelativeGraph } from './components/graph/CorrelativeGraph';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { SemesterPlanner } from './components/planner/SemesterPlanner';
import { ElectivesPicker } from './components/electives/ElectivesPicker';
import { StatsDashboard } from './components/stats/StatsDashboard';
import { QuickStatusModal } from './components/common/QuickStatusModal';
import { SearchModal } from './components/common/SearchModal';
import { OnboardingModal } from './components/onboarding/OnboardingModal';

const AppContent: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>('graph');

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Simulation banner if active */}
      <SimulationBar />

      {/* Main navigation header */}
      <Navbar currentView={currentView} setCurrentView={setCurrentView} />

      {/* Main content body with smooth transitions */}
      <main className="flex-1 flex flex-col overflow-x-hidden">
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
            {currentView === 'planner' && <SemesterPlanner />}
            {currentView === 'electives' && <ElectivesPicker />}
            {currentView === 'stats' && <StatsDashboard />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Global Modals */}
      <QuickStatusModal />
      <SearchModal />
      <OnboardingModal />
    </div>
  );
};

export default function App() {
  return (
    <CareerProvider>
      <AppContent />
    </CareerProvider>
  );
}
