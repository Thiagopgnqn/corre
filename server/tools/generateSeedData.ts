import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar datos actuales del frontend (fuera del backend)
import { CORE_SUBJECTS } from '../../test/fixtures/plan2023.js';
import { ELECTIVES } from '../../test/fixtures/electives.js';
import { ACRONYM_TO_ID } from '../../test/fixtures/acronyms.js';

const targetDir = path.resolve(__dirname, '../seed-data');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Estructurar el catálogo completo
const catalog = {
  institution: {
    name: 'Universidad Tecnológica Nacional',
    code: 'UTN',
  },
  faculty: {
    name: 'Facultad Regional Córdoba',
    code: 'FRC',
  },
  career: {
    name: 'Ingeniería en Sistemas de Información',
    code: 'ISI',
  },
  studyPlan: {
    name: 'Plan 2023',
    year: 2023,
    isActive: true,
    config: {
      requiredElectiveCredits: 20,
      defaultMinPassingGrade: 4,
      electiveSlotsEquivalent: 7,
      totalLevels: 5,
      levelLabel: 'Año',
      shortTag: 'ISI · Plan 2023',
      finalDegreeTitle: 'Ingeniero/a',
      ppsRequirement: {
        referenceSubjectCode: 36,
        label: 'Habilitación PPS',
        description: 'Cumplís los requisitos para cursar la Práctica Profesional',
      },
      intermediateDegrees: [
        {
          key: 'analista',
          name: 'Analista Universitario de Sistemas de Información',
          shortLabel: 'Analista',
          shortTitle: 'Analista Universitario',
          requiredElectiveCredits: 4,
          specialRuleSubjectCode: 99,
        },
      ],
    },
  },
  specialRules: [
    {
      subjectCode: 99, // Seminario Integrador
      ruleType: 'approved_range',
      params: { fromCode: 1, toCode: 23 },
      description: 'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.',
    },
    {
      subjectCode: 36, // Proyecto Final
      ruleType: 'all_previous_core_approved',
      params: { excludeTrackKeys: ['analista'] },
      description: 'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).',
    },
  ],
  acronyms: Object.entries(ACRONYM_TO_ID).map(([acronym, subjectCode]) => ({
    acronym,
    subjectCode,
  })),
  subjects: [
    ...CORE_SUBJECTS.map((s) => ({
      codeInPlan: s.id,
      name: s.name,
      shortName: s.name,
      level: s.level,
      modality: s.modality,
      contraCuatrimestral: s.modality.includes('CC'),
      weeklyHours: s.weeklyHours,
      kind: 'obligatoria',
      credits: null,
      isOptionalTrack: s.id === 99,
      trackKey: s.id === 99 ? 'analista' : null,
      isIntegrator: Boolean(s.isIntegrator),
      regularPrereqs: s.regularPrereqs,
      approvedPrereqs: s.approvedPrereqs,
    })),
    ...ELECTIVES.map((e) => ({
      codeInPlan: e.id,
      name: e.name,
      shortName: e.name,
      level: e.level,
      modality: e.modality,
      contraCuatrimestral: false,
      weeklyHours: e.weeklyHours,
      kind: 'electiva',
      credits: e.credits,
      isOptionalTrack: false,
      trackKey: null,
      isIntegrator: false,
      regularPrereqs: e.regularPrereqs,
      approvedPrereqs: e.approvedPrereqs,
    })),
  ],
};

const outputPath = path.join(targetDir, 'plan2023-catalog.json');
fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2), 'utf8');

console.log(`✅ Archivo de seed generado exitosamente en: ${outputPath}`);
console.log(`📊 Materias obligatorias: ${CORE_SUBJECTS.length}`);
console.log(`📊 Materias electivas: ${ELECTIVES.length}`);
console.log(`📊 Siglas registradas: ${Object.keys(ACRONYM_TO_ID).length}`);

