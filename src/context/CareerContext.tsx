import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import type {
  SubjectStatus,
  UserCareerState,
  CareerProgress,
  CriticalPathResult,
  Subject,
} from '../types/career';
import { CORE_SUBJECTS } from '../data/plan2023';
import { ELECTIVES } from '../data/electives';
import {
  getSubjectStatus,
  isApprovedOrHigher,
  checkAnalistaTitle,
  isPPSEligible,
  getNewlyUnlockedOnStateChange,
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
  clearCareerData,
  exportCareerToJson,
  importCareerFromJson,
  getSample3rdYearStudent,
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

  exportData: () => string;
  importData: (json: string) => { success: boolean; error?: string };
  resetAll: () => void;
  loadSample: () => void;
}

const CareerContext = createContext<CareerContextType | undefined>(undefined);

export const CareerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userState, setUserState] = useState<UserCareerState>(() => loadUserState());
  const [simulationState, setSimulationState] = useState<UserCareerState | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => soundManager.getSoundEnabled());
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [statusModalSubjectId, setStatusModalSubjectId] = useState<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [semesterBasket, setSemesterBasket] = useState<number[]>(() => loadBasket());
  const [showElectivesInGraph, setShowElectivesInGraph] = useState<boolean>(false);

  // Sync state to local storage when real state changes
  useEffect(() => {
    saveUserState(userState);
  }, [userState]);

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
    let approvedCount = 0;
    let promotedCount = 0;
    let regularizedCount = 0;
    let takingCount = 0;
    let blockedCount = 0;
    let availableCount = 0;

    let totalWeeklyHours = 0;
    let approvedWeeklyHours = 0;

    const gradesToAverage: number[] = [];

    CORE_SUBJECTS.forEach((subject) => {
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

    // Electives credits computation
    let electiveCreditsN3 = 0;
    let electiveCreditsN4 = 0;
    let electiveCreditsN5 = 0;

    ELECTIVES.forEach((el) => {
      const st = activeState[el.id];
      if (isApprovedOrHigher(st)) {
        if (el.level === 3) electiveCreditsN3 += el.credits;
        if (el.level === 4) electiveCreditsN4 += el.credits;
        if (el.level === 5) electiveCreditsN5 += el.credits;

        if (st?.grade !== undefined && st.grade >= settings.minPassingGrade) {
          gradesToAverage.push(st.grade);
        }
      }
    });

    const totalElectiveCredits = electiveCreditsN3 + electiveCreditsN4 + electiveCreditsN5;
    const totalApproved = approvedCount + promotedCount;
    const careerPercentageBySubjects = Math.round((totalApproved / CORE_SUBJECTS.length) * 100);
    const careerPercentageByHours = Math.round((approvedWeeklyHours / totalWeeklyHours) * 100);

    const averageGrade = gradesToAverage.length > 0
      ? Number((gradesToAverage.reduce((a, b) => a + b, 0) / gradesToAverage.length).toFixed(2))
      : 0;

    const analistaCheck = checkAnalistaTitle(activeState);
    const ppsCheck = isPPSEligible(activeState);

    // Degree eligible: all 37 core subjects approved + min 20 elective credits
    const isDegreeEligible =
      totalApproved === CORE_SUBJECTS.length &&
      electiveCreditsN3 >= 4 &&
      electiveCreditsN4 >= 6 &&
      electiveCreditsN5 >= 10;

    return {
      totalSubjects: CORE_SUBJECTS.length,
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
      averageGrade,
      averageGradeWithPromotions: averageGrade,
      pendingFinalsCount: regularizedCount,
      electiveCreditsN3,
      electiveCreditsN4,
      electiveCreditsN5,
      totalElectiveCredits,
      isAnalistaEligible: analistaCheck.eligible,
      isPPSEligible: ppsCheck.eligible,
      isDegreeEligible,
    };
  }, [activeState, settings]);

  const criticalPath = useMemo(() => {
    return calculateCriticalPath(activeState);
  }, [activeState]);

  const exportData = useCallback(() => {
    return exportCareerToJson(userState, settings, semesterBasket);
  }, [userState, settings, semesterBasket]);

  const importData = useCallback((json: string) => {
    const res = importCareerFromJson(json);
    if (res.success && res.userState) {
      setUserState(res.userState);
      if (res.settings) setSettings(res.settings);
      if (res.basket) setSemesterBasket(res.basket);
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
    setSimulationState(null);
    soundManager.playClick();
  }, []);

  const loadSample = useCallback(() => {
    const sample = getSample3rdYearStudent();
    setUserState(sample);
    setSimulationState(null);
    soundManager.playMilestone();
    fireConfetti();
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
