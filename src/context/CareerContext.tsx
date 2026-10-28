import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type {
  SubjectStatus,
  UserCareerState,
  CareerProgress,
  CriticalPathResult,
  Subject,
  AssignedElectivesByYear,
} from '../types/career';
import { CORE_SUBJECTS } from '../data/plan2023';
import {
  ELECTIVES,
  REQUIRED_ELECTIVE_CREDITS_TOTAL,
  ELECTIVE_SLOTS_EQUIVALENT,
} from '../data/electives';
import { TUTORIAL_STEPS } from '../data/tutorialSteps';
import {
  getSubjectStatus,
  isApprovedOrHigher,
  checkAnalistaTitle,
  isPPSEligible,
  getNewlyUnlockedOnStateChange,
  calculateProgressBreakdown,
} from '../utils/correlativas';
import { calculateCriticalPath } from '../utils/criticalPath';
import { soundManager } from '../utils/audio';
import { fireConfetti } from '../utils/confetti';
import {
  loadUserState,
  saveUserState,
  loadBasket,
  saveBasket,
  loadSettings,
  saveSettings,
  type AppSettings,
  loadAssignedElectives,
  saveAssignedElectives,
  INITIAL_ASSIGNED_ELECTIVES,
  clearCareerData,
  exportCareerToJson,
  importCareerFromJson,
  getSample3rdYearStudent,
  shouldAutoStartTutorial,
  markTutorialCompleted,
} from '../utils/storage';

interface CareerContextType {
  userState: UserCareerState;
  activeState: UserCareerState;
  isSimulationMode: boolean;
  simulationChangedCount: number;
  toggleSimulationMode: () => void;
  applySimulation: () => void;
  resetSimulation: () => void;

  updateSubjectStatus: (id: number, status: SubjectStatus, grade?: number) => void;
  batchUpdateStatus: (updates: Array<{ id: number; status: SubjectStatus; grade?: number }>) => void;

  assignedElectives: AssignedElectivesByYear;
  addElectiveToYear: (electiveId: number, targetYear: number) => void;
  removeElectiveFromYear: (electiveId: number, year: number) => void;
  moveElectiveYear: (electiveId: number, fromYear: number, toYear: number) => void;

  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;

  soundEnabled: boolean;
  toggleSound: () => void;

  selectedSubjectId: number | null;
  setSelectedSubjectId: (id: number | null) => void;
  selectedSubject: Subject | null;

  statusModalSubjectId: number | null;
  setStatusModalSubjectId: (id: number | null) => void;

  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;

  isOnboardingOpen: boolean;
  setIsOnboardingOpen: (open: boolean) => void;

  semesterBasket: number[];
  toggleBasketSubject: (id: number) => void;
  clearBasket: () => void;

  showElectivesInGraph: boolean;
  setShowElectivesInGraph: (show: boolean) => void;

  computedProgress: CareerProgress;
  criticalPath: CriticalPathResult;

  isTutorialOpen: boolean;
  currentTutorialStep: number;
  startTutorial: (fromStep?: number) => void;
  closeTutorial: (options?: { openOnboarding?: boolean }) => void;
  nextTutorialStep: () => void;
  prevTutorialStep: () => void;
  goToTutorialStep: (step: number) => void;

  exportData: () => string;
  importData: (json: string) => { success: boolean; error?: string };
  resetAll: () => void;
  loadSample: () => void;
}

const CareerContext = createContext<CareerContextType | undefined>(undefined);

export const CareerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userState, setUserState] = useState<UserCareerState>(() => loadUserState());
  const [simulationState, setSimulationState] = useState<UserCareerState | null>(null);
  const [assignedElectives, setAssignedElectives] = useState<AssignedElectivesByYear>(() => loadAssignedElectives());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => soundManager.getSoundEnabled());
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [statusModalSubjectId, setStatusModalSubjectId] = useState<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [semesterBasket, setSemesterBasket] = useState<number[]>(() => loadBasket());
  const [showElectivesInGraph, setShowElectivesInGraph] = useState<boolean>(false);

  // Tutorial state & sandbox snapshot
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(() => shouldAutoStartTutorial());
  const [currentTutorialStep, setCurrentTutorialStep] = useState<number>(0);
  const realUserStateBackupRef = useRef<UserCareerState | null>(null);

  useEffect(() => {
    if (isTutorialOpen && realUserStateBackupRef.current === null) {
      realUserStateBackupRef.current = { ...userState };
    }
  }, [isTutorialOpen, userState]);

  // Sync state to local storage when real state changes
  useEffect(() => {
    saveUserState(userState);
  }, [userState]);

  useEffect(() => {
    saveAssignedElectives(assignedElectives);
  }, [assignedElectives]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveBasket(semesterBasket);
  }, [semesterBasket]);

  const isSimulationMode = simulationState !== null;
  const activeState = simulationState ?? userState;

  const simulationChangedCount = useMemo(() => {
    if (!simulationState) return 0;
    let count = 0;
    const allKeys = new Set([...Object.keys(userState), ...Object.keys(simulationState)]);
    allKeys.forEach((key) => {
      const u = userState[key];
      const s = simulationState[key];
      if (u?.status !== s?.status || u?.grade !== s?.grade) {
        count++;
      }
    });
    return count;
  }, [userState, simulationState]);

  const toggleSimulationMode = useCallback(() => {
    if (isSimulationMode) {
      setSimulationState(null);
    } else {
      setSimulationState({ ...userState });
    }
    soundManager.playClick();
  }, [isSimulationMode, userState]);

  const applySimulation = useCallback(() => {
    if (simulationState) {
      setUserState(simulationState);
      setSimulationState(null);
      soundManager.playMilestone();
      fireConfetti();
    }
  }, [simulationState]);

  const resetSimulation = useCallback(() => {
    setSimulationState({ ...userState });
    soundManager.playClick();
  }, [userState]);

  const updateSubjectStatus = useCallback(
    (id: number, status: SubjectStatus, grade?: number) => {
      const targetState = isSimulationMode ? simulationState! : userState;
      const prevSubState = targetState[id];

      // Check if newly unlocked subjects appear
      const newlyUnlocked = getNewlyUnlockedOnStateChange(id, status, targetState);

      const nextSubjectState = {
        ...prevSubState,
        status,
        grade: (status === 'aprobada' || status === 'promocionada') && grade !== undefined ? grade : prevSubState?.grade,
        updatedAt: new Date().toISOString(),
      };

      if (status === 'bloqueada' || status === 'disponible') {
        // If resetting back to pending, clear grade
        delete nextSubjectState.grade;
      }

      const nextTargetState = {
        ...targetState,
        [id]: nextSubjectState,
      };

      if (isSimulationMode) {
        setSimulationState(nextTargetState);
      } else {
        setUserState(nextTargetState);
      }

      // Audio and celebratory effects
      if (status === 'aprobada' || status === 'promocionada') {
        fireConfetti();
        soundManager.playApproval();
      } else if (newlyUnlocked.length > 0) {
        soundManager.playUnlock();
      } else {
        soundManager.playClick();
      }
    },
    [isSimulationMode, simulationState, userState]
  );

  const batchUpdateStatus = useCallback(
    (updates: Array<{ id: number; status: SubjectStatus; grade?: number }>) => {
      const targetState = isSimulationMode ? { ...simulationState! } : { ...userState };
      updates.forEach(({ id, status, grade }) => {
        targetState[id] = {
          ...targetState[id],
          status,
          grade,
          updatedAt: new Date().toISOString(),
        };
      });

      if (isSimulationMode) {
        setSimulationState(targetState);
      } else {
        setUserState(targetState);
      }
      soundManager.playApproval();
      fireConfetti();
    },
    [isSimulationMode, simulationState, userState]
  );

  // Elective assignment handlers (strictly prevent duplication across years)
  const addElectiveToYear = useCallback((electiveId: number, targetYear: number) => {
    const validYear = Math.max(1, Math.min(5, targetYear));
    setAssignedElectives((prev) => {
      const next: AssignedElectivesByYear = {
        1: prev[1].filter((id) => id !== electiveId),
        2: prev[2].filter((id) => id !== electiveId),
        3: prev[3].filter((id) => id !== electiveId),
        4: prev[4].filter((id) => id !== electiveId),
        5: prev[5].filter((id) => id !== electiveId),
      };
      next[validYear].push(electiveId);
      return next;
    });
    soundManager.playClick();
  }, []);

  const removeElectiveFromYear = useCallback((electiveId: number, year: number) => {
    setAssignedElectives((prev) => {
      const yearList = prev[year] || [];
      return {
        ...prev,
        [year]: yearList.filter((id) => id !== electiveId),
      };
    });
    soundManager.playClick();
  }, []);

  const moveElectiveYear = useCallback((electiveId: number, _fromYear: number, toYear: number) => {
    const validToYear = Math.max(1, Math.min(5, toYear));
    setAssignedElectives((prev) => {
      const next: AssignedElectivesByYear = {
        1: prev[1].filter((id) => id !== electiveId),
        2: prev[2].filter((id) => id !== electiveId),
        3: prev[3].filter((id) => id !== electiveId),
        4: prev[4].filter((id) => id !== electiveId),
        5: prev[5].filter((id) => id !== electiveId),
      };
      next[validToYear].push(electiveId);
      return next;
    });
    soundManager.playClick();
  }, []);

  const updateSettings = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  const toggleSound = useCallback(() => {
    const isNowOn = soundManager.toggleMute();
    setSoundEnabled(isNowOn);
  }, []);

  const toggleBasketSubject = useCallback((id: number) => {
    setSemesterBasket((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((item) => item !== id) : [...prev, id];
      soundManager.playClick();
      return next;
    });
  }, []);

  const clearBasket = useCallback(() => {
    setSemesterBasket([]);
    soundManager.playClick();
  }, []);

  const selectedSubject = useMemo(() => {
    if (!selectedSubjectId) return null;
    const core = CORE_SUBJECTS.find((s) => s.id === selectedSubjectId);
    if (core) return core;
    const elective = ELECTIVES.find((e) => e.id === selectedSubjectId);
    return elective || null;
  }, [selectedSubjectId]);

  // Global statistics calculation
  const computedProgress = useMemo<CareerProgress>(() => {
    const activeCoreSubjects = settings.includeAnalistaTrack
      ? CORE_SUBJECTS
      : CORE_SUBJECTS.filter((s) => s.id !== 99);

    let approvedCount = 0;
    let promotedCount = 0;
    let regularizedCount = 0;
    let takingCount = 0;
    let blockedCount = 0;
    let availableCount = 0;

    let totalWeeklyHours = 0;
    let approvedWeeklyHours = 0;

    const gradesToAverage: number[] = [];

    activeCoreSubjects.forEach((subject) => {
      totalWeeklyHours += subject.weeklyHours;
      const status = getSubjectStatus(subject, activeState);
      const st = activeState[subject.id];

      if (status === 'aprobada') {
        approvedCount++;
        approvedWeeklyHours += subject.weeklyHours;
        if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
          gradesToAverage.push(st.grade);
        }
      } else if (status === 'promocionada') {
        promotedCount++;
        approvedWeeklyHours += subject.weeklyHours;
        if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
          gradesToAverage.push(st.grade);
        }
      } else if (status === 'regularizada') {
        regularizedCount++;
      } else if (status === 'cursando') {
        takingCount++;
      } else if (status === 'disponible') {
        availableCount++;
      } else {
        blockedCount++;
      }
    });

    // Electives credits computation (global total, regardless of level)
    let totalElectiveCreditsApproved = 0;
    let totalElectiveCreditsRegularized = 0;
    let totalElectiveCreditsTaking = 0;

    ELECTIVES.forEach((el) => {
      const st = activeState[el.id];
      if (isApprovedOrHigher(st)) {
        totalElectiveCreditsApproved += el.credits;
        if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
          gradesToAverage.push(st.grade);
        }
      } else if (st?.status === 'regularizada') {
        totalElectiveCreditsRegularized += el.credits;
      } else if (st?.status === 'cursando') {
        totalElectiveCreditsTaking += el.credits;
      }
    });

    const coreApproved = approvedCount + promotedCount;
    const corePending = blockedCount + availableCount;

    const breakdown = calculateProgressBreakdown({
      coreApproved,
      coreRegularized: regularizedCount,
      coreTaking: takingCount,
      corePending,
      totalCore: activeCoreSubjects.length,
      electiveCreditsApproved: totalElectiveCreditsApproved,
      electiveCreditsRegularized: totalElectiveCreditsRegularized,
      electiveCreditsTaking: totalElectiveCreditsTaking,
      includeElectives: settings.includeElectivesInProgress,
      electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
      requiredElectiveCredits: REQUIRED_ELECTIVE_CREDITS_TOTAL,
    });

    const careerPercentageBySubjects = breakdown.percentageApproved;
    const careerPercentageByHours = totalWeeklyHours > 0
      ? Math.round((approvedWeeklyHours / totalWeeklyHours) * 100)
      : 0;

    const averageGrade = gradesToAverage.length > 0
      ? Number((gradesToAverage.reduce((a, b) => a + b, 0) / gradesToAverage.length).toFixed(2))
      : 0;

    const missingElectiveCreditsForDegree = Math.max(0, REQUIRED_ELECTIVE_CREDITS_TOTAL - totalElectiveCreditsApproved);
    const missingCoreForDegree = activeCoreSubjects
      .filter((s) => !isApprovedOrHigher(activeState[s.id]))
      .map((s) => s.id);

    const analistaCheck = checkAnalistaTitle(activeState, totalElectiveCreditsApproved);
    const ppsCheck = isPPSEligible(activeState);

    // Degree eligible: all active core subjects approved + 20 total elective credits
    const isDegreeEligible =
      missingCoreForDegree.length === 0 &&
      totalElectiveCreditsApproved >= REQUIRED_ELECTIVE_CREDITS_TOTAL;

    return {
      totalSubjects: activeCoreSubjects.length,
      approvedCount,
      promotedCount,
      regularizedCount,
      takingCount,
      blockedCount,
      availableCount,
      totalWeeklyHours,
      approvedWeeklyHours,
      careerPercentageBySubjects,
      careerPercentageByHours,
      percentageApproved: breakdown.percentageApproved,
      percentageTaking: breakdown.percentageTaking,
      percentageRegularized: breakdown.percentageRegularized,
      percentagePending: breakdown.percentagePending,
      totalEquivalentSlots: breakdown.totalEquivalentSlots,
      approvedEquivalentSlots: breakdown.approvedEquivalentSlots,
      averageGrade,
      averageGradeWithPromotions: averageGrade,
      pendingFinalsCount: regularizedCount,
      totalElectiveCreditsApproved,
      totalElectiveCreditsTaking,
      totalElectiveCreditsRegularized,
      totalElectiveCreditsRequired: REQUIRED_ELECTIVE_CREDITS_TOTAL,
      missingElectiveCreditsForDegree,
      missingCoreForDegree,
      isAnalistaEligible: analistaCheck.eligible,
      missingForAnalista: analistaCheck,
      isPPSEligible: ppsCheck.eligible,
      isDegreeEligible,
    };
  }, [activeState, settings]);

  const criticalPath = useMemo(() => {
    return calculateCriticalPath(activeState, settings.includeAnalistaTrack);
  }, [activeState, settings.includeAnalistaTrack]);

  const exportData = useCallback(() => {
    return exportCareerToJson(userState, settings, semesterBasket, assignedElectives);
  }, [userState, settings, semesterBasket, assignedElectives]);

  const importData = useCallback((json: string) => {
    const res = importCareerFromJson(json);
    if (res.success && res.userState) {
      setUserState(res.userState);
      if (res.settings) setSettings(res.settings);
      if (res.basket) setSemesterBasket(res.basket);
      if (res.assignedElectives) setAssignedElectives(res.assignedElectives);
      soundManager.playMilestone();
      fireConfetti();
      return { success: true };
    }
    return { success: false, error: res.error };
  }, []);

  const resetAll = useCallback(() => {
    clearCareerData();
    setUserState({});
    setSemesterBasket([]);
    setAssignedElectives({ ...INITIAL_ASSIGNED_ELECTIVES });
    setSimulationState(null);
    soundManager.playClick();
  }, []);

  const loadSample = useCallback(() => {
    const sample = getSample3rdYearStudent();
    setUserState(sample.userState);
    setAssignedElectives(sample.assignedElectives);
    setSimulationState(null);
    soundManager.playMilestone();
    fireConfetti();
  }, []);

  const startTutorial = useCallback(
    (fromStep = 0) => {
      realUserStateBackupRef.current = { ...userState };
      setCurrentTutorialStep(fromStep);
      setIsTutorialOpen(true);
      soundManager.playClick();
    },
    [userState]
  );

  const closeTutorial = useCallback((options?: { openOnboarding?: boolean }) => {
    // Restore userState from real backup if sandbox modifications happened
    if (realUserStateBackupRef.current !== null) {
      setUserState(realUserStateBackupRef.current);
      realUserStateBackupRef.current = null;
    }
    markTutorialCompleted();
    setIsTutorialOpen(false);
    setSelectedSubjectId(null);
    setStatusModalSubjectId(null);
    soundManager.playClick();

    if (options?.openOnboarding) {
      setIsOnboardingOpen(true);
    }
  }, []);

  const nextTutorialStep = useCallback(() => {
    setCurrentTutorialStep((prev) => {
      if (prev < TUTORIAL_STEPS.length - 1) {
        soundManager.playClick();
        return prev + 1;
      }
      closeTutorial();
      return prev;
    });
  }, [closeTutorial]);

  const prevTutorialStep = useCallback(() => {
    setCurrentTutorialStep((prev) => {
      soundManager.playClick();
      return Math.max(0, prev - 1);
    });
  }, []);

  const goToTutorialStep = useCallback((step: number) => {
    setCurrentTutorialStep(Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, step)));
    soundManager.playClick();
  }, []);

  // Keyboard shortcut for Ctrl+K / Cmd+K search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <CareerContext.Provider
      value={{
        userState,
        activeState,
        isSimulationMode,
        simulationChangedCount,
        toggleSimulationMode,
        applySimulation,
        resetSimulation,
        updateSubjectStatus,
        batchUpdateStatus,
        assignedElectives,
        addElectiveToYear,
        removeElectiveFromYear,
        moveElectiveYear,
        settings,
        updateSettings,
        soundEnabled,
        toggleSound,
        selectedSubjectId,
        setSelectedSubjectId,
        selectedSubject,
        statusModalSubjectId,
        setStatusModalSubjectId,
        isSearchOpen,
        setIsSearchOpen,
        isOnboardingOpen,
        setIsOnboardingOpen,
        semesterBasket,
        toggleBasketSubject,
        clearBasket,
        showElectivesInGraph,
        setShowElectivesInGraph,
        computedProgress,
        criticalPath,
        isTutorialOpen,
        currentTutorialStep,
        startTutorial,
        closeTutorial,
        nextTutorialStep,
        prevTutorialStep,
        goToTutorialStep,
        exportData,
        importData,
        resetAll,
        loadSample,
      }}
    >
      {children}
    </CareerContext.Provider>
  );
};

export const useCareer = () => {
  const context = useContext(CareerContext);
  if (!context) {
    throw new Error('useCareer must be used within a CareerProvider');
  }
  return context;
};
