import { CORE_SUBJECTS } from '../src/data/plan2023';
import { ELECTIVES } from '../src/data/electives';
import { ACRONYM_TO_ID } from '../src/data/acronyms';
import {
  checkEligibility,
  getSubjectStatus,
  canRenderSeminario,
  canRenderProyectoFinal,
  checkAnalistaTitle,
  isPPSEligible,
  getUnlockedBySubject,
} from '../src/utils/correlativas';
import { calculateCriticalPath } from '../src/utils/criticalPath';
import type { UserCareerState } from '../src/types/career';

function assert(cond: boolean, message: string) {
  if (!cond) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('Running pure logic tests for Plan 2023 ISI UTN...');

// 1. Level 1 subjects should have 0 requirements and be immediately 'disponible' on empty state
const emptyState: UserCareerState = {};
const am1 = CORE_SUBJECTS.find((s) => s.id === 1)!;
assert(am1.regularPrereqs.length === 0, 'AM1 has 0 reg prereqs');
assert(am1.approvedPrereqs.length === 0, 'AM1 has 0 apr prereqs');
assert(getSubjectStatus(am1, emptyState) === 'disponible', 'AM1 is disponible on empty state');

// 2. Level 2: AM2 (id 9) requires reg [1, 2]
const am2 = CORE_SUBJECTS.find((s) => s.id === 9)!;
assert(getSubjectStatus(am2, emptyState) === 'bloqueada', 'AM2 is locked when 1 and 2 are not done');

const stateWith1and2Reg: UserCareerState = {
  1: { status: 'regularizada' },
  2: { status: 'regularizada' },
};
assert(getSubjectStatus(am2, stateWith1and2Reg) === 'disponible', 'AM2 is available when 1 and 2 are regularized');

// 3. Level 3: Economia (id 18) requires approved [1, 2]
const econ = CORE_SUBJECTS.find((s) => s.id === 18)!;
assert(getSubjectStatus(econ, stateWith1and2Reg) === 'bloqueada', 'Economia requires approved, so regularized is not enough');

const stateWith1and2Apr: UserCareerState = {
  1: { status: 'aprobada', grade: 8 },
  2: { status: 'promocionada', grade: 9 },
};
assert(getSubjectStatus(econ, stateWith1and2Apr) === 'disponible', 'Economia is available when 1 and 2 are approved/promoted');

// 4. Special rule: Seminario Integrador 99 requires approved all 1..23 to render
const semCheck1 = canRenderSeminario(emptyState);
assert(!semCheck1.canRender && semCheck1.missingIds.length === 23, 'Seminario requires 23 subjects approved');

const stateWithAll1to23: UserCareerState = {};
for (let i = 1; i <= 23; i++) {
  stateWithAll1to23[i] = { status: 'aprobada', grade: 8 };
}
const semCheck2 = canRenderSeminario(stateWithAll1to23);
assert(semCheck2.canRender && semCheck2.missingIds.length === 0, 'Seminario can render when all 1..23 are approved');

// 5. Special rule: Proyecto Final 36 requires all prior subjects approved
const pfCheck1 = canRenderProyectoFinal(stateWithAll1to23);
assert(!pfCheck1.canRender, 'PF cannot render if subjects 24-35 are not approved');

// 6. Electives: Backend de Aplicaciones (301) requires reg [14, 13] and apr [6]
const backendElective = ELECTIVES.find((e) => e.id === 301)!;
assert(backendElective.regularPrereqs.includes(ACRONYM_TO_ID.PPR), 'Backend requires PPR');
assert(backendElective.regularPrereqs.includes(ACRONYM_TO_ID.SSL), 'Backend requires SSL');
assert(backendElective.approvedPrereqs.includes(ACRONYM_TO_ID.AED), 'Backend requires AED');

// 7. PPS eligibility requires meeting Proyecto Final enrollment conditions: reg [25, 26, 30] and apr [12, 20, 23]
const ppsCheckEmpty = isPPSEligible(emptyState);
assert(!ppsCheckEmpty.eligible, 'PPS not eligible on empty state');

// 8. Critical path test
const path = calculateCriticalPath(emptyState);
assert(path.length > 0, 'Critical path exists on empty state');
console.log(`Critical path length on empty state: ${path.length} subjects (~${path.estimatedTerms} terms)`);
console.log(`Chain: ${path.chain.map((s) => s.name).join(' -> ')}`);

// 9. Unlocks check: AM1 unlocks AM2, Fisica 2, Probabilidad, Economia, Analisis Numerico
const am1Unlocks = getUnlockedBySubject(1);
assert(am1Unlocks.totalCount >= 5, 'AM1 unlocks at least 5 subjects');

console.log('ALL UNIT LOGIC TESTS PASSED SUCCESSFULLY!');
