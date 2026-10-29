import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar datos actuales del frontend
import { CORE_SUBJECTS } from '../../../src/data/plan2023.js';
import { ELECTIVES } from '../../../src/data/electives.js';
import { ACRONYM_TO_ID } from '../../../src/data/acronyms.js';

const targetDir = path.resolve(__dirname, '../../seed-data');
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
      intermediateDegrees: [
        {
          key: 'analista',
          name: 'Analista Universitario en Sistemas',
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
      description: 'Requiere tener aprobadas todas las materias del ciclo básico y nivel 2 (códigos 1 al 23).',
    },
    {
      subjectCode: 36, // Proyecto Final
      ruleType: 'all_previous_core_approved',
      params: { excludeTrackKeys: ['analista'] },
      description: 'Requiere tener aprobadas todas las materias obligatorias previas del plan (excluye Seminario si no se optó por Analista).',
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

