import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type {
  ActivePlanCatalog,
  AssignedElectivesByYear,
  CareerProgress,
  CriticalPathResult,
  ExamAttempt,
  PlanCareerMeta,
  PlanConfig,
  PlanSpecialRule,
  Subject,
  SubjectStatus,
  UserCareerState,
} from '../types/career';
import type { ScheduleDraft, SubjectSchedule } from '../types/schedule';
import type {
  EnrollmentTerm,
  PendingCommissionPrompt,
  PendingReviewPromptItem,
  SubjectEnrollment,
  UpsertEnrollmentInput,
} from '../types/enrollment';
import { getAvailableTutorialSteps } from '../data/tutorialSteps';
import { getScheduleAvailability } from '../utils/scheduleAvailability';
import {
  buildSubjectsMap,
  evaluatePlanProgress,
  getNewlyUnlockedOnStateChange,
  getSubjectStatus,
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
  DEFAULT_SETTINGS,
  type AppSettings,
  loadAssignedElectives,
  saveAssignedElectives,
  sanitizeAssignedElectives,
  buildEmptyAssignedElectives,
  clearCareerData,
  exportCareerToJson,
  importCareerFromJson,
  getSampleStudentForPlan,
  hasUnmigratedLegacyLocalStorage,
  migrateLegacyLocalStorageToPlan,
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
  loadExamAttempts,
  saveExamAttempts,
} from '../utils/storage';
import { useAuth } from './AuthContext';
import { userStateApi } from '../api/userState.api';
import { catalogApi, loadPlanCatalogSmart } from '../api/catalog.api';
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

  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

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
  scheduleStatus: 'loading' | 'ready' | 'error';
  scheduleError: string | null;
  retryLoadSchedule: () => Promise<void>;
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


  // Exámenes Finales y Aplazos
  examAttempts: ExamAttempt[];
  getSubjectExamAttempts: (subjectCode: number) => ExamAttempt[];
  saveExamAttempt: (
    subjectCode: number,
    attempt: { date: string; grade: number; notes?: string }
  ) => Promise<ExamAttempt>;
  deleteExamAttempt: (id: string) => Promise<void>;

  // Active dynamic catalog metadata
  activePlan: ActivePlanCatalog | null;
  activeCareer: PlanCareerMeta | null;
  planConfig: PlanConfig | null;
  planRules: PlanSpecialRule[];
  coreSubjects: Subject[];
  electives: Subject[];
  allSubjects: Subject[];
  subjectsById: Map<number, Subject>;
  acronyms: Record<string, number>;
  requiredElectiveCredits: number;
  totalLevels: number;
  levelLabel: string;
  catalogStatus: 'loading' | 'ready' | 'error';
  isWakingCatalogServer: boolean;
  catalogError: string | null;
  retryLoadCatalog: () => Promise<void>;

  // Full-Stack & Sync features
  syncStatus: SyncStatus;
  showMigrationModal: boolean;
  setShowMigrationModal: (show: boolean) => void;
  currentPlanName: string;
  reloadServerState: (overridePlanId?: string) => Promise<void>;
}

const CareerContext = createContext<CareerContextType | undefined>(undefined);

const EMPTY_PROGRESS: CareerProgress = {
  totalSubjects: 0,
  approvedCount: 0,
  promotedCount: 0,
  regularizedCount: 0,
  takingCount: 0,
  blockedCount: 0,
  availableCount: 0,
  totalWeeklyHours: 0,
  approvedWeeklyHours: 0,
  careerPercentageBySubjects: 0,
  careerPercentageByHours: 0,
  percentageApproved: 0,
  percentageTaking: 0,
  percentageRegularized: 0,
  percentagePending: 0,
  totalEquivalentSlots: 0,
  approvedEquivalentSlots: 0,
  averageGrade: 0,
  averageGradeWithPromotions: 0,
  averageGradeWithoutFails: 0,
  averageGradeWithFails: 0,
  totalFailsCount: 0,
  libreCount: 0,
  pendingFinalsCount: 0,
  totalElectiveCreditsApproved: 0,
  totalElectiveCreditsTaking: 0,
  totalElectiveCreditsRegularized: 0,
  totalElectiveCreditsRequired: 0,
  missingElectiveCreditsForDegree: 0,
  missingCoreForDegree: [],
  isAnalistaEligible: false,
  missingForAnalista: {
    missingCoreIds: [],
    seminarioApproved: false,
    electiveCredits: 0,
  },
  isPPSEligible: false,
  isDegreeEligible: false,
};

export const CareerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();

  const [activePlan, setActivePlan] = useState<ActivePlanCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isWakingCatalogServer, setIsWakingCatalogServer] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [userState, setUserState] = useState<UserCareerState>({});
  const [simulationState, setSimulationState] = useState<UserCareerState | null>(null);
  const [assignedElectives, setAssignedElectives] = useState<AssignedElectivesByYear>(() =>
    buildEmptyAssignedElectives(5)
  );
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => soundManager.getSoundEnabled());
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [statusModalSubjectId, setStatusModalSubjectId] = useState<number | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);
  const [semesterBasket, setSemesterBasket] = useState<number[]>([]);
  const [showElectivesInGraph, setShowElectivesInGraph] = useState<boolean>(false);

  // Schedule builder state
  const [scheduleSelections, setScheduleSelections] = useState<Record<number, string>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>([]);
  const [customSchedules, setCustomSchedules] = useState<SubjectSchedule[] | null>(null);
  const [serverSchedules, setServerSchedules] = useState<SubjectSchedule[] | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleTerm, setScheduleTerm] = useState<'1C' | '2C'>('1C');

  // Enrollments & Recommendations state
  const [enrollments, setEnrollments] = useState<SubjectEnrollment[]>([]);
  const [examAttempts, setExamAttempts] = useState<ExamAttempt[]>([]);
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
  const [currentPlanName, setCurrentPlanName] = useState<string>('Plan de estudio');

  const activePlanRef = useRef<ActivePlanCatalog | null>(null);
  const hydratedStoragePlanIdRef = useRef<string | null>(null);
  const hasHydratedRef = useRef(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeCareer = activePlan?.career ?? null;
  const planConfig = activePlan?.plan.config ?? null;
  const planRules = activePlan?.rules ?? [];
  const acronyms = activePlan?.acronyms ?? {};
  const allSubjects = activePlan?.subjects ?? [];
  const coreSubjects = useMemo(
    () => allSubjects.filter((s) => !s.isElective),
    [allSubjects]
  );
  const electives = useMemo(
    () => allSubjects.filter((s) => Boolean(s.isElective)),
    [allSubjects]
  );
  const subjectsById = useMemo(() => buildSubjectsMap(allSubjects), [allSubjects]);
  const validElectiveIds = useMemo(() => new Set(electives.map((e) => e.id)), [electives]);
  const totalLevels = planConfig?.totalLevels ?? 5;
  const levelLabel = planConfig?.levelLabel ?? 'Año';
  const requiredElectiveCredits = planConfig?.requiredElectiveCredits ?? 0;

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

  const applyLoadedCatalogToState = useCallback((catalog: ActivePlanCatalog) => {
    activePlanRef.current = catalog;
    setActivePlan(catalog);
    setCatalogStatus('ready');
    setCatalogError(null);
    setCurrentPlanName(catalog.plan.name);

    const planId = catalog.plan.id;
    migrateLegacyLocalStorageToPlan(planId);

    const planElectives = catalog.subjects.filter((s) => Boolean(s.isElective));
    const planTotalLevels = catalog.plan.config.totalLevels;
    const localState = loadUserState(planId);

    setUserState(localState);
    setAssignedElectives(
      loadAssignedElectives(localState, {
        electives: planElectives,
        totalLevels: planTotalLevels,
        planId,
      })
    );
    setSettings(loadSettings(planId));
    setSemesterBasket(loadBasket(planId));
    setScheduleSelections(loadScheduleSelections(planId));
    setScheduleDrafts(loadScheduleDrafts(planId));
    setCustomSchedules(loadCustomSchedules(planId));
    setServerSchedules(null);
    setScheduleStatus('loading');
    setScheduleError(null);
    setScheduleTerm(loadScheduleTerm(planId));
    setEnrollments(loadEnrollments(planId));
    setExamAttempts(loadExamAttempts(planId));
    setSimulationState(null);
    setSelectedSubjectId(null);
    hydratedStoragePlanIdRef.current = planId;
  }, []);

  const reloadSeqRef = useRef(0);
  const scheduleSeqRef = useRef(0);

  const loadPlanSchedule = useCallback(async (planId: string) => {
    const schedSeq = ++scheduleSeqRef.current;
    setScheduleStatus('loading');
    setScheduleError(null);
    try {
      const schedRes = await catalogApi.getSchedule({ planId });
      if (schedSeq !== scheduleSeqRef.current) return;
      if (activePlanRef.current && activePlanRef.current.plan.id !== planId) return;
      if (!schedRes?.success) {
        throw new Error('No se pudo cargar la oferta horaria desde el servidor.');
      }
      const serverList = Array.isArray(schedRes.data?.schedule)
        ? schedRes.data.schedule
        : [];
      setServerSchedules(serverList);
      setScheduleStatus('ready');
      setScheduleError(null);
    } catch (schedErr) {
      if (schedSeq !== scheduleSeqRef.current) return;
      if (activePlanRef.current && activePlanRef.current.plan.id !== planId) return;
      console.error('Error loading plan schedule:', schedErr);
      setServerSchedules(null);
      setScheduleStatus('error');
      setScheduleError(
        schedErr instanceof Error && schedErr.message
          ? schedErr.message
          : 'No se pudo cargar la oferta horaria desde el servidor. Verificá tu conexión e intentá nuevamente.'
      );
    }
  }, []);

  // Load server catalog + state when authenticated
  const reloadServerState = useCallback(
    async (overridePlanId?: string) => {
      if (!isAuthenticated) return;

      const seq = ++reloadSeqRef.current;
      hydratedStoragePlanIdRef.current = null;
      hasHydratedRef.current = false;

      const isPlanSwitch =
        typeof overridePlanId === 'string' || activePlanRef.current !== null;
      const requestedPlanId =
        overridePlanId ?? (isPlanSwitch ? 'current' : user?.selectedPlanId || 'current');

      setCatalogStatus('loading');
      setCatalogError(null);

      let loadedCatalog: ActivePlanCatalog;
      let immediateAppliedId: string | null = null;
      try {
        const result = await loadPlanCatalogSmart({
          planId: requestedPlanId,
          forceRefresh: isPlanSwitch && !overridePlanId,
          onWakingChange: setIsWakingCatalogServer,
          onImmediateCache: (cachedCatalog) => {
            if (seq !== reloadSeqRef.current) return;
            immediateAppliedId = cachedCatalog.plan.id;
            applyLoadedCatalogToState(cachedCatalog);
          },
        });
        if (seq !== reloadSeqRef.current) return;
        loadedCatalog = result.catalog;

        if (immediateAppliedId !== loadedCatalog.plan.id) {
          applyLoadedCatalogToState(loadedCatalog);
        } else {
          activePlanRef.current = loadedCatalog;
          setActivePlan(loadedCatalog);
          setCurrentPlanName(loadedCatalog.plan.name);
        }
      } catch (e) {
        if (seq !== reloadSeqRef.current) return;
        console.error('Error loading active plan catalog:', e);
        activePlanRef.current = null;
        setActivePlan(null);
        setCatalogError(
          e instanceof Error && e.message
            ? e.message
            : 'No se pudo cargar tu plan de estudio. Verificá tu conexión e intentá nuevamente.'
        );
        setCatalogStatus('error');
        setServerSchedules(null);
        setScheduleStatus('error');
        setScheduleError('No se pudo cargar la oferta horaria porque falló la carga del plan.');
        setSyncStatus('offline');
        return;
      }

      const planId = loadedCatalog.plan.id;
      const planElectiveIds = new Set(
        loadedCatalog.subjects.filter((s) => Boolean(s.isElective)).map((s) => s.id)
      );
      const planTotalLevels = loadedCatalog.plan.config.totalLevels;

      try {
        setSyncStatus('saving');

        // 2. Cargar estado de usuario para el plan activo
        const stateRes = await userStateApi.getState();
        if (seq !== reloadSeqRef.current) return;

        let effectiveStateForTutorial = loadUserState(planId);
        let effectiveSettingsForTutorial = loadSettings(planId);

        if (stateRes.success && stateRes.data) {
          const d = stateRes.data;
          const nextState = d.progress || {};
          effectiveStateForTutorial = nextState;
          effectiveSettingsForTutorial = d.settings || DEFAULT_SETTINGS;

          setUserState(nextState);
          setSettings(d.settings);
          setAssignedElectives(
            sanitizeAssignedElectives(d.assignedElectives || {}, planElectiveIds, planTotalLevels)
          );
          setSemesterBasket(d.basket || []);
          setScheduleSelections(d.scheduleSelections || {});
          if (d.scheduleProposals) {
            setScheduleDrafts(d.scheduleProposals);
          }
          if (Array.isArray(d.enrollments)) {
            setEnrollments(d.enrollments);
          }
          if (Array.isArray(d.examAttempts)) {
            setExamAttempts(d.examAttempts);
          }

          // Si la cuenta en la nube es virgen para este plan pero hay datos locales (scoped o legados sin migrar)
          const localState = loadUserState(planId);
          if (!d.hasSavedData && (Object.keys(localState).length > 0 || hasUnmigratedLegacyLocalStorage())) {
            setShowMigrationModal(true);
          }

          hasHydratedRef.current = true;
          setSyncStatus('saved');
        }

        if (!effectiveSettingsForTutorial.tutorialCompleted && shouldAutoStartTutorial(effectiveStateForTutorial, planId)) {
          setIsTutorialOpen(true);
        }

        // 3. Cargar oferta de horarios del plan activo desde el backend (sin fallback estático)
        await loadPlanSchedule(planId);
        if (seq !== reloadSeqRef.current) return;

        // 4. Cargar resumen de recomendaciones de reseñas
        await refreshReviewableSummary();
      } catch (e) {
        if (seq !== reloadSeqRef.current) return;
        console.error('Error hydrating from server:', e);
        setServerSchedules(null);
        setScheduleStatus('error');
        setScheduleError(
          (prev) =>
            prev ||
            'No se pudo cargar la oferta horaria desde el servidor. Verificá tu conexión e intentá nuevamente.'
        );
        setSyncStatus('offline');
      }
    },
    [
      isAuthenticated,
      user?.selectedPlanId,
      applyLoadedCatalogToState,
      loadPlanSchedule,
      refreshReviewableSummary,
    ]
  );

  const retryLoadCatalog = useCallback(async () => {
    await reloadServerState();
  }, [reloadServerState]);

  const retryLoadSchedule = useCallback(async () => {
    const planId = activePlanRef.current?.plan.id;
    if (!planId || !isAuthenticated) return;
    await loadPlanSchedule(planId);
  }, [isAuthenticated, loadPlanSchedule]);

  useEffect(() => {
    if (isAuthenticated) {
      reloadServerState();
    } else {
      scheduleSeqRef.current += 1;
      hasHydratedRef.current = false;
      hydratedStoragePlanIdRef.current = null;
      activePlanRef.current = null;
      setActivePlan(null);
      setCatalogStatus('loading');
      setCatalogError(null);
      setServerSchedules(null);
      setScheduleStatus('loading');
      setScheduleError(null);
      setUnseenRecommendationsCount(0);
    }
  }, [isAuthenticated, reloadServerState]);

  const activeSchedules = useMemo(() => {
    if (customSchedules && customSchedules.length > 0) {
      return customSchedules;
    }
    return serverSchedules && serverSchedules.length > 0 ? serverSchedules : [];
  }, [customSchedules, serverSchedules]);

  // Tutorial state & sandbox snapshot
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(false);
  const [currentTutorialStep, setCurrentTutorialStep] = useState<number>(0);
  const realUserStateBackupRef = useRef<UserCareerState | null>(null);

  useEffect(() => {
    if (isTutorialOpen && realUserStateBackupRef.current === null) {
      realUserStateBackupRef.current = { ...userState };
    }
  }, [isTutorialOpen, userState]);

  // Sync state to plan-scoped local storage when real state changes (never before hydration)
  const scopedPlanId = activePlan?.plan.id ?? null;

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveUserState(userState, scopedPlanId);
  }, [userState, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveAssignedElectives(assignedElectives, { validElectiveIds, totalLevels, planId: scopedPlanId });
  }, [assignedElectives, scopedPlanId, validElectiveIds, totalLevels]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveSettings(settings, scopedPlanId);
  }, [settings, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveBasket(semesterBasket, scopedPlanId);
  }, [semesterBasket, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveScheduleSelections(scheduleSelections, scopedPlanId);
  }, [scheduleSelections, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveScheduleDrafts(scheduleDrafts, scopedPlanId);
  }, [scheduleDrafts, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    if (customSchedules) {
      saveCustomSchedules(customSchedules, scopedPlanId);
    } else {
      clearCustomSchedules(scopedPlanId);
    }
  }, [customSchedules, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveScheduleTerm(scheduleTerm, scopedPlanId);
  }, [scheduleTerm, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveEnrollments(enrollments, scopedPlanId);
  }, [enrollments, scopedPlanId]);

  useEffect(() => {
    if (!scopedPlanId || hydratedStoragePlanIdRef.current !== scopedPlanId) return;
    saveExamAttempts(examAttempts, scopedPlanId);
  }, [examAttempts, scopedPlanId]);

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
      const sub = subjectsById.get(subjectCode);
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
    [activeState, subjectsById]
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


  const getSubjectExamAttempts = useCallback(
    (subjectCode: number): ExamAttempt[] => {
      return examAttempts.filter((att) => att.subjectCode === subjectCode);
    },
    [examAttempts]
  );

  const saveExamAttempt = useCallback(
    async (
      subjectCode: number,
      attempt: { date: string; grade: number; notes?: string }
    ): Promise<ExamAttempt> => {
      const isPassed = attempt.grade >= settings.minPassingGrade;
      if (isAuthenticated) {
        setSyncStatus('saving');
        try {
          const res = await userStateApi.saveExamAttempt({
            subjectIdOrCode: subjectCode,
            date: attempt.date,
            grade: attempt.grade,
            notes: attempt.notes,
          });
          const saved = res.data;
          setExamAttempts((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
          setSyncStatus('saved');
          return saved;
        } catch (err) {
          setSyncStatus('error');
          throw err;
        }
      } else {
        const localAttempt: ExamAttempt = {
          id: 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          subjectCode,
          date: attempt.date,
          grade: attempt.grade,
          isPassed,
          notes: attempt.notes,
          createdAt: new Date().toISOString(),
        };
        setExamAttempts((prev) => [localAttempt, ...prev]);
        return localAttempt;
      }
    },
    [isAuthenticated, settings.minPassingGrade]
  );

  const deleteExamAttempt = useCallback(
    async (id: string): Promise<void> => {
      if (isAuthenticated) {
        setSyncStatus('saving');
        try {
          await userStateApi.deleteExamAttempt(id);
          setExamAttempts((prev) => prev.filter((a) => a.id !== id));
          setSyncStatus('saved');
        } catch (err) {
          setSyncStatus('error');
          throw err;
        }
      } else {
        setExamAttempts((prev) => prev.filter((a) => a.id !== id));
      }
    },
    [isAuthenticated]
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
      const subjectObj = subjectsById.get(id);
      const prevStatus = subjectObj
        ? getSubjectStatus(subjectObj, targetState)
        : prevSubState?.status;

      // Check if newly unlocked subjects appear
      const newlyUnlocked = getNewlyUnlockedOnStateChange(id, status, targetState, coreSubjects);

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
      subjectsById,
      coreSubjects,
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

  // Elective assignment handlers (strictly prevent duplication across levels)
  const addElectiveToYear = useCallback(
    (electiveId: number, targetYear: number) => {
      const validYear = Math.max(1, Math.min(totalLevels, targetYear));
      setAssignedElectives((prev) => {
        const next = buildEmptyAssignedElectives(totalLevels);
        for (let lvl = 1; lvl <= totalLevels; lvl++) {
          next[lvl] = (prev[lvl] || []).filter((id) => id !== electiveId);
        }
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
    [isAuthenticated, totalLevels]
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
      const validToYear = Math.max(1, Math.min(totalLevels, toYear));
      setAssignedElectives((prev) => {
        const next = buildEmptyAssignedElectives(totalLevels);
        for (let lvl = 1; lvl <= totalLevels; lvl++) {
          next[lvl] = (prev[lvl] || []).filter((id) => id !== electiveId);
        }
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
    [isAuthenticated, totalLevels]
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
    return subjectsById.get(selectedSubjectId) || null;
  }, [selectedSubjectId, subjectsById]);

  // Global statistics calculation delegated cleanly to pure engine
  const computedProgress = useMemo<CareerProgress>(() => {
    if (!activePlan) return EMPTY_PROGRESS;
    return evaluatePlanProgress({
      plan: activePlan,
      userState: activeState,
      settings,
      examAttempts,
    }).progress;
  }, [activePlan, activeState, settings, examAttempts]);

  const criticalPath = useMemo<CriticalPathResult>(() => {
    if (!activePlan) {
      return { chain: [], length: 0, estimatedTerms: 0 };
    }
    return calculateCriticalPath(activeState, activePlan, settings.includeAnalistaTrack);
  }, [activePlan, activeState, settings.includeAnalistaTrack]);

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
        const subjectObj = subjectsById.get(id);
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
    subjectsById,
  ]);

  const exportData = useCallback((): string => {
    return exportCareerToJson(userState, settings, semesterBasket, assignedElectives, {
      scheduleDrafts,
      scheduleSelections,
      customSchedules: customSchedules || undefined,
      scheduleTerm,
      enrollments,
      examAttempts,
      planId: activePlan?.plan.id,
      planTag: planConfig?.shortTag || activePlan?.plan.name,
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
    examAttempts,
    activePlan,
    planConfig,
  ]);

  const importData = useCallback(
    (json: string): { success: boolean; error?: string } => {
      const result = importCareerFromJson(json, {
        validElectiveIds,
        electives,
        totalLevels,
        planId: activePlan?.plan.id,
      });
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
        if (result.examAttempts) setExamAttempts(result.examAttempts);

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
    [isAuthenticated, reloadServerState, validElectiveIds, electives, totalLevels, activePlan]
  );

  const resetAll = useCallback(() => {
    const pId = activePlan?.plan.id;
    const emptyElectives = buildEmptyAssignedElectives(totalLevels);
    clearCareerData(pId);
    setUserState({});
    setSemesterBasket([]);
    setAssignedElectives(emptyElectives);
    setScheduleSelections({});
    setScheduleDrafts([]);
    setCustomSchedules(null);
    setEnrollments([]);
    setExamAttempts([]);
    setSettings(loadSettings(pId));
    soundManager.playClick();

    if (isAuthenticated) {
      setSyncStatus('saving');
      userStateApi
        .importLegacyData({
          userState: {},
          basket: [],
          assignedElectives: emptyElectives,
          scheduleSelections: {},
        })
        .then(() => setSyncStatus('saved'))
        .catch(() => setSyncStatus('error'));
    }
  }, [isAuthenticated, activePlan, totalLevels]);

  const loadSample = useCallback(() => {
    const sample = getSampleStudentForPlan(activePlan);
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
  }, [isAuthenticated, activePlan, refreshReviewableSummary]);

  // Interactive Tour controls
  const startTutorial = useCallback((fromStep: number = 0) => {
    realUserStateBackupRef.current = { ...userState };
    setCurrentTutorialStep(fromStep);
    setIsTutorialOpen(true);
    soundManager.playClick();
  }, [userState]);

  const closeTutorial = useCallback((options?: { openOnboarding?: boolean }) => {
    setIsTutorialOpen(false);
    setIsMoreMenuOpen(false);
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
      const isSchedAvail = typeof window !== 'undefined'
        ? getScheduleAvailability(window.innerWidth, window.innerHeight) === 'available'
        : true;
      const steps = getAvailableTutorialSteps(isSchedAvail);
      if (prev < steps.length - 1) {
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
    const isSchedAvail = typeof window !== 'undefined'
      ? getScheduleAvailability(window.innerWidth, window.innerHeight) === 'available'
      : true;
    const steps = getAvailableTutorialSteps(isSchedAvail);
    setCurrentTutorialStep(Math.max(0, Math.min(steps.length - 1, step)));
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
        isMoreMenuOpen,
        setIsMoreMenuOpen,
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
        scheduleStatus,
        scheduleError,
        retryLoadSchedule,
        scheduleTerm,
        setScheduleTerm,
        applyScheduleToEnrolled,
        enrollments,
        getSubjectEnrollments,
        saveSubjectEnrollment,
        deleteSubjectEnrollment,
        examAttempts,
        getSubjectExamAttempts,
        saveExamAttempt,
        deleteExamAttempt,
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
        activePlan,
        activeCareer,
        planConfig,
        planRules,
        coreSubjects,
        electives,
        allSubjects,
        subjectsById,
        acronyms,
        requiredElectiveCredits,
        totalLevels,
        levelLabel,
        catalogStatus,
        isWakingCatalogServer,
        catalogError,
        retryLoadCatalog,
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
