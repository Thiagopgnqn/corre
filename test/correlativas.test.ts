import { CORE_SUBJECTS } from '../src/data/plan2023';
import {
  ELECTIVES,
  REQUIRED_ELECTIVE_CREDITS_TOTAL,
  ELECTIVE_SLOTS_EQUIVALENT,
} from '../src/data/electives';
import { ACRONYM_TO_ID } from '../src/data/acronyms';
import {
  getSubjectStatus,
  canRenderSeminario,
  canRenderProyectoFinal,
  checkAnalistaTitle,
  isPPSEligible,
  getUnlockedBySubject,
  calculateProgressBreakdown,
} from '../src/utils/correlativas';
import { calculateCriticalPath } from '../src/utils/criticalPath';
import { sanitizeAssignedElectives, migrateLegacyElectives } from '../src/utils/storage';
import type { UserCareerState } from '../src/types/career';

function assert(cond: boolean, message: string) {
  if (!cond) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('Running pure logic tests for Plan 2023 ISI UTN...');

// 1. Acronym verification: DDS must be ID 20 (Desarrollo de Software, NOT 23)
assert(ACRONYM_TO_ID.DDS === 20, 'DDS must map to ID 20 (Desarrollo de Software)');
assert(ACRONYM_TO_ID.AED === 6, 'AED must map to ID 6');
assert(ACRONYM_TO_ID.SSL === 13, 'SSL must map to ID 13');
assert(ACRONYM_TO_ID.PPR === 14, 'PPR must map to ID 14');
assert(ACRONYM_TO_ID.SPN === 8, 'SPN must map to ID 8');
assert(ACRONYM_TO_ID.ASI === 16, 'ASI must map to ID 16');
assert(ACRONYM_TO_ID.BDA === 19, 'BDA must map to ID 19');
assert(ACRONYM_TO_ID.RDA === 26, 'RDA must map to ID 26');
assert(ACRONYM_TO_ID.ADM === 30, 'ADM must map to ID 30');
assert(ACRONYM_TO_ID.IOP === 27, 'IOP must map to ID 27');
assert(ACRONYM_TO_ID.ICS === 25, 'ICS must map to ID 25');

// 2. Level 1 subjects should have 0 requirements and be immediately 'disponible' on empty state
const emptyState: UserCareerState = {};
const am1 = CORE_SUBJECTS.find((s) => s.id === 1)!;
assert(am1.regularPrereqs.length === 0, 'AM1 has 0 reg prereqs');
assert(am1.approvedPrereqs.length === 0, 'AM1 has 0 apr prereqs');
assert(getSubjectStatus(am1, emptyState) === 'disponible', 'AM1 is disponible on empty state');

// 3. Level 2: AM2 (id 9) requires reg [1, 2]
const am2 = CORE_SUBJECTS.find((s) => s.id === 9)!;
assert(getSubjectStatus(am2, emptyState) === 'bloqueada', 'AM2 is locked when 1 and 2 are not done');

const stateWith1and2Reg: UserCareerState = {
  1: { status: 'regularizada' },
  2: { status: 'regularizada' },
};
assert(getSubjectStatus(am2, stateWith1and2Reg) === 'disponible', 'AM2 is available when 1 and 2 are regularized');

// 4. Level 3: Economia (id 18) requires approved [1, 2]
const econ = CORE_SUBJECTS.find((s) => s.id === 18)!;
assert(getSubjectStatus(econ, stateWith1and2Reg) === 'bloqueada', 'Economia requires approved, so regularized is not enough');

const stateWith1and2Apr: UserCareerState = {
  1: { status: 'aprobada', grade: 8 },
  2: { status: 'promocionada', grade: 9 },
};
assert(getSubjectStatus(econ, stateWith1and2Apr) === 'disponible', 'Economia is available when 1 and 2 are approved/promoted');

// 5. Special rule: Seminario Integrador 99 requires approved all 1..23 to render
const semCheck1 = canRenderSeminario(emptyState);
assert(!semCheck1.canRender && semCheck1.missingIds.length === 23, 'Seminario requires 23 subjects approved');

const stateWithAll1to23: UserCareerState = {};
for (let i = 1; i <= 23; i++) {
  stateWithAll1to23[i] = { status: 'aprobada', grade: 8 };
}
const semCheck2 = canRenderSeminario(stateWithAll1to23);
assert(semCheck2.canRender && semCheck2.missingIds.length === 0, 'Seminario can render when all 1..23 are approved');

// 6. Proyecto Final (ID 36) with Analista Active vs Inactive
// Prepare state where all core subjects 1 to 35 are approved, but 99 is NOT approved
const stateWith1to35Approved: UserCareerState = {};
CORE_SUBJECTS.forEach((s) => {
  if (s.id !== 36 && s.id !== 99) {
    stateWith1to35Approved[s.id] = { status: 'aprobada', grade: 9 };
  }
});

// A) When Analista is INACTIVE (false): PF rendering does NOT require 99
const pfAnalistaOff = canRenderProyectoFinal(stateWith1to35Approved, false);
assert(pfAnalistaOff.canRender === true, 'Proyecto Final can be rendered when Analista is OFF and 1..35 are approved');
assert(!pfAnalistaOff.missingIds.includes(99), 'Missing IDs must NOT include 99 when Analista track is disabled');

// B) When Analista is ACTIVE (true): PF rendering DOES require 99
const pfAnalistaOn = canRenderProyectoFinal(stateWith1to35Approved, true);
assert(pfAnalistaOn.canRender === false, 'Proyecto Final CANNOT be rendered when Analista is ON and 99 is unapproved');
assert(pfAnalistaOn.missingIds.includes(99), 'Missing IDs MUST include 99 when Analista track is enabled');

// Once 99 is approved, PF can render with Analista ON
const stateWith1to35And99Approved: UserCareerState = {
  ...stateWith1to35Approved,
  99: { status: 'aprobada', grade: 10 },
};
const pfAnalistaOnWith99 = canRenderProyectoFinal(stateWith1to35And99Approved, true);
assert(pfAnalistaOnWith99.canRender === true, 'Proyecto Final can render when 99 is approved with Analista ON');

// 7. Electives: Backend de Aplicaciones (301) requires reg [14, 13] and apr [6]
const backendElective = ELECTIVES.find((e) => e.id === 301)!;
assert(backendElective.regularPrereqs.includes(ACRONYM_TO_ID.PPR), 'Backend requires PPR');
assert(backendElective.regularPrereqs.includes(ACRONYM_TO_ID.SSL), 'Backend requires SSL');
assert(backendElective.approvedPrereqs.includes(ACRONYM_TO_ID.AED), 'Backend requires AED');

// Green Software (401) requires reg [DDS(20), BDA(19)] and apr [PPR(14), SSL(13)]
const greenSoft = ELECTIVES.find((e) => e.id === 401)!;
assert(greenSoft.regularPrereqs.includes(20), 'Green Software regularPrereqs includes DDS (20)');
assert(greenSoft.regularPrereqs.includes(19), 'Green Software regularPrereqs includes BDA (19)');

// 8. Global Elective Credits: 20 total
assert(REQUIRED_ELECTIVE_CREDITS_TOTAL === 20, 'Required elective credits total must be 20');

// Analista title requirement: any 4 elective credits (regardless of level)
const analistaCheckNoElectives = checkAnalistaTitle(stateWithAll1to23, 0);
assert(!analistaCheckNoElectives.eligible, 'Analista not eligible with 0 elective credits');

const stateWithAnalistaComplete: UserCareerState = {
  ...stateWithAll1to23,
  99: { status: 'aprobada', grade: 9 },
  503: { status: 'aprobada', grade: 8 }, // 4 credits elective (even if level 5 suggested!)
};
const analistaCheckWithL5Elective = checkAnalistaTitle(stateWithAnalistaComplete, 4);
assert(analistaCheckWithL5Elective.eligible, 'Analista title eligible with any 4 elective credits + 1..23 + 99');

// 9. Validation against duplicate electives across years
const rawDuplicateState: Record<number, number[]> = {
  1: [301],
  2: [],
  3: [301, 401], // 301 appears in year 1 and year 3
  4: [401],      // 401 appears in year 3 and year 4
  5: [9999],     // invalid elective id
};
const sanitized = sanitizeAssignedElectives(rawDuplicateState);
assert(sanitized[1].includes(301), '301 stays in year 1');
assert(!sanitized[3].includes(301), '301 must NOT appear in year 3 as it was already in year 1');
assert(sanitized[3].includes(401), '401 stays in year 3');
assert(!sanitized[4].includes(401), '401 must NOT appear in year 4 as it was already in year 3');
assert(!sanitized[5].includes(9999), 'Invalid elective ID 9999 is pruned');

// Total occurrences of any elective across all years must be at most 1
const allAssignedIds = Object.values(sanitized).flat();
const uniqueIds = new Set(allAssignedIds);
assert(allAssignedIds.length === uniqueIds.size, 'No elective is duplicated across years');

// 10. Migration from legacy schema or active electives in userState
const legacyUserState: UserCareerState = {
  301: { status: 'aprobada', grade: 9 }, // Nivel 3 elective
  404: { status: 'cursando' },           // Nivel 4 elective
  502: { status: 'promocionada', grade: 10 }, // Nivel 5 elective
};
const migrated = migrateLegacyElectives(legacyUserState);
assert(migrated[3].includes(301), '301 migrated into year 3 matching its suggested level');
assert(migrated[4].includes(404), '404 migrated into year 4 matching its suggested level');
assert(migrated[5].includes(502), '502 migrated into year 5 matching its suggested level');

// 11. Critical path test (Analista ON vs OFF)
const pathWithoutAnalista = calculateCriticalPath(emptyState, false);
const pathWithAnalista = calculateCriticalPath(emptyState, true);
assert(pathWithoutAnalista.length > 0, 'Critical path exists without Analista');
assert(!pathWithoutAnalista.chain.some((s) => s.id === 99), 'Critical path without Analista excludes subject 99');
console.log(`Critical path without Analista: ${pathWithoutAnalista.length} subjects (~${pathWithoutAnalista.estimatedTerms} terms)`);
console.log(`Critical path with Analista: ${pathWithAnalista.length} subjects (~${pathWithAnalista.estimatedTerms} terms)`);

// 12. PPS eligibility requires meeting Proyecto Final enrollment conditions
const ppsCheckEmpty = isPPSEligible(emptyState);
assert(!ppsCheckEmpty.eligible, 'PPS not eligible on empty state');

// 13. Unlocks check: AM1 unlocks AM2, Fisica 2, Probabilidad, Economia, Analisis Numerico
const am1Unlocks = getUnlockedBySubject(1);
assert(am1Unlocks.totalCount >= 5, 'AM1 unlocks at least 5 subjects');

// 14. Progress Breakdown: Mode "Solo obligatorias"
// Case: 18 core approved, 4 regularized, 2 taking, 12 pending out of 36 (Analista OFF)
const progressCoreOnly = calculateProgressBreakdown({
  coreApproved: 18,
  coreRegularized: 4,
  coreTaking: 2,
  corePending: 12,
  totalCore: 36,
  electiveCreditsApproved: 12,
  electiveCreditsRegularized: 3,
  electiveCreditsTaking: 3,
  includeElectives: false,
});
assert(progressCoreOnly.totalEquivalentSlots === 36, 'Core only total slots is 36');
assert(progressCoreOnly.percentageApproved === 50, '18/36 is 50%');
const sumCoreOnly =
  progressCoreOnly.percentageApproved +
  progressCoreOnly.percentageRegularized +
  progressCoreOnly.percentageTaking +
  progressCoreOnly.percentagePending;
assert(sumCoreOnly === 100, `Core only sum must be 100, got ${sumCoreOnly}`);

// 15. Progress Breakdown: Mode "Con electivas"
// Denominator without Analista: 36 + 7 = 43
// Denominator with Analista: 37 + 7 = 44
// A) 0 elective credits
const prog0cr = calculateProgressBreakdown({
  coreApproved: 18,
  coreRegularized: 0,
  coreTaking: 0,
  corePending: 18,
  totalCore: 36,
  electiveCreditsApproved: 0,
  electiveCreditsRegularized: 0,
  electiveCreditsTaking: 0,
  includeElectives: true,
  electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
});
// 18 / 43 ~ 41.86% -> rounded to 42%
assert(prog0cr.totalEquivalentSlots === 43, 'Total slots is 36 + 7 = 43');
assert(prog0cr.approvedEquivalentSlots === 18, 'Approved equivalent is 18 + 0 = 18');
assert(
  prog0cr.percentageApproved +
    prog0cr.percentageRegularized +
    prog0cr.percentageTaking +
    prog0cr.percentagePending ===
    100,
  'Sum of percentages with 0 elective credits must be 100'
);

// B) Below 20 credits: 10 credits approved (50% of 7 = 3.5 slots)
const prog10cr = calculateProgressBreakdown({
  coreApproved: 18,
  coreRegularized: 4,
  coreTaking: 2,
  corePending: 12,
  totalCore: 36,
  electiveCreditsApproved: 10,
  electiveCreditsRegularized: 0,
  electiveCreditsTaking: 6, // 6 credits taking = 2.1 slots
  includeElectives: true,
  electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
});
assert(prog10cr.totalEquivalentSlots === 43, 'Total slots with electives is 43');
assert(prog10cr.approvedEquivalentSlots === 21.5, '18 + 3.5 = 21.5 slots');
const sum10cr =
  prog10cr.percentageApproved +
  prog10cr.percentageRegularized +
  prog10cr.percentageTaking +
  prog10cr.percentagePending;
assert(sum10cr === 100, `Sum with 10cr electives must be 100, got ${sum10cr}`);

// C) Exactly 20 credits: 20 credits approved (= 7 full slots)
const prog20cr = calculateProgressBreakdown({
  coreApproved: 36,
  coreRegularized: 0,
  coreTaking: 0,
  corePending: 0,
  totalCore: 36,
  electiveCreditsApproved: 20,
  electiveCreditsRegularized: 0,
  electiveCreditsTaking: 0,
  includeElectives: true,
  electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
});
assert(prog20cr.approvedEquivalentSlots === 43, 'All 36 + 7 = 43 slots approved');
assert(prog20cr.percentageApproved === 100, 'All approved is 100%');
assert(
  prog20cr.percentageApproved +
    prog20cr.percentageRegularized +
    prog20cr.percentageTaking +
    prog20cr.percentagePending ===
    100,
  'Sum with 20cr must be 100'
);

// D) Above 20 credits (e.g. 24 credits): must be capped at 20 credits (7 slots)
const prog24cr = calculateProgressBreakdown({
  coreApproved: 18,
  coreRegularized: 2,
  coreTaking: 2,
  corePending: 14,
  totalCore: 36,
  electiveCreditsApproved: 24, // exceeding 20
  electiveCreditsRegularized: 0,
  electiveCreditsTaking: 0,
  includeElectives: true,
  electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
});
assert(prog24cr.approvedEquivalentSlots === 25, '18 + 7 = 25 (capped at 7 slots for electives)');
assert(
  prog24cr.percentageApproved +
    prog24cr.percentageRegularized +
    prog24cr.percentageTaking +
    prog24cr.percentagePending ===
    100,
  'Sum with >20cr must be 100'
);

// E) With Analista mode ON (totalCore = 37 -> total slots = 37 + 7 = 44)
const progAnalistaOn = calculateProgressBreakdown({
  coreApproved: 22,
  coreRegularized: 5,
  coreTaking: 3,
  corePending: 7,
  totalCore: 37,
  electiveCreditsApproved: 10,
  electiveCreditsRegularized: 4,
  electiveCreditsTaking: 3,
  includeElectives: true,
  electiveSlotsEquivalent: ELECTIVE_SLOTS_EQUIVALENT,
});
assert(progAnalistaOn.totalEquivalentSlots === 44, 'Total slots with Analista ON is 37 + 7 = 44');
const sumAnalista =
  progAnalistaOn.percentageApproved +
  progAnalistaOn.percentageRegularized +
  progAnalistaOn.percentageTaking +
  progAnalistaOn.percentagePending;
assert(sumAnalista === 100, `Sum with Analista ON must be 100, got ${sumAnalista}`);

// 16. Edge cases: all combinations strictly sum to 100%
const randomScenarios = [
  { cA: 0, cR: 0, cT: 0, cP: 36, eA: 0, eR: 0, eT: 0, inc: false },
  { cA: 1, cR: 1, cT: 1, cP: 33, eA: 3, eR: 3, eT: 3, inc: true },
  { cA: 35, cR: 1, cT: 0, cP: 0, eA: 19, eR: 1, eT: 0, inc: true },
  { cA: 10, cR: 10, cT: 10, cP: 6, eA: 5, eR: 5, eT: 5, inc: true },
  { cA: 37, cR: 0, cT: 0, cP: 0, eA: 30, eR: 0, eT: 0, inc: true, totalCore: 37 },
];
randomScenarios.forEach((sc, i) => {
  const res = calculateProgressBreakdown({
    coreApproved: sc.cA,
    coreRegularized: sc.cR,
    coreTaking: sc.cT,
    corePending: sc.cP,
    totalCore: sc.totalCore ?? 36,
    electiveCreditsApproved: sc.eA,
    electiveCreditsRegularized: sc.eR,
    electiveCreditsTaking: sc.eT,
    includeElectives: sc.inc,
  });
  const sum = res.percentageApproved + res.percentageRegularized + res.percentageTaking + res.percentagePending;
  assert(sum === 100, `Scenario ${i} sum must be 100, got ${sum}`);
});

console.log('ALL UNIT LOGIC TESTS (INCLUDING ELECTIVES PROGRESS BREAKDOWN & 100% SUM) PASSED SUCCESSFULLY!');
