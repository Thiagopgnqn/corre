import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPlanCatalogPayload } from '../server/src/modules/catalog/planConfig.helpers';
import { TUTORIAL_STEPS, getAvailableTutorialSteps } from '../src/data/tutorialSteps';
import { APP_NAME } from '../src/config/brand';
import { evaluatePlanProgress } from '../src/utils/correlativas';
import { getSampleStudentForPlan } from '../src/utils/storage';
import {
  buildAdminPlanSubjectOptions,
  buildElectivesPickerStructure,
  buildGraphViewStructure,
  buildKanbanBoardStructure,
  buildLibraryHomeStructure,
  buildOnboardingModalStructure,
  buildProfessorsDirectoryStructure,
  buildScheduleBuilderStructure,
  buildScheduleSummaryExportMetadata,
  buildScheduleWeeklyGridSubjectLabel,
  buildSearchModalStructure,
  buildSemesterPlannerStructure,
  buildSubjectListViewStructure,
  buildSubjectNodeViewModel,
  isPlanSelected,
} from '../src/utils/planViewSelectors';
import { CORE_SUBJECTS } from './fixtures/plan2023';
import { ELECTIVES } from './fixtures/electives';
import { ACRONYM_TO_ID } from './fixtures/acronyms';
import { SAMPLE_SCHEDULES } from './fixtures/schedule';
import type { ActivePlanCatalog, AssignedElectivesByYear, UserCareerState } from '../src/types/career';
import {
  buildPlanTutorialSteps,
  clampTutorialStep,
  computeNextTutorialStep,
  computePrevTutorialStep,
  formatSpanishOrdinal,
  getBadgesSectionSubtitle,
  getDegreeElectiveFootnote,
  getDegreeElectiveReachedLabel,
  getDemoNavbarLabel,
  getDemoOnboardingLabel,
  getDemoTargetLevel,
  getElectivesAssignedHeading,
  getElectivesSuggestedLevelsFootnote,
  getFinalDegreeMilestoneDesc,
  getFinalDegreeMilestoneTitle,
  getFinalDegreeSectionHeading,
  getIntermediateDegreeCardHeading,
  getIntermediateDegreeCreditsValueLabel,
  getIntermediateDegreeMilestoneDesc,
  getIntermediateDegreeMilestoneTitle,
  getIntermediateDegreeMobileSubtitle,
  getIntermediateDegreeRangeLabel,
  getIntermediateDegreeRangeProgressText,
  getIntermediateDegreeShortLabel,
  getIntermediateDegreeShortTitle,
  getIntermediateDegreeSpecialSubjectLabel,
  getIntermediateDegreeToggleDropdownLabel,
  getIntermediateDegreeToggleShortLabel,
  getIntermediateDegreeToggleTooltip,
  getLevelNumbers,
  getLevelOrdinalTabLabel,
  getLevelProgressRowLabel,
  getLibraryHeroDescription,
  getLibraryTermsIntroParagraph,
  getPpsMilestoneDesc,
  getPpsMilestoneTitle,
  getProgressCalcSubtitle,
  getProgressWeightedFooterLabel,
  getProgressWithElectivesBtnLabel,
  getScheduleClipboardHeader,
  getScheduleIcsFilename,
  getScheduleIcsProdId,
  getScheduleIcsUidDomain,
  getScheduleShortSubjectName,
  getWeeklyHoursElectiveFootnote,
  resolveSpecialRuleView,
} from '../src/utils/planText';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const seedRaw = JSON.parse(
  fs.readFileSync(path.resolve(currentDir, '../server/seed-data/plan2023-catalog.json'), 'utf8')
);

function buildNormalizedIsiCatalog(): ActivePlanCatalog {
  const codeToUuid = new Map<number, string>();
  const subjects = seedRaw.subjects.map((s: any, idx: number) => {
    const id = `subj-uuid-${idx + 1}`;
    codeToUuid.set(s.codeInPlan, id);
    return {
      id,
      codeInPlan: s.codeInPlan,
      name: s.name,
      shortName: s.shortName,
      level: s.level,
      modality: s.modality,
      contraCuatrimestral: Boolean(s.contraCuatrimestral),
      weeklyHours: s.weeklyHours,
      kind: s.kind,
      credits: s.credits ?? null,
      isOptionalTrack: Boolean(s.isOptionalTrack),
      trackKey: s.trackKey ?? null,
      isIntegrator: Boolean(s.isIntegrator),
    };
  });

  const prerequisites: Array<{ subjectId: string; requiresSubjectId: string; type: string }> = [];
  for (const s of seedRaw.subjects) {
    const subjectId = codeToUuid.get(s.codeInPlan)!;
    for (const req of s.regularPrereqs ?? []) {
      const requiresSubjectId = codeToUuid.get(req);
      if (requiresSubjectId) prerequisites.push({ subjectId, requiresSubjectId, type: 'regular' });
    }
    for (const req of s.approvedPrereqs ?? []) {
      const requiresSubjectId = codeToUuid.get(req);
      if (requiresSubjectId) prerequisites.push({ subjectId, requiresSubjectId, type: 'approved' });
    }
  }

  const rules = (seedRaw.specialRules ?? []).map((r: any, idx: number) => ({
    id: `rule-${idx + 1}`,
    subjectId: codeToUuid.get(r.subjectCode)!,
    ruleType: r.ruleType,
    params: r.params ?? {},
    description: r.description ?? '',
  }));

  const acronyms = (seedRaw.acronyms ?? []).map((a: any) => ({
    acronym: a.acronym,
    subjectId: codeToUuid.get(a.subjectCode)!,
  }));

  return formatPlanCatalogPayload({
    plan: {
      id: 'plan-isi-2023',
      name: seedRaw.studyPlan.name,
      year: seedRaw.studyPlan.year,
      config: seedRaw.studyPlan.config,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    career: {
      id: 'career-isi',
      name: seedRaw.career.name,
      code: seedRaw.career.code,
      facultyId: 'faculty-frc',
      facultyCode: seedRaw.faculty.code,
      facultyName: seedRaw.faculty.name,
      institutionCode: seedRaw.institution.code,
      institutionName: seedRaw.institution.name,
    },
    subjects,
    prerequisites,
    rules,
    acronyms,
  }) as ActivePlanCatalog;
}

const ISI_PLAN = buildNormalizedIsiCatalog();

/**
 * Frozen character-by-character copy captured from production Sistemas components.
 */
const ISI_2023_FROZEN_UI_TEXTS = {
  subjectDrawer: {
    rule36AnalistaOn:
      'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).',
    rule36AnalistaOff:
      'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Electivas).',
    rule36Eligible: '¡Cumplís todas las materias previas para rendir Proyecto Final!',
    rule36Missing35: 'Faltan aprobar 35 materias previas',
    rule36Missing36WithAnalista: 'Faltan aprobar 36 materias previas',
    rule99Text: 'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.',
  },
  statsDashboard: {
    graduatedTitle: 'Graduación (Título Ingeniero/a)',
    graduatedDesc: 'Todas las materias obligatorias aprobadas + 20 créditos de electivas',
    degreeSectionHeading: 'Requisitos para el Título de Ingeniero/a',
    progressCalcSubtitle:
      'Elegí si el porcentaje de avance general incluye el bloque de 20 créditos de electivas.',
    progressWithElectivesBtn: 'Con electivas (20 cr)',
    progressWeightedFooter: 'Ponderado: obligatorias + bloque electivas (7 eq.)',
    degreeElectiveReached: 'Requisito de 20 créditos alcanzado',
    degreeElectiveFootnote:
      '* 20 créditos requeridos en total, sin importar el nivel de las electivas aprobadas.',
    badgesSubtitle: 'Logros desbloqueados automáticamente al avanzar en el plan 2023.',
    ppsTitle: 'Habilitación PPS',
    ppsDesc: 'Cumplís los requisitos para cursar la Práctica Profesional',
    analistaMilestoneTitle: 'Título Intermedio: Analista Universitario',
    analistaCardHeading: 'Título Intermedio: Analista Universitario de Sistemas de Información',
    analistaMilestoneDesc: 'Materias 1 a 23 + Seminario Integrador 99 + 4 créditos de electivas',
    analistaRangeLabel: 'Materias 1 a 23:',
    analistaRangeProgressZeroDone: '0 / 23 aprobadas',
    analistaRangeProgressAllDone: '23 / 23 aprobadas',
    analistaSpecialSubjectLabel: 'Seminario Integrador (99):',
    analistaCreditsLabel: '2 / 4 cr (aprobados)',
    levelRow1: 'Nivel 1 (Año 1)',
    levelRow5: 'Nivel 5 (Año 5)',
  },
  navbar: {
    analistaToggleShort: 'Analista (99)',
    analistaToggleDropdown: 'Título Analista (99)',
    analistaTooltipOn: 'Seminario Integrador y Título Analista: ACTIVADO (Click para desactivar)',
    analistaTooltipOff: 'Seminario Integrador y Título Analista: DESACTIVADO (Click para activar)',
    analistaMobileSubtitle: 'Seminario Integrador y 4 cr. electivas',
    demoButton: 'Cargar demo (3er año)',
  },
  onboarding: {
    demoButton: 'Cargar demo: Alumno de 3er año',
    levels: [1, 2, 3, 4, 5],
  },
  electives: {
    mobileTab1: '1° Año',
    assignedHeading1: 'Electivas asignadas a 1° Año',
    suggestedLevelsFootnote:
      '* Los niveles (3°, 4°, 5°) de las electivas son solo sugerencias académicas de la UTN.',
  },
  schedule: {
    clipboardHeader: '📅 MI HORARIO DE CURSADA — UTN ISI (Plan 2023)\n',
    icsProdId: 'PRODID:-//Stack//Armador de Horarios//ES',
    icsFilename: 'horarios-utn-2026-11-14.ics',
    icsUidDomain: '@micarrera.utn',
  },
  library: {
    homeHeroDesc:
      'Exámenes parciales y finales, resoluciones, apuntes y resúmenes compartidos por y para estudiantes de Ingeniería en Sistemas de Información.',
    termsIntro: `La Biblioteca de ${APP_NAME} es un espacio colaborativo desarrollado para la comunidad estudiantil de Ingeniería en Sistemas de Información, cuyo único propósito es facilitar el intercambio académico libre y sin costo de recursos de aprendizaje.`,
  },
  tutorial: {
    graphOverviewDesc:
      'Cada nodo es una materia del plan oficial y las 5 columnas representan los años de la carrera (1° a 5° año). Podés arrastrar el lienzo y hacer zoom con la rueda del mouse.',
    electivesTitle: 'Electivas Libres por Año (Total 20 cr)',
    electivesDesc:
      'Sin cupos rígidos por nivel: podés agregar cualquier electiva en cualquier año donde cumplas sus correlativas. Para el título de Ingeniero/a se requieren 20 créditos en total.',
    analistaTitle: 'Título Intermedio de Analista',
    analistaDesc:
      'Si querés tramitar el título intermedio, activá este interruptor. Hará visible el Seminario Integrador (99) y habilitará el seguimiento con sus 4 créditos de electivas requeridos.',
  },
};

describe('Plan Text Helpers — Character-by-character ISI Plan 2023 parity & Neutral Fallbacks', () => {
  it('reproduces SubjectDrawer specialRule texts and ruleType eligibility checks for ISI 2023 character-by-character', () => {
    const subj36 = ISI_PLAN.subjects.find((s) => s.id === 36)!;
    const subj99 = ISI_PLAN.subjects.find((s) => s.id === 99)!;
    const subj1 = ISI_PLAN.subjects.find((s) => s.id === 1)!;

    // #1 has no special rule
    assert.equal(resolveSpecialRuleView(subj1, ISI_PLAN, {}, false), null);

    // #99 approved_range: displays exact fixture text, no all_previous_core_approved footer badge
    const view99 = resolveSpecialRuleView(subj99, ISI_PLAN, {}, true);
    assert.deepEqual(view99, {
      text: ISI_2023_FROZEN_UI_TEXTS.subjectDrawer.rule99Text,
      statusBadge: null,
    });

    // #36 all_previous_core_approved with Analista OFF, empty state
    const view36OffEmpty = resolveSpecialRuleView(subj36, ISI_PLAN, {}, false);
    assert.deepEqual(view36OffEmpty, {
      text: ISI_2023_FROZEN_UI_TEXTS.subjectDrawer.rule36AnalistaOff,
      statusBadge: {
        canRender: false,
        message: ISI_2023_FROZEN_UI_TEXTS.subjectDrawer.rule36Missing35,
      },
    });

    // #36 all_previous_core_approved with Analista ON, empty state (includes 99 in missingIds)
    const view36OnEmpty = resolveSpecialRuleView(subj36, ISI_PLAN, {}, true);
    assert.deepEqual(view36OnEmpty, {
      text: ISI_2023_FROZEN_UI_TEXTS.subjectDrawer.rule36AnalistaOn,
      statusBadge: {
        canRender: false,
        message: ISI_2023_FROZEN_UI_TEXTS.subjectDrawer.rule36Missing36WithAnalista,
      },
    });

    // #36 with 1..35 approved (Analista OFF -> eligible; Analista ON without 99 -> blocked)
    const state1to35: UserCareerState = {};
    for (const s of ISI_PLAN.subjects) {
      if (!s.isElective && s.id !== 36 && s.id !== 99) {
        state1to35[s.id] = { status: 'aprobada', grade: 8 };
      }
    }
    const view36OffEligible = resolveSpecialRuleView(subj36, ISI_PLAN, state1to35, false);
    assert.deepEqual(view36OffEligible?.statusBadge, {
      canRender: true,
      message: ISI_2023_FROZEN_UI_TEXTS.subjectDrawer.rule36Eligible,
    });

    const view36OnBlockedBy99 = resolveSpecialRuleView(subj36, ISI_PLAN, state1to35, true);
    assert.deepEqual(view36OnBlockedBy99?.statusBadge, {
      canRender: false,
      message: 'Faltan aprobar 1 materias previas',
    });
  });

  it('reproduces all StatsDashboard, Navbar, Onboarding, ElectivesPicker, Schedule and Library texts for ISI 2023', () => {
    const cfg = ISI_PLAN.plan.config;
    const analistaDegree = cfg.intermediateDegrees[0]!;
    const electives = ISI_PLAN.subjects.filter((s) => s.isElective);

    assert.equal(getFinalDegreeMilestoneTitle(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.graduatedTitle);
    assert.equal(getFinalDegreeMilestoneDesc(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.graduatedDesc);
    assert.equal(getFinalDegreeSectionHeading(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.degreeSectionHeading);
    assert.equal(getProgressCalcSubtitle(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.progressCalcSubtitle);
    assert.equal(getProgressWithElectivesBtnLabel(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.progressWithElectivesBtn);
    assert.equal(getProgressWeightedFooterLabel(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.progressWeightedFooter);
    assert.equal(getDegreeElectiveReachedLabel(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.degreeElectiveReached);
    assert.equal(getDegreeElectiveFootnote(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.degreeElectiveFootnote);
    assert.equal(getBadgesSectionSubtitle(ISI_PLAN.plan.name), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.badgesSubtitle);

    assert.equal(getPpsMilestoneTitle(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.ppsTitle);
    assert.equal(getPpsMilestoneDesc(cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.ppsDesc);
    assert.equal(
      getWeeklyHoursElectiveFootnote(electives.length),
      '* Las electivas no tienen carga horaria definida, por eso este valor no las incluye'
    );

    assert.equal(
      getIntermediateDegreeMilestoneDesc(analistaDegree, ISI_PLAN.rules, ISI_PLAN.subjects),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaMilestoneDesc
    );
    assert.equal(
      getIntermediateDegreeRangeLabel(analistaDegree, ISI_PLAN.rules, ISI_PLAN.subjects),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaRangeLabel
    );
    assert.equal(
      getIntermediateDegreeRangeProgressText(analistaDegree, ISI_PLAN.rules, ISI_PLAN.subjects, 23),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaRangeProgressZeroDone
    );
    assert.equal(
      getIntermediateDegreeRangeProgressText(analistaDegree, ISI_PLAN.rules, ISI_PLAN.subjects, 0),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaRangeProgressAllDone
    );
    assert.equal(
      getIntermediateDegreeSpecialSubjectLabel(analistaDegree, ISI_PLAN.subjects),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaSpecialSubjectLabel
    );
    assert.equal(
      getIntermediateDegreeCreditsValueLabel(2, analistaDegree),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaCreditsLabel
    );
    assert.equal(
      getIntermediateDegreeMilestoneTitle(analistaDegree),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaMilestoneTitle
    );
    assert.equal(
      getIntermediateDegreeCardHeading(analistaDegree),
      ISI_2023_FROZEN_UI_TEXTS.statsDashboard.analistaCardHeading
    );

    assert.equal(getLevelProgressRowLabel(1, cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.levelRow1);
    assert.equal(getLevelProgressRowLabel(5, cfg), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.levelRow5);

    assert.equal(
      getIntermediateDegreeToggleShortLabel(analistaDegree),
      ISI_2023_FROZEN_UI_TEXTS.navbar.analistaToggleShort
    );
    assert.equal(
      getIntermediateDegreeToggleDropdownLabel(analistaDegree),
      ISI_2023_FROZEN_UI_TEXTS.navbar.analistaToggleDropdown
    );
    assert.equal(
      getIntermediateDegreeToggleTooltip(analistaDegree, ISI_PLAN.subjects, true),
      ISI_2023_FROZEN_UI_TEXTS.navbar.analistaTooltipOn
    );
    assert.equal(
      getIntermediateDegreeToggleTooltip(analistaDegree, ISI_PLAN.subjects, false),
      ISI_2023_FROZEN_UI_TEXTS.navbar.analistaTooltipOff
    );
    assert.equal(
      getIntermediateDegreeMobileSubtitle(analistaDegree, ISI_PLAN.subjects),
      ISI_2023_FROZEN_UI_TEXTS.navbar.analistaMobileSubtitle
    );
    assert.equal(getDemoTargetLevel(cfg), 3);
    assert.equal(getDemoNavbarLabel(cfg), ISI_2023_FROZEN_UI_TEXTS.navbar.demoButton);
    assert.equal(getDemoOnboardingLabel(cfg), ISI_2023_FROZEN_UI_TEXTS.onboarding.demoButton);
    assert.deepEqual(getLevelNumbers(cfg), ISI_2023_FROZEN_UI_TEXTS.onboarding.levels);

    assert.equal(getLevelOrdinalTabLabel(1, cfg), ISI_2023_FROZEN_UI_TEXTS.electives.mobileTab1);
    assert.equal(getElectivesAssignedHeading(1, cfg), ISI_2023_FROZEN_UI_TEXTS.electives.assignedHeading1);
    assert.equal(
      getElectivesSuggestedLevelsFootnote(electives, ISI_PLAN.career),
      ISI_2023_FROZEN_UI_TEXTS.electives.suggestedLevelsFootnote
    );

    assert.equal(getScheduleClipboardHeader(ISI_PLAN), ISI_2023_FROZEN_UI_TEXTS.schedule.clipboardHeader);
    assert.equal(getScheduleIcsProdId(), ISI_2023_FROZEN_UI_TEXTS.schedule.icsProdId);
    assert.equal(
      getScheduleIcsFilename(ISI_PLAN.career, '2026-11-14'),
      ISI_2023_FROZEN_UI_TEXTS.schedule.icsFilename
    );
    assert.equal(getScheduleIcsUidDomain(ISI_PLAN.career), ISI_2023_FROZEN_UI_TEXTS.schedule.icsUidDomain);

    assert.equal(getLibraryHeroDescription(ISI_PLAN.career), ISI_2023_FROZEN_UI_TEXTS.library.homeHeroDesc);
    assert.equal(getLibraryTermsIntroParagraph(ISI_PLAN.career), ISI_2023_FROZEN_UI_TEXTS.library.termsIntro);

    // Raw TUTORIAL_STEPS are neutral (no Sistemas/ISI literals) and buildPlanTutorialSteps recovers ISI 2023 texts verbatim
    assert.equal(TUTORIAL_STEPS.length, 17);
    const rawTutorialText = TUTORIAL_STEPS.map((s) => `${s.title}\n${s.description}`).join('\n');
    for (const forbidden of ['99', 'Analista Universitario', 'Ingeniero/a', '5 columnas', '20 cr']) {
      assert.equal(
        rawTutorialText.includes(forbidden),
        false,
        `TUTORIAL_STEPS neutro no debe contener "${forbidden}"`
      );
    }

    const derivedSteps = buildPlanTutorialSteps(TUTORIAL_STEPS, ISI_PLAN);
    assert.equal(derivedSteps.length, TUTORIAL_STEPS.length);
    assert.deepEqual(
      derivedSteps.map((s) => ({ id: s.id, targetSelector: s.targetSelector, targetView: s.targetView })),
      TUTORIAL_STEPS.map((s) => ({ id: s.id, targetSelector: s.targetSelector, targetView: s.targetView }))
    );
    const graphStep = derivedSteps.find((s) => s.id === 'graph-overview')!;
    const electivesStep = derivedSteps.find((s) => s.id === 'electives-tour')!;
    const analistaStep = derivedSteps.find((s) => s.id === 'analista-switch')!;
    assert.equal(graphStep.description, ISI_2023_FROZEN_UI_TEXTS.tutorial.graphOverviewDesc);
    assert.equal(electivesStep.title, ISI_2023_FROZEN_UI_TEXTS.tutorial.electivesTitle);
    assert.equal(electivesStep.description, ISI_2023_FROZEN_UI_TEXTS.tutorial.electivesDesc);
    assert.equal(analistaStep.title, ISI_2023_FROZEN_UI_TEXTS.tutorial.analistaTitle);
    assert.equal(analistaStep.description, ISI_2023_FROZEN_UI_TEXTS.tutorial.analistaDesc);
    const overriddenIds = new Set(['graph-overview', 'electives-tour', 'analista-switch']);
    for (let i = 0; i < derivedSteps.length; i++) {
      if (!overriddenIds.has(derivedSteps[i].id)) {
        assert.deepEqual(derivedSteps[i], TUTORIAL_STEPS[i]);
      }
    }
  });

const EXPECTED_ISI_SCHEDULE_SHORT_NAMES: Record<number, string> = {
  // Nivel 1
  1: 'Análisis Mat. 1',
  2: 'Álgebra y Geom.',
  3: 'Física 1',
  4: 'Inglés 1',
  5: 'Lógica y Estruct.',
  6: 'Algoritmos (AED)',
  7: 'Arquitectura (ACO)',
  8: 'Sist. y Procesos (SPN)',
  11: 'Ing. y Sociedad',
  // Nivel 2
  9: 'Análisis Mat. 2',
  10: 'Física 2',
  12: 'Inglés 2',
  13: 'Sintaxis (SSL)',
  14: 'Paradigmas (PPR)',
  15: 'Sistemas Operativos',
  16: 'Análisis de Sistemas',
  17: 'Probabilidad y Est.',
  // Nivel 3
  18: 'Economía',
  19: 'Bases de Datos',
  20: 'Desarrollo Software (DDS)',
  21: 'Com. de Datos',
  22: 'Análisis Numérico',
  23: 'Diseño de Sist. (DSI)',
  99: 'Seminario Integrador',
  // Nivel 4
  24: 'Legislación',
  25: 'Calidad de Software',
  26: 'Redes de Datos (RDA)',
  27: 'Investigación Operativa',
  28: 'Simulación',
  29: 'Automatización (TPA)',
  30: 'Admin. de Sistemas',
  // Nivel 5
  31: 'Inteligencia Artificial',
  32: 'Ciencia de Datos',
  33: 'Sistemas de Gestión',
  34: 'Gestión Gerencial',
  35: 'Seguridad en Sistemas',
  36: 'Proyecto Final',
  // Electivas alineadas con shortName en catálogo
  405: 'Aplic. con Objetos (DAO)',
  408: 'Interfaces y UIX',
  507: 'Decisiones (DEC)',
  509: 'Seguridad SW (SDS)',
  511: 'Software Libre (ISFA)',
  512: 'Habilidades Blandas',
  513: 'Entornos Virtuales',
  514: 'PPS',
};

  it('resolves ScheduleWeeklyGrid short names solely from catalog shortName or <= 22 char name truncation without any ID map', () => {
    // 1. All 37 core subjects + 9 aligned electives + 301 read exact shortName from catalog
    const alignedAndCoreIds = [
      ...ISI_PLAN.subjects.filter((s) => !s.isElective).map((s) => s.id),
      301,
      405,
      408,
      507,
      509,
      511,
      512,
      513,
      514,
    ];
    const subjectsById = new Map(ISI_PLAN.subjects.map((s) => [s.id, s]));
    for (const id of alignedAndCoreIds) {
      const subj = ISI_PLAN.subjects.find((s) => s.id === id)!;
      const resolved = getScheduleShortSubjectName(subj.id, subj.name, subj);
      assert.equal(resolved, subj.shortName);
      assert.equal(buildScheduleWeeklyGridSubjectLabel(subj.id, subj.name, subjectsById), resolved);
      if (EXPECTED_ISI_SCHEDULE_SHORT_NAMES[id]) {
        assert.equal(
          resolved,
          EXPECTED_ISI_SCHEDULE_SHORT_NAMES[id],
          `Mismatch on aligned subject #${id}`
        );
      }
    }

    // 2. When catalogSubject or shortName is absent/empty, truncates fullName to <= 22 chars and NEVER uses ISI dictionary
    const fake1Short = getScheduleShortSubjectName(1, 'Introducción a la Química Orgánica y Biológica');
    assert.equal(fake1Short, 'Introducción a la Q...');
    assert.ok(fake1Short.length <= 22);

    const fake99EmptyShort = getScheduleShortSubjectName(99, 'Fisiología Humana', {
      name: 'Fisiología Humana',
      shortName: '',
    });
    assert.equal(fake99EmptyShort, 'Fisiología Humana');
    assert.notEqual(fake99EmptyShort, 'Seminario Integrador');

    assert.equal(getScheduleShortSubjectName(42, ''), 'Materia #42');
  });

  it('produces strictly neutral multi-career texts and non-ISI specialRule evaluation for arbitrary plans', () => {
    const bioPlan: ActivePlanCatalog = {
      career: {
        id: 'car-bio',
        name: 'Licenciatura en Biotecnología',
        code: 'BIO',
        facultyId: 'fac-fcq',
        facultyCode: 'FCQ',
        facultyName: 'Facultad de Ciencias Químicas',
      },
      plan: {
        id: 'plan-bio-2026',
        name: 'Plan 2026',
        year: 2026,
        config: {
          requiredElectiveCredits: 0,
          defaultMinPassingGrade: 6,
          electiveSlotsEquivalent: 0,
          totalLevels: 4,
          levelLabel: 'Cuatrimestre',
          shortTag: 'BIO · Plan 2026',
          intermediateDegrees: [],
          ppsRequirement: null,
        },
      },
      subjects: [
        {
          id: 10,
          code: '10',
          shortName: 'Genética Molecular',
          name: 'Genética Molecular',
          level: 1,
          modality: '1C',
          weeklyHours: 4,
          regularPrereqs: [],
          approvedPrereqs: [],
          isElective: false,
        },
        {
          id: 40,
          code: '40',
          shortName: 'Tesina Final',
          name: 'Tesina Final',
          level: 4,
          modality: 'A',
          weeklyHours: 6,
          regularPrereqs: [],
          approvedPrereqs: [],
          isElective: false,
          specialRule: 'Requiere aprobar todas las materias obligatorias previas.',
        },
      ],
      rules: [
        {
          id: 'r-bio-40',
          subjectCode: 40,
          ruleType: 'all_previous_core_approved',
          params: {},
          description: 'Requiere aprobar todas las materias obligatorias previas.',
        },
      ],
      acronyms: {},
    };

    // Neutral fallbacks contain zero UTN/ISI/Sistemas/Analista/Ingeniero/3er año leaks
    const joinedOutputs = [
      getFinalDegreeMilestoneTitle(bioPlan.plan.config),
      getFinalDegreeMilestoneDesc(bioPlan.plan.config),
      getFinalDegreeSectionHeading(bioPlan.plan.config),
      getProgressCalcSubtitle(bioPlan.plan.config),
      getProgressWithElectivesBtnLabel(bioPlan.plan.config),
      getProgressWeightedFooterLabel(bioPlan.plan.config),
      getBadgesSectionSubtitle(bioPlan.plan.name),
      getDemoNavbarLabel(bioPlan.plan.config),
      getDemoOnboardingLabel(bioPlan.plan.config),
      getLevelProgressRowLabel(2, bioPlan.plan.config),
      getLevelOrdinalTabLabel(2, bioPlan.plan.config),
      getElectivesAssignedHeading(2, bioPlan.plan.config),
      getElectivesSuggestedLevelsFootnote([], bioPlan.career),
      getScheduleClipboardHeader(bioPlan),
      getScheduleIcsProdId(),
      getScheduleIcsFilename(bioPlan.career, '2026-11-14'),
      getScheduleIcsUidDomain(bioPlan.career),
      getLibraryHeroDescription(bioPlan.career),
      getLibraryTermsIntroParagraph(bioPlan.career),
    ].join('\n');

    for (const forbidden of ['UTN', 'utn', 'Sistemas', 'ISI', 'Analista', 'Ingeniero', '3er año', 'Plan 2023']) {
      assert.equal(
        joinedOutputs.includes(forbidden),
        false,
        `Neutral fallback leaked ISI/UTN term "${forbidden}"`
      );
    }

    assert.equal(getFinalDegreeMilestoneTitle(bioPlan.plan.config), 'Graduación (Título Final)');
    assert.equal(getFinalDegreeMilestoneDesc(bioPlan.plan.config), 'Todas las materias obligatorias aprobadas');
    assert.equal(getPpsMilestoneDesc(bioPlan.plan.config), 'Cumplís los requisitos académicos exigidos por el plan');
    assert.equal(getPpsMilestoneDesc(bioPlan.plan.config).includes('Práctica Profesional'), false);
    assert.equal(getIntermediateDegreeShortLabel({ name: 'Tecnicatura Universitaria' }), 'Tecnicatura');
    assert.equal(getIntermediateDegreeShortTitle({ name: 'Tecnicatura Universitaria' }), 'Tecnicatura Universitaria');
    assert.equal(
      getIntermediateDegreeMilestoneTitle({ name: 'Tecnicatura Universitaria' }),
      'Título Intermedio: Tecnicatura Universitaria'
    );
    assert.equal(
      getElectivesSuggestedLevelsFootnote([], bioPlan.career),
      '* Los niveles de las electivas son solo sugerencias académicas de la institución.'
    );
    assert.equal(getWeeklyHoursElectiveFootnote(0), null);
    assert.deepEqual(getLevelNumbers(bioPlan.plan.config), [1, 2, 3, 4]);
    assert.equal(getDemoTargetLevel(bioPlan.plan.config), 2);
    assert.equal(getDemoNavbarLabel(bioPlan.plan.config), 'Cargar demo (2do cuatrimestre)');
    assert.equal(getDemoOnboardingLabel(bioPlan.plan.config), 'Cargar demo: Alumno de 2do cuatrimestre');
    assert.equal(getScheduleClipboardHeader(bioPlan), '📅 MI HORARIO DE CURSADA — BIO (Plan 2026)\n');
    assert.equal(getScheduleIcsProdId(), 'PRODID:-//Stack//Armador de Horarios//ES');
    assert.equal(getScheduleIcsFilename(bioPlan.career, '2026-11-14'), 'horarios-cursada-2026-11-14.ics');
    assert.equal(getScheduleIcsUidDomain(bioPlan.career), '@micarrera.local');

    // Special rule works on non-36 capstone #40 without hardcoded ID checks
    const blockedCapstone = resolveSpecialRuleView(bioPlan.subjects[1], bioPlan, {}, false);
    assert.deepEqual(blockedCapstone, {
      text: 'Requiere aprobar todas las materias obligatorias previas.',
      statusBadge: {
        canRender: false,
        message: 'Faltan aprobar 1 materias previas',
      },
    });
    const eligibleCapstone = resolveSpecialRuleView(
      bioPlan.subjects[1],
      bioPlan,
      { 10: { status: 'aprobada', grade: 9 } },
      false
    );
    assert.deepEqual(eligibleCapstone, {
      text: 'Requiere aprobar todas las materias obligatorias previas.',
      statusBadge: {
        canRender: true,
        message: '¡Cumplís todas las materias previas para rendir Tesina Final!',
      },
    });

    // Tutorial steps adapt totalLevels=4, levelLabel="Cuatrimestre", omit electives-tour & analista-switch
    const bioSteps = buildPlanTutorialSteps(TUTORIAL_STEPS, bioPlan);
    assert.equal(bioSteps.some((s) => s.id === 'electives-tour'), false);
    assert.equal(bioSteps.some((s) => s.id === 'analista-switch'), false);
    assert.ok(
      bioSteps
        .find((s) => s.id === 'graph-overview')!
        .description.includes('4 columnas representan los cuatrimestres de la carrera (1° a 4° cuatrimestre)')
    );

    assert.equal(formatSpanishOrdinal(1), '1er');
    assert.equal(formatSpanishOrdinal(4), '4to');
  });

  it('contains zero fixed Sistemas strings or standalone 99/36 academic references in Tanda 2a, 2b and 2c components, selectors and tutorialSteps.ts', () => {
    const repoRoot = path.resolve(currentDir, '..');
    const auditedFiles = [
      // Tanda 2a
      'src/components/stats/StatsDashboard.tsx',
      'src/components/graph/SubjectDrawer.tsx',
      'src/components/common/QuickStatusModal.tsx',
      'src/components/common/Navbar.tsx',
      'src/components/common/UserMenu.tsx',
      'src/data/tutorialSteps.ts',
      'src/components/tutorial/TutorialSpotlight.tsx',
      // Tanda 2b + selectors
      'src/components/graph/CorrelativeGraph.tsx',
      'src/components/graph/SubjectListView.tsx',
      'src/components/graph/SubjectNode.tsx',
      'src/components/kanban/KanbanBoard.tsx',
      'src/components/planner/SemesterPlanner.tsx',
      'src/components/electives/ElectivesPicker.tsx',
      'src/components/onboarding/OnboardingModal.tsx',
      'src/components/common/SearchModal.tsx',
      'src/utils/planViewSelectors.ts',
      // Tanda 2c
      'src/components/schedule/ScheduleWeeklyGrid.tsx',
      'src/components/schedule/ScheduleSummaryPanel.tsx',
      'src/components/schedule/ScheduleBuilder.tsx',
      'src/components/library/LibraryHome.tsx',
      'src/components/library/LibraryTermsPage.tsx',
      'src/components/common/PlanSelectorModal.tsx',
      'src/components/professors/ProfessorsDirectory.tsx',
      'src/components/admin/tabs/AdminScheduleTab.tsx',
      'src/components/admin/tabs/AdminReviewsTab.tsx',
      'src/utils/libraryUploadLogic.ts',
    ];
    const forbiddenStrings = [
      'UTN',
      'Plan 2023',
      'plan 2023',
      'Analista (99)',
      'Seminario Integrador',
      'Ingeniería en Sistemas',
      'Ingeniero/a',
      'Analista Universitario',
      'Práctica Profesional',
      '3er año',
      'Algoritmos, 14, DDS',
      'SUBJECT_SHORT_NAMES',
      '[1, 2, 3, 4, 5]',
    ];
    // Documented non-academic literals containing 99 or 36 (Tailwind heights/widths, SVG math, hex/rgba colors, layout comments/sentinels, opacity)
    const allowedTechnicalLiterals = [
      'min-h-[36px]',
      'min-w-[36px]',
      'min-[360px]',
      '#34d399',
      '163.36',
      '0.99',
      'rgba(99,102,241,0.2)',
      'rgba(99,102,241,0.6)',
      '640x360',
      '-9999',
      'rgba(251,191,36,0.4)',
      'rgba(251,191,36,0.3)',
    ];

    const scheduleGridSource = fs.readFileSync(
      path.join(repoRoot, 'src/components/schedule/ScheduleWeeklyGrid.tsx'),
      'utf8'
    );
    assert.equal(
      scheduleGridSource.includes('Record<number, string>'),
      false,
      'ScheduleWeeklyGrid.tsx no debe definir ni importar mapas Record<number, string> por ID'
    );

    for (const relPath of auditedFiles) {
      const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
      for (const forbidden of forbiddenStrings) {
        assert.equal(
          content.includes(forbidden),
          false,
          `${relPath} no debe contener el texto fijo "${forbidden}"`
        );
      }

      let scrubbed = content;
      for (const literal of allowedTechnicalLiterals) {
        scrubbed = scrubbed.split(literal).join('');
      }
      const codeMatches = scrubbed.match(/\b(?:99|36)\b/g);
      assert.equal(
        codeMatches,
        null,
        `${relPath} no debe contener códigos de materia fijos 99/36 (hallados: ${codeMatches?.join(', ')})`
      );
    }
  });

  it('traverses tutorial steps forward, backward and by index on ISI Plan 2023 and on a plan without intermediate degrees or electives', () => {
    // Plan ficticio de 3 niveles sin título intermedio ni electivas
    const minimalPlan: ActivePlanCatalog = {
      ...ISI_PLAN,
      plan: {
        ...ISI_PLAN.plan,
        id: 'plan-sin-intermedio-ni-electivas',
        name: 'Plan Cuatrimestral Básico',
        config: {
          ...ISI_PLAN.plan.config,
          totalLevels: 3,
          levelLabel: 'Cuatrimestre',
          requiredElectiveCredits: 0,
          electiveSlotsEquivalent: 0,
          intermediateDegrees: [],
          ppsRequirement: null,
        },
      },
      subjects: ISI_PLAN.subjects.filter((s) => !s.isElective && s.level <= 3 && !s.isOptionalTrack),
      rules: [],
    };

    // 1. ISI Plan 2023 en desktop (17 pasos) y mobile (16 pasos, sin vista schedule)
    const isiDesktopSteps = buildPlanTutorialSteps(getAvailableTutorialSteps(true), ISI_PLAN);
    assert.equal(isiDesktopSteps.length, 17);
    assert.equal(isiDesktopSteps[0].id, 'welcome');
    assert.equal(isiDesktopSteps.some((s) => s.id === 'electives-tour'), true);
    assert.equal(isiDesktopSteps.some((s) => s.id === 'analista-switch'), true);
    assert.equal(isiDesktopSteps[16].id, 'finish');

    const isiMobileSteps = buildPlanTutorialSteps(getAvailableTutorialSteps(false), ISI_PLAN);
    assert.equal(isiMobileSteps.length, 16);
    assert.equal(isiMobileSteps.some((s) => s.targetView === 'schedule'), false);

    // 2. Plan mínimo sin título intermedio ni electivas: 15 pasos en desktop, 14 en mobile
    const minDesktopSteps = buildPlanTutorialSteps(getAvailableTutorialSteps(true), minimalPlan);
    assert.equal(minDesktopSteps.length, 15);
    assert.equal(minDesktopSteps.some((s) => s.id === 'electives-tour'), false);
    assert.equal(minDesktopSteps.some((s) => s.id === 'analista-switch'), false);
    assert.ok(
      minDesktopSteps
        .find((s) => s.id === 'graph-overview')!
        .description.includes('3 columnas representan los cuatrimestres de la carrera (1° a 3° cuatrimestre)')
    );

    const minMobileSteps = buildPlanTutorialSteps(getAvailableTutorialSteps(false), minimalPlan);
    assert.equal(minMobileSteps.length, 14);
    assert.equal(minMobileSteps.some((s) => s.targetView === 'schedule'), false);
    assert.equal(minMobileSteps.some((s) => s.id === 'electives-tour'), false);
    assert.equal(minMobileSteps.some((s) => s.id === 'analista-switch'), false);

    // 3. Recorrido completo hacia adelante, atrás y acceso directo con clamp en ambos planes
    for (const steps of [isiDesktopSteps, isiMobileSteps, minDesktopSteps, minMobileSteps]) {
      let current = 0;
      const visitedIds: string[] = [steps[current].id];

      for (let i = 0; i < steps.length - 1; i++) {
        const res = computeNextTutorialStep(current, steps.length);
        assert.equal(res.shouldClose, false);
        assert.equal(res.nextStep, current + 1);
        current = res.nextStep;
        visitedIds.push(steps[current].id);
      }

      assert.deepEqual(
        visitedIds,
        steps.map((s) => s.id)
      );

      // Avanzar en el último paso debe cerrar el tutorial sin desbordar
      const endRes = computeNextTutorialStep(steps.length - 1, steps.length);
      assert.equal(endRes.shouldClose, true);
      assert.equal(endRes.nextStep, steps.length - 1);

      // Retroceder desde el final hasta 0 y tope en 0
      for (let i = steps.length - 1; i > 0; i--) {
        current = computePrevTutorialStep(current);
        assert.equal(current, i - 1);
      }
      assert.equal(computePrevTutorialStep(0), 0);

      // goToTutorialStep / clampTutorialStep acota al rango válido [0, steps.length - 1]
      assert.equal(clampTutorialStep(-5, steps.length), 0);
      assert.equal(clampTutorialStep(999, steps.length), steps.length - 1);
      assert.equal(clampTutorialStep(3, steps.length), 3);
    }
  });

  it('reproduces identical Tanda 2b structures from normalized ISI Plan 2023 payload and 60-subject fixtures across all 8 selectors', () => {
    const payloadCore = ISI_PLAN.subjects.filter((s) => !s.isElective);
    const payloadElectives = ISI_PLAN.subjects.filter((s) => s.isElective);
    // El fixture estático pre-multicarrera marcaba el trayecto Analista en la 99 implícitamente;
    // en DB/payload ese dato viaja explícito en isOptionalTrack/trackKey (ver PAYLOAD_ONLY_KEY_EXCEPTIONS en plan2023Oracle).
    const fixtureCore = CORE_SUBJECTS.map((s) =>
      s.id === 99 ? { ...s, isOptionalTrack: true, trackKey: 'analista' } : s
    );
    const payloadById = new Map(ISI_PLAN.subjects.map((s) => [s.id, s]));
    const fixtureById = new Map([...fixtureCore, ...ELECTIVES].map((s) => [s.id, s]));

    assert.equal(payloadCore.length, fixtureCore.length);
    assert.equal(payloadElectives.length, ELECTIVES.length);

    const sample = getSampleStudentForPlan(ISI_PLAN);
    const emptyState: UserCareerState = {};
    const emptyAssigned: AssignedElectivesByYear = { 1: [], 2: [], 3: [], 4: [], 5: [] };

    for (const [label, userState, assignedElectives, includeTrack, showElectives] of [
      ['empty_trackOn_elecOff', emptyState, emptyAssigned, true, false],
      ['sample_trackOn_elecOn', sample.userState, sample.assignedElectives, true, true],
      ['sample_trackOff_elecOn', sample.userState, sample.assignedElectives, false, true],
    ] as const) {
      // 1. CorrelativeGraph
      const graphPayload = buildGraphViewStructure({
        planConfig: ISI_PLAN.plan.config,
        coreSubjects: payloadCore,
        electives: payloadElectives,
        activeState: userState,
        includeIntermediateTrack: includeTrack,
        showElectivesInGraph: showElectives,
        assignedElectives,
      });
      const graphFixture = buildGraphViewStructure({
        planConfig: ISI_PLAN.plan.config,
        coreSubjects: fixtureCore,
        electives: ELECTIVES,
        activeState: userState,
        includeIntermediateTrack: includeTrack,
        showElectivesInGraph: showElectives,
        assignedElectives,
      });

      assert.equal(graphPayload.showElectivesToggle, true, label);
      assert.equal(graphPayload.totalLevels, 5, label);
      assert.deepEqual(graphPayload.columns, graphFixture.columns, `graph columns ${label}`);
      assert.deepEqual(
        graphPayload.columns.map((c) => c.label),
        ['1° Año', '2° Año', '3° Año', '4° Año', '5° Año'],
        `graph column labels ${label}`
      );
      assert.deepEqual(
        graphPayload.nodesLayout.map((n) => ({
          id: n.id,
          code: n.code,
          name: n.name,
          level: n.level,
          targetCol: n.targetCol,
          position: n.position,
          status: n.status,
          grade: n.grade,
          isElective: n.isElective,
          isIntegrator: n.isIntegrator,
          assignedYear: n.assignedYear,
        })),
        graphFixture.nodesLayout.map((n) => ({
          id: n.id,
          code: n.code,
          name: n.name,
          level: n.level,
          targetCol: n.targetCol,
          position: n.position,
          status: n.status,
          grade: n.grade,
          isElective: n.isElective,
          isIntegrator: n.isIntegrator,
          assignedYear: n.assignedYear,
        })),
        `graph nodes ${label}`
      );
      assert.deepEqual(graphPayload.edgesLayout, graphFixture.edgesLayout, `graph edges ${label}`);
      assert.equal(graphPayload.sampleSubjectId, graphFixture.sampleSubjectId, `sampleSubjectId ${label}`);

      // 2. SubjectListView
      const listPayload = buildSubjectListViewStructure({
        subjects: graphPayload.activeSubjects,
        activeState: userState,
        subjectsById: payloadById,
        planConfig: ISI_PLAN.plan.config,
      });
      const listFixture = buildSubjectListViewStructure({
        subjects: graphFixture.activeSubjects,
        activeState: userState,
        subjectsById: fixtureById,
        planConfig: ISI_PLAN.plan.config,
      });
      assert.deepEqual(
        listPayload.map((g) => ({
          level: g.level,
          title: g.title,
          summaryLabel: g.summaryLabel,
          percentage: g.percentage,
          items: g.items.map((it) => ({
            id: it.subject.id,
            code: it.subject.code,
            status: it.status,
            isBlocked: it.isBlocked,
            missingRegularNames: it.missingRegularNames,
            missingApprovedNames: it.missingApprovedNames,
          })),
        })),
        listFixture.map((g) => ({
          level: g.level,
          title: g.title,
          summaryLabel: g.summaryLabel,
          percentage: g.percentage,
          items: g.items.map((it) => ({
            id: it.subject.id,
            code: it.subject.code,
            status: it.status,
            isBlocked: it.isBlocked,
            missingRegularNames: it.missingRegularNames,
            missingApprovedNames: it.missingApprovedNames,
          })),
        })),
        `subject list ${label}`
      );

      // 3. SubjectNode view models across all active subjects
      for (let i = 0; i < graphPayload.nodesLayout.length; i++) {
        const pNode = graphPayload.nodesLayout[i];
        const fNode = graphFixture.nodesLayout[i];
        assert.deepEqual(
          buildSubjectNodeViewModel(pNode.subject, pNode.status, pNode.grade, ISI_PLAN.plan.config),
          buildSubjectNodeViewModel(fNode.subject, fNode.status, fNode.grade, ISI_PLAN.plan.config),
          `subject node #${pNode.id} ${label}`
        );
      }

      // 4. KanbanBoard
      const kanbanPayload = buildKanbanBoardStructure({
        coreSubjects: payloadCore,
        activeState: userState,
        includeIntermediateTrack: includeTrack,
        levelFilter: 'all',
        planConfig: ISI_PLAN.plan.config,
      });
      const kanbanFixture = buildKanbanBoardStructure({
        coreSubjects: fixtureCore,
        activeState: userState,
        includeIntermediateTrack: includeTrack,
        levelFilter: 'all',
        planConfig: ISI_PLAN.plan.config,
      });
      assert.equal(kanbanPayload.subtitle, kanbanFixture.subtitle);
      assert.equal(kanbanPayload.levelsRangeTag, '(1° a 5°)');
      assert.deepEqual(kanbanPayload.levelFilterOptions, kanbanFixture.levelFilterOptions);
      assert.deepEqual(
        kanbanPayload.columns.map((c) => ({
          id: c.id,
          count: c.count,
          ids: c.subjects.map((s) => s.id),
        })),
        kanbanFixture.columns.map((c) => ({
          id: c.id,
          count: c.count,
          ids: c.subjects.map((s) => s.id),
        })),
        `kanban columns ${label}`
      );
      assert.deepEqual(
        kanbanPayload.levelGroups.map((g) => ({
          level: g.level,
          progressText: g.progressText,
          ids: g.subjects.map((s) => s.id),
        })),
        kanbanFixture.levelGroups.map((g) => ({
          level: g.level,
          progressText: g.progressText,
          ids: g.subjects.map((s) => s.id),
        })),
        `kanban levelGroups ${label}`
      );

      // 5. SemesterPlanner
      const plannerPayload = buildSemesterPlannerStructure({
        coreSubjects: payloadCore,
        electives: payloadElectives,
        activeState: userState,
        subjectsById: payloadById,
        semesterBasket: [6, 301],
        includeIntermediateTrack: includeTrack,
        includeElectives: true,
        termFilter: 'all',
        planConfig: ISI_PLAN.plan.config,
      });
      const plannerFixture = buildSemesterPlannerStructure({
        coreSubjects: fixtureCore,
        electives: ELECTIVES,
        activeState: userState,
        subjectsById: fixtureById,
        semesterBasket: [6, 301],
        includeIntermediateTrack: includeTrack,
        includeElectives: true,
        termFilter: 'all',
        planConfig: ISI_PLAN.plan.config,
      });
      assert.equal(plannerPayload.showIncludeElectivesToggle, true, label);
      assert.equal(plannerPayload.availableCount, plannerFixture.availableCount, label);
      assert.deepEqual(
        plannerPayload.availableSubjects.map((s) => ({ id: s.id, code: s.code })),
        plannerFixture.availableSubjects.map((s) => ({ id: s.id, code: s.code })),
        `planner available ${label}`
      );
      assert.equal(plannerPayload.totalWeeklyHours, plannerFixture.totalWeeklyHours, label);

      // 6. ElectivesPicker
      const evalSettings = {
        minPassingGrade: 4,
        includeAnalistaTrack: includeTrack,
        includeElectivesInProgress: true,
      };
      const progressPayload = evaluatePlanProgress({
        plan: ISI_PLAN,
        userState,
        settings: evalSettings,
        examAttempts: [],
      }).progress;
      const fixturePlan: ActivePlanCatalog = {
        ...ISI_PLAN,
        subjects: [...fixtureCore, ...ELECTIVES],
      };
      const progressFixture = evaluatePlanProgress({
        plan: fixturePlan,
        userState,
        settings: evalSettings,
        examAttempts: [],
      }).progress;
      const electivesPayload = buildElectivesPickerStructure({
        electives: payloadElectives,
        planConfig: ISI_PLAN.plan.config,
        career: ISI_PLAN.career,
        assignedElectives,
        computedProgress: progressPayload,
        modalSearch: '',
      });
      const electivesFixture = buildElectivesPickerStructure({
        electives: ELECTIVES,
        planConfig: ISI_PLAN.plan.config,
        career: ISI_PLAN.career,
        assignedElectives,
        computedProgress: progressFixture,
        modalSearch: '',
      });
      assert.equal(electivesPayload.hasElectivesBlock, true);
      assert.deepEqual(electivesPayload.suggestedLevels, [3, 4, 5]);
      assert.deepEqual(
        electivesPayload.suggestedLevelGroups.map((g) => ({
          level: g.level,
          heading: g.heading,
          ids: g.electives.map((e) => e.id),
        })),
        electivesFixture.suggestedLevelGroups.map((g) => ({
          level: g.level,
          heading: g.heading,
          ids: g.electives.map((e) => e.id),
        })),
        `electives groups ${label}`
      );
      assert.deepEqual(
        electivesPayload.yearSections.map((y) => ({
          year: y.year,
          heading: y.heading,
          summaryText: y.summaryText,
          ids: y.assignedSubjects.map((s) => s.id),
        })),
        electivesFixture.yearSections.map((y) => ({
          year: y.year,
          heading: y.heading,
          summaryText: y.summaryText,
          ids: y.assignedSubjects.map((s) => s.id),
        })),
        `electives yearSections ${label}`
      );

      // 7. OnboardingModal
      const onboardingPayload = buildOnboardingModalStructure({
        coreSubjects: payloadCore,
        includeIntermediateTrack: includeTrack,
        planConfig: ISI_PLAN.plan.config,
        selections: {},
        defaultGradeByLevel: {},
      });
      const onboardingFixture = buildOnboardingModalStructure({
        coreSubjects: fixtureCore,
        includeIntermediateTrack: includeTrack,
        planConfig: ISI_PLAN.plan.config,
        selections: {},
        defaultGradeByLevel: {},
      });
      assert.equal(onboardingPayload.demoButtonLabel, 'Cargar demo: Alumno de 3er año');
      assert.deepEqual(
        onboardingPayload.levels.map((l) => ({
          level: l.level,
          title: l.title,
          countLabel: l.countLabel,
          ids: l.subjects.map((s) => s.id),
        })),
        onboardingFixture.levels.map((l) => ({
          level: l.level,
          title: l.title,
          countLabel: l.countLabel,
          ids: l.subjects.map((s) => s.id),
        })),
        `onboarding ${label}`
      );

      // 8. SearchModal
      const searchPayload = buildSearchModalStructure({
        coreSubjects: payloadCore,
        electives: payloadElectives,
        activeState: userState,
        includeIntermediateTrack: includeTrack,
        query: '14',
        levelFilter: 'all',
        statusFilter: 'all',
        planConfig: ISI_PLAN.plan.config,
        acronyms: ISI_PLAN.acronyms,
      });
      const searchFixture = buildSearchModalStructure({
        coreSubjects: fixtureCore,
        electives: ELECTIVES,
        activeState: userState,
        includeIntermediateTrack: includeTrack,
        query: '14',
        levelFilter: 'all',
        statusFilter: 'all',
        planConfig: ISI_PLAN.plan.config,
        acronyms: ACRONYM_TO_ID,
      });
      assert.equal(
        searchPayload.desktopPlaceholder,
        'Buscar materia por nombre o código... (ej. Algoritmos, 14, DDS, Física)'
      );
      assert.equal(searchPayload.desktopPlaceholder, searchFixture.desktopPlaceholder);
      assert.equal(searchPayload.countLabelMobile, searchFixture.countLabelMobile);
      assert.equal(searchPayload.countLabelDesktop, searchFixture.countLabelDesktop);
      assert.deepEqual(searchPayload.levelFilterOptions, searchFixture.levelFilterOptions);
      assert.deepEqual(
        searchPayload.filtered.map((s) => ({ id: s.id, code: s.code })),
        searchFixture.filtered.map((s) => ({ id: s.id, code: s.code })),
        `search filtered ${label}`
      );
    }
  });

  it('builds strictly neutral Tanda 2b structures on a 3-level plan without intermediate degrees or electives', () => {
    const threeLevelConfig = {
      ...ISI_PLAN.plan.config,
      totalLevels: 3,
      levelLabel: 'Cuatrimestre',
      shortTag: 'Q3C · Plan 2026',
      requiredElectiveCredits: 0,
      electiveSlotsEquivalent: 0,
      intermediateDegrees: [],
      ppsRequirement: null,
    };
    const coreThreeLevels = [
      {
        id: 101,
        code: '101',
        shortName: 'Química General',
        name: 'Química General',
        level: 1,
        modality: '1C' as const,
        weeklyHours: 4,
        regularPrereqs: [],
        approvedPrereqs: [],
        isElective: false,
      },
      {
        id: 102,
        code: '102',
        shortName: 'Biología Celular',
        name: 'Biología Celular',
        level: 2,
        modality: '2C' as const,
        weeklyHours: 5,
        regularPrereqs: [101],
        approvedPrereqs: [],
        isElective: false,
      },
      {
        id: 103,
        code: '103',
        shortName: 'Bioquímica Aplicada',
        name: 'Bioquímica Aplicada',
        level: 3,
        modality: 'A' as const,
        weeklyHours: 6,
        regularPrereqs: [],
        approvedPrereqs: [101],
        isElective: false,
        isIntegrator: true,
      },
    ];
    const subjectsById = new Map(coreThreeLevels.map((s) => [s.id, s]));

    const graph = buildGraphViewStructure({
      planConfig: threeLevelConfig,
      coreSubjects: coreThreeLevels,
      electives: [],
      activeState: {},
      includeIntermediateTrack: false,
      showElectivesInGraph: true,
      assignedElectives: {},
    });
    assert.equal(graph.totalLevels, 3);
    assert.deepEqual(
      graph.columns.map((c) => c.label),
      ['1° Cuatrimestre', '2° Cuatrimestre', '3° Cuatrimestre']
    );
    assert.equal(graph.showElectivesToggle, false);
    assert.equal(graph.sampleSubjectId, 101);

    const list = buildSubjectListViewStructure({
      subjects: coreThreeLevels,
      activeState: {},
      subjectsById,
      planConfig: threeLevelConfig,
    });
    assert.deepEqual(
      list.map((g) => g.title),
      ['1° Cuatrimestre', '2° Cuatrimestre', '3° Cuatrimestre']
    );

    const node = buildSubjectNodeViewModel(coreThreeLevels[2], 'bloqueada', undefined, threeLevelConfig);
    assert.equal(node.levelBadge, 'N3');
    assert.equal(node.showElectiveBadge, false);
    assert.equal(node.showIntegratorBadge, true);

    const kanban = buildKanbanBoardStructure({
      coreSubjects: coreThreeLevels,
      activeState: {},
      includeIntermediateTrack: false,
      levelFilter: 'all',
      planConfig: threeLevelConfig,
    });
    assert.equal(kanban.levelsRangeTag, '(1° a 3°)');
    assert.equal(kanban.subtitle.includes('cuatrimestre'), true);
    assert.deepEqual(
      kanban.levelFilterOptions.map((o) => o.label),
      ['Todos', '1°', '2°', '3°']
    );
    assert.equal(kanban.levelGroups.length, 3);

    const planner = buildSemesterPlannerStructure({
      coreSubjects: coreThreeLevels,
      electives: [],
      activeState: {},
      subjectsById,
      semesterBasket: [101],
      includeIntermediateTrack: false,
      includeElectives: true,
      termFilter: 'all',
      planConfig: threeLevelConfig,
    });
    assert.equal(planner.showIncludeElectivesToggle, false);
    assert.equal(planner.availableCount, 1);

    const electives = buildElectivesPickerStructure({
      electives: [],
      planConfig: threeLevelConfig,
      career: { name: 'Tecnicatura en Química', facultyName: 'FCQ' },
      assignedElectives: {},
      computedProgress: {
        totalElectiveCreditsApproved: 0,
        totalElectiveCreditsTaking: 0,
        missingElectiveCreditsForDegree: 0,
      },
      modalSearch: '',
    });
    assert.equal(electives.hasElectivesBlock, false);
    assert.equal(electives.suggestedLevelGroups.length, 0);
    assert.deepEqual(electives.years, [1, 2, 3]);
    assert.equal(electives.headerTitle, 'Electivas Libres por Cuatrimestre');

    const onboarding = buildOnboardingModalStructure({
      coreSubjects: coreThreeLevels,
      includeIntermediateTrack: false,
      planConfig: threeLevelConfig,
      selections: {},
      defaultGradeByLevel: {},
    });
    assert.equal(onboarding.demoButtonLabel, 'Cargar demo: Alumno de 2do cuatrimestre');
    assert.deepEqual(
      onboarding.levels.map((l) => l.level),
      [1, 2, 3]
    );

    const search = buildSearchModalStructure({
      coreSubjects: coreThreeLevels,
      electives: [],
      activeState: {},
      includeIntermediateTrack: false,
      query: '',
      levelFilter: 'all',
      statusFilter: 'all',
      planConfig: threeLevelConfig,
      acronyms: { QG: 101 },
    });
    assert.deepEqual(
      search.levelFilterOptions.map((o) => o.label),
      ['Todos', '1°', '2°', '3°']
    );
    assert.equal(
      search.desktopPlaceholder,
      'Buscar materia por nombre o código... (ej. Química, 102, QG, Bioquímica)'
    );
    const searchNoAcronyms = buildSearchModalStructure({
      coreSubjects: coreThreeLevels,
      electives: [],
      activeState: {},
      includeIntermediateTrack: false,
      query: '',
      levelFilter: 'all',
      statusFilter: 'all',
      planConfig: threeLevelConfig,
      acronyms: {},
    });
    assert.equal(searchNoAcronyms.desktopPlaceholder, 'Buscar materia por nombre o código...');

    const serialized = JSON.stringify({
      graph,
      list,
      node,
      kanban,
      planner,
      electives,
      onboarding,
      search,
    });
    for (const forbidden of ['Analista', 'UTN', 'Sistemas', 'Ingeniero', '4°', '5°', 'Año']) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `Estructura 3-niveles no debe contener "${forbidden}"`
      );
    }
  });

  it('reproduces Tanda 2c structures on normalized ISI Plan 2023 payload matching fixtures and legacy export/tab metadata', () => {
    const coreFromPayload = ISI_PLAN.subjects.filter((s) => !s.isElective);
    const electivesFromPayload = ISI_PLAN.subjects.filter((s) => s.isElective);
    const subjectsByIdFromPayload = new Map(ISI_PLAN.subjects.map((s) => [s.id, s]));

    // 1. ScheduleWeeklyGrid: exact parity with all 45 legacy aligned short names
    for (const [idStr, expectedShort] of Object.entries(EXPECTED_ISI_SCHEDULE_SHORT_NAMES)) {
      const id = Number(idStr);
      const subj = subjectsByIdFromPayload.get(id)!;
      assert.ok(subj, `Subject #${id} must exist in normalized ISI payload`);
      assert.equal(
        buildScheduleWeeklyGridSubjectLabel(id, subj.name, subjectsByIdFromPayload),
        expectedShort
      );
    }

    // 2. ScheduleSummaryPanel: exact clipboard header + ICS export metadata
    const exportMeta = buildScheduleSummaryExportMetadata(ISI_PLAN, '2026-11-14');
    assert.deepEqual(exportMeta, {
      clipboardHeader: '📅 MI HORARIO DE CURSADA — UTN ISI (Plan 2023)\n',
      icsProdId: 'PRODID:-//Stack//Armador de Horarios//ES',
      icsUidDomain: '@micarrera.utn',
      icsFilename: 'horarios-utn-2026-11-14.ics',
    });

    // 3. ScheduleBuilder: exact active core/electives counts, availability & selected hours vs fixtures
    const builderClean = buildScheduleBuilderStructure({
      coreSubjects: coreFromPayload,
      electives: electivesFromPayload,
      includeAnalistaTrack: false,
      scheduleData: SAMPLE_SCHEDULES,
      selectedCommissions: { 1: '1-1K1' },
      activeState: {},
      assignedElectives: {},
    });
    assert.equal(builderClean.activeCoreSubjects.length, CORE_SUBJECTS.filter((s) => s.id !== 99).length);
    assert.equal(builderClean.allPlanSubjects.length, CORE_SUBJECTS.length + ELECTIVES.length);
    assert.equal(builderClean.knownSubjectIds.size, CORE_SUBJECTS.length + ELECTIVES.length);
    assert.equal(builderClean.subjectNamesMap.get(6), CORE_SUBJECTS.find((s) => s.id === 6)!.name);
    assert.deepEqual(
      builderClean.availableSubjects.map((s) => s.id),
      [1, 2, 3, 4, 5, 6, 7, 8, 11]
    );
    assert.equal(builderClean.selectedCount, 1);
    assert.equal(builderClean.totalHours, 4.5);

    const builderWithTrack = buildScheduleBuilderStructure({
      coreSubjects: coreFromPayload,
      electives: electivesFromPayload,
      includeAnalistaTrack: true,
      scheduleData: SAMPLE_SCHEDULES,
      selectedCommissions: {},
      activeState: {},
      assignedElectives: {},
    });
    assert.equal(builderWithTrack.activeCoreSubjects.some((s) => s.id === 99), true);
    assert.equal(builderWithTrack.allSubjects.length, CORE_SUBJECTS.length + ELECTIVES.length);

    // 4. LibraryHome & LibraryTermsPage: exact 5 years + Electives tab + career descriptions
    const libraryIsi = buildLibraryHomeStructure({
      subjects: coreFromPayload,
      electives: electivesFromPayload,
      planConfig: ISI_PLAN.plan.config,
      career: ISI_PLAN.career,
    });
    assert.equal(libraryIsi.totalLevels, 5);
    assert.equal(libraryIsi.hasElectives, true);
    assert.equal(
      libraryIsi.heroDescription,
      'Exámenes parciales y finales, resoluciones, apuntes y resúmenes compartidos por y para estudiantes de Ingeniería en Sistemas de Información.'
    );
    assert.deepEqual(libraryIsi.levelFilterTabs, [
      { id: 'all', label: 'Todas las materias' },
      { id: 1, label: '1° Año' },
      { id: 2, label: '2° Año' },
      { id: 3, label: '3° Año' },
      { id: 4, label: '4° Año' },
      { id: 5, label: '5° Año' },
      { id: 'electives', label: 'Electivas' },
    ]);
    assert.equal(
      getLibraryTermsIntroParagraph(ISI_PLAN.career, APP_NAME),
      `La Biblioteca de ${APP_NAME} es un espacio colaborativo desarrollado para la comunidad estudiantil de Ingeniería en Sistemas de Información, cuyo único propósito es facilitar el intercambio académico libre y sin costo de recursos de aprendizaje.`
    );

    // 5. PlanSelectorModal: identity strictly by plan.id
    assert.equal(isPlanSelected('plan-isi-2023', ISI_PLAN.plan.id), true);
    assert.equal(isPlanSelected('plan-other-2023', ISI_PLAN.plan.id), false);
    assert.equal(isPlanSelected('plan-isi-2023', undefined), false);

    // 6. ProfessorsDirectory & Admin selects: subject options keep codeInPlan & level/name sorting
    const dirIsi = buildProfessorsDirectoryStructure(ISI_PLAN.subjects);
    assert.equal(dirIsi.allPlanSubjects.length, CORE_SUBJECTS.length + ELECTIVES.length);
    assert.equal(dirIsi.subjectFilterOptions[0].label.startsWith('1° · '), true);
    const dirLevels = dirIsi.allPlanSubjects.map((s) => s.level);
    assert.deepEqual(
      dirLevels,
      [...dirLevels].sort((a, b) => a - b)
    );

    const adminOptions = buildAdminPlanSubjectOptions(coreFromPayload);
    assert.equal(adminOptions.length, CORE_SUBJECTS.length);
    assert.deepEqual(adminOptions[0], {
      id: 1,
      value: '1',
      code: '1',
      name: CORE_SUBJECTS.find((s) => s.id === 1)!.name,
      label: `#1 ${CORE_SUBJECTS.find((s) => s.id === 1)!.name}`,
    });
    assert.equal(adminOptions.some((o) => o.id === 99 && o.label.startsWith('#99 ')), true);
  });

  it('builds strictly neutral Tanda 2c structures on a 3-level plan without intermediate degrees or electives', () => {
    const threeLevelCareer = {
      id: 'career-tq',
      name: 'Tecnicatura en Química',
      code: 'TQ',
      facultyId: 'fac-fcq',
      facultyCode: 'FCQ',
      facultyName: 'Facultad de Ciencias Químicas',
      institutionCode: 'UNLP',
      institutionName: 'Universidad Nacional de La Plata',
    };
    const threeLevelConfig = {
      ...ISI_PLAN.plan.config,
      totalLevels: 3,
      levelLabel: 'Cuatrimestre',
      shortTag: 'TQ · Plan 2026',
      requiredElectiveCredits: 0,
      electiveSlotsEquivalent: 0,
      intermediateDegrees: [],
      ppsRequirement: null,
      finalDegreeTitle: 'Técnico/a en Química',
    };
    const coreThreeLevels = [
      {
        id: 6,
        code: '6',
        shortName: 'Química General',
        name: 'Introducción a la Química General Experimental',
        level: 1,
        modality: '1C' as const,
        weeklyHours: 4,
        regularPrereqs: [],
        approvedPrereqs: [],
        isElective: false,
      },
      {
        id: 99,
        code: '99',
        shortName: '',
        name: 'Fisiología Humana Celular Avanzada',
        level: 2,
        modality: '2C' as const,
        weeklyHours: 5,
        regularPrereqs: [6],
        approvedPrereqs: [],
        isElective: false,
      },
      {
        id: 103,
        code: '103',
        shortName: 'Bioquímica Aplicada',
        name: 'Bioquímica Aplicada',
        level: 3,
        modality: 'A' as const,
        weeklyHours: 6,
        regularPrereqs: [],
        approvedPrereqs: [6],
        isElective: false,
      },
    ];
    const threeLevelPlan: ActivePlanCatalog = {
      career: threeLevelCareer,
      plan: {
        id: 'plan-tq-2026',
        name: 'Plan 2026',
        year: 2026,
        config: threeLevelConfig,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      subjects: coreThreeLevels,
      rules: [],
      acronyms: {},
    };
    const subjectsById = new Map(coreThreeLevels.map((s) => [s.id, s]));

    // 1. Weekly grid uses catalog shortName or fullName truncation even for colliding IDs (6, 99)
    assert.equal(buildScheduleWeeklyGridSubjectLabel(6, coreThreeLevels[0].name, subjectsById), 'Química General');
    assert.equal(buildScheduleWeeklyGridSubjectLabel(99, coreThreeLevels[1].name, subjectsById), 'Fisiología Humana C...');

    // 2. ICS & clipboard metadata reflect the non-UTN career
    const exportMeta = buildScheduleSummaryExportMetadata(threeLevelPlan, '2026-11-14');
    assert.deepEqual(exportMeta, {
      clipboardHeader: '📅 MI HORARIO DE CURSADA — UNLP TQ (Plan 2026)\n',
      icsProdId: 'PRODID:-//Stack//Armador de Horarios//ES',
      icsUidDomain: '@micarrera.unlp',
      icsFilename: 'horarios-unlp-2026-11-14.ics',
    });

    // 3. ScheduleBuilder handles 3-level plan cleanly
    const builder = buildScheduleBuilderStructure({
      coreSubjects: coreThreeLevels,
      electives: [],
      includeAnalistaTrack: false,
      scheduleData: [],
      selectedCommissions: {},
    });
    assert.deepEqual(builder.availableSubjects.map((s) => s.id), [6]);

    // 4. LibraryHome emits 4 tabs (all + 1..3 cuatrimestres), NO electives tab, and neutral descriptions
    const lib = buildLibraryHomeStructure({
      subjects: coreThreeLevels,
      electives: [],
      planConfig: threeLevelConfig,
      career: threeLevelCareer,
    });
    assert.equal(lib.totalLevels, 3);
    assert.equal(lib.hasElectives, false);
    assert.deepEqual(lib.levelFilterTabs, [
      { id: 'all', label: 'Todas las materias' },
      { id: 1, label: '1° Cuatrimestre' },
      { id: 2, label: '2° Cuatrimestre' },
      { id: 3, label: '3° Cuatrimestre' },
    ]);
    assert.equal(
      lib.heroDescription,
      'Exámenes parciales y finales, resoluciones, apuntes y resúmenes compartidos por y para estudiantes de Tecnicatura en Química.'
    );
    assert.equal(
      getLibraryTermsIntroParagraph(threeLevelCareer, APP_NAME),
      `La Biblioteca de ${APP_NAME} es un espacio colaborativo desarrollado para la comunidad estudiantil de Tecnicatura en Química, cuyo único propósito es facilitar el intercambio académico libre y sin costo de recursos de aprendizaje.`
    );

    // 5. PlanSelectorModal, ProfessorsDirectory & Admin options remain plan-agnostic
    assert.equal(isPlanSelected('plan-tq-2026', threeLevelPlan.plan.id), true);
    assert.equal(isPlanSelected('plan-isi-2023', threeLevelPlan.plan.id), false);
    const dir = buildProfessorsDirectoryStructure(coreThreeLevels);
    const adminOpts = buildAdminPlanSubjectOptions(coreThreeLevels);

    const serialized = JSON.stringify({
      exportMeta,
      builder,
      lib,
      dir,
      adminOpts,
    });
    for (const forbidden of ['Analista', 'UTN', 'Sistemas', 'Ingeniero', '4°', '5°', 'Año', 'Electivas']) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `Estructura 2c de 3-niveles no debe contener "${forbidden}"`
      );
    }
  });

  it('preserves exact pre-Tanda-2c option values, labels and defaults in buildAdminPlanSubjectOptions for AdminScheduleTab and AdminReviewsTab', () => {
    const legacyMap = (subjects: Array<{ id: number; code: string; name: string }>) => ({
      options: subjects.map((s) => ({
        value: String(s.id),
        label: `#${s.code} ${s.name}`,
      })),
      defaultFormSubjectId: subjects[0]?.id ? String(subjects[0].id) : '',
    });

    // 1. Parity across ALL core subjects on normalized ISI 2023 payload and CORE_SUBJECTS fixture
    const coreFromPayload = ISI_PLAN.subjects.filter((s) => !s.isElective);
    const optionsFromPayload = buildAdminPlanSubjectOptions(coreFromPayload);
    const optionsFromFixture = buildAdminPlanSubjectOptions(CORE_SUBJECTS);
    const legacyFromFixture = legacyMap(CORE_SUBJECTS);

    assert.equal(coreFromPayload.every((s) => Number.isInteger(s.id) && s.id >= 1), true);
    assert.deepEqual(
      optionsFromPayload.map((o) => ({ value: o.value, label: o.label })),
      legacyFromFixture.options
    );
    assert.deepEqual(
      optionsFromFixture.map((o) => ({ value: o.value, label: o.label })),
      legacyFromFixture.options
    );
    assert.equal(optionsFromPayload[0]?.value ?? '', legacyFromFixture.defaultFormSubjectId);
    assert.equal(optionsFromFixture[0]?.value ?? '', legacyFromFixture.defaultFormSubjectId);

    // 2. Parity on non-ISI multi-career plan & empty list
    const otherSubjects = [
      { id: 101, code: 'BIO-1', name: 'Biología Celular' },
      { id: 102, code: 'BIO-2', name: 'Genética Molecular' },
    ];
    const otherOpts = buildAdminPlanSubjectOptions(otherSubjects);
    const legacyOther = legacyMap(otherSubjects);
    assert.deepEqual(
      otherOpts.map((o) => ({ value: o.value, label: o.label })),
      legacyOther.options
    );
    assert.equal(otherOpts[0]?.value ?? '', legacyOther.defaultFormSubjectId);

    assert.deepEqual(buildAdminPlanSubjectOptions([]), []);
    assert.equal(buildAdminPlanSubjectOptions([])[0]?.value ?? '', legacyMap([]).defaultFormSubjectId);

    // 3. Explicit edge-case invariant: if a hypothetical catalog used id=0 (falsy in legacy ternary),
    // subjectOptions[0]?.value ?? '' yields '0' whereas legacy subjects[0]?.id ? String(...) : '' yielded ''.
    // Real code_in_plan values are strictly >= 1.
    const zeroIdEdge = buildAdminPlanSubjectOptions([{ id: 0, code: '0', name: 'Zero Edge' }]);
    assert.equal(zeroIdEdge[0]?.value ?? '', '0');
    assert.equal(legacyMap([{ id: 0, code: '0', name: 'Zero Edge' }]).defaultFormSubjectId, '');
  });
});
