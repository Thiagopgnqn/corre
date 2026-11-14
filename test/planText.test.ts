import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPlanCatalogPayload } from '../server/src/modules/catalog/planConfig.helpers';
import { TUTORIAL_STEPS } from '../src/data/tutorialSteps';
import { SUBJECT_SHORT_NAMES } from '../src/components/schedule/ScheduleWeeklyGrid';
import { APP_NAME } from '../src/config/brand';
import type { ActivePlanCatalog, UserCareerState } from '../src/types/career';
import {
  buildPlanTutorialSteps,
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
  getScheduleIcsUidDomain,
  getScheduleShortSubjectName,
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
    assert.equal(getPpsMilestoneDesc(), ISI_2023_FROZEN_UI_TEXTS.statsDashboard.ppsDesc);

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
    // Documented minor wording discrepancy: catalog DB stores "en Sistemas" while current StatsDashboard L152/L641 show shortened / "de Sistemas"
    assert.equal(
      getIntermediateDegreeMilestoneTitle(analistaDegree),
      'Título Intermedio: Analista Universitario en Sistemas'
    );
    assert.equal(
      getIntermediateDegreeCardHeading(analistaDegree),
      'Título Intermedio: Analista Universitario en Sistemas'
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
    assert.equal(
      getScheduleIcsFilename(ISI_PLAN.career, '2026-11-14'),
      ISI_2023_FROZEN_UI_TEXTS.schedule.icsFilename
    );
    assert.equal(getScheduleIcsUidDomain(ISI_PLAN.career), ISI_2023_FROZEN_UI_TEXTS.schedule.icsUidDomain);

    assert.equal(getLibraryHeroDescription(ISI_PLAN.career), ISI_2023_FROZEN_UI_TEXTS.library.homeHeroDesc);
    assert.equal(getLibraryTermsIntroParagraph(ISI_PLAN.career), ISI_2023_FROZEN_UI_TEXTS.library.termsIntro);

    // Tutorial steps match both the frozen constants AND current TUTORIAL_STEPS verbatim
    const derivedSteps = buildPlanTutorialSteps(TUTORIAL_STEPS, ISI_PLAN);
    assert.equal(derivedSteps.length, TUTORIAL_STEPS.length);
    const graphStep = derivedSteps.find((s) => s.id === 'graph-overview')!;
    const electivesStep = derivedSteps.find((s) => s.id === 'electives-tour')!;
    const analistaStep = derivedSteps.find((s) => s.id === 'analista-switch')!;
    assert.equal(graphStep.description, ISI_2023_FROZEN_UI_TEXTS.tutorial.graphOverviewDesc);
    assert.equal(electivesStep.title, ISI_2023_FROZEN_UI_TEXTS.tutorial.electivesTitle);
    assert.equal(electivesStep.description, ISI_2023_FROZEN_UI_TEXTS.tutorial.electivesDesc);
    assert.equal(analistaStep.title, ISI_2023_FROZEN_UI_TEXTS.tutorial.analistaTitle);
    assert.equal(analistaStep.description, ISI_2023_FROZEN_UI_TEXTS.tutorial.analistaDesc);
    assert.deepEqual(derivedSteps, TUTORIAL_STEPS);
  });

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
    for (const id of alignedAndCoreIds) {
      const subj = ISI_PLAN.subjects.find((s) => s.id === id)!;
      const resolved = getScheduleShortSubjectName(subj.id, subj.name, subj);
      assert.equal(resolved, subj.shortName);
      if (SUBJECT_SHORT_NAMES[id]) {
        assert.equal(resolved, SUBJECT_SHORT_NAMES[id], `Mismatch on aligned subject #${id}`);
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
    assert.deepEqual(getLevelNumbers(bioPlan.plan.config), [1, 2, 3, 4]);
    assert.equal(getDemoTargetLevel(bioPlan.plan.config), 2);
    assert.equal(getDemoNavbarLabel(bioPlan.plan.config), 'Cargar demo (2do cuatrimestre)');
    assert.equal(getDemoOnboardingLabel(bioPlan.plan.config), 'Cargar demo: Alumno de 2do cuatrimestre');
    assert.equal(getScheduleClipboardHeader(bioPlan), '📅 MI HORARIO DE CURSADA — BIO (Plan 2026)\n');
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
});
