import type { Subject } from '../types/career';
import { ACRONYM_TO_ID } from './acronyms';

export interface ElectiveSubject extends Subject {
  isElective: true;
  credits: number;
}

// Configuración general de créditos requeridos (fácil de editar)
export const REQUIRED_ELECTIVE_CREDITS_TOTAL = 20;
export const REQUIRED_ANALISTA_ELECTIVE_CREDITS = 4;
export const ELECTIVE_SLOTS_EQUIVALENT = 7; // 20 créditos / ~3 cr por electiva (redondeado hacia arriba)

export const ELECTIVES: ElectiveSubject[] = [
  // ================= NIVEL SUGERIDO 3 =================
  {
    id: 301,
    code: 'E-301',
    name: 'Backend de Aplicaciones',
    level: 3,
    modality: '2C',
    weeklyHours: 4,
    regularPrereqs: [ACRONYM_TO_ID.PPR, ACRONYM_TO_ID.SSL], // 14, 13
    approvedPrereqs: [ACRONYM_TO_ID.AED], // 6
    isElective: true,
    credits: 4,
  },

  // ================= NIVEL SUGERIDO 4 =================
  {
    id: 401,
    code: 'E-401',
    name: 'Green Software',
    level: 4,
    modality: '1C/2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.DDS, ACRONYM_TO_ID.BDA], // 20, 19
    approvedPrereqs: [ACRONYM_TO_ID.PPR, ACRONYM_TO_ID.SSL], // 14, 13
    isElective: true,
    credits: 3,
  },
  {
    id: 402,
    code: 'E-402',
    name: 'Gestión Industrial de la Producción',
    level: 4,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.BDA], // 19
    approvedPrereqs: [ACRONYM_TO_ID.SPN, ACRONYM_TO_ID.ASI], // 8, 16
    isElective: true,
    credits: 3,
  },
  {
    id: 403,
    code: 'E-403',
    name: 'Gestión de la Mejora de los Procesos',
    level: 4,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.BDA], // 19
    approvedPrereqs: [ACRONYM_TO_ID.SPN, ACRONYM_TO_ID.ASI], // 8, 16
    isElective: true,
    credits: 3,
  },
  {
    id: 404,
    code: 'E-404',
    name: 'Desarrollo y Operaciones DevOps',
    level: 4,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.BDA, ACRONYM_TO_ID.DDS], // 19, 20
    approvedPrereqs: [ACRONYM_TO_ID.PPR, ACRONYM_TO_ID.SSL], // 14, 13
    isElective: true,
    credits: 3,
  },
  {
    id: 405,
    code: 'E-405',
    name: 'Desarrollo de Aplicaciones con Objetos',
    level: 4,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.SSL], // 13
    approvedPrereqs: [ACRONYM_TO_ID.AED], // 6
    isElective: true,
    credits: 3,
  },
  {
    id: 406,
    code: 'E-406',
    name: 'Comunicación Multimedial en el Desarrollo de Sistemas de Información',
    level: 4,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.BDA], // 19
    approvedPrereqs: [ACRONYM_TO_ID.SPN, ACRONYM_TO_ID.ASI], // 8, 16
    isElective: true,
    credits: 3,
  },
  {
    id: 407,
    code: 'E-407',
    name: 'Arquitectura de Software',
    level: 4,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.BDA, ACRONYM_TO_ID.DDS], // 19, 20
    approvedPrereqs: [ACRONYM_TO_ID.PPR, ACRONYM_TO_ID.SSL], // 14, 13
    isElective: true,
    credits: 3,
  },

  // ================= NIVEL SUGERIDO 5 =================
  {
    id: 501,
    code: 'E-501',
    name: 'Desarrollo de Tecnologías Blockchain',
    level: 5,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.RDA, ACRONYM_TO_ID.BDA], // 26, 19
    approvedPrereqs: [ACRONYM_TO_ID.PPR, ACRONYM_TO_ID.DDS], // 14, 20
    isElective: true,
    credits: 3,
  },
  {
    id: 502,
    code: 'E-502',
    name: 'Creatividad e Innovación en Ingeniería',
    level: 5,
    modality: '1C/2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM], // 30
    approvedPrereqs: [ACRONYM_TO_ID.DDS], // 20
    isElective: true,
    credits: 3,
  },
  {
    id: 503,
    code: 'E-503',
    name: 'Auditoría de SI/TI',
    level: 5,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM], // 30
    approvedPrereqs: [ACRONYM_TO_ID.DDS], // 20
    isElective: true,
    credits: 3,
  },
  {
    id: 504,
    code: 'E-504',
    name: 'Gerenciamiento Estratégico',
    level: 5,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM], // 30
    approvedPrereqs: [ACRONYM_TO_ID.DDS], // 20
    isElective: true,
    credits: 3,
  },
  {
    id: 505,
    code: 'E-505',
    name: 'Consultoría en Negocios Digitales',
    level: 5,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM], // 30
    approvedPrereqs: [ACRONYM_TO_ID.DDS], // 20
    isElective: true,
    credits: 3,
  },
  {
    id: 506,
    code: 'E-506',
    name: 'Emprendimientos Tecnológicos',
    level: 5,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM], // 30
    approvedPrereqs: [ACRONYM_TO_ID.ASI, ACRONYM_TO_ID.BDA], // 16, 19
    isElective: true,
    credits: 3,
  },
  {
    id: 507,
    code: 'E-507',
    name: 'Decisiones en Escenarios Complejos',
    level: 5,
    modality: '1C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.IOP], // 27
    approvedPrereqs: [ACRONYM_TO_ID.BDA], // 19
    isElective: true,
    credits: 3,
  },
  {
    id: 508,
    code: 'E-508',
    name: 'Testing de Software',
    level: 5,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ICS], // 25
    approvedPrereqs: [ACRONYM_TO_ID.BDA, ACRONYM_TO_ID.DDS], // 19, 20
    isElective: true,
    credits: 3,
  },
  {
    id: 509,
    code: 'E-509',
    name: 'Seguridad en el Desarrollo de Software',
    level: 5,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.RDA, ACRONYM_TO_ID.BDA], // 26, 19
    approvedPrereqs: [ACRONYM_TO_ID.DDS, ACRONYM_TO_ID.SPN], // 20, 8
    isElective: true,
    credits: 3,
  },
  {
    id: 510,
    code: 'E-510',
    name: 'Integración de Aplicaciones en Entorno Web',
    level: 5,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.RDA, ACRONYM_TO_ID.BDA], // 26, 19
    approvedPrereqs: [ACRONYM_TO_ID.BDA, ACRONYM_TO_ID.DDS], // 19, 20
    isElective: true,
    credits: 3,
  },
  {
    id: 511,
    code: 'E-511',
    name: 'Ingeniería de Software de fuentes abiertas/libres',
    level: 5,
    modality: '2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.DDS, ACRONYM_TO_ID.BDA, ACRONYM_TO_ID.RDA], // 20, 19, 26
    approvedPrereqs: [ACRONYM_TO_ID.SSL, ACRONYM_TO_ID.PPR], // 13, 14
    isElective: true,
    credits: 3,
  },
  {
    id: 408,
    code: 'X-408',
    name: 'Experiencia e Interfaces de Usuario (UI/UX)',
    level: 4,
    modality: '1C/2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.DDS],
    approvedPrereqs: [ACRONYM_TO_ID.PPR],
    isElective: true,
    credits: 3,
  },
  {
    id: 512,
    code: 'X-512',
    name: 'Habilidades Blandas',
    level: 5,
    modality: '1C/2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM],
    approvedPrereqs: [ACRONYM_TO_ID.DDS],
    isElective: true,
    credits: 3,
  },
  {
    id: 513,
    code: 'X-513',
    name: 'Creatividad y Desarrollo de Entornos Virtuales',
    level: 5,
    modality: '1C/2C',
    weeklyHours: 3,
    regularPrereqs: [ACRONYM_TO_ID.ADM],
    approvedPrereqs: [ACRONYM_TO_ID.DDS],
    isElective: true,
    credits: 3,
  },
  {
    id: 514,
    code: 'X-514',
    name: 'Práctica Profesional Supervisada',
    level: 5,
    modality: 'A',
    weeklyHours: 4,
    regularPrereqs: [ACRONYM_TO_ID.ADM],
    approvedPrereqs: [ACRONYM_TO_ID.DDS, ACRONYM_TO_ID.BDA],
    isElective: true,
    credits: 4,
  },
];
