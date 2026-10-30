import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type {
  SubjectStatus,
  UserCareerState,
  CareerProgress,
  CriticalPathResult,
  Subject,
  AssignedElectivesByYear,
} from '../types/career';
import type { ScheduleDraft, SubjectSchedule } from '../types/schedule';
import type {
  EnrollmentTerm,
  PendingCommissionPrompt,
  PendingReviewPromptItem,
  SubjectEnrollment,
  UpsertEnrollmentInput,
} from '../types/enrollment';
import { DEFAULT_SCHEDULES, SAMPLE_SCHEDULES } from '../data/schedule';
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
  ALL_SUBJECTS_MAP,
} from '../utils/correlativas';
import {
  evaluateCommissionPromptOnStatusChange,
  getReviewPromptsOnRegularizeTransition,
  type StatusChangeTriggerSource,
} from '../utils/enrollmentLogic';
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
  clearCareerData,
  exportCareerToJson,
  importCareerFromJson,
  getSample3rdYearStudent,
  shouldAutoStartTutorial,
  loadScheduleSelections,
  saveScheduleSelections,
  loadScheduleDrafts,
  saveScheduleDrafts,
  loadCustomSchedules,
  saveCustomSchedules,
  clearCustomSchedules,
  loadScheduleTerm,
  saveScheduleTerm,
  loadEnrollments,
  saveEnrollments,
} from '../utils/storage';
import { useAuth } from './AuthContext';
import { userStateApi } from '../api/userState.api';
import { catalogApi } from '../api/catalog.api';
import { enrollmentsApi } from '../api/enrollments.api';
import { professorsApi } from '../api/professors.api';
import type { SyncStatus } from '../components/common/SyncStatusBadge';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GlobalReviewModalTarget {
  professorId: string;
  subjectId?: string | null;
  academicYear?: number | null;
  term?: EnrollmentTerm | null;
}

export interface KanbanEnrollmentHint {
  subjectCode: number;
  subjectName: string;
  status: SubjectStatus;
}

interface CareerContextType {
  userState: UserCareerState;
  activeState: UserCareerState;
  isSimulationMode: boolean;
  simulationChangedCount: number;
  toggleSimulationMode: () => void;
  applySimulation: () => void;
  resetSimulation: () => void;

  updateSubjectStatus: (
    id: number,
    status: SubjectStatus,
    grade?: number,
    options?: { source?: StatusChangeTriggerSource }
  ) => void;
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

  // Schedule builder
  scheduleSelections: Record<number, string>;
  setScheduleSelections: (selections: Record<number, string>) => void;
  selectCommission: (subjectId: number, commissionId: string) => void;
  removeCommission: (subjectId: number) => void;
  clearScheduleSelections: () => void;
  scheduleDrafts: ScheduleDraft[];
  saveDraft: (name: string, term: '1C' | '2C') => ScheduleDraft;
  loadDraft: (draftId: string) => void;
  deleteDraft: (draftId: string) => void;
  renameDraft: (draftId: string, newName: string) => void;
  duplicateDraft: (draftId: string) => void;
  customSchedules: SubjectSchedule[] | null;
  setCustomSchedules: (schedules: SubjectSchedule[] | null) => void;
  activeSchedules: SubjectSchedule[];
  scheduleTerm: '1C' | '2C';
  setScheduleTerm: (term: '1C' | '2C') => void;
  applyScheduleToEnrolled: () => { success: boolean; enrolledCount: number };

  // Enrollments ("Mi cursada") & Review Recommendations
  enrollments: SubjectEnrollment[];
  getSubjectEnrollments: (subjectCode: number) => SubjectEnrollment[];
  saveSubjectEnrollment: (
    subjectCode: number,
    input: UpsertEnrollmentInput
  ) => Promise<SubjectEnrollment>;
  deleteSubjectEnrollment: (enrollmentId: string) => Promise<void>;
  pendingCommissionPrompt: PendingCommissionPrompt | null;
  setPendingCommissionPrompt: (prompt: PendingCommissionPrompt | null) => void;
  openEnrollmentModal: (
    subjectCode: number,
    options?: {
      targetStatus?: SubjectStatus;
      editingEnrollment?: SubjectEnrollment | null;
    }
  ) => void;
  kanbanEnrollmentHint: KanbanEnrollmentHint | null;
  dismissKanbanEnrollmentHint: () => void;
  pendingReviewPrompts: PendingReviewPromptItem[];
  dismissPendingReviewPrompt: (
    item: PendingReviewPromptItem,
    persistInAccount?: boolean
  ) => Promise<void>;
  unseenRecommendationsCount: number;
  refreshReviewableSummary: () => Promise<void>;
  markReviewRecommendationsSeen: (keys?: string[]) => Promise<void>;
  dismissReviewRecommendation: (
    professorId: string,
    subjectId: string | number
  ) => Promise<void>;
  globalReviewModalTarget: GlobalReviewModalTarget | null;
  openGlobalReviewModal: (target: GlobalReviewModalTarget) => void;
  closeGlobalReviewModal: () => void;

  exportData: () => string;
  importData: (json: string) => { success: boolean; error?: string };
  resetAll: () => void;
  loadSample: () => void;

  // Full-Stack & Sync features
  syncStatus: SyncStatus;
  showMigrationModal: boolean;
  setShowMigrationModal: (show: boolean) => void;
  currentPlanName: string;
  reloadServerState: () => Promise<void>;
}

const CareerContext = createContext<CareerContextType | undefined>(undefined);

export const CareerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();

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

  // Schedule builder state
  const [scheduleSelections, setScheduleSelections] = useState<Record<number, string>>(() => loadScheduleSelections());
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>(() => loadScheduleDrafts());
  const [customSchedules, setCustomSchedules] = useState<SubjectSchedule[] | null>(() => loadCustomSchedules());
  const [scheduleTerm, setScheduleTerm] = useState<'1C' | '2C'>(() => loadScheduleTerm());

  // Enrollments & Recommendations state
  const [enrollments, setEnrollments] = useState<SubjectEnrollment[]>(() => loadEnrollments());
  const [pendingCommissionPrompt, setPendingCommissionPrompt] =
    useState<PendingCommissionPrompt | null>(null);
  const [kanbanEnrollmentHint, setKanbanEnrollmentHint] =
    useState<KanbanEnrollmentHint | null>(null);
  const [pendingReviewPrompts, setPendingReviewPrompts] = useState<PendingReviewPromptItem[]>([]);
  const [unseenRecommendationsCount, setUnseenRecommendationsCount] = useState<number>(0);
  const [globalReviewModalTarget, setGlobalReviewModalTarget] =
    useState<GlobalReviewModalTarget | null>(null);

  const reviewedPairsRef = useRef<Set<string>>(new Set());
  const dismissedPairsRef = useRef<Set<string>>(new Set());

  // Full Stack sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('saved');
  const [showMigrationModal, setShowMigrationModal] = useState<boolean>(false);
  const [currentPlanName, setCurrentPlanName] = useState<string>('Plan 2023');

  const hasHydratedRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshReviewableSummary = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await professorsApi.getReviewable();
      if (res.success && res.data) {
        const reviewedSet = new Set<string>();
        const dismissedSet = new Set<string>();
        for (const rev of res.data.myReviews) {
          reviewedSet.add(`${rev.professorId}::${rev.subjectId}`);
        }
        for (const pair of res.data.eligible) {
          if (pair.alreadyReviewed) {
            reviewedSet.add(`${pair.professorId}::${pair.subjectId}`);
          }
          if (pair.dismissed) {
            dismissedSet.add(`${pair.professorId}::${pair.subjectId}`);
          }
        }
        reviewedPairsRef.current = reviewedSet;
        dismissedPairsRef.current = dismissedSet;
        setUnseenRecommendationsCount(res.data.unseenRecommendedCount ?? 0);
      }
    } catch {
      // Silencioso en caso offline
    }
  }, [isAuthenticated]);

  // Load server state when authenticated
  const reloadServerState = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setSyncStatus('saving');

      // 1. Cargar plan activo
      const planRes = await catalogApi.getPlan('current').catch(() => null);
      if (planRes?.success && planRes.data?.plan) {
        setCurrentPlanName(planRes.data.plan.name);
      }

      // 2. Cargar estado de usuario
      const stateRes = await userStateApi.getState();
      if (stateRes.success && stateRes.data) {
        const d = stateRes.data;
        setUserState(d.progress || {});
        setSettings(d.settings);
        setAssignedElectives(d.assignedElectives);
        setSemesterBasket(d.basket || []);
        setScheduleSelections(d.scheduleSelections || {});
        if (d.scheduleProposals) {
          setScheduleDrafts(d.scheduleProposals);
        }
        if (Array.isArray(d.enrollments)) {
          setEnrollments(d.enrollments);
        }

        // Si la cuenta en la nube es virgen pero el navegador tiene datos locales
        const localState = loadUserState();
        if (!d.hasSavedData && Object.keys(localState).length > 0) {
          setShowMigrationModal(true);
        }

        hasHydratedRef.current = true;
        setSyncStatus('saved');
      }

      // 3. Cargar oferta de horarios desde la API de catálogo
      const schedRes = await catalogApi.getSchedule().catch(() => null);
      if (schedRes?.success && schedRes.data?.schedule && schedRes.data.schedule.length > 0) {
        setCustomSchedules(schedRes.data.schedule);
      }

      // 4. Cargar resumen de recomendaciones de reseñas
      await refreshReviewableSummary();
    } catch (e) {
      console.error('Error hydrating from server:', e);
      setSyncStatus('offline');
    }
  }, [isAuthenticated, refreshReviewableSummary]);

  useEffect(() => {
    if (isAuthenticated) {
      reloadServerState();
    } else {
      hasHydratedRef.current = false;
      setUnseenRecommendationsCount(0);
    }
  }, [isAuthenticated, reloadServerState]);

  const activeSchedules = useMemo(() => {
    return customSchedules && customSchedules.length > 0
      ? customSchedules
      : DEFAULT_SCHEDULES.length > 0
      ? DEFAULT_SCHEDULES
      : SAMPLE_SCHEDULES;
  }, [customSchedules]);

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

  useEffect(() => {
    saveScheduleSelections(scheduleSelections);
  }, [scheduleSelections]);

  useEffect(() => {
    saveScheduleDrafts(scheduleDrafts);
  }, [scheduleDrafts]);

  useEffect(() => {
    if (customSchedules) {
      saveCustomSchedules(customSchedules);
    } else {
      clearCustomSchedules();
    }
  }, [customSchedules]);

  useEffect(() => {
    saveScheduleTerm(scheduleTerm);
  }, [scheduleTerm]);

  useEffect(() => {
    saveEnrollments(enrollments);
  }, [enrollments]);

  const isSimulationMode = simulationState !== null;
  const activeState = simulationState ?? userState;

  const getSubjectEnrollments = useCallback(
    (subjectCode: number): SubjectEnrollment[] => {
      return enrollments.filter((enr) => enr.subjectCode === subjectCode);
    },
    [enrollments]
  );

  const openEnrollmentModal = useCallback(
    (
      subjectCode: number,
      options?: {
        targetStatus?: SubjectStatus;
        editingEnrollment?: SubjectEnrollment | null;
      }
    ) => {
      const sub = ALL_SUBJECTS_MAP.get(subjectCode);
      const currentStatus =
        options?.targetStatus ||
        (sub ? getSubjectStatus(sub, activeState) : 'cursando');
      setPendingCommissionPrompt({
        subjectCode,
        subjectName: sub?.name || `Materia #${subjectCode}`,
        targetStatus: currentStatus,
        editingEnrollment: options?.editingEnrollment ?? null,
      });
      setKanbanEnrollmentHint(null);
    },
    [activeState]
  );

  const dismissKanbanEnrollmentHint = useCallback(() => {
    setKanbanEnrollmentHint(null);
  }, []);

  const saveSubjectEnrollment = useCallback(
    async (
      subjectCode: number,
      input: UpsertEnrollmentInput
    ): Promise<SubjectEnrollment> => {
      setSyncStatus('saving');
      try {
        const res = await enrollmentsApi.upsertEnrollment(subjectCode, input);
        const saved = res.data;
        setEnrollments((prev) => {
          const filtered = prev.filter((e) => e.id !== saved.id);
          return [saved, ...filtered];
        });
        setSyncStatus('saved');
        await refreshReviewableSummary();
        return saved;
      } catch (err) {
        setSyncStatus('error');
        throw err;
      }
    },
    [refreshReviewableSummary]
  );

  const deleteSubjectEnrollment = useCallback(
    async (enrollmentId: string): Promise<void> => {
      setSyncStatus('saving');
      try {
        await enrollmentsApi.deleteEnrollment(enrollmentId);
        setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId));
        setSyncStatus('saved');
        await refreshReviewableSummary();
      } catch (err) {
        setSyncStatus('error');
        throw err;
      }
    },
    [refreshReviewableSummary]
  );

  const dismissReviewRecommendation = useCallback(
    async (professorId: string, subjectId: string | number): Promise<void> => {
      await professorsApi.dismissRecommendation({ professorId, subjectId });
      dismissedPairsRef.current.add(`${professorId}::${subjectId}`);
      setPendingReviewPrompts((prev) =>
        prev.filter(
          (p) =>
            !(
              p.professorId === professorId &&
              (p.subjectId === String(subjectId) || p.subjectCode === Number(subjectId))
            )
        )
      );
      await refreshReviewableSummary();
    },
    [refreshReviewableSummary]
  );

  const dismissPendingReviewPrompt = useCallback(
    async (item: PendingReviewPromptItem, persistInAccount = false): Promise<void> => {
      setPendingReviewPrompts((prev) =>
        prev.filter(
          (p) => !(p.professorId === item.professorId && p.subjectId === item.subjectId)
        )
      );
      if (persistInAccount && isAuthenticated) {
        try {
          await professorsApi.dismissRecommendation({
            professorId: item.professorId,
            subjectId: item.subjectId,
          });
          dismissedPairsRef.current.add(`${item.professorId}::${item.subjectId}`);
          await refreshReviewableSummary();
        } catch {
          // Silencioso
        }
      }
    },
    [isAuthenticated, refreshReviewableSummary]
  );

  const markReviewRecommendationsSeen = useCallback(
    async (keys?: string[]): Promise<void> => {
      if (!isAuthenticated) return;
      setUnseenRecommendationsCount(0);
      try {
        await professorsApi.markRecommendationsSeen(keys);
      } catch {
        // Silencioso
      }
    },
    [isAuthenticated]
  );

  const openGlobalReviewModal = useCallback((target: GlobalReviewModalTarget) => {
    setGlobalReviewModalTarget(target);
  }, []);

  const closeGlobalReviewModal = useCallback(() => {
    setGlobalReviewModalTarget(null);
  }, []);

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

      // Sincronizar simulación confirmada a la nube
      if (isAuthenticated) {
        setSyncStatus('saving');
        userStateApi
          .importLegacyData({ userState: simulationState })
          .then(() => {
            setSyncStatus('saved');
            refreshReviewableSummary();
          })
          .catch(() => setSyncStatus('error'));
      }
    }
  }, [simulationState, isAuthenticated, refreshReviewableSummary]);

  const resetSimulation = useCallback(() => {
    setSimulationState({ ...userState });
    soundManager.playClick();
  }, [userState]);

  const updateSubjectStatus = useCallback(
    (
      id: number,
      status: SubjectStatus,
      grade?: number,
      options?: { source?: StatusChangeTriggerSource }
    ) => {
      const targetState = isSimulationMode ? simulationState! : userState;
      const prevSubState = targetState[id];
      const subjectObj = ALL_SUBJECTS_MAP.get(id);
      const prevStatus = subjectObj
        ? getSubjectStatus(subjectObj, targetState)
        : prevSubState?.status;

      // Check if newly unlocked subjects appear
      const newlyUnlocked = getNewlyUnlockedOnStateChange(id, status, targetState);

      const nextSubjectState = {
        ...prevSubState,
        status,
        grade: (status === 'aprobada' || status === 'promocionada') && grade !== undefined ? grade : prevSubState?.grade,
        updatedAt: new Date().toISOString(),
      };

      if (status === 'bloqueada' || status === 'disponible') {
        // Si vuelve a pendiente, limpiar la nota (las cursadas registradas no se borran automáticamente)
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

        // Sincronizar estado al backend inmediatamente para que elegibilidad y recomendaciones estén al día
        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          userStateApi
            .updateProgress(id, status, nextSubjectState.grade)
            .then(() => {
              setSyncStatus('saved');
              refreshReviewableSummary();
            })
            .catch(() => {
              setSyncStatus('error');
            });
        }

        // Paso opcional de comisión o aviso de reseñas al regularizar/aprobar (fuera del tutorial)
        if (!isTutorialOpen) {
          const subjectEnrollments = enrollments.filter((enr) => enr.subjectCode === id);
          const source = options?.source ?? 'status_change';

          const promptDecision = evaluateCommissionPromptOnStatusChange({
            prevStatus,
            nextStatus: status,
            existingSubjectEnrollments: subjectEnrollments,
            isSimulationMode: false,
            source,
          });

          if (promptDecision.shouldOpenModal) {
            setPendingCommissionPrompt({
              subjectCode: id,
              subjectName: subjectObj?.name || `Materia #${id}`,
              targetStatus: status,
              editingEnrollment: null,
            });
            setKanbanEnrollmentHint(null);
          } else if (promptDecision.shouldShowKanbanHint) {
            setKanbanEnrollmentHint({
              subjectCode: id,
              subjectName: subjectObj?.name || `Materia #${id}`,
              status,
            });
          }

          // Aviso discreto al pasar de cursando -> regularizada / aprobada / promocionada
          const reviewPrompts = getReviewPromptsOnRegularizeTransition({
            prevStatus,
            nextStatus: status,
            existingSubjectEnrollments: subjectEnrollments,
            reviewedPairKeys: reviewedPairsRef.current,
            dismissedPairKeys: dismissedPairsRef.current,
          });

          if (reviewPrompts.length > 0) {
            setPendingReviewPrompts((prev) => {
              const existingKeys = new Set(
                prev.map((p) => `${p.professorId}::${p.subjectId}`)
              );
              const additions = reviewPrompts.filter(
                (p) => !existingKeys.has(`${p.professorId}::${p.subjectId}`)
              );
              return [...additions, ...prev];
            });
          }
        }
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
    [
      isSimulationMode,
      simulationState,
      userState,
      isAuthenticated,
      isTutorialOpen,
      enrollments,
      refreshReviewableSummary,
    ]
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

        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          userStateApi
            .importLegacyData({ userState: targetState })
            .then(() => {
              setSyncStatus('saved');
              refreshReviewableSummary();
            })
            .catch(() => setSyncStatus('error'));
        }
      }
      soundManager.playApproval();
      fireConfetti();
    },
    [isSimulationMode, simulationState, userState, isAuthenticated, refreshReviewableSummary]
  );

  // Elective assignment handlers (strictly prevent duplication across years)
  const addElectiveToYear = useCallback(
    (electiveId: number, targetYear: number) => {
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

        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          userStateApi
            .updateElectives(next)
            .then(() => setSyncStatus('saved'))
            .catch(() => setSyncStatus('error'));
        }

        return next;
      });
      soundManager.playClick();
    },
    [isAuthenticated]
  );

  const removeElectiveFromYear = useCallback(
    (electiveId: number, year: number) => {
      setAssignedElectives((prev) => {
        const yearList = prev[year] || [];
        const next = {
          ...prev,
          [year]: yearList.filter((id) => id !== electiveId),
        };

        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          userStateApi
            .updateElectives(next)
            .then(() => setSyncStatus('saved'))
            .catch(() => setSyncStatus('error'));
        }

        return next;
      });
      soundManager.playClick();
    },
    [isAuthenticated]
  );

  const moveElectiveYear = useCallback(
    (electiveId: number, _fromYear: number, toYear: number) => {
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

        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          userStateApi
            .updateElectives(next)
            .then(() => setSyncStatus('saved'))
            .catch(() => setSyncStatus('error'));
        }

        return next;
      });
      soundManager.playClick();
    },
    [isAuthenticated]
  );

  const updateSettings = useCallback(
    (newSettings: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...newSettings };
        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          userStateApi
            .updateSettings(next)
            .then(() => setSyncStatus('saved'))
            .catch(() => setSyncStatus('error'));
        }
        return next;
      });
    },
    [isAuthenticated]
  );

  const toggleSound = useCallback(() => {
    const isNowOn = soundManager.toggleMute();
    setSoundEnabled(isNowOn);
  }, []);

  const toggleBasketSubject = useCallback(
    (id: number) => {
      setSemesterBasket((prev) => {
        const exists = prev.includes(id);
        const next = exists ? prev.filter((item) => item !== id) : [...prev, id];
        soundManager.playClick();

        if (isAuthenticated && hasHydratedRef.current) {
          setSyncStatus('saving');
          userStateApi
            .updateBasket(next)
            .then(() => setSyncStatus('saved'))
            .catch(() => setSyncStatus('error'));
        }

        return next;
      });
    },
    [isAuthenticated]
  );

  const clearBasket = useCallback(() => {
    setSemesterBasket([]);
    soundManager.playClick();

    if (isAuthenticated && hasHydratedRef.current) {
      setSyncStatus('saving');
      userStateApi
        .updateBasket([])
        .then(() => setSyncStatus('saved'))
        .catch(() => setSyncStatus('error'));
    }
  }, [isAuthenticated]);

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
      missingForAnalista: {
        missingCoreIds: analistaCheck.missingCoreIds,
        seminarioApproved: analistaCheck.seminarioApproved,
        electiveCredits: analistaCheck.electiveCredits,
      },
      isPPSEligible: ppsCheck.eligible,
      isDegreeEligible,
    };
  }, [activeState, settings]);

  const criticalPath = useMemo<CriticalPathResult>(() => {
    return calculateCriticalPath(activeState, settings.includeAnalistaTrack);
  }, [activeState, settings.includeAnalistaTrack]);

  // Schedule Builder Actions
  const selectCommission = useCallback(
    (subjectId: number, commissionId: string) => {
      setScheduleSelections((prev) => {
        const next = { ...prev, [subjectId]: commissionId };
        if (isAuthenticated && hasHydratedRef.current) {
          userStateApi.saveScheduleSelections(next).catch(() => {});
        }
        return next;
      });
      soundManager.playClick();
    },
    [isAuthenticated]
  );

  const removeCommission = useCallback(
    (subjectId: number) => {
      setScheduleSelections((prev) => {
        const next = { ...prev };
        delete next[subjectId];
        if (isAuthenticated && hasHydratedRef.current) {
          userStateApi.saveScheduleSelections(next).catch(() => {});
        }
        return next;
      });
      soundManager.playClick();
    },
    [isAuthenticated]
  );

  const clearScheduleSelections = useCallback(() => {
    setScheduleSelections({});
    if (isAuthenticated && hasHydratedRef.current) {
      userStateApi.saveScheduleSelections({}).catch(() => {});
    }
    soundManager.playClick();
  }, [isAuthenticated]);

  const saveDraft = useCallback(
    (name: string, term: '1C' | '2C'): ScheduleDraft => {
      const now = Date.now();
      const draft: ScheduleDraft = {
        id: `draft_${now}`,
        name: name.trim() || `Propuesta ${scheduleDrafts.length + 1}`,
        term,
        selections: { ...scheduleSelections },
        createdAt: now,
        updatedAt: now,
      };
      setScheduleDrafts((prev) => [draft, ...prev]);

      if (isAuthenticated && hasHydratedRef.current) {
        userStateApi
          .saveScheduleProposal({
            name: draft.name,
            selections: draft.selections as any,
          })
          .catch(() => {});
      }

      soundManager.playClick();
      return draft;
    },
    [scheduleSelections, scheduleDrafts.length, isAuthenticated]
  );

  const loadDraft = useCallback(
    (draftId: string) => {
      const draft = scheduleDrafts.find((d) => d.id === draftId);
      if (!draft) return;
      setScheduleSelections({ ...draft.selections });
      setScheduleTerm(draft.term);
      soundManager.playClick();
    },
    [scheduleDrafts]
  );

  const deleteDraft = useCallback(
    (draftId: string) => {
      setScheduleDrafts((prev) => prev.filter((d) => d.id !== draftId));
      if (isAuthenticated && hasHydratedRef.current) {
        userStateApi.deleteScheduleProposal(draftId).catch(() => {});
      }
      soundManager.playClick();
    },
    [isAuthenticated]
  );

  const renameDraft = useCallback((draftId: string, newName: string) => {
    setScheduleDrafts((prev) =>
      prev.map((d) =>
        d.id === draftId ? { ...d, name: newName.trim(), updatedAt: Date.now() } : d
      )
    );
    soundManager.playClick();
  }, []);

  const duplicateDraft = useCallback(
    (draftId: string) => {
      const src = scheduleDrafts.find((d) => d.id === draftId);
      if (!src) return;
      const now = Date.now();
      const copy: ScheduleDraft = {
        ...src,
        id: `draft_${now}`,
        name: `${src.name} (Copia)`,
        createdAt: now,
        updatedAt: now,
      };
      setScheduleDrafts((prev) => [copy, ...prev]);
      soundManager.playClick();
    },
    [scheduleDrafts]
  );

  const applyScheduleToEnrolled = useCallback((): { success: boolean; enrolledCount: number } => {
    const selectedSubjectIds = Object.keys(scheduleSelections).map((k) => Number(k));
    if (selectedSubjectIds.length === 0) {
      return { success: false, enrolledCount: 0 };
    }

    const updates: Array<{ id: number; status: SubjectStatus }> = [];
    selectedSubjectIds.forEach((id) => {
      const current = userState[id]?.status;
      if (current !== 'aprobada' && current !== 'promocionada') {
        updates.push({ id, status: 'cursando' });
      }
    });

    if (updates.length > 0) {
      batchUpdateStatus(updates);
    }

    // Guardar automáticamente cada comisión seleccionada y sus profesores como cursada (source = 'schedule_builder')
    if (isAuthenticated && !isSimulationMode) {
      const schedulesBySubject = new Map<number, SubjectSchedule>();
      activeSchedules.forEach((s) => schedulesBySubject.set(Number(s.subjectId), s));
      const currentYear = new Date().getFullYear();

      const enrollmentPromises = updates.map(async ({ id }) => {
        const commKey = scheduleSelections[id];
        const sched = schedulesBySubject.get(id);
        const comm = sched?.commissions.find((c) => c.id === commKey);
        if (!comm) return null;

        const isCommissionUuid = UUID_REGEX.test(comm.id);
        const refProfUuids = (comm.professorRefs || [])
          .map((r) => r.id)
          .filter((pid): pid is string => Boolean(pid && UUID_REGEX.test(pid)));
        const subjectObj = ALL_SUBJECTS_MAP.get(id);
        const effectiveTerm: EnrollmentTerm =
          subjectObj?.modality === 'A' ? 'A' : scheduleTerm;

        const payload: UpsertEnrollmentInput = isCommissionUuid
          ? {
              commissionId: comm.id,
              source: 'schedule_builder',
            }
          : {
              commissionCode: comm.code,
              academicYear: currentYear,
              term: effectiveTerm,
              ...(refProfUuids.length > 0
                ? { professorIds: refProfUuids }
                : { professorNames: comm.professors }),
              source: 'schedule_builder',
            };

        try {
          const res = await enrollmentsApi.upsertEnrollment(id, payload);
          return res.data;
        } catch {
          return null;
        }
      });

      Promise.all(enrollmentPromises)
        .then((savedList) => {
          const validSaved = savedList.filter((item): item is SubjectEnrollment => Boolean(item));
          if (validSaved.length > 0) {
            setEnrollments((prev) => {
              const savedIds = new Set(validSaved.map((s) => s.id));
              return [...validSaved, ...prev.filter((p) => !savedIds.has(p.id))];
            });
            refreshReviewableSummary();
          }
        })
        .catch(() => {});
    }

    return { success: true, enrolledCount: updates.length };
  }, [
    scheduleSelections,
    userState,
    batchUpdateStatus,
    isAuthenticated,
    isSimulationMode,
    activeSchedules,
    scheduleTerm,
    refreshReviewableSummary,
  ]);

  const exportData = useCallback((): string => {
    return exportCareerToJson(userState, settings, semesterBasket, assignedElectives, {
      scheduleDrafts,
      scheduleSelections,
      customSchedules: customSchedules || undefined,
      scheduleTerm,
      enrollments,
    });
  }, [
    userState,
    settings,
    semesterBasket,
    assignedElectives,
    scheduleDrafts,
    scheduleSelections,
    customSchedules,
    scheduleTerm,
    enrollments,
  ]);

  const importData = useCallback(
    (json: string): { success: boolean; error?: string } => {
      const result = importCareerFromJson(json);
      if (result.success) {
        if (result.userState) setUserState(result.userState);
        if (result.settings) setSettings(result.settings);
        if (result.basket) setSemesterBasket(result.basket);
        if (result.assignedElectives) setAssignedElectives(result.assignedElectives);
        if (result.scheduleDrafts) setScheduleDrafts(result.scheduleDrafts);
        if (result.scheduleSelections) setScheduleSelections(result.scheduleSelections);
        if (result.customSchedules) setCustomSchedules(result.customSchedules);
        if (result.scheduleTerm) setScheduleTerm(result.scheduleTerm);
        if (result.enrollments) setEnrollments(result.enrollments);

        // Si está autenticado, sincronizar a Neon en una sola transacción
        if (isAuthenticated) {
          setSyncStatus('saving');
          try {
            const parsed = JSON.parse(json);
            userStateApi
              .importLegacyData(parsed)
              .then(() => {
                setSyncStatus('saved');
                reloadServerState();
              })
              .catch(() => setSyncStatus('error'));
          } catch {
            // Ignorar
          }
        }

        soundManager.playMilestone();
        fireConfetti();
        return { success: true };
      }
      return { success: false, error: result.error };
    },
    [isAuthenticated, reloadServerState]
  );

  const resetAll = useCallback(() => {
    clearCareerData();
    setUserState({});
    setSemesterBasket([]);
    setAssignedElectives({ 1: [], 2: [], 3: [], 4: [], 5: [] });
    setScheduleSelections({});
    setScheduleDrafts([]);
    setCustomSchedules(null);
    setEnrollments([]);
    setSettings(loadSettings());
    soundManager.playClick();

    if (isAuthenticated) {
      setSyncStatus('saving');
      userStateApi
        .importLegacyData({
          userState: {},
          basket: [],
          assignedElectives: { 1: [], 2: [], 3: [], 4: [], 5: [] },
          scheduleSelections: {},
        })
        .then(() => setSyncStatus('saved'))
        .catch(() => setSyncStatus('error'));
    }
  }, [isAuthenticated]);

  const loadSample = useCallback(() => {
    const sample = getSample3rdYearStudent();
    setUserState(sample.userState);
    setSemesterBasket([]);
    setAssignedElectives(sample.assignedElectives);
    soundManager.playMilestone();
    fireConfetti();

    if (isAuthenticated) {
      setSyncStatus('saving');
      userStateApi
        .importLegacyData(sample)
        .then(() => {
          setSyncStatus('saved');
          refreshReviewableSummary();
        })
        .catch(() => setSyncStatus('error'));
    }
  }, [isAuthenticated, refreshReviewableSummary]);

  // Interactive Tour controls
  const startTutorial = useCallback((fromStep: number = 0) => {
    realUserStateBackupRef.current = { ...userState };
    setCurrentTutorialStep(fromStep);
    setIsTutorialOpen(true);
    soundManager.playClick();
  }, [userState]);

  const closeTutorial = useCallback((options?: { openOnboarding?: boolean }) => {
    setIsTutorialOpen(false);
    if (realUserStateBackupRef.current !== null) {
      setUserState(realUserStateBackupRef.current);
      realUserStateBackupRef.current = null;
    }
    if (options?.openOnboarding) {
      setIsOnboardingOpen(true);
    }
    soundManager.playClick();
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
        scheduleSelections,
        setScheduleSelections,
        selectCommission,
        removeCommission,
        clearScheduleSelections,
        scheduleDrafts,
        saveDraft,
        loadDraft,
        deleteDraft,
        renameDraft,
        duplicateDraft,
        customSchedules,
        setCustomSchedules,
        activeSchedules,
        scheduleTerm,
        setScheduleTerm,
        applyScheduleToEnrolled,
        enrollments,
        getSubjectEnrollments,
        saveSubjectEnrollment,
        deleteSubjectEnrollment,
        pendingCommissionPrompt,
        setPendingCommissionPrompt,
        openEnrollmentModal,
        kanbanEnrollmentHint,
        dismissKanbanEnrollmentHint,
        pendingReviewPrompts,
        dismissPendingReviewPrompt,
        unseenRecommendationsCount,
        refreshReviewableSummary,
        markReviewRecommendationsSeen,
        dismissReviewRecommendation,
        globalReviewModalTarget,
        openGlobalReviewModal,
        closeGlobalReviewModal,
        exportData,
        importData,
        resetAll,
        loadSample,
        syncStatus,
        showMigrationModal,
        setShowMigrationModal,
        currentPlanName,
        reloadServerState,
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
