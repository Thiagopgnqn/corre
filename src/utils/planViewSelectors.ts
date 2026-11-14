import type {
  AssignedElectivesByYear,
  CareerProgress,
  PlanCareerMeta,
  PlanConfig,
  Subject,
  SubjectStatus,
  UserCareerState,
} from '../types/career';
import {
  checkEligibility,
  getActiveCoreSubjects,
  getSubjectStatus,
} from './correlativas';
import {
  getDemoOnboardingLabel,
  getElectivesAddModalTitle,
  getElectivesAllLevelsChipLabel,
  getElectivesAssignedHeading,
  getElectivesEmptyAssignedText,
  getElectivesHeaderSubtitle,
  getElectivesHeaderTitle,
  getElectivesMoveSelectTitle,
  getElectivesOnePerLevelFooterNote,
  getElectivesRemoveBtnTitle,
  getElectivesSuggestedLevelsFootnote,
  getKanbanBoardSubtitle,
  getKanbanLevelsRangeTag,
  getLevelNumbers,
  getLevelOrdinalTabLabel,
  getSearchModalDesktopPlaceholder,
  getSubjectNodeLevelBadge,
} from './planText';

// ── 1. CorrelativeGraph Structure ───────────────────────────────────────────

export interface GraphColumnDescriptor {
  level: number;
  label: string;
  x: number;
}

export interface GraphNodeLayoutItem {
  subject: Subject;
  id: string;
  code: string;
  name: string;
  level: number;
  targetCol: number;
  colIndex: number;
  position: { x: number; y: number };
  status: SubjectStatus;
  grade?: number;
  isElective: boolean;
  isIntegrator: boolean;
  assignedYear?: number;
}

export interface GraphEdgeLayoutItem {
  id: string;
  source: string;
  target: string;
  type: 'regular' | 'approved';
}

export interface GraphViewStructure {
  totalLevels: number;
  columns: GraphColumnDescriptor[];
  showElectivesToggle: boolean;
  activeSubjects: Subject[];
  nodesLayout: GraphNodeLayoutItem[];
  edgesLayout: GraphEdgeLayoutItem[];
  initialViewport: { x: number; y: number; zoom: number };
  dynamicTranslateExtent: [[number, number], [number, number]];
  isDegreeComplete: boolean;
  sampleSubjectId: number;
}

const NODE_COL_START_X = 50;
const NODE_COL_STEP_X = 330;
const NODE_ROW_START_Y = 80;
const NODE_ROW_STEP_Y = 155;

export function buildGraphViewStructure(params: {
  planConfig?: Partial<PlanConfig> | null;
  coreSubjects: Subject[];
  electives: Subject[];
  activeState: UserCareerState;
  includeIntermediateTrack: boolean;
  showElectivesInGraph: boolean;
  assignedElectives: AssignedElectivesByYear;
  screenWidth?: number;
}): GraphViewStructure {
  const {
    planConfig,
    coreSubjects,
    electives,
    activeState,
    includeIntermediateTrack,
    showElectivesInGraph,
    assignedElectives,
    screenWidth = 390,
  } = params;

  const levels = getLevelNumbers(planConfig);
  const totalLevels = levels.length;
  const levelLabel = (planConfig?.levelLabel ?? '').trim() || 'Año';

  const columns: GraphColumnDescriptor[] = levels.map((level, idx) => ({
    level,
    label: `${level}° ${levelLabel}`,
    x: NODE_COL_START_X + idx * NODE_COL_STEP_X,
  }));

  const showElectivesToggle =
    electives.length > 0 || (planConfig?.requiredElectiveCredits ?? 0) > 0;

  const core = getActiveCoreSubjects(coreSubjects, includeIntermediateTrack);
  let activeSubjects: Subject[] = core;

  if (showElectivesToggle && showElectivesInGraph) {
    const yearByElective = new Map<number, number>();
    for (const lvl of levels) {
      (assignedElectives[lvl] || []).forEach((id) => yearByElective.set(id, lvl));
    }

    const electivesWithAssignedYear: Subject[] = electives.map((el) => ({
      ...el,
      assignedYear: yearByElective.get(el.id),
    }));

    activeSubjects = [...core, ...electivesWithAssignedYear];
  }

  const xByCol = new Map(columns.map((c) => [c.level, c.x]));
  const levelCounts: Record<number, number> = {};
  for (const lvl of levels) {
    levelCounts[lvl] = 0;
  }

  const nodesLayout: GraphNodeLayoutItem[] = activeSubjects.map((subject) => {
    const rawCol =
      subject.assignedYear && subject.assignedYear >= 1 && subject.assignedYear <= totalLevels
        ? subject.assignedYear
        : subject.level;
    const targetCol = Math.min(totalLevels, Math.max(1, rawCol));
    const colIndex = levelCounts[targetCol] || 0;
    levelCounts[targetCol] = colIndex + 1;

    const x = xByCol.get(targetCol) ?? NODE_COL_START_X + (targetCol - 1) * NODE_COL_STEP_X;
    const y = NODE_ROW_START_Y + colIndex * NODE_ROW_STEP_Y;

    const status = getSubjectStatus(subject, activeState);
    const grade = activeState[subject.id]?.grade;

    return {
      subject,
      id: String(subject.id),
      code: subject.code,
      name: subject.name,
      level: subject.level,
      targetCol,
      colIndex,
      position: { x, y },
      status,
      grade,
      isElective: Boolean(subject.isElective),
      isIntegrator: Boolean(subject.isIntegrator),
      assignedYear: subject.assignedYear,
    };
  });

  const displayedIds = new Set(activeSubjects.map((s) => s.id));
  const edgesLayout: GraphEdgeLayoutItem[] = [];
  activeSubjects.forEach((subject) => {
    subject.regularPrereqs.forEach((reqId) => {
      if (!displayedIds.has(reqId)) return;
      edgesLayout.push({
        id: `reg-${reqId}-${subject.id}`,
        source: String(reqId),
        target: String(subject.id),
        type: 'regular',
      });
    });
    subject.approvedPrereqs.forEach((reqId) => {
      if (!displayedIds.has(reqId)) return;
      edgesLayout.push({
        id: `apr-${reqId}-${subject.id}`,
        source: String(reqId),
        target: String(subject.id),
        type: 'approved',
      });
    });
  });

  if (nodesLayout.length === 0) {
    return {
      totalLevels,
      columns,
      showElectivesToggle,
      activeSubjects,
      nodesLayout,
      edgesLayout,
      initialViewport: { x: 50, y: 120, zoom: 0.78 },
      dynamicTranslateExtent: [
        [-400, -200],
        [3200, 2200],
      ],
      isDegreeComplete: false,
      sampleSubjectId: coreSubjects[0]?.id ?? 1,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  nodesLayout.forEach((n) => {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.x > maxX) maxX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.y > maxY) maxY = n.position.y;
  });

  const NODE_WIDTH = 240;
  const NODE_HEIGHT = 120;
  const MARGIN_X = 300;
  const MARGIN_Y = 250;

  const dynamicTranslateExtent: [[number, number], [number, number]] = [
    [Math.round(minX - MARGIN_X), Math.round(minY - MARGIN_Y)],
    [Math.round(maxX + NODE_WIDTH + MARGIN_X), Math.round(maxY + NODE_HEIGHT + MARGIN_Y)],
  ];

  const cursandoNodes = nodesLayout.filter((n) => n.status === 'cursando');
  const unapprovedNodes = nodesLayout.filter(
    (n) => n.status !== 'aprobada' && n.status !== 'promocionada'
  );
  const isDegreeComplete = cursandoNodes.length === 0 && unapprovedNodes.length === 0;

  let targetNodes: GraphNodeLayoutItem[] = [];
  if (cursandoNodes.length > 0) {
    const yearBuckets = new Map<number, GraphNodeLayoutItem[]>();
    cursandoNodes.forEach((n) => {
      const yr = n.level || 1;
      const bucket = yearBuckets.get(yr) || [];
      bucket.push(n);
      yearBuckets.set(yr, bucket);
    });

    let bestYear = 1;
    let maxCount = -1;
    Array.from(yearBuckets.keys())
      .sort((a, b) => a - b)
      .forEach((yr) => {
        const count = yearBuckets.get(yr)!.length;
        if (count > maxCount) {
          maxCount = count;
          bestYear = yr;
        }
      });

    targetNodes = yearBuckets.get(bestYear) || cursandoNodes;
  } else if (unapprovedNodes.length > 0) {
    const minYear = Math.min(...unapprovedNodes.map((n) => n.level || 1));
    targetNodes = unapprovedNodes.filter((n) => (n.level || 1) === minYear);
  }

  if (targetNodes.length === 0) {
    targetNodes = nodesLayout.filter((n) => (n.level || 1) === 1);
  }
  if (targetNodes.length === 0) {
    targetNodes = [nodesLayout[0]];
  }

  let tMinX = Infinity;
  let tMaxX = -Infinity;
  let tMinY = Infinity;
  targetNodes.forEach((n) => {
    if (n.position.x < tMinX) tMinX = n.position.x;
    if (n.position.x > tMaxX) tMaxX = n.position.x;
    if (n.position.y < tMinY) tMinY = n.position.y;
  });

  const zoom = 0.78;
  const targetCenterX = (tMinX + tMaxX + NODE_WIDTH) / 2;
  const calcX = Math.round(screenWidth / 2 - targetCenterX * zoom);
  const calcY = Math.round(140 - tMinY * zoom);

  const topTargetNode = [...targetNodes].sort((a, b) => a.position.y - b.position.y)[0];
  const sampleSubjectId = topTargetNode
    ? topTargetNode.subject.id
    : activeSubjects[0]?.id ?? 1;

  return {
    totalLevels,
    columns,
    showElectivesToggle,
    activeSubjects,
    nodesLayout,
    edgesLayout,
    initialViewport: { x: calcX, y: calcY, zoom },
    dynamicTranslateExtent,
    isDegreeComplete,
    sampleSubjectId,
  };
}

// ── 2. SubjectListView Structure ────────────────────────────────────────────

export interface SubjectListItemModel {
  subject: Subject;
  status: SubjectStatus;
  grade?: number;
  isBlocked: boolean;
  missingRegularNames: string[];
  missingApprovedNames: string[];
}

export interface SubjectListLevelGroup {
  level: number;
  shortBadge: string;
  title: string;
  summaryLabel: string;
  total: number;
  approvedCount: number;
  percentage: number;
  items: SubjectListItemModel[];
}

export function buildSubjectListViewStructure(params: {
  subjects: Subject[];
  activeState: UserCareerState;
  subjectsById: Map<number, Subject>;
  planConfig?: Partial<PlanConfig> | null;
  isSimulationActive?: boolean;
  checkEligibilityFn?: typeof checkEligibility;
}): SubjectListLevelGroup[] {
  const {
    subjects,
    activeState,
    subjectsById,
    planConfig,
    isSimulationActive = false,
    checkEligibilityFn = checkEligibility,
  } = params;

  const map = new Map<number, Subject[]>();
  for (const lvl of getLevelNumbers(planConfig)) {
    map.set(lvl, []);
  }

  subjects.forEach((s) => {
    const list = map.get(s.level) || [];
    list.push(s);
    map.set(s.level, list);
  });

  return Array.from(map.entries())
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => a - b)
    .map(([level, levelSubjects]) => {
      const total = levelSubjects.length;
      const items: SubjectListItemModel[] = levelSubjects.map((subject) => {
        const status = getSubjectStatus(subject, activeState);
        const grade = activeState[subject.id]?.grade;
        const eligibility = checkEligibilityFn(subject, activeState);
        const missingRegularNames = eligibility.missingRegular
          .map((id) => subjectsById.get(id)?.name)
          .filter((n): n is string => Boolean(n));
        const missingApprovedNames = eligibility.missingApproved
          .map((id) => subjectsById.get(id)?.name)
          .filter((n): n is string => Boolean(n));
        const isBlocked = status === 'bloqueada' && !isSimulationActive;

        return {
          subject,
          status,
          grade,
          isBlocked,
          missingRegularNames,
          missingApprovedNames,
        };
      });

      const approvedCount = items.filter(
        (item) => item.status === 'aprobada' || item.status === 'promocionada'
      ).length;
      const percentage = total > 0 ? Math.round((approvedCount / total) * 100) : 0;

      return {
        level,
        shortBadge: `${level}°`,
        title: getLevelOrdinalTabLabel(level, planConfig),
        summaryLabel: `(${approvedCount}/${total} aprobadas)`,
        total,
        approvedCount,
        percentage,
        items,
      };
    });
}

// ── 3. SubjectNode ViewModel ────────────────────────────────────────────────

export interface SubjectNodeViewModel {
  codeBadge: string;
  levelBadge: string;
  modalityBadge: string;
  showIntegratorBadge: boolean;
  integratorLabel: string;
  showElectiveBadge: boolean;
  electiveLabel: string;
  hoursLabel: string;
  creditsBadge: string | null;
  showGradeBadge: boolean;
  gradeBadge: string | null;
}

export function buildSubjectNodeViewModel(
  subject: Pick<
    Subject,
    'code' | 'level' | 'assignedYear' | 'modality' | 'isIntegrator' | 'isElective' | 'weeklyHours' | 'credits'
  >,
  status: SubjectStatus,
  grade?: number,
  planConfig?: Partial<PlanConfig> | null
): SubjectNodeViewModel {
  const showGradeBadge =
    grade !== undefined && (status === 'aprobada' || status === 'promocionada');

  return {
    codeBadge: `#${subject.code}`,
    levelBadge: getSubjectNodeLevelBadge(subject, planConfig),
    modalityBadge: subject.modality,
    showIntegratorBadge: Boolean(subject.isIntegrator),
    integratorLabel: 'INT',
    showElectiveBadge: Boolean(subject.isElective),
    electiveLabel: 'ELECT',
    hoursLabel: `${subject.weeklyHours} hs`,
    creditsBadge: subject.credits ? `(${subject.credits}cr)` : null,
    showGradeBadge,
    gradeBadge: showGradeBadge ? `Nota: ${grade}` : null,
  };
}

// ── 4. KanbanBoard Structure ────────────────────────────────────────────────

export interface KanbanColumnInput {
  id: SubjectStatus;
  title: string;
  shortTitle: string;
  filterFn: (status: SubjectStatus) => boolean;
}

export interface KanbanColumnGroup extends KanbanColumnInput {
  subjects: Subject[];
  count: number;
}

export interface KanbanLevelGroup {
  level: number;
  badge: string;
  title: string;
  progressText: string;
  subjects: Subject[];
  approvedCount: number;
  total: number;
  percent: number;
}

export interface KanbanBoardStructure {
  subtitle: string;
  levelsRangeTag: string;
  levels: number[];
  levelFilterOptions: Array<{ value: number | 'all'; label: string }>;
  activeCorePool: Subject[];
  filteredSubjects: Subject[];
  columns: KanbanColumnGroup[];
  levelGroups: KanbanLevelGroup[];
}

export const DEFAULT_KANBAN_COLUMN_DEFS: KanbanColumnInput[] = [
  {
    id: 'disponible',
    title: 'Pendiente / Disponible',
    shortTitle: 'Pendientes',
    filterFn: (st) => st === 'bloqueada' || st === 'disponible',
  },
  {
    id: 'cursando',
    title: 'Cursando',
    shortTitle: 'Cursando',
    filterFn: (st) => st === 'cursando',
  },
  {
    id: 'regularizada',
    title: 'Regularizada (Final pendiente)',
    shortTitle: 'Regularizadas',
    filterFn: (st) => st === 'regularizada',
  },
  {
    id: 'aprobada',
    title: 'Aprobada / Promocionada',
    shortTitle: 'Aprobadas',
    filterFn: (st) => st === 'aprobada' || st === 'promocionada',
  },
];

export function buildKanbanBoardStructure(params: {
  coreSubjects: Subject[];
  activeState: UserCareerState;
  includeIntermediateTrack: boolean;
  levelFilter: number | 'all';
  planConfig?: Partial<PlanConfig> | null;
  columnDefs?: KanbanColumnInput[];
}): KanbanBoardStructure {
  const {
    coreSubjects,
    activeState,
    includeIntermediateTrack,
    levelFilter,
    planConfig,
    columnDefs = DEFAULT_KANBAN_COLUMN_DEFS,
  } = params;

  const levels = getLevelNumbers(planConfig);
  const levelFilterOptions: Array<{ value: number | 'all'; label: string }> = [
    { value: 'all', label: 'Todos' },
    ...levels.map((lvl) => ({ value: lvl, label: `${lvl}°` })),
  ];

  const activeCorePool = getActiveCoreSubjects(coreSubjects, includeIntermediateTrack);
  const filteredSubjects = activeCorePool.filter((s) =>
    levelFilter === 'all' ? true : s.level === levelFilter
  );

  const columns: KanbanColumnGroup[] = columnDefs.map((col) => {
    const colSubjects = filteredSubjects.filter((s) =>
      col.filterFn(getSubjectStatus(s, activeState))
    );
    return {
      ...col,
      subjects: colSubjects,
      count: colSubjects.length,
    };
  });

  const levelGroups: KanbanLevelGroup[] = levels.map((lvl) => {
    const lvlSubjects = activeCorePool.filter((s) => s.level === lvl);
    const approvedCount = lvlSubjects.filter((s) => {
      const st = getSubjectStatus(s, activeState);
      return st === 'aprobada' || st === 'promocionada';
    }).length;
    const total = lvlSubjects.length;
    const percent = total > 0 ? Math.round((approvedCount / total) * 100) : 0;

    return {
      level: lvl,
      badge: `${lvl}°`,
      title: `Nivel ${lvl}`,
      progressText: `${approvedCount} de ${total} materias aprobadas (${percent}%)`,
      subjects: lvlSubjects,
      approvedCount,
      total,
      percent,
    };
  });

  return {
    subtitle: getKanbanBoardSubtitle(planConfig),
    levelsRangeTag: getKanbanLevelsRangeTag(planConfig),
    levels,
    levelFilterOptions,
    activeCorePool,
    filteredSubjects,
    columns,
    levelGroups,
  };
}

// ── 5. SemesterPlanner Structure ────────────────────────────────────────────

export interface SemesterPlannerWorkloadInfo {
  label: string;
  color: string;
  bg: string;
}

export interface SemesterPlannerStructure {
  showIncludeElectivesToggle: boolean;
  availableSubjects: Subject[];
  availableCount: number;
  basketSubjects: Subject[];
  basketCount: number;
  totalWeeklyHours: number;
  workloadInfo: SemesterPlannerWorkloadInfo;
}

export function buildSemesterPlannerStructure(params: {
  coreSubjects: Subject[];
  electives: Subject[];
  activeState: UserCareerState;
  subjectsById: Map<number, Subject>;
  semesterBasket: number[];
  includeIntermediateTrack: boolean;
  includeElectives: boolean;
  termFilter: 'all' | '1C' | '2C' | 'A';
  planConfig?: Partial<PlanConfig> | null;
}): SemesterPlannerStructure {
  const {
    coreSubjects,
    electives,
    activeState,
    subjectsById,
    semesterBasket,
    includeIntermediateTrack,
    includeElectives,
    termFilter,
    planConfig,
  } = params;

  const showIncludeElectivesToggle =
    electives.length > 0 || (planConfig?.requiredElectiveCredits ?? 0) > 0;

  const core = getActiveCoreSubjects(coreSubjects, includeIntermediateTrack);
  const pool =
    showIncludeElectivesToggle && includeElectives ? [...core, ...electives] : core;

  const availableSubjects = pool.filter((s) => {
    const status = getSubjectStatus(s, activeState);
    if (status !== 'disponible') return false;

    if (termFilter === 'all') return true;
    if (termFilter === 'A') return s.modality === 'A';
    if (termFilter === '1C') return s.modality.includes('1C') || s.modality === 'A';
    if (termFilter === '2C') return s.modality.includes('2C') || s.modality === 'A';
    return true;
  });

  const basketSubjects = semesterBasket
    .map((id) => subjectsById.get(id))
    .filter((s): s is Subject => Boolean(s));

  const totalWeeklyHours = basketSubjects.reduce((acc, s) => acc + s.weeklyHours, 0);

  let workloadInfo: SemesterPlannerWorkloadInfo;
  if (totalWeeklyHours === 0) {
    workloadInfo = { label: 'Sin materias seleccionadas', color: 'text-slate-400', bg: 'bg-slate-800' };
  } else if (totalWeeklyHours <= 14) {
    workloadInfo = {
      label: 'Carga Liviana (fácil de llevar)',
      color: 'text-emerald-400',
      bg: 'bg-emerald-950/70 border-emerald-500/40',
    };
  } else if (totalWeeklyHours <= 22) {
    workloadInfo = {
      label: 'Carga Recomendada (ritmo estándar)',
      color: 'text-cyan-400',
      bg: 'bg-cyan-950/70 border-cyan-500/40',
    };
  } else if (totalWeeklyHours <= 28) {
    workloadInfo = {
      label: 'Carga Intensa (exigente pero alcanzable)',
      color: 'text-amber-400',
      bg: 'bg-amber-950/70 border-amber-500/40',
    };
  } else {
    workloadInfo = {
      label: 'Carga Muy Pesada (cuidado con superposición)',
      color: 'text-rose-400',
      bg: 'bg-rose-950/70 border-rose-500/40',
    };
  }

  return {
    showIncludeElectivesToggle,
    availableSubjects,
    availableCount: availableSubjects.length,
    basketSubjects,
    basketCount: basketSubjects.length,
    totalWeeklyHours,
    workloadInfo,
  };
}

// ── 6. ElectivesPicker Structure ────────────────────────────────────────────

export interface ElectivesYearSection {
  year: number;
  badge: string;
  tabLabel: string;
  heading: string;
  emptyText: string;
  summaryText: string;
  assignedSubjects: Subject[];
  yearTotalCredits: number;
}

export interface ElectivesSuggestedLevelGroup {
  level: number;
  heading: string;
  electives: Subject[];
}

export interface ElectivesPickerStructure {
  hasElectivesBlock: boolean;
  years: number[];
  headerTitle: string;
  headerSubtitle: string;
  allLevelsChipLabel: string;
  onePerLevelFooterNote: string;
  moveSelectTitle: string;
  removeBtnTitle: string;
  footnote: string;
  requiredElectiveCredits: number;
  progressPercent: number;
  progressBarWidthPercent: number;
  yearSections: ElectivesYearSection[];
  filteredElectives: Subject[];
  filteredElectivesCount: number;
  totalElectivesCount: number;
  suggestedLevels: number[];
  suggestedLevelGroups: ElectivesSuggestedLevelGroup[];
  modalTitleForYear: (year: number) => string;
}

export function buildElectivesPickerStructure(params: {
  electives: Subject[];
  planConfig?: Partial<PlanConfig> | null;
  career?: Partial<PlanCareerMeta> | null;
  assignedElectives: AssignedElectivesByYear;
  computedProgress: Pick<
    CareerProgress,
    'totalElectiveCreditsApproved' | 'totalElectiveCreditsTaking' | 'missingElectiveCreditsForDegree'
  >;
  modalSearch: string;
}): ElectivesPickerStructure {
  const {
    electives,
    planConfig,
    career,
    assignedElectives,
    computedProgress,
    modalSearch,
  } = params;

  const years = getLevelNumbers(planConfig);
  const requiredElectiveCredits = planConfig?.requiredElectiveCredits ?? 0;
  const hasElectivesBlock = electives.length > 0 || requiredElectiveCredits > 0;

  const progressPercent =
    requiredElectiveCredits > 0
      ? Math.min(
          100,
          Math.round((computedProgress.totalElectiveCreditsApproved / requiredElectiveCredits) * 100)
        )
      : 0;
  const progressBarWidthPercent =
    requiredElectiveCredits > 0
      ? Math.min(100, (computedProgress.totalElectiveCreditsApproved / requiredElectiveCredits) * 100)
      : 0;

  const yearSections: ElectivesYearSection[] = years.map((year) => {
    const assignedIds = assignedElectives[year] || [];
    const assignedSubjects = assignedIds
      .map((id) => electives.find((e) => e.id === id))
      .filter((e): e is Subject => Boolean(e));
    const yearTotalCredits = assignedSubjects.reduce(
      (acc, curr) => acc + (curr.credits ?? 0),
      0
    );

    return {
      year,
      badge: `${year}°`,
      tabLabel: getLevelOrdinalTabLabel(year, planConfig),
      heading: getElectivesAssignedHeading(year, planConfig),
      emptyText: getElectivesEmptyAssignedText(year, planConfig),
      summaryText:
        assignedSubjects.length === 0
          ? 'Sin electivas asignadas todavía'
          : `${assignedSubjects.length} electiva${assignedSubjects.length > 1 ? 's' : ''} • ${yearTotalCredits} créditos planificados`,
      assignedSubjects,
      yearTotalCredits,
    };
  });

  const q = modalSearch.toLowerCase().trim();
  const levelLabelLower = ((planConfig?.levelLabel ?? '').trim() || 'Año').toLowerCase();
  const filteredElectives = electives.filter((el) => {
    if (!q) return true;
    return (
      el.name.toLowerCase().includes(q) ||
      el.code.toLowerCase().includes(q) ||
      `nivel ${el.level}`.includes(q) ||
      `${levelLabelLower} ${el.level}`.includes(q)
    );
  });

  const suggestedLevels = Array.from(
    new Set(electives.map((e) => e.level).filter((lvl) => Number.isFinite(lvl) && lvl > 0))
  ).sort((a, b) => a - b);

  const suggestedLevelGroups: ElectivesSuggestedLevelGroup[] = suggestedLevels
    .map((lvl) => ({
      level: lvl,
      heading: `Electivas (Nivel Sugerido ${lvl}°)`,
      electives: filteredElectives.filter((e) => e.level === lvl),
    }))
    .filter((group) => group.electives.length > 0);

  return {
    hasElectivesBlock,
    years,
    headerTitle: getElectivesHeaderTitle(planConfig),
    headerSubtitle: getElectivesHeaderSubtitle(planConfig),
    allLevelsChipLabel: getElectivesAllLevelsChipLabel(planConfig),
    onePerLevelFooterNote: getElectivesOnePerLevelFooterNote(planConfig),
    moveSelectTitle: getElectivesMoveSelectTitle(planConfig),
    removeBtnTitle: getElectivesRemoveBtnTitle(planConfig),
    footnote: getElectivesSuggestedLevelsFootnote(electives, career),
    requiredElectiveCredits,
    progressPercent,
    progressBarWidthPercent,
    yearSections,
    filteredElectives,
    filteredElectivesCount: filteredElectives.length,
    totalElectivesCount: electives.length,
    suggestedLevels,
    suggestedLevelGroups,
    modalTitleForYear: (year: number) => getElectivesAddModalTitle(year, planConfig),
  };
}

// ── 7. OnboardingModal Structure ────────────────────────────────────────────

export interface OnboardingLevelGroup {
  level: number;
  title: string;
  countLabel: string;
  subjects: Subject[];
  allSelected: boolean;
  someSelected: boolean;
  defaultGrade: number;
}

export interface OnboardingModalStructure {
  demoButtonLabel: string;
  levels: OnboardingLevelGroup[];
  selectedCount: number;
}

export function buildOnboardingModalStructure(params: {
  coreSubjects: Subject[];
  includeIntermediateTrack: boolean;
  planConfig?: Partial<PlanConfig> | null;
  selections: Record<number, { selected: boolean; grade: number; status: SubjectStatus }>;
  defaultGradeByLevel: Record<number, number>;
}): OnboardingModalStructure {
  const {
    coreSubjects,
    includeIntermediateTrack,
    planConfig,
    selections,
    defaultGradeByLevel,
  } = params;

  const corePool = getActiveCoreSubjects(coreSubjects, includeIntermediateTrack);
  const levelNumbers = getLevelNumbers(planConfig);

  const levels: OnboardingLevelGroup[] = levelNumbers.map((level) => {
    const subjects = corePool.filter((s) => s.level === level);
    const allSelected =
      subjects.length > 0 && subjects.every((s) => Boolean(selections[s.id]?.selected));
    const someSelected = subjects.some((s) => Boolean(selections[s.id]?.selected));

    return {
      level,
      title: `Nivel ${level}`,
      countLabel: `(${subjects.length} materias)`,
      subjects,
      allSelected,
      someSelected,
      defaultGrade: defaultGradeByLevel[level] ?? 8,
    };
  });

  const selectedCount = Object.values(selections).filter((s) => s.selected).length;

  return {
    demoButtonLabel: getDemoOnboardingLabel(planConfig),
    levels,
    selectedCount,
  };
}

// ── 8. SearchModal Structure ────────────────────────────────────────────────

export interface SearchModalStructure {
  allSubjects: Subject[];
  filtered: Subject[];
  levelFilterOptions: Array<{ value: number | 'all'; label: string }>;
  statusFilterOptions: ReadonlyArray<SubjectStatus | 'all'>;
  desktopPlaceholder: string;
  countLabelMobile: string;
  countLabelDesktop: string;
}

const SEARCH_STATUS_OPTIONS: ReadonlyArray<SubjectStatus | 'all'> = [
  'all',
  'disponible',
  'cursando',
  'regularizada',
  'aprobada',
  'promocionada',
  'bloqueada',
];

export function buildSearchModalStructure(params: {
  coreSubjects: Subject[];
  electives: Subject[];
  activeState: UserCareerState;
  includeIntermediateTrack: boolean;
  query: string;
  levelFilter: number | 'all';
  statusFilter: SubjectStatus | 'all';
  planConfig?: Partial<PlanConfig> | null;
  acronyms?: Record<string, number>;
}): SearchModalStructure {
  const {
    coreSubjects,
    electives,
    activeState,
    includeIntermediateTrack,
    query,
    levelFilter,
    statusFilter,
    planConfig,
    acronyms,
  } = params;

  const core = getActiveCoreSubjects(coreSubjects, includeIntermediateTrack);
  const allSubjects = [...core, ...electives];

  const q = query.toLowerCase();
  const filtered = allSubjects.filter((subject) => {
    const matchesQuery =
      subject.name.toLowerCase().includes(q) || subject.code.toLowerCase().includes(q);
    if (!matchesQuery) return false;

    if (levelFilter !== 'all' && subject.level !== levelFilter) {
      return false;
    }

    if (statusFilter !== 'all') {
      const status = getSubjectStatus(subject, activeState);
      if (status !== statusFilter) return false;
    }

    return true;
  });

  const levels = getLevelNumbers(planConfig);
  const levelFilterOptions: Array<{ value: number | 'all'; label: string }> = [
    { value: 'all', label: 'Todos' },
    ...levels.map((lvl) => ({ value: lvl, label: `${lvl}°` })),
  ];

  return {
    allSubjects,
    filtered,
    levelFilterOptions,
    statusFilterOptions: SEARCH_STATUS_OPTIONS,
    desktopPlaceholder: getSearchModalDesktopPlaceholder(allSubjects, acronyms),
    countLabelMobile: `${filtered.length} ${filtered.length === 1 ? 'materia encontrada' : 'materias encontradas'}`,
    countLabelDesktop: `${filtered.length} materias encontradas`,
  };
}
