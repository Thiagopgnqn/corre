import * as xlsxModule from 'xlsx';
import {
  PLAN_TEMPLATE_HEADERS,
  PLAN_TEMPLATE_SHEETS,
  SUPPORTED_SPECIAL_RULE_TYPES,
} from './planImport.rules.js';

const XLSX = (xlsxModule as any).default || xlsxModule;

/**
 * Generates the canonical `.xlsx` study-plan template workbook buffer.
 * Uses strictly neutral fictitious 3-level example data without any UTN/Sistemas copy.
 */
export function buildPlanImportTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();

  const planRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PLAN]],
    [
      'Plan Modelo 2026', // Nombre del plan
      2026, // Año del plan
      'Cuatrimestre', // Etiqueta nivel
      3, // Total niveles
      4, // Créditos electivas requeridos
      1, // Equivalente slots electivas
      4, // Nota mínima aprobación
      'Licenciado/a en Tecnología Aplicada', // Título final
      'MOD · Plan 2026', // Etiqueta corta
      4, // Código materia PPS (opcional)
      'Habilitación Práctica', // Título PPS (opcional)
      'Cumplís los requisitos para cursar la práctica supervisada', // Descripción PPS (opcional)
      '', // Título intermedio (opcional)
      '', // Etiqueta título intermedio (opcional)
      '', // Título corto intermedio (opcional)
      '', // Clave trayecto intermedio (opcional)
      '', // Créditos electivas intermedio (opcional)
      '', // Código materia regla intermedio (opcional)
    ],
  ];

  const subjectRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS]],
    [1, '1', 'Fundamentos de Programación', 'Fundamentos Prog.', 1, '1C', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
    [2, '2', 'Matemática Básica', 'Matemática Básica', 1, '1C', 'NO', 5, 'obligatoria', '', 'NO', 'NO', ''],
    [3, '3', 'Estructuras de Datos', 'Estruct. de Datos', 2, '2C', 'NO', 6, 'obligatoria', '', 'SI', 'NO', ''],
    [4, '4', 'Práctica Supervisada', 'Práctica Sup.', 3, 'A', 'NO', 4, 'obligatoria', '', 'SI', 'NO', ''],
    [101, 'OPT-101', 'Tópicos Avanzados I', 'Tópicos I', 3, '1C', 'NO', 4, 'electiva', 4, 'NO', 'NO', ''],
  ];

  const prerequisiteRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
    [3, 1, 'regular'],
    [3, 2, 'regular'],
    [4, 1, 'aprobada'],
    [4, 2, 'aprobada'],
    [101, 3, 'regular'],
  ];

  const ruleRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [
      4,
      'all_previous_core_approved',
      '{}',
      'Para aprobar es necesario tener aprobadas todas las obligatorias previas.',
    ],
  ];

  const acronymRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
    ['FPROG', 1],
    ['EDD', 3],
    ['PRAC', 4],
  ];

  const instructionRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.INSTRUCTIONS]],
    ['Plan', 'Nombre del plan', 'Sí', 'Texto de 2 a 120 caracteres. Define el nombre visible del plan.'],
    ['Plan', 'Año del plan', 'Sí', 'Entero entre 1950 y 2100.'],
    ['Plan', 'Etiqueta nivel', 'No', 'Ej.: "Año", "Cuatrimestre" o "Semestre". Por defecto "Año".'],
    ['Plan', 'Total niveles', 'No', 'Entero entre 1 y 12. Si se omite se calcula desde Materias.'],
    ['Plan', 'Créditos electivas requeridos / Equivalente slots electivas', 'No', 'Números >= 0. Usar 0 si el plan no tiene electivas.'],
    ['Plan', 'Nota mínima aprobación', 'No', 'Entero 1..10 (por defecto 4).'],
    ['Plan', 'Columnas PPS e intermedio', 'No', 'Dejar vacías si el plan no define PPS ni título intermedio.'],
    ['Materias', 'Código', 'Sí', 'Entero único >= 1 dentro del plan (identificador estable).'],
    ['Materias', 'Código visible', 'No', 'Texto hasta 32 caracteres (ej. "1", "OPT-101"). Sin prefijos automáticos.'],
    ['Materias', 'Modalidad', 'Sí', 'Valores válidos: A, 1C, 2C, 1C/2C, 1C-CC, 2C-CC.'],
    ['Materias', 'Contra-cuatrimestral / Integradora / Trayecto opcional', 'No', 'Valores válidos: SI o NO (por defecto NO).'],
    ['Materias', 'Tipo', 'Sí', 'obligatoria o electiva. Créditos requerido/numérico en electivas.'],
    ['Correlativas', 'Tipo requisito', 'Sí', 'regular o aprobada. No se permiten ciclos ni auto-correlativas.'],
    [
      'Reglas',
      'Tipo regla',
      'Sí',
      `Únicamente: ${SUPPORTED_SPECIAL_RULE_TYPES.join(' o ')}. approved_range requiere {"fromCode": N, "toCode": M}.`,
    ],
    ['Acrónimos', 'Sigla', 'Sí', 'Código alfanumérico corto (2 a 16 caracteres) único por plan.'],
    ['Límites', 'Seguridad de importación', 'Sí', 'Solo archivos .xlsx <= 5 MB, máx. 10 hojas, máx. 2000 filas, sin fórmulas ni macros.'],
  ];

  const appendSheet = (name: string, rows: unknown[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  appendSheet(PLAN_TEMPLATE_SHEETS.PLAN, planRows);
  appendSheet(PLAN_TEMPLATE_SHEETS.SUBJECTS, subjectRows);
  appendSheet(PLAN_TEMPLATE_SHEETS.PREREQUISITES, prerequisiteRows);
  appendSheet(PLAN_TEMPLATE_SHEETS.RULES, ruleRows);
  appendSheet(PLAN_TEMPLATE_SHEETS.ACRONYMS, acronymRows);
  appendSheet(PLAN_TEMPLATE_SHEETS.INSTRUCTIONS, instructionRows);

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(out);
}
