import { parentPort, workerData } from 'node:worker_threads';
import * as xlsxModule from 'xlsx';
import {
  ALLOWED_PREREQ_TYPES,
  ALLOWED_SUBJECT_KINDS,
  ALLOWED_SUBJECT_MODALITIES,
  PLAN_IMPORT_MAX_ROWS,
  PLAN_IMPORT_MAX_SHEETS,
  PLAN_TEMPLATE_HEADERS,
  PLAN_TEMPLATE_SHEETS,
  deriveShortSubjectName,
  validateSpecialRuleParams,
  type AllowedPrereqType,
  type AllowedSubjectKind,
  type AllowedSubjectModality,
} from './planImport.rules.js';
import type {
  ParsedAcronymRow,
  ParsedPlanMetadata,
  ParsedPlanWorkbookData,
  ParsedPrerequisiteRow,
  ParsedSpecialRuleRow,
  ParsedSubjectRow,
  ParsePlanWorkbookResult,
  PlanImportIssue,
} from './planImport.types.js';

const XLSX = (xlsxModule as any).default || xlsxModule;

interface WorkerInputPayload {
  fileBytes: Uint8Array;
  artificialDelayMs?: number;
}

const MAX_CELLS_PER_SHEET = 50_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDangerousFormulaOrControlText(raw: string): boolean {
  const trimmed = raw.trimStart();
  if (!trimmed) return false;
  const first = trimmed[0];
  return first === '=' || first === '@' || raw.startsWith('\t') || raw.startsWith('\r');
}

function normalizeCellValueToString(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  return '';
}

function parseStrictBoolean(raw: string): { ok: true; value: boolean } | { ok: false } {
  const upper = raw.trim().toUpperCase();
  if (upper === '' || upper === 'NO' || upper === 'FALSE' || upper === '0' || upper === 'N') {
    return { ok: true, value: false };
  }
  if (upper === 'SI' || upper === 'SÍ' || upper === 'TRUE' || upper === '1' || upper === 'S') {
    return { ok: true, value: true };
  }
  return { ok: false };
}

function parseStrictInt(raw: string): number | null {
  if (!raw.trim()) return null;
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

function parseStrictFiniteNumber(raw: string): number | null {
  if (!raw.trim()) return null;
  const normalized = raw.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function makeEmptyStats(): ParsePlanWorkbookResult['stats'] {
  return {
    sheetCount: 0,
    totalRowsProcessed: 0,
    subjectsCount: 0,
    coreSubjectsCount: 0,
    electiveSubjectsCount: 0,
    prerequisitesCount: 0,
    specialRulesCount: 0,
    acronymsCount: 0,
    maxLevel: 0,
  };
}

/**
 * Extracts populated rows using direct cell-key scanning without touching prototype chains
 * and without iterating sparse Excel ranges (guards against 1M-row empty-range DoS).
 */
function extractSafeSheetRows(
  sheet: Record<string, any>,
  sheetName: string,
  errors: PlanImportIssue[]
): { rows: Array<{ rowNumber: number; cells: Map<number, string> }> } | null {
  const keys = Object.keys(sheet);
  if (keys.length > MAX_CELLS_PER_SHEET) {
    errors.push({
      sheet: sheetName,
      row: 0,
      message: `La hoja "${sheetName}" supera el límite de ${MAX_CELLS_PER_SHEET} celdas pobladas.`,
    });
    return null;
  }

  const rowMap = new Map<number, Map<number, string>>();

  for (const key of keys) {
    if (key.startsWith('!') || FORBIDDEN_KEYS.has(key)) continue;
    const cell = sheet[key];
    if (!cell || typeof cell !== 'object') continue;

    let coords: { r: number; c: number };
    try {
      coords = XLSX.utils.decode_cell(key);
    } catch {
      continue;
    }

    if (coords.c < 0 || coords.r < 0 || coords.c > 64) {
      continue;
    }

    // Reject Excel formula cells cleanly (no formula evaluation)
    if (typeof cell.f === 'string' && cell.f.trim().length > 0) {
      errors.push({
        sheet: sheetName,
        row: coords.r + 1,
        field: key,
        message: 'No se permiten fórmulas en el archivo (pegá únicamente valores).',
      });
      continue;
    }

    const strVal = normalizeCellValueToString(cell.v);
    if (!strVal) continue;

    if (isDangerousFormulaOrControlText(strVal)) {
      errors.push({
        sheet: sheetName,
        row: coords.r + 1,
        field: key,
        message: 'Valor no permitido: comienza con prefijo de fórmula (=, @) o carácter de control.',
      });
      continue;
    }

    let cols = rowMap.get(coords.r);
    if (!cols) {
      cols = new Map<number, string>();
      rowMap.set(coords.r, cols);
      if (rowMap.size > PLAN_IMPORT_MAX_ROWS) {
        errors.push({
          sheet: sheetName,
          row: coords.r + 1,
          message: `Se superó el máximo de ${PLAN_IMPORT_MAX_ROWS} filas permitidas.`,
        });
        return null;
      }
    }
    cols.set(coords.c, strVal);
  }

  const sortedRowIndices = Array.from(rowMap.keys()).sort((a, b) => a - b);
  return {
    rows: sortedRowIndices.map((r) => ({
      rowNumber: r + 1,
      cells: rowMap.get(r)!,
    })),
  };
}

function validateHeaderRow(
  sheetName: string,
  expectedHeaders: readonly string[],
  extractedRows: Array<{ rowNumber: number; cells: Map<number, string> }>,
  errors: PlanImportIssue[]
): boolean {
  const headerRow = extractedRows.find((r) => r.rowNumber === 1) || extractedRows[0];
  if (!headerRow || headerRow.rowNumber !== 1) {
    errors.push({
      sheet: sheetName,
      row: 1,
      message: `Falta la fila 1 de encabezados en la hoja "${sheetName}".`,
    });
    return false;
  }

  for (let colIdx = 0; colIdx < expectedHeaders.length; colIdx++) {
    const actual = (headerRow.cells.get(colIdx) || '').trim();
    const expected = expectedHeaders[colIdx];
    if (actual !== expected) {
      errors.push({
        sheet: sheetName,
        row: 1,
        field: expected,
        message: `Encabezado inválido en columna ${colIdx + 1} de "${sheetName}": se esperaba "${expected}" y se recibió "${actual || '(vacío)'}".`,
      });
      return false;
    }
  }

  return true;
}

function rowToNullProtoRecord(
  cells: Map<number, string>,
  headers: readonly string[]
): Record<string, string> {
  const rec = Object.create(null) as Record<string, string>;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (FORBIDDEN_KEYS.has(h)) continue;
    rec[h] = cells.get(i) ?? '';
  }
  return rec;
}

function parseAndValidateWorkbook(buffer: Buffer): ParsePlanWorkbookResult {
  const errors: PlanImportIssue[] = [];
  const warnings: PlanImportIssue[] = [];
  const stats = makeEmptyStats();

  let wb: Record<string, any>;
  try {
    wb = XLSX.read(buffer, {
      type: 'buffer',
      cellFormula: true,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: false,
      bookVBA: true,
      sheetStubs: false,
    });
  } catch (err) {
    errors.push({
      sheet: 'Archivo',
      row: 0,
      message: `No se pudo leer el archivo OOXML (.xlsx): ${err instanceof Error ? err.message : 'formato inválido'}.`,
    });
    return { valid: false, errors, warnings, stats, data: null };
  }

  if (wb.vbaraw) {
    errors.push({
      sheet: 'Archivo',
      row: 0,
      message: 'El archivo contiene macros VBA no permitidas.',
    });
    return { valid: false, errors, warnings, stats, data: null };
  }

  const sheetNames: string[] = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  stats.sheetCount = sheetNames.length;
  if (sheetNames.length === 0) {
    errors.push({ sheet: 'Archivo', row: 0, message: 'El libro Excel no contiene ninguna hoja.' });
    return { valid: false, errors, warnings, stats, data: null };
  }
  if (sheetNames.length > PLAN_IMPORT_MAX_SHEETS) {
    errors.push({
      sheet: 'Archivo',
      row: 0,
      message: `El archivo tiene ${sheetNames.length} hojas; el máximo permitido es ${PLAN_IMPORT_MAX_SHEETS}.`,
    });
    return { valid: false, errors, warnings, stats, data: null };
  }

  // Require core structural sheets
  if (!sheetNames.includes(PLAN_TEMPLATE_SHEETS.PLAN)) {
    errors.push({ sheet: PLAN_TEMPLATE_SHEETS.PLAN, row: 0, message: 'Falta la hoja obligatoria "Plan".' });
  }
  if (!sheetNames.includes(PLAN_TEMPLATE_SHEETS.SUBJECTS)) {
    errors.push({ sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS, row: 0, message: 'Falta la hoja obligatoria "Materias".' });
  }

  const knownSheetSet = new Set<string>(Object.values(PLAN_TEMPLATE_SHEETS));
  const sheetData = new Map<string, Array<{ rowNumber: number; cells: Map<number, string> }>>();
  let totalRowsAcrossWorkbook = 0;

  for (const sheetName of sheetNames) {
    if (!knownSheetSet.has(sheetName)) {
      warnings.push({
        sheet: sheetName,
        row: 0,
        message: `La hoja adicional "${sheetName}" no forma parte de la plantilla canónica y será ignorada.`,
      });
    }

    const rawSheet = wb.Sheets?.[sheetName];
    if (!rawSheet) continue;
    const extracted = extractSafeSheetRows(rawSheet, sheetName, errors);
    if (!extracted) {
      return { valid: false, errors, warnings, stats, data: null };
    }
    totalRowsAcrossWorkbook += extracted.rows.length;
    if (totalRowsAcrossWorkbook > PLAN_IMPORT_MAX_ROWS) {
      errors.push({
        sheet: sheetName,
        row: 0,
        message: `El libro supera el límite total de ${PLAN_IMPORT_MAX_ROWS} filas (${totalRowsAcrossWorkbook} encontradas).`,
      });
      stats.totalRowsProcessed = totalRowsAcrossWorkbook;
      return { valid: false, errors, warnings, stats, data: null };
    }
    sheetData.set(sheetName, extracted.rows);
  }
  stats.totalRowsProcessed = totalRowsAcrossWorkbook;

  // Validate headers on known sheets that are present
  const sheetHeadersValid = new Map<string, boolean>();
  for (const sheetName of [
    PLAN_TEMPLATE_SHEETS.PLAN,
    PLAN_TEMPLATE_SHEETS.SUBJECTS,
    PLAN_TEMPLATE_SHEETS.PREREQUISITES,
    PLAN_TEMPLATE_SHEETS.RULES,
    PLAN_TEMPLATE_SHEETS.ACRONYMS,
  ]) {
    const rows = sheetData.get(sheetName);
    if (!rows) continue;
    const ok = validateHeaderRow(sheetName, PLAN_TEMPLATE_HEADERS[sheetName], rows, errors);
    sheetHeadersValid.set(sheetName, ok);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, stats, data: null };
  }

  // 1. Parse Plan Metadata ("Plan")
  const planRows = (sheetData.get(PLAN_TEMPLATE_SHEETS.PLAN) || []).filter((r) => r.rowNumber > 1);
  if (planRows.length !== 1) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows.length === 0 ? 2 : planRows[1].rowNumber,
      message: `La hoja "Plan" debe contener exactamente 1 fila de configuración (se encontraron ${planRows.length}).`,
    });
    return { valid: false, errors, warnings, stats, data: null };
  }

  const planHeaders = PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PLAN];
  const rawPlan = rowToNullProtoRecord(planRows[0].cells, planHeaders);

  const planName = rawPlan['Nombre del plan'];
  if (!planName || planName.length < 2 || planName.length > 120) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Nombre del plan',
      message: 'Nombre del plan obligatorio (entre 2 y 120 caracteres).',
    });
  }

  const planYear = parseStrictInt(rawPlan['Año del plan']);
  if (planYear === null || planYear < 1950 || planYear > 2100) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Año del plan',
      message: 'Año del plan debe ser un entero entre 1950 y 2100.',
    });
  }

  const levelLabel = rawPlan['Etiqueta nivel'] || 'Año';
  if (levelLabel.length > 30) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Etiqueta nivel',
      message: 'Etiqueta nivel no puede superar 30 caracteres.',
    });
  }

  let explicitTotalLevels: number | null = null;
  if (rawPlan['Total niveles']) {
    const parsedLevels = parseStrictInt(rawPlan['Total niveles']);
    if (parsedLevels === null || parsedLevels < 1 || parsedLevels > 12) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PLAN,
        row: planRows[0].rowNumber,
        field: 'Total niveles',
        message: 'Total niveles debe ser un entero entre 1 y 12.',
      });
    } else {
      explicitTotalLevels = parsedLevels;
    }
  }

  const requiredElectiveCredits = rawPlan['Créditos electivas requeridos']
    ? parseStrictInt(rawPlan['Créditos electivas requeridos'])
    : 0;
  if (requiredElectiveCredits === null || requiredElectiveCredits < 0 || requiredElectiveCredits > 500) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Créditos electivas requeridos',
      message: 'Créditos electivas requeridos debe ser un entero >= 0.',
    });
  }

  const electiveSlotsEquivalent = rawPlan['Equivalente slots electivas']
    ? parseStrictFiniteNumber(rawPlan['Equivalente slots electivas'])
    : 0;
  if (electiveSlotsEquivalent === null || electiveSlotsEquivalent < 0 || electiveSlotsEquivalent > 100) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Equivalente slots electivas',
      message: 'Equivalente slots electivas debe ser un número >= 0.',
    });
  }

  const defaultMinPassingGrade = rawPlan['Nota mínima aprobación']
    ? parseStrictInt(rawPlan['Nota mínima aprobación'])
    : 4;
  if (defaultMinPassingGrade === null || defaultMinPassingGrade < 1 || defaultMinPassingGrade > 10) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Nota mínima aprobación',
      message: 'Nota mínima aprobación debe ser un entero entre 1 y 10.',
    });
  }

  const finalDegreeTitle = rawPlan['Título final'] || undefined;
  if (finalDegreeTitle && finalDegreeTitle.length > 80) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Título final',
      message: 'Título final no puede superar 80 caracteres.',
    });
  }

  const shortTag = rawPlan['Etiqueta corta'] || undefined;
  if (shortTag && shortTag.length > 60) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Etiqueta corta',
      message: 'Etiqueta corta no puede superar 60 caracteres.',
    });
  }

  const ppsCodeRaw = rawPlan['Código materia PPS'];
  const ppsTitleRaw = rawPlan['Título PPS'];
  const ppsDescRaw = rawPlan['Descripción PPS'];
  let ppsRequirement: ParsedPlanMetadata['ppsRequirement'] = null;
  if (ppsCodeRaw || ppsTitleRaw || ppsDescRaw) {
    const ppsCode = parseStrictInt(ppsCodeRaw);
    if (ppsCode === null || ppsCode < 1) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PLAN,
        row: planRows[0].rowNumber,
        field: 'Código materia PPS',
        message: 'Si se configura PPS, "Código materia PPS" debe ser un código entero positivo.',
      });
    } else {
      ppsRequirement = {
        referenceSubjectCode: ppsCode,
        label: ppsTitleRaw || 'Habilitación PPS',
        ...(ppsDescRaw ? { description: ppsDescRaw } : {}),
      };
    }
  }

  const interName = rawPlan['Título intermedio'];
  const interShortLabel = rawPlan['Etiqueta título intermedio'];
  const interShortTitle = rawPlan['Título corto intermedio'];
  const interTrackKey = rawPlan['Clave trayecto intermedio'];
  const interCreditsRaw = rawPlan['Créditos electivas intermedio'];
  const interRuleCodeRaw = rawPlan['Código materia regla intermedio'];
  const intermediateDegrees: ParsedPlanMetadata['intermediateDegrees'] = [];

  if (
    interName ||
    interShortLabel ||
    interShortTitle ||
    interTrackKey ||
    interCreditsRaw ||
    interRuleCodeRaw
  ) {
    if (!interName || interName.length > 140) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PLAN,
        row: planRows[0].rowNumber,
        field: 'Título intermedio',
        message: 'Si configurás título intermedio, "Título intermedio" es obligatorio (<= 140 caracteres).',
      });
    } else {
      let interCredits: number | undefined;
      if (interCreditsRaw) {
        const parsedCred = parseStrictInt(interCreditsRaw);
        if (parsedCred === null || parsedCred < 0) {
          errors.push({
            sheet: PLAN_TEMPLATE_SHEETS.PLAN,
            row: planRows[0].rowNumber,
            field: 'Créditos electivas intermedio',
            message: 'Créditos electivas intermedio debe ser un entero >= 0.',
          });
        } else {
          interCredits = parsedCred;
        }
      }

      let interRuleCode: number | undefined;
      if (interRuleCodeRaw) {
        const parsedRuleCode = parseStrictInt(interRuleCodeRaw);
        if (parsedRuleCode === null || parsedRuleCode < 1) {
          errors.push({
            sheet: PLAN_TEMPLATE_SHEETS.PLAN,
            row: planRows[0].rowNumber,
            field: 'Código materia regla intermedio',
            message: 'Código materia regla intermedio debe ser un entero positivo.',
          });
        } else {
          interRuleCode = parsedRuleCode;
        }
      }

      intermediateDegrees.push({
        key: (interTrackKey || 'intermedio').toLowerCase(),
        name: interName,
        ...(interShortLabel ? { shortLabel: interShortLabel } : {}),
        ...(interShortTitle ? { shortTitle: interShortTitle } : {}),
        ...(interCredits !== undefined ? { requiredElectiveCredits: interCredits } : {}),
        ...(interRuleCode !== undefined ? { specialRuleSubjectCode: interRuleCode } : {}),
      });
    }
  }

  // 2. Parse Subjects ("Materias")
  const subjectHeaders = PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.SUBJECTS];
  const subjectDataRows = (sheetData.get(PLAN_TEMPLATE_SHEETS.SUBJECTS) || []).filter(
    (r) => r.rowNumber > 1
  );

  if (subjectDataRows.length === 0) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
      row: 2,
      message: 'La hoja "Materias" debe incluir al menos una materia.',
    });
  }

  const parsedSubjects: ParsedSubjectRow[] = [];
  const seenCodes = new Set<number>();
  const subjectByCode = new Map<number, ParsedSubjectRow>();
  const knownSubjectCodes = new Set<number>();
  const coreSubjectCodes = new Set<number>();
  const knownTrackKeys = new Set<string>();
  let maxSubjectLevel = 0;

  for (const rowObj of subjectDataRows) {
    const rec = rowToNullProtoRecord(rowObj.cells, subjectHeaders);
    const code = parseStrictInt(rec['Código']);
    if (code === null || code < 1 || code > 9999) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Código',
        message: 'Código debe ser un entero único entre 1 y 9999.',
      });
      continue;
    }

    if (seenCodes.has(code)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Código',
        message: `Código de materia duplicado: ${code}.`,
      });
      continue;
    }

    const name = rec['Nombre'];
    if (!name || name.length < 2 || name.length > 200) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Nombre',
        message: 'Nombre obligatorio (2 a 200 caracteres).',
      });
      continue;
    }

    let shortName = rec['Nombre corto'];
    if (!shortName) {
      shortName = deriveShortSubjectName(name);
      warnings.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Nombre corto',
        message: `Se derivó automáticamente nombre corto "${shortName}" para "${name}".`,
      });
    } else if (shortName.length > 60) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Nombre corto',
        message: 'Nombre corto no puede superar 60 caracteres.',
      });
      continue;
    }

    const displayCode = rec['Código visible'] || String(code);
    if (displayCode.length > 32) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Código visible',
        message: 'Código visible no puede superar 32 caracteres.',
      });
      continue;
    }

    const level = parseStrictInt(rec['Nivel']);
    if (level === null || level < 1 || level > 12) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Nivel',
        message: 'Nivel debe ser un entero entre 1 y 12.',
      });
      continue;
    }
    if (explicitTotalLevels !== null && level > explicitTotalLevels) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Nivel',
        message: `Nivel ${level} supera el "Total niveles" (${explicitTotalLevels}) declarado en la hoja Plan.`,
      });
      continue;
    }

    const rawModality = rec['Modalidad'].toUpperCase();
    if (!(ALLOWED_SUBJECT_MODALITIES as readonly string[]).includes(rawModality)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Modalidad',
        message: `Modalidad "${rec['Modalidad']}" inválida. Valores permitidos: ${ALLOWED_SUBJECT_MODALITIES.join(', ')}.`,
      });
      continue;
    }
    const modality = rawModality as AllowedSubjectModality;

    const ccRes = parseStrictBoolean(rec['Contra-cuatrimestral']);
    if (!ccRes.ok) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Contra-cuatrimestral',
        message: 'Contra-cuatrimestral debe ser SI o NO.',
      });
      continue;
    }

    const weeklyHours = parseStrictFiniteNumber(rec['Horas semanales']);
    if (weeklyHours === null || weeklyHours < 0 || weeklyHours > 40) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Horas semanales',
        message: 'Horas semanales debe ser un número entre 0 y 40.',
      });
      continue;
    }

    const kindRaw = rec['Tipo'].toLowerCase();
    if (!(ALLOWED_SUBJECT_KINDS as readonly string[]).includes(kindRaw)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Tipo',
        message: `Tipo "${rec['Tipo']}" inválido. Valores permitidos: ${ALLOWED_SUBJECT_KINDS.join(', ')}.`,
      });
      continue;
    }
    const kind = kindRaw as AllowedSubjectKind;

    let credits: number | null = null;
    if (rec['Créditos']) {
      const parsedCredits = parseStrictInt(rec['Créditos']);
      if (parsedCredits === null || parsedCredits < 0 || parsedCredits > 100) {
        errors.push({
          sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
          row: rowObj.rowNumber,
          field: 'Créditos',
          message: 'Créditos debe ser un entero entre 0 y 100.',
        });
        continue;
      }
      credits = parsedCredits;
    } else if (kind === 'electiva' && (requiredElectiveCredits ?? 0) > 0) {
      warnings.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Créditos',
        message: `La electiva "${name}" (${code}) no especifica créditos en un plan que requiere ${requiredElectiveCredits} créditos electivos.`,
      });
    }

    const integRes = parseStrictBoolean(rec['Integradora']);
    if (!integRes.ok) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Integradora',
        message: 'Integradora debe ser SI o NO.',
      });
      continue;
    }

    const trackOptRes = parseStrictBoolean(rec['Trayecto opcional']);
    if (!trackOptRes.ok) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Trayecto opcional',
        message: 'Trayecto opcional debe ser SI o NO.',
      });
      continue;
    }

    const trackKeyRaw = rec['Clave trayecto'].toLowerCase();
    if (trackOptRes.value && !trackKeyRaw) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Clave trayecto',
        message: 'Clave trayecto es obligatoria cuando "Trayecto opcional" es SI.',
      });
      continue;
    }
    if (trackKeyRaw && !/^[a-z0-9_-]{1,40}$/.test(trackKeyRaw)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
        row: rowObj.rowNumber,
        field: 'Clave trayecto',
        message: 'Clave trayecto solo admite minúsculas, números, guion y guion bajo (<= 40 caracteres).',
      });
      continue;
    }

    seenCodes.add(code);
    knownSubjectCodes.add(code);
    if (kind === 'obligatoria') {
      coreSubjectCodes.add(code);
    }
    if (trackKeyRaw) {
      knownTrackKeys.add(trackKeyRaw);
    }
    if (level > maxSubjectLevel) {
      maxSubjectLevel = level;
    }

    const subRow: ParsedSubjectRow = {
      codeInPlan: code,
      displayCode,
      name,
      shortName,
      level,
      modality,
      contraCuatrimestral: ccRes.value,
      weeklyHours,
      kind,
      credits,
      isIntegrator: integRes.value,
      isOptionalTrack: trackOptRes.value,
      trackKey: trackKeyRaw || null,
    };
    parsedSubjects.push(subRow);
    subjectByCode.set(code, subRow);
  }

  // Cross-checks from Plan against parsed Subjects
  if (ppsRequirement && !knownSubjectCodes.has(ppsRequirement.referenceSubjectCode)) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.PLAN,
      row: planRows[0].rowNumber,
      field: 'Código materia PPS',
      message: `La materia PPS (${ppsRequirement.referenceSubjectCode}) no existe en la hoja "Materias".`,
    });
  }

  if (intermediateDegrees.length > 0) {
    const deg = intermediateDegrees[0];
    if (deg.specialRuleSubjectCode !== undefined && !knownSubjectCodes.has(deg.specialRuleSubjectCode)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PLAN,
        row: planRows[0].rowNumber,
        field: 'Código materia regla intermedio',
        message: `La materia regla del título intermedio (${deg.specialRuleSubjectCode}) no existe en "Materias".`,
      });
    }
  }

  const electiveSubjectsCount = parsedSubjects.filter((s) => s.kind === 'electiva').length;
  const coreSubjectsCount = parsedSubjects.length - electiveSubjectsCount;
  if ((requiredElectiveCredits ?? 0) > 0 && electiveSubjectsCount === 0) {
    errors.push({
      sheet: PLAN_TEMPLATE_SHEETS.SUBJECTS,
      row: 2,
      message: `El plan exige ${requiredElectiveCredits} créditos de electivas, pero no incluye materias de tipo "electiva".`,
    });
  }

  // 3. Parse Prerequisites ("Correlativas") + DFS Cycle Detection
  const prereqHeaders = PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.PREREQUISITES];
  const prereqDataRows = (sheetData.get(PLAN_TEMPLATE_SHEETS.PREREQUISITES) || []).filter(
    (r) => r.rowNumber > 1
  );
  const parsedPrereqs: ParsedPrerequisiteRow[] = [];
  const seenPrereqEdges = new Set<string>();
  const adjacency = new Map<number, Set<number>>();

  for (const rowObj of prereqDataRows) {
    const rec = rowToNullProtoRecord(rowObj.cells, prereqHeaders);
    const subjectCode = parseStrictInt(rec['Código materia']);
    const requiresCode = parseStrictInt(rec['Código requisito']);
    const typeRaw = rec['Tipo requisito'].toLowerCase();

    if (subjectCode === null || !knownSubjectCodes.has(subjectCode)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
        row: rowObj.rowNumber,
        field: 'Código materia',
        message: `Código materia "${rec['Código materia'] || ''}" no existe en "Materias".`,
      });
      continue;
    }
    if (requiresCode === null || !knownSubjectCodes.has(requiresCode)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
        row: rowObj.rowNumber,
        field: 'Código requisito',
        message: `Código requisito "${rec['Código requisito'] || ''}" no existe en "Materias".`,
      });
      continue;
    }
    if (subjectCode === requiresCode) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
        row: rowObj.rowNumber,
        field: 'Código requisito',
        message: `Auto-correlativa inválida: la materia ${subjectCode} no puede requerirse a sí misma.`,
      });
      continue;
    }
    if (!(ALLOWED_PREREQ_TYPES as readonly string[]).includes(typeRaw)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
        row: rowObj.rowNumber,
        field: 'Tipo requisito',
        message: `Tipo requisito "${rec['Tipo requisito']}" inválido (permitidos: regular, aprobada).`,
      });
      continue;
    }

    const edgeKey = `${subjectCode}->${requiresCode}:${typeRaw}`;
    if (seenPrereqEdges.has(edgeKey)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
        row: rowObj.rowNumber,
        message: `Correlativa duplicada: ${subjectCode} requiere ${requiresCode} (${typeRaw}).`,
      });
      continue;
    }
    seenPrereqEdges.add(edgeKey);

    const targetSub = subjectByCode.get(subjectCode)!;
    const reqSub = subjectByCode.get(requiresCode)!;
    if (reqSub.level > targetSub.level) {
      warnings.push({
        sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
        row: rowObj.rowNumber,
        message: `La materia ${subjectCode} (nivel ${targetSub.level}) requiere a ${requiresCode} de un nivel posterior (${reqSub.level}).`,
      });
    }

    if (!adjacency.has(subjectCode)) {
      adjacency.set(subjectCode, new Set<number>());
    }
    adjacency.get(subjectCode)!.add(requiresCode);

    parsedPrereqs.push({
      subjectCode,
      requiresSubjectCode: requiresCode,
      type: typeRaw as AllowedPrereqType,
    });
  }

  // DFS Cycle detection (detects cycles across directed prerequisites graph)
  const color = new Map<number, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=visited
  const stack: number[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (node: number): void => {
    color.set(node, 1);
    stack.push(node);

    const neighbors = Array.from(adjacency.get(node) || []).sort((a, b) => a - b);
    for (const next of neighbors) {
      const nextColor = color.get(next) ?? 0;
      if (nextColor === 1) {
        const cycleStartIdx = stack.indexOf(next);
        const cyclePath = [...stack.slice(cycleStartIdx), next];
        const sig = [...cyclePath.slice(0, -1)].sort((a, b) => a - b).join(',');
        if (!reportedCycles.has(sig)) {
          reportedCycles.add(sig);
          errors.push({
            sheet: PLAN_TEMPLATE_SHEETS.PREREQUISITES,
            row: 0,
            message: `Ciclo detectado en correlativas: ${cyclePath.join(' -> ')}.`,
          });
        }
      } else if (nextColor === 0) {
        dfs(next);
      }
    }

    stack.pop();
    color.set(node, 2);
  };

  for (const code of Array.from(adjacency.keys()).sort((a, b) => a - b)) {
    if ((color.get(code) ?? 0) === 0) {
      dfs(code);
    }
  }

  // 4. Parse Special Rules ("Reglas") — strictly reconciled with `src/utils/correlativas.ts`
  const ruleHeaders = PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.RULES];
  const ruleDataRows = (sheetData.get(PLAN_TEMPLATE_SHEETS.RULES) || []).filter(
    (r) => r.rowNumber > 1
  );
  const parsedRules: ParsedSpecialRuleRow[] = [];
  const seenRulePairs = new Set<string>();

  for (const rowObj of ruleDataRows) {
    const rec = rowToNullProtoRecord(rowObj.cells, ruleHeaders);
    const subjectCode = parseStrictInt(rec['Código materia']);
    if (subjectCode === null || !knownSubjectCodes.has(subjectCode)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.RULES,
        row: rowObj.rowNumber,
        field: 'Código materia',
        message: `Código materia "${rec['Código materia'] || ''}" no existe en "Materias".`,
      });
      continue;
    }

    const ruleType = rec['Tipo regla'].trim();
    const paramValidation = validateSpecialRuleParams(
      ruleType,
      rec['Parámetros JSON'],
      knownSubjectCodes,
      coreSubjectCodes,
      knownTrackKeys
    );
    if (!paramValidation.ok) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.RULES,
        row: rowObj.rowNumber,
        field: 'Tipo regla',
        message: paramValidation.error,
      });
      continue;
    }

    const pairKey = `${subjectCode}:${ruleType}`;
    if (seenRulePairs.has(pairKey)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.RULES,
        row: rowObj.rowNumber,
        message: `Regla duplicada de tipo "${ruleType}" para la materia ${subjectCode}.`,
      });
      continue;
    }
    seenRulePairs.add(pairKey);

    const description = rec['Descripción'].trim();
    if (!description || description.length > 500) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.RULES,
        row: rowObj.rowNumber,
        field: 'Descripción',
        message: 'La descripción de la regla es obligatoria (1 a 500 caracteres).',
      });
      continue;
    }

    parsedRules.push({
      subjectCode,
      ruleType: paramValidation.ruleType,
      params: paramValidation.params,
      description,
    });
  }

  // 5. Parse Acronyms ("Acrónimos")
  const acronymHeaders = PLAN_TEMPLATE_HEADERS[PLAN_TEMPLATE_SHEETS.ACRONYMS];
  const acronymDataRows = (sheetData.get(PLAN_TEMPLATE_SHEETS.ACRONYMS) || []).filter(
    (r) => r.rowNumber > 1
  );
  const parsedAcronyms: ParsedAcronymRow[] = [];
  const seenAcronyms = new Set<string>();

  for (const rowObj of acronymDataRows) {
    const rec = rowToNullProtoRecord(rowObj.cells, acronymHeaders);
    const acronym = rec['Sigla'].toUpperCase().trim();
    const subjectCode = parseStrictInt(rec['Código materia']);

    if (!/^[A-Z0-9_-]{2,16}$/.test(acronym)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.ACRONYMS,
        row: rowObj.rowNumber,
        field: 'Sigla',
        message: `Sigla "${rec['Sigla'] || ''}" inválida (2 a 16 caracteres alfanuméricos, guiones o _).`,
      });
      continue;
    }

    if (seenAcronyms.has(acronym)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.ACRONYMS,
        row: rowObj.rowNumber,
        field: 'Sigla',
        message: `Sigla duplicada: "${acronym}".`,
      });
      continue;
    }

    if (subjectCode === null || !knownSubjectCodes.has(subjectCode)) {
      errors.push({
        sheet: PLAN_TEMPLATE_SHEETS.ACRONYMS,
        row: rowObj.rowNumber,
        field: 'Código materia',
        message: `Código materia "${rec['Código materia'] || ''}" no existe en "Materias".`,
      });
      continue;
    }

    seenAcronyms.add(acronym);
    parsedAcronyms.push({ acronym, subjectCode });
  }

  const finalTotalLevels = explicitTotalLevels ?? Math.max(1, maxSubjectLevel);
  stats.subjectsCount = parsedSubjects.length;
  stats.coreSubjectsCount = coreSubjectsCount;
  stats.electiveSubjectsCount = electiveSubjectsCount;
  stats.prerequisitesCount = parsedPrereqs.length;
  stats.specialRulesCount = parsedRules.length;
  stats.acronymsCount = parsedAcronyms.length;
  stats.maxLevel = finalTotalLevels;

  if (errors.length > 0) {
    return { valid: false, errors, warnings, stats, data: null };
  }

  // Sort deterministically for canonical preview & idempotent hashing
  parsedSubjects.sort((a, b) => a.codeInPlan - b.codeInPlan);
  parsedPrereqs.sort((a, b) =>
    a.subjectCode !== b.subjectCode
      ? a.subjectCode - b.subjectCode
      : a.requiresSubjectCode !== b.requiresSubjectCode
        ? a.requiresSubjectCode - b.requiresSubjectCode
        : a.type.localeCompare(b.type)
  );
  parsedRules.sort((a, b) =>
    a.subjectCode !== b.subjectCode
      ? a.subjectCode - b.subjectCode
      : a.ruleType.localeCompare(b.ruleType)
  );
  parsedAcronyms.sort((a, b) => a.acronym.localeCompare(b.acronym));

  const data: ParsedPlanWorkbookData = {
    plan: {
      name: planName,
      year: planYear!,
      levelLabel,
      totalLevels: finalTotalLevels,
      requiredElectiveCredits: requiredElectiveCredits ?? 0,
      electiveSlotsEquivalent: electiveSlotsEquivalent ?? 0,
      defaultMinPassingGrade: defaultMinPassingGrade ?? 4,
      ...(finalDegreeTitle ? { finalDegreeTitle } : {}),
      ...(shortTag ? { shortTag } : {}),
      ppsRequirement,
      intermediateDegrees,
    },
    subjects: parsedSubjects,
    prerequisites: parsedPrereqs,
    specialRules: parsedRules,
    acronyms: parsedAcronyms,
  };

  return { valid: true, errors, warnings, stats, data };
}

async function runWorker(): Promise<void> {
  const input = workerData as WorkerInputPayload;
  if (input.artificialDelayMs && input.artificialDelayMs > 0) {
    await sleep(input.artificialDelayMs);
  }
  const buffer = Buffer.from(input.fileBytes);
  const result = parseAndValidateWorkbook(buffer);
  parentPort?.postMessage(result);
}

runWorker().catch((err) => {
  const stats = makeEmptyStats();
  parentPort?.postMessage({
    valid: false,
    errors: [
      {
        sheet: 'Archivo',
        row: 0,
        message: `Error interno al procesar el archivo en el worker: ${err instanceof Error ? err.message : 'desconocido'}`,
      },
    ],
    warnings: [],
    stats,
    data: null,
  } satisfies ParsePlanWorkbookResult);
});
