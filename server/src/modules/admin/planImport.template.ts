import * as xlsxModule from 'xlsx';
import {
  PLAN_TEMPLATE_HEADERS,
  PLAN_TEMPLATE_SHEETS,
  SUPPORTED_SPECIAL_RULE_TYPES,
} from './planImport.rules.js';

const XLSX = (xlsxModule as any).default || xlsxModule;

/**
 * Generates the canonical `.xlsx` study-plan template workbook buffer.
 * Uses strictly neutral fictitious 5-level "Ingeniería Ficticia" example data
 * without any Sistemas (ISI) or Industrial (IND) data.
 */
export function buildPlanImportTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();

  const planRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PLAN]],
    [
      'Plan Ingeniería Ficticia 2026', // Nombre del plan
      2026, // Año del plan
      'Año', // Etiqueta nivel
      5, // Total niveles
      6, // Créditos electivas requeridos
      2, // Equivalente slots electivas
      4, // Nota mínima aprobación
      'Ingeniero/a Ficticio/a', // Título final
      'IFIC · Plan 2026', // Etiqueta corta
      7, // Código materia PPS (opcional)
      'Habilitación Práctica Ficticia', // Título PPS (opcional)
      'Cumplís los requisitos para cursar la práctica supervisada ficticia.', // Descripción PPS (opcional)
      'Técnico/a Universitario/a Ficticio/a', // Título intermedio (opcional)
      'Técnico', // Etiqueta título intermedio (opcional)
      'Técnico Ficticio', // Título corto intermedio (opcional)
      'tecnico', // Clave trayecto intermedio (opcional)
      4, // Créditos electivas intermedio (opcional)
      5, // Código materia regla intermedio (opcional)
    ],
  ];

  const subjectRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS]],
    [1, 'IFIC-1', 'Dibujo Técnico', 'Dibujo Téc.', 1, 'A', 'NO', 4, 'obligatoria', '', 'NO', 'NO', ''],
    [2, 'IFIC-2', 'Física General', 'Física Gral.', 1, 'A', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
    [3, 'IFIC-3', 'Termodinámica Básica', 'Termodinámica', 2, '1C', 'NO', 5, 'obligatoria', '', 'NO', 'NO', ''],
    [4, 'IFIC-4', 'Taller de Diseño Aplicado', 'Taller Diseño', 2, '2C', 'NO', 4, 'obligatoria', '', 'SI', 'NO', ''],
    [5, 'IFIC-5', 'Taller Intermedio de Síntesis', 'Taller Síntesis', 3, 'A', 'NO', 6, 'obligatoria', '', 'SI', 'NO', ''],
    [6, 'IFIC-6', 'Ingeniería de Procesos Ficticios', 'Ing. Procesos', 4, '1C', 'NO', 6, 'obligatoria', '', 'NO', 'NO', ''],
    [7, 'IFIC-7', 'Práctica Profesional Ficticia', 'Práctica Fict.', 4, '2C', 'NO', 4, 'obligatoria', '', 'NO', 'NO', ''],
    [8, 'IFIC-8', 'Proyecto Integrador Final', 'Proyecto Final', 5, 'A', 'NO', 8, 'obligatoria', '', 'SI', 'NO', ''],
    [101, 'ELEC-101', 'Seminario Ficticio Alpha', 'Seminario Alpha', 4, '1C-CC', 'SI', 4, 'electiva', 4, 'NO', 'NO', ''],
    [102, 'ELEC-102', 'Laboratorio Ficticio Beta', 'Lab. Beta', 5, '2C', 'NO', 4, 'electiva', 6, 'NO', 'NO', ''],
  ];

  const prerequisiteRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES]],
    [3, 2, 'regular'],
    [4, 1, 'aprobada'],
    [5, 3, 'regular'],
    [5, 4, 'regular'],
    [6, 5, 'regular'],
    [7, 3, 'aprobada'],
    [7, 4, 'aprobada'],
    [7, 5, 'regular'],
    [8, 5, 'aprobada'],
    [8, 6, 'regular'],
    [101, 3, 'regular'],
    [102, 6, 'regular'],
  ];

  const ruleRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES]],
    [
      5,
      'approved_range',
      1,
      4,
      '',
      'Para aprobar el Taller Intermedio debés tener aprobadas las materias obligatorias 1 a 4.',
    ],
    [
      8,
      'all_previous_core_approved',
      '',
      '',
      '',
      'Para aprobar el Proyecto Integrador Final debés tener aprobadas todas las obligatorias previas.',
    ],
  ];

  const acronymRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS]],
    ['DIB', 1],
    ['TIS', 5],
    ['PPF', 7],
    ['PIF', 8],
  ];

  const instructionRows: unknown[][] = [
    [...PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.INSTRUCTIONS]],
    ['Plan', 'Nombre del plan', 'Sí', 'Texto de 2 a 120 caracteres. Define el nombre visible del plan.', 'Plan Ingeniería Ficticia 2026'],
    ['Plan', 'Año del plan', 'Sí', 'Entero entre 1950 y 2100.', '2026'],
    ['Plan', 'Etiqueta nivel', 'No', 'Texto <= 30 caracteres (por defecto "Año"). Ej.: "Año", "Cuatrimestre", "Semestre".', 'Año'],
    ['Plan', 'Total niveles', 'No', 'Entero entre 1 y 12. Si se omite se calcula como el máximo Nivel de Materias.', '5'],
    ['Plan', 'Créditos electivas requeridos', 'No', 'Entero >= 0 (usar 0 si el plan no requiere electivas).', '6'],
    ['Plan', 'Equivalente slots electivas', 'No', 'Número >= 0 equivalente en cantidad aproximada de materias electivas.', '2'],
    ['Plan', 'Nota mínima aprobación', 'No', 'Entero entre 1 y 10 (por defecto 4).', '4'],
    ['Plan', 'Título final', 'No', 'Nombre del título final <= 80 caracteres.', 'Ingeniero/a Ficticio/a'],
    ['Plan', 'Etiqueta corta', 'No', 'Texto breve <= 60 caracteres mostrado en selector/barra superior.', 'IFIC · Plan 2026'],
    ['Plan', 'Código materia PPS', 'No', 'Código entero de Materias que representa la PPS (obligatoria o electiva).', '7'],
    ['Plan', 'Título PPS', 'No', 'Título de la tarjeta de habilitación PPS <= 120 caracteres.', 'Habilitación Práctica Ficticia'],
    ['Plan', 'Descripción PPS', 'No', 'Texto informativo cuando el alumno cumple requisitos de PPS.', 'Cumplís los requisitos para cursar la práctica supervisada ficticia.'],
    ['Plan', 'Título intermedio', 'No', 'Nombre oficial del título intermedio <= 140 caracteres (vacío si no existe).', 'Técnico/a Universitario/a Ficticio/a'],
    ['Plan', 'Etiqueta título intermedio', 'No', 'Etiqueta breve para el botón switch superior.', 'Técnico'],
    ['Plan', 'Título corto intermedio', 'No', 'Nombre abreviado para tarjetas y resúmenes.', 'Técnico Ficticio'],
    ['Plan', 'Clave trayecto intermedio', 'No', 'Identificador en minúsculas del trayecto asociado al título intermedio.', 'tecnico'],
    ['Plan', 'Créditos electivas intermedio', 'No', 'Entero >= 0 con créditos de electivas exigidos para el título intermedio (0 si no exige).', '4'],
    ['Plan', 'Código materia regla intermedio', 'No', 'Código de materia integradora/hito que dispara el análisis de título intermedio (opcional).', '5'],
    ['Materias', 'Código', 'Sí', 'Entero positivo único (1..9999) identificador interno del plan.', '1'],
    ['Materias', 'Código visible', 'No', 'Texto hasta 32 caracteres mostrado en UI (por defecto igual a Código; sin prefijos automáticos).', 'ELEC-101'],
    ['Materias', 'Nombre', 'Sí', 'Nombre completo de la materia (2 a 200 caracteres).', 'Dibujo Técnico'],
    ['Materias', 'Nombre corto', 'No', 'Nombre abreviado <= 60 caracteres para grillas (si se omite se deriva del Nombre).', 'Dibujo Téc.'],
    ['Materias', 'Nivel', 'Sí', 'Entero entre 1 y 12 (no puede superar "Total niveles" si está definido).', '1'],
    ['Materias', 'Modalidad', 'Sí', 'A (anual), 1C (1er cuatr.), 2C (2do cuatr.), 1C/2C (ambos), 1C-CC (1C + contracuatr.), 2C-CC (2C + contracuatr.).', '1C-CC'],
    ['Materias', 'Contra-cuatrimestral', 'No', 'SI/NO o vacío. Debe ser coherente: 1C-CC/2C-CC deducen SI (rechaza NO); A/1C/2C/1C/2C exigen NO o vacío (rechaza SI).', 'NO'],
    ['Materias', 'Horas semanales', 'Sí', 'Número entre 0 y 40 (admite decimales con punto o coma).', '6'],
    ['Materias', 'Tipo', 'Sí', '"obligatoria" o "electiva".', 'obligatoria'],
    ['Materias', 'Créditos', 'No', 'Entero entre 0 y 100 (recomendado numérico en materias electivas).', '4'],
    ['Materias', 'Integradora', 'No', 'SI o NO (por defecto NO). Indica materia integradora del nivel.', 'NO'],
    ['Materias', 'Trayecto opcional', 'No', 'SI o NO (por defecto NO). Marca si pertenece a un trayecto opcional.', 'NO'],
    ['Materias', 'Clave trayecto', 'No', 'Minúsculas, números, guion o guion bajo (<= 40 caracteres). Obligatoria si Trayecto opcional = SI.', 'tecnico'],
    ['Correlativas', 'Código materia', 'Sí', 'Código entero existente en "Materias" que tiene el requisito.', '3'],
    ['Correlativas', 'Código requisito', 'Sí', 'Código entero existente en "Materias" requerido (sin ciclos ni auto-correlativas).', '2'],
    ['Correlativas', 'Tipo requisito', 'Sí', '"regular" o "aprobada".', 'regular'],
    ['Reglas', 'Código materia', 'Sí', 'Código entero de "Materias" sobre el que aplica la regla.', '5'],
    ['Reglas', 'Tipo regla', 'Sí', `Únicamente: ${SUPPORTED_SPECIAL_RULE_TYPES.join(' o ')}.`, 'approved_range'],
    ['Reglas', 'Desde código', 'No', 'Entero positivo; obligatorio en approved_range (dejar vacío en all_previous_core_approved).', '1'],
    ['Reglas', 'Hasta código', 'No', 'Entero positivo >= Desde código; obligatorio en approved_range (vacío en all_previous_core_approved).', '4'],
    ['Reglas', 'Trayectos excluidos', 'No', 'Claves separadas por coma existentes en "Clave trayecto"; solo para all_previous_core_approved.', 'orientacion_b'],
    ['Reglas', 'Descripción', 'No', 'Texto hasta 500 caracteres mostrado al estudiante (si se omite se genera uno por defecto).', 'Requiere obligatorias de código 1 a 4 aprobadas.'],
    ['Acrónimos', 'Sigla', 'Sí', 'Código alfanumérico (2 a 16 caracteres, A-Z/0-9/_/-) único dentro del plan.', 'DIB'],
    ['Acrónimos', 'Código materia', 'Sí', 'Código entero existente en "Materias".', '1'],
    ['Límites', 'Seguridad de importación', 'Sí', 'Solo archivos .xlsx <= 5 MB, máx. 10 hojas, máx. 2000 filas, sin fórmulas ni macros VBA.', 'plantilla.xlsx'],
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
