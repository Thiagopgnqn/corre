import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as xlsxModule from 'xlsx';
import { z } from 'zod';
import {
  cleanDisplayName,
  compareProfessorParsed,
  parseProfessorName,
  pickBestDisplayName,
} from '../modules/professors/professorNormalizer.js';
import {
  computeAggregatesFromReviews,
  type ReviewStatus,
  type StoredReview,
} from '../modules/reviews/reviews.store.js';
import {
  BAYESIAN_PRIOR_GLOBAL_MEAN,
  BAYESIAN_PRIOR_WEIGHT,
} from '../config/reviews.config.js';
import { ELECTIVE_OFFERINGS_SEED } from './electiveOfferingsSeed.js';

const XLSX = (xlsxModule as any).default || xlsxModule;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. ESQUEMA Y VALIDACIÓN DE merges.json
// ==========================================

export const MergePairSchema = z.object({
  keep: z.string().trim().min(1, 'El campo "keep" no puede estar vacío'),
  remove: z.string().trim().min(1, 'El campo "remove" no puede estar vacío'),
});

export const RenameEntrySchema = z.object({
  from: z.string().trim().min(1, 'El campo "from" no puede estar vacío'),
  to: z.string().trim().min(1, 'El campo "to" no puede estar vacío'),
});

export const MergeConfigSchema = z.object({
  merges: z.array(MergePairSchema).default([]),
  renames: z.array(RenameEntrySchema).default([]),
  inspect: z.array(z.string().trim().min(1)).default([]),
});

export type MergePair = z.infer<typeof MergePairSchema>;
export type RenameEntry = z.infer<typeof RenameEntrySchema>;
export type MergeConfig = z.infer<typeof MergeConfigSchema>;

export function validateMergeConfig(raw: unknown): MergeConfig {
  const parsed = MergeConfigSchema.parse(raw);

  const seenRemoves = new Set<string>();
  const keepCleanedSet = new Set<string>();

  for (const pair of parsed.merges) {
    const keepClean = cleanDisplayName(pair.keep).toLowerCase();
    const removeClean = cleanDisplayName(pair.remove).toLowerCase();

    if (keepClean === removeClean) {
      throw new Error(
        `Par inválido en "merges": keep y remove son idénticos ("${pair.keep}").`
      );
    }
    if (seenRemoves.has(removeClean)) {
      throw new Error(
        `Docente duplicado en "remove": "${pair.remove}" aparece más de una vez para eliminar/fusionar.`
      );
    }
    seenRemoves.add(removeClean);
    keepCleanedSet.add(keepClean);
  }

  for (const pair of parsed.merges) {
    const removeClean = cleanDisplayName(pair.remove).toLowerCase();
    if (keepCleanedSet.has(removeClean)) {
      throw new Error(
        `Cadena encadenada detectada en "merges": "${pair.remove}" figura como "remove" en un par y como "keep" en otro. Apuntá directamente al docente final a conservar.`
      );
    }
  }

  const seenFroms = new Set<string>();
  for (const ren of parsed.renames) {
    const fromClean = cleanDisplayName(ren.from);
    const toClean = cleanDisplayName(ren.to);
    if (fromClean === toClean) {
      throw new Error(
        `Renombre redundante en "renames": from y to son idénticos ("${ren.from}").`
      );
    }
    const fromLower = fromClean.toLowerCase();
    if (seenFroms.has(fromLower)) {
      throw new Error(
        `Docente duplicado en "renames.from": "${ren.from}" aparece más de una vez.`
      );
    }
    if (seenRemoves.has(fromLower)) {
      throw new Error(
        `Conflicto entre "merges" y "renames": "${ren.from}" va a ser fusionado/eliminado en "merges" y no puede renombrarse a la vez.`
      );
    }
    seenFroms.add(fromLower);
  }

  return parsed;
}

// ==========================================
// 2. TIPOS DE SNAPSHOT PARA PREVIEW / DRY-RUN
// ==========================================

export interface SubjectBrief {
  subjectCode: number;
  subjectName: string;
  kind: string;
}

export interface CommissionBrief {
  commissionCode: string;
  courseCode: string;
  subjectCode: number;
  subjectName: string;
  termLabel: string;
  turno: string | null;
  kind: 'comisión' | 'oferta electiva';
  rawProfessorName: string;
  slotsSummary: string | null;
}

export interface ProfessorSnapshot {
  id: string;
  displayName: string;
  normalizedKey: string;
  rawAliases: string[];
  aliasNormalizedKeys: string[];
  subjects: SubjectBrief[];
  commissions: CommissionBrief[];
  publishedReviewCount: number;
  totalReviewCount: number;
}

export interface RawExcelOccurrence {
  file: string;
  sheetName: string;
  cellRef: string;
  rawSubject: string;
  rawProfessorCell: string;
}

// ==========================================
// 3. RESOLUCIÓN DE ARCHIVOS Y CATÁLOGO LOCAL
// ==========================================

export function resolveInputFilePath(fileArg: string): string {
  const candidates: string[] = [];
  if (path.isAbsolute(fileArg)) {
    candidates.push(fileArg);
  } else {
    if (process.env.INIT_CWD) {
      candidates.push(path.resolve(process.env.INIT_CWD, fileArg));
    }
    candidates.push(path.resolve(process.cwd(), fileArg));
    candidates.push(path.resolve(__dirname, '../../../', fileArg));
    candidates.push(path.resolve(__dirname, '../../', fileArg));
  }

  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
  }

  throw new Error(
    `No se encontró el archivo JSON "${fileArg}". Rutas verificadas:\n  - ${Array.from(
      new Set(candidates)
    ).join('\n  - ')}`
  );
}

function loadLocalSubjectCatalog(): Map<number, SubjectBrief> {
  const candidates = [
    path.resolve(__dirname, '../../seed-data/plan2023-catalog.json'),
    path.resolve(__dirname, '../seed-data/plan2023-catalog.json'),
    path.resolve(process.cwd(), 'seed-data/plan2023-catalog.json'),
    path.resolve(process.cwd(), 'server/seed-data/plan2023-catalog.json'),
  ];

  let catalogFile = '';
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      catalogFile = cand;
      break;
    }
  }

  const map = new Map<number, SubjectBrief>();
  if (!catalogFile) return map;

  const parsed = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  for (const sub of parsed.subjects || []) {
    if (typeof sub.codeInPlan === 'number') {
      map.set(sub.codeInPlan, {
        subjectCode: sub.codeInPlan,
        subjectName: sub.name,
        kind: sub.kind || 'obligatoria',
      });
    }
  }
  return map;
}

function formatTermLabel(term: string): string {
  if (term === 'A') return 'Anual';
  if (term === '1C') return '1C';
  if (term === '2C') return '2C';
  return term;
}

function formatSlotsSummary(
  slots: Array<{ day: string; start: string; end: string }> | undefined
): string | null {
  if (!slots || slots.length === 0) return null;
  return slots.map((s) => `${s.day} ${s.start}-${s.end}`).join(', ');
}

export function loadOfflineProfessorSnapshots(): {
  snapshots: ProfessorSnapshot[];
  sourceLabel: string;
} {
  const scheduleCandidates = [
    path.resolve(__dirname, '../../seed-data/schedule.json'),
    path.resolve(__dirname, '../seed-data/schedule.json'),
    path.resolve(__dirname, '../../../src/data/schedule.json'),
    path.resolve(process.cwd(), 'seed-data/schedule.json'),
    path.resolve(process.cwd(), 'server/seed-data/schedule.json'),
  ];

  let scheduleFile = '';
  for (const cand of scheduleCandidates) {
    if (fs.existsSync(cand)) {
      scheduleFile = cand;
      break;
    }
  }

  if (!scheduleFile) {
    throw new Error('No se encontró schedule.json para ejecutar merge-professors en modo --dry-run.');
  }

  const subjectsCatalog = loadLocalSubjectCatalog();
  const parsedSchedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));

  const byNormKey = new Map<
    string,
    {
      rawNames: Set<string>;
      subjectsMap: Map<number, SubjectBrief>;
      commissionsMap: Map<string, CommissionBrief>;
    }
  >();

  const ensureGroup = (rawName: string) => {
    const parsed = parseProfessorName(rawName);
    if (!parsed.normalizedKey) return null;
    let group = byNormKey.get(parsed.normalizedKey);
    if (!group) {
      group = {
        rawNames: new Set<string>(),
        subjectsMap: new Map<number, SubjectBrief>(),
        commissionsMap: new Map<string, CommissionBrief>(),
      };
      byNormKey.set(parsed.normalizedKey, group);
    }
    group.rawNames.add(rawName.trim());
    return { group, parsed };
  };

  for (const item of parsedSchedule.schedule || []) {
    const subjectCode = Number(item.subjectId);
    const subInfo = subjectsCatalog.get(subjectCode) || {
      subjectCode,
      subjectName: `Materia #${subjectCode}`,
      kind: 'obligatoria',
    };
    const termLabel = formatTermLabel(String(item.term || ''));

    for (const comm of item.commissions || []) {
      const slotsSummary = formatSlotsSummary(comm.slots);
      for (const rawProf of comm.professors || []) {
        if (typeof rawProf !== 'string' || !rawProf.trim()) continue;
        const entry = ensureGroup(rawProf);
        if (!entry) continue;

        entry.group.subjectsMap.set(subjectCode, subInfo);
        const commKey = `comm:${subjectCode}:${item.term}:${comm.code}`;
        entry.group.commissionsMap.set(commKey, {
          commissionCode: String(comm.code),
          courseCode: String(comm.courseCode || comm.code),
          subjectCode,
          subjectName: subInfo.subjectName,
          termLabel,
          turno: comm.turno ? String(comm.turno) : null,
          kind: 'comisión',
          rawProfessorName: rawProf.trim(),
          slotsSummary,
        });
      }
    }
  }

  for (const off of ELECTIVE_OFFERINGS_SEED) {
    const subjectCode = off.subjectCode;
    const subInfo = subjectsCatalog.get(subjectCode) || {
      subjectCode,
      subjectName: `Electiva #${subjectCode}`,
      kind: 'electiva',
    };

    for (const rawProf of off.professors) {
      if (!rawProf.trim()) continue;
      const entry = ensureGroup(rawProf);
      if (!entry) continue;

      entry.group.subjectsMap.set(subjectCode, subInfo);
      const offKey = `elec:${subjectCode}:${off.courseCode}`;
      entry.group.commissionsMap.set(offKey, {
        commissionCode: off.courseCode,
        courseCode: off.courseCode,
        subjectCode,
        subjectName: subInfo.subjectName,
        termLabel: '1C/2C',
        turno: null,
        kind: 'oferta electiva',
        rawProfessorName: rawProf.trim(),
        slotsSummary: null,
      });
    }
  }

  const snapshots: ProfessorSnapshot[] = [];
  for (const [normalizedKey, group] of byNormKey.entries()) {
    const rawAliases = Array.from(group.rawNames).sort((a, b) => a.localeCompare(b, 'es'));
    const displayName = pickBestDisplayName(rawAliases);
    const subjects = Array.from(group.subjectsMap.values()).sort(
      (a, b) => a.subjectCode - b.subjectCode
    );
    const commissions = Array.from(group.commissionsMap.values()).sort(
      (a, b) =>
        a.subjectCode - b.subjectCode ||
        a.commissionCode.localeCompare(b.commissionCode, 'es') ||
        a.termLabel.localeCompare(b.termLabel, 'es')
    );

    snapshots.push({
      id: `local:${normalizedKey}`,
      displayName,
      normalizedKey,
      rawAliases,
      aliasNormalizedKeys: [normalizedKey],
      subjects,
      commissions,
      publishedReviewCount: 0,
      totalReviewCount: 0,
    });
  }

  snapshots.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

  return {
    snapshots,
    sourceLabel: `Catálogo local offline (${path.basename(scheduleFile)} + ofertas electivas + plan2023-catalog.json · sin conexión a Neon)`,
  };
}

export function scanRawExcelOccurrences(queries: string[]): Map<string, RawExcelOccurrence[]> {
  const result = new Map<string, RawExcelOccurrence[]>();
  for (const q of queries) {
    result.set(q, []);
  }
  if (queries.length === 0) return result;

  const dirCandidates = [
    path.resolve(__dirname, '../../../data-source'),
    path.resolve(process.cwd(), '../data-source'),
    path.resolve(process.cwd(), 'data-source'),
  ];

  let dir = '';
  for (const cand of dirCandidates) {
    if (fs.existsSync(cand)) {
      dir = cand;
      break;
    }
  }
  if (!dir) return result;

  const parsedQueries = queries.map((q) => ({
    rawQuery: q,
    lowerQuery: cleanDisplayName(q).toLowerCase(),
    semiNormalized: q.replace(/\s*;\s*/g, '; ').trim().toLowerCase(),
    normKey: parseProfessorName(q).normalizedKey,
  }));

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.xlsx'))
    .sort((a, b) => a.localeCompare(b, 'es'));

  for (const file of files) {
    try {
      const wb = XLSX.readFile(path.join(dir, file));
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet || !sheet['!ref']) continue;
        const range = XLSX.utils.decode_range(sheet['!ref']);

        let materiaCol = -1;
        let docenteCol = -1;
        let headerRow = -1;

        for (let r = 0; r <= Math.min(range.e.r, 5); r++) {
          for (let c = 8; c <= range.e.c; c++) {
            const val = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
            if (typeof val === 'string' && val.toLowerCase().trim() === 'materia') {
              materiaCol = c;
              docenteCol = c + 1;
              headerRow = r;
              break;
            }
          }
          if (docenteCol !== -1) break;
        }
        if (docenteCol === -1) continue;

        let lastSubjectText = '';
        for (let r = headerRow + 1; r <= range.e.r; r++) {
          const matVal = sheet[XLSX.utils.encode_cell({ r, c: materiaCol })]?.v;
          if (typeof matVal === 'string' && matVal.trim()) {
            lastSubjectText = matVal.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
          }

          const docVal = sheet[XLSX.utils.encode_cell({ r, c: docenteCol })]?.v;
          if (typeof docVal !== 'string' || !docVal.trim()) continue;

          const cellRef = XLSX.utils.encode_cell({ r, c: docenteCol });
          const semiJoined = docVal
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .join('; ');
          const spaceJoined = docVal
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .join(' ');
          const individualLines = docVal
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);

          for (const pq of parsedQueries) {
            const matchesSemi = semiJoined.toLowerCase().includes(pq.semiNormalized);
            const matchesLiteral =
              semiJoined.toLowerCase().includes(pq.lowerQuery) ||
              spaceJoined.toLowerCase().includes(pq.lowerQuery);
            const matchesNormFull =
              pq.normKey.length > 0 &&
              (parseProfessorName(semiJoined).normalizedKey === pq.normKey ||
                parseProfessorName(spaceJoined).normalizedKey === pq.normKey ||
                individualLines.some((line) => parseProfessorName(line).normalizedKey === pq.normKey));

            if (matchesSemi || matchesLiteral || matchesNormFull) {
              result.get(pq.rawQuery)!.push({
                file,
                sheetName,
                cellRef,
                rawSubject: lastSubjectText || '(sin texto en columna Materia)',
                rawProfessorCell: semiJoined,
              });
            }
          }
        }
      }
    } catch {
      // Ignorar errores de lectura de planilla opcional
    }
  }

  return result;
}

// ==========================================
// 4. BÚSQUEDA DE PROFESOR POR NOMBRE / ALIAS
// ==========================================

export function resolveSnapshotByQuery(
  snapshots: ProfessorSnapshot[],
  queryName: string
): { match: ProfessorSnapshot | null; ambiguous: ProfessorSnapshot[]; matchedVia: string } {
  const cleaned = cleanDisplayName(queryName);
  const cleanedLower = cleaned.toLowerCase();

  // 1. Coincidencia exacta de displayName
  const exactDisplay = snapshots.filter((s) => cleanDisplayName(s.displayName) === cleaned);
  if (exactDisplay.length === 1) {
    return { match: exactDisplay[0], ambiguous: [], matchedVia: 'display_name exacto' };
  }
  if (exactDisplay.length > 1) {
    return { match: null, ambiguous: exactDisplay, matchedVia: 'display_name ambiguo' };
  }

  // 2. Coincidencia case-insensitive en displayName o alias crudos
  const exactCaseInsensitive = snapshots.filter(
    (s) =>
      cleanDisplayName(s.displayName).toLowerCase() === cleanedLower ||
      s.rawAliases.some((a) => cleanDisplayName(a).toLowerCase() === cleanedLower)
  );
  if (exactCaseInsensitive.length === 1) {
    return {
      match: exactCaseInsensitive[0],
      ambiguous: [],
      matchedVia: 'alias / display_name (case-insensitive)',
    };
  }
  if (exactCaseInsensitive.length > 1) {
    return { match: null, ambiguous: exactCaseInsensitive, matchedVia: 'alias ambiguo' };
  }

  // 3. Coincidencia por normalizedKey (cubre variantes de puntuación como "Zanatta, Valentin; Santiago" -> "Zanatta, Valentin Santiago")
  const parsed = parseProfessorName(queryName);
  if (parsed.normalizedKey) {
    const byNorm = snapshots.filter(
      (s) =>
        s.normalizedKey === parsed.normalizedKey ||
        s.aliasNormalizedKeys.includes(parsed.normalizedKey)
    );
    if (byNorm.length === 1) {
      return {
        match: byNorm[0],
        ambiguous: [],
        matchedVia: `normalized_key ("${parsed.normalizedKey}")`,
      };
    }
    if (byNorm.length > 1) {
      return { match: null, ambiguous: byNorm, matchedVia: 'normalized_key ambiguo' };
    }
  }

  return { match: null, ambiguous: [], matchedVia: 'sin coincidencia' };
}

// ==========================================
// 5. IMPRESIÓN DEL REPORTE (DRY-RUN / PREVIEW)
// ==========================================

function printProfessorDetails(
  roleTag: string,
  requestedName: string,
  resolved: ReturnType<typeof resolveSnapshotByQuery>,
  modeIsOffline: boolean
) {
  if (!resolved.match) {
    if (resolved.ambiguous.length > 1) {
      console.log(
        `   ❌ ${roleTag}: "${requestedName}" -> AMBIGUO (${resolved.ambiguous
          .map((a) => `"${a.displayName}"`)
          .join(', ')})`
      );
    } else {
      console.log(`   ❌ ${roleTag}: "${requestedName}" -> NO ENCONTRADO`);
    }
    return;
  }

  const prof = resolved.match;
  const diffDisplayNote =
    cleanDisplayName(prof.displayName) !== cleanDisplayName(requestedName)
      ? `  [resuelto como "${prof.displayName}" vía ${resolved.matchedVia}]`
      : '';

  console.log(`   • ${roleTag}: "${prof.displayName}"${diffDisplayNote}`);
  console.log(`     - normalized_key: "${prof.normalizedKey}"`);

  if (prof.subjects.length === 0) {
    console.log('     - Materias (0): (sin materias asignadas)');
  } else {
    const subjectsText = prof.subjects
      .map((s) => `[${s.subjectCode}] ${s.subjectName}`)
      .join(' | ');
    console.log(`     - Materias (${prof.subjects.length}): ${subjectsText}`);
  }

  if (prof.commissions.length === 0) {
    console.log('     - Comisiones (0): (sin comisiones cargadas)');
  } else {
    console.log(`     - Comisiones / ofertas (${prof.commissions.length}):`);
    for (const c of prof.commissions) {
      const turnoPart = c.turno ? ` · turno ${c.turno}` : '';
      const kindPart = c.kind === 'oferta electiva' ? ' · oferta electiva' : '';
      const slotsPart = c.slotsSummary ? ` · [${c.slotsSummary}]` : '';
      console.log(
        `         ◦ ${c.commissionCode} (${c.termLabel}${turnoPart}${kindPart}) — [${c.subjectCode}] ${c.subjectName}${slotsPart}`
      );
    }
  }

  const reviewLine = modeIsOffline
    ? `${prof.publishedReviewCount} (catálogo local offline; sin conexión a Neon)`
    : `${prof.publishedReviewCount} publicadas (${prof.totalReviewCount} totales en BD)`;
  console.log(`     - Reseñas: ${reviewLine}`);
}

export function printMergePreviewReport(params: {
  config: MergeConfig;
  filePath: string;
  snapshots: ProfessorSnapshot[];
  excelOccurrences: Map<string, RawExcelOccurrence[]>;
  mode: 'DRY-RUN' | 'APPLY';
  sourceLabel: string;
  modeIsOffline: boolean;
}): { missingOrAmbiguousCount: number } {
  const { config, filePath, snapshots, excelOccurrences, mode, sourceLabel, modeIsOffline } =
    params;

  let missingOrAmbiguousCount = 0;

  console.log('==========================================================================');
  console.log(` 🔀 REPORTE DE FUSIÓN Y CORRECCIÓN DE PROFESORES (${mode})`);
  console.log(` 📄 Archivo JSON: ${filePath}`);
  console.log(` 📂 Fuente:       ${sourceLabel}`);
  console.log('==========================================================================\n');

  console.log(`📌 1. PARES A FUSIONAR (${config.merges.length})`);
  if (config.merges.length === 0) {
    console.log('   (Sin pares de fusión configurados)\n');
  } else {
    config.merges.forEach((pair, idx) => {
      const keepRes = resolveSnapshotByQuery(snapshots, pair.keep);
      const removeRes = resolveSnapshotByQuery(snapshots, pair.remove);

      if (!keepRes.match) missingOrAmbiguousCount++;
      if (!removeRes.match) missingOrAmbiguousCount++;

      console.log(`──────────────────────────────────────────────────────────────────────────`);
      console.log(`   #${idx + 1}  CONSERVAR: "${pair.keep}"   <──   FUSIONAR: "${pair.remove}"`);

      if (keepRes.match && removeRes.match) {
        const cmp = compareProfessorParsed(
          parseProfessorName(keepRes.match.displayName),
          parseProfessorName(removeRes.match.displayName)
        );
        const keepSubCodes = new Set(keepRes.match.subjects.map((s) => s.subjectCode));
        const sharedSubjects = removeRes.match.subjects.filter((s) =>
          keepSubCodes.has(s.subjectCode)
        );
        const sharedLabel =
          sharedSubjects.length > 0
            ? `Sí (${sharedSubjects.map((s) => `[${s.subjectCode}] ${s.subjectName}`).join(', ')})`
            : 'No comparten materia exacta (dictan materias distintas)';
        console.log(
          `   🔎 Relación de nombre: ${cmp ? `${cmp.kind} [${cmp.confidence.toUpperCase()}] — ${cmp.reason}` : 'fusión manual explícita'}`
        );
        console.log(`   📚 ¿Comparten materia?: ${sharedLabel}`);
      }

      printProfessorDetails('KEEP (se conserva)', pair.keep, keepRes, modeIsOffline);
      printProfessorDetails('REMOVE (se fusiona)', pair.remove, removeRes, modeIsOffline);
    });
    console.log(`──────────────────────────────────────────────────────────────────────────\n`);
  }

  console.log(`📌 2. RENOMBRES DE DOCENTES (${config.renames.length})`);
  if (config.renames.length === 0) {
    console.log('   (Sin renombres configurados todavía)\n');
  } else {
    config.renames.forEach((ren, idx) => {
      const fromRes = resolveSnapshotByQuery(snapshots, ren.from);
      if (!fromRes.match) missingOrAmbiguousCount++;

      console.log(
        `   #${idx + 1}  RENOMBRAR: "${ren.from}"   ──>   "${cleanDisplayName(ren.to)}" (nuevo normalized_key: "${parseProfessorName(ren.to).normalizedKey}")`
      );
      printProfessorDetails('DOCENTE ACTUAL', ren.from, fromRes, modeIsOffline);
    });
    console.log('');
  }

  if (config.inspect.length > 0) {
    console.log(
      `📌 3. INSPECCIÓN DE NOMBRES MAL ESCRITOS / CON ANOMALÍAS (${config.inspect.length}) — SIN RENOMBRAR TODAVÍA`
    );
    config.inspect.forEach((inspName, idx) => {
      const res = resolveSnapshotByQuery(snapshots, inspName);
      const parsedInsp = parseProfessorName(inspName);
      const rawExcel = excelOccurrences.get(inspName) || [];

      console.log(`──────────────────────────────────────────────────────────────────────────`);
      console.log(`   #${idx + 1}  CONSULTA: "${inspName}"`);
      if (parsedInsp.anomalies.length > 0) {
        console.log(`   ⚠️  Anomalías detectadas: ${parsedInsp.anomalies.join(' · ')}`);
      }

      printProfessorDetails('EN CATÁLOGO / HORARIOS', inspName, res, modeIsOffline);

      if (rawExcel.length > 0) {
        console.log(`     - Apariciones en planillas Excel originales (data-source/*.xlsx):`);
        for (const occ of rawExcel) {
          console.log(
            `         ◦ ${occ.file} [pestaña "${occ.sheetName}", celda ${occ.cellRef}] -> Materia: "${occ.rawSubject}" | Docente crudo: "${occ.rawProfessorCell}"`
          );
        }
      }
    });
    console.log(`──────────────────────────────────────────────────────────────────────────\n`);
  }

  console.log('==========================================================================');
  if (mode === 'DRY-RUN') {
    console.log(
      modeIsOffline
        ? ' ℹ️  MODO SIMULACIÓN (--dry-run): NO se realizó ninguna conexión ni escritura en Neon.'
        : ' ℹ️  MODO SIMULACIÓN (--dry-run --from-db): Solo lectura; NO se modificó ningún dato.'
    );
    console.log(
      modeIsOffline
        ? ' 💡 Para previsualizar reseñas reales en PostgreSQL (solo lectura): agregá --from-db.'
        : ' 💡 Previsualización completada contra PostgreSQL sin modificar datos.'
    );
    console.log(
      ' 💡 Cuando confirmes los pares y hayas corrido migrate:professors, aplicá con --apply.'
    );
  }
  console.log('==========================================================================');

  return { missingOrAmbiguousCount };
}

// ==========================================
// 6. CARGA Y EJECUCIÓN TRANSACCIONAL EN BD
// ==========================================

async function loadDatabaseProfessorSnapshots(facultyCode: string): Promise<{
  facultyId: string;
  facultyName: string;
  snapshots: ProfessorSnapshot[];
  pool: { end: () => Promise<void> };
  db: any;
}> {
  const { eq } = await import('drizzle-orm');
  const { db, pool } = await import('../db/index.js');
  const {
    faculties,
    professors,
    professorAliases,
    commissionProfessors,
    commissions,
    commissionSlots,
    scheduleTerms,
    courseGroups,
    electiveOfferingProfessors,
    electiveOfferings,
    professorSubjectLinks,
    professorReviews,
    subjects,
  } = await import('../db/schema.js');

  const [fac] = await db
    .select()
    .from(faculties)
    .where(eq(faculties.code, facultyCode))
    .limit(1);

  if (!fac) {
    await pool.end();
    throw new Error(`No se encontró la facultad con código "${facultyCode}" en la base de datos.`);
  }

  const profRows = await db
    .select()
    .from(professors)
    .where(eq(professors.facultyId, fac.id));

  const aliasRows = await db
    .select()
    .from(professorAliases)
    .where(eq(professorAliases.facultyId, fac.id));

  const commRows = await db
    .select({
      professorId: commissionProfessors.professorId,
      rawProfessorName: commissionProfessors.professorName,
      commissionId: commissions.id,
      commissionCode: commissions.code,
      turno: commissions.turno,
      termCode: scheduleTerms.term,
      academicYear: scheduleTerms.academicYear,
      courseCode: courseGroups.code,
      subjectCode: subjects.codeInPlan,
      subjectName: subjects.name,
      subjectKind: subjects.kind,
    })
    .from(commissionProfessors)
    .innerJoin(commissions, eq(commissionProfessors.commissionId, commissions.id))
    .innerJoin(scheduleTerms, eq(commissions.scheduleTermId, scheduleTerms.id))
    .leftJoin(courseGroups, eq(commissions.courseGroupId, courseGroups.id))
    .innerJoin(subjects, eq(commissions.subjectId, subjects.id));

  const slotRows = await db.select().from(commissionSlots);
  const dayNames: Record<number, string> = {
    1: 'LUN',
    2: 'MAR',
    3: 'MIE',
    4: 'JUE',
    5: 'VIE',
    6: 'SAB',
  };
  const slotsByComm = new Map<string, string[]>();
  for (const s of slotRows) {
    const arr = slotsByComm.get(s.commissionId) || [];
    arr.push(`${dayNames[s.day] || s.day} ${s.startTime}-${s.endTime}`);
    slotsByComm.set(s.commissionId, arr);
  }

  const elecRows = await db
    .select({
      professorId: electiveOfferingProfessors.professorId,
      rawProfessorName: electiveOfferingProfessors.professorName,
      termCode: scheduleTerms.term,
      academicYear: scheduleTerms.academicYear,
      courseCode: courseGroups.code,
      subjectCode: subjects.codeInPlan,
      subjectName: subjects.name,
      subjectKind: subjects.kind,
    })
    .from(electiveOfferingProfessors)
    .innerJoin(
      electiveOfferings,
      eq(electiveOfferingProfessors.electiveOfferingId, electiveOfferings.id)
    )
    .innerJoin(scheduleTerms, eq(electiveOfferings.scheduleTermId, scheduleTerms.id))
    .innerJoin(courseGroups, eq(electiveOfferings.courseGroupId, courseGroups.id))
    .innerJoin(subjects, eq(electiveOfferings.subjectId, subjects.id));

  const histRows = await db
    .select({
      professorId: professorSubjectLinks.professorId,
      subjectCode: subjects.codeInPlan,
      subjectName: subjects.name,
      subjectKind: subjects.kind,
    })
    .from(professorSubjectLinks)
    .innerJoin(subjects, eq(professorSubjectLinks.subjectId, subjects.id));

  const revRows = await db
    .select({
      professorId: professorReviews.professorId,
      status: professorReviews.status,
    })
    .from(professorReviews);

  const aliasesByProf = new Map<string, { raw: Set<string>; norm: Set<string> }>();
  for (const a of aliasRows) {
    const entry = aliasesByProf.get(a.professorId) || { raw: new Set(), norm: new Set() };
    entry.raw.add(a.aliasRaw);
    entry.norm.add(a.aliasNormalized);
    aliasesByProf.set(a.professorId, entry);
  }

  const subjectsByProf = new Map<string, Map<number, SubjectBrief>>();
  const commsByProf = new Map<string, CommissionBrief[]>();

  for (const cr of commRows) {
    if (!cr.professorId) continue;
    const subMap = subjectsByProf.get(cr.professorId) || new Map<number, SubjectBrief>();
    subMap.set(cr.subjectCode, {
      subjectCode: cr.subjectCode,
      subjectName: cr.subjectName,
      kind: cr.subjectKind,
    });
    subjectsByProf.set(cr.professorId, subMap);

    const list = commsByProf.get(cr.professorId) || [];
    const slotList = slotsByComm.get(cr.commissionId);
    list.push({
      commissionCode: cr.commissionCode,
      courseCode: cr.courseCode || cr.commissionCode,
      subjectCode: cr.subjectCode,
      subjectName: cr.subjectName,
      termLabel: `${cr.academicYear}-${cr.termCode}`,
      turno: cr.turno || null,
      kind: 'comisión',
      rawProfessorName: cr.rawProfessorName,
      slotsSummary: slotList && slotList.length > 0 ? slotList.join(', ') : null,
    });
    commsByProf.set(cr.professorId, list);
  }

  for (const er of elecRows) {
    if (!er.professorId) continue;
    const subMap = subjectsByProf.get(er.professorId) || new Map<number, SubjectBrief>();
    subMap.set(er.subjectCode, {
      subjectCode: er.subjectCode,
      subjectName: er.subjectName,
      kind: er.subjectKind,
    });
    subjectsByProf.set(er.professorId, subMap);

    const list = commsByProf.get(er.professorId) || [];
    list.push({
      commissionCode: er.courseCode,
      courseCode: er.courseCode,
      subjectCode: er.subjectCode,
      subjectName: er.subjectName,
      termLabel: `${er.academicYear}-${er.termCode}`,
      turno: null,
      kind: 'oferta electiva',
      rawProfessorName: er.rawProfessorName,
      slotsSummary: null,
    });
    commsByProf.set(er.professorId, list);
  }

  for (const hr of histRows) {
    const subMap = subjectsByProf.get(hr.professorId) || new Map<number, SubjectBrief>();
    subMap.set(hr.subjectCode, {
      subjectCode: hr.subjectCode,
      subjectName: hr.subjectName,
      kind: hr.subjectKind,
    });
    subjectsByProf.set(hr.professorId, subMap);
  }

  const revCountsByProf = new Map<string, { published: number; total: number }>();
  for (const r of revRows) {
    const curr = revCountsByProf.get(r.professorId) || { published: 0, total: 0 };
    curr.total++;
    if (r.status === 'published') curr.published++;
    revCountsByProf.set(r.professorId, curr);
  }

  const snapshots: ProfessorSnapshot[] = profRows.map((p) => {
    const al = aliasesByProf.get(p.id);
    const subMap = subjectsByProf.get(p.id) || new Map<number, SubjectBrief>();
    const comms = (commsByProf.get(p.id) || []).sort(
      (a, b) =>
        a.subjectCode - b.subjectCode ||
        a.commissionCode.localeCompare(b.commissionCode, 'es') ||
        a.termLabel.localeCompare(b.termLabel, 'es')
    );
    const rev = revCountsByProf.get(p.id) || { published: 0, total: 0 };

    return {
      id: p.id,
      displayName: p.displayName,
      normalizedKey: p.normalizedKey,
      rawAliases: al ? Array.from(al.raw) : [p.displayName],
      aliasNormalizedKeys: al ? Array.from(al.norm) : [p.normalizedKey],
      subjects: Array.from(subMap.values()).sort((a, b) => a.subjectCode - b.subjectCode),
      commissions: comms,
      publishedReviewCount: rev.published,
      totalReviewCount: rev.total,
    };
  });

  snapshots.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

  return {
    facultyId: fac.id,
    facultyName: `${fac.code} — ${fac.name}`,
    snapshots,
    pool,
    db,
  };
}

async function recalculateProfessorStatsInTx(tx: any, professorId: string): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { professorReviews, professorStats, professorSubjectStats } = await import(
    '../db/schema.js'
  );

  const rows = await tx
    .select()
    .from(professorReviews)
    .where(
      and(
        eq(professorReviews.professorId, professorId),
        eq(professorReviews.status, 'published')
      )
    );

  const mapped: StoredReview[] = rows.map((r: any) => ({
    id: r.id,
    userId: r.userId,
    professorId: r.professorId,
    subjectId: r.subjectId,
    academicYear: r.academicYear ?? null,
    term: (r.term as '1C' | '2C' | 'A' | null) ?? null,
    overall: r.overall,
    clarity: r.clarity ?? null,
    treatment: r.treatment ?? null,
    availability: r.availability ?? null,
    difficulty: r.difficulty ?? null,
    wouldRecommend: r.wouldRecommend ?? null,
    comment: r.comment ?? null,
    status: r.status as ReviewStatus,
    helpfulCount: r.helpfulCount,
    attendedDeclared: Boolean(r.attendedDeclared),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  const priorWeight = BAYESIAN_PRIOR_WEIGHT;
  const priorMean = BAYESIAN_PRIOR_GLOBAL_MEAN;

  const agg = computeAggregatesFromReviews(mapped);
  const bayesian =
    agg.reviewCount > 0 && agg.avgOverall !== null
      ? String(
          Math.round(
            ((agg.reviewCount * agg.avgOverall + priorWeight * priorMean) /
              (agg.reviewCount + priorWeight)) *
              1000
          ) / 1000
        )
      : null;

  await tx
    .insert(professorStats)
    .values({
      professorId,
      reviewCount: agg.reviewCount,
      avgOverall: agg.avgOverall !== null ? String(agg.avgOverall) : null,
      bayesianScore: bayesian,
      avgClarity: agg.avgClarity !== null ? String(agg.avgClarity) : null,
      avgTreatment: agg.avgTreatment !== null ? String(agg.avgTreatment) : null,
      avgAvailability: agg.avgAvailability !== null ? String(agg.avgAvailability) : null,
      avgDifficulty: agg.avgDifficulty !== null ? String(agg.avgDifficulty) : null,
      recommendRate: agg.recommendPercent !== null ? String(agg.recommendPercent) : null,
      stars1: agg.distribution[1],
      stars2: agg.distribution[2],
      stars3: agg.distribution[3],
      stars4: agg.distribution[4],
      stars5: agg.distribution[5],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: professorStats.professorId,
      set: {
        reviewCount: agg.reviewCount,
        avgOverall: agg.avgOverall !== null ? String(agg.avgOverall) : null,
        bayesianScore: bayesian,
        avgClarity: agg.avgClarity !== null ? String(agg.avgClarity) : null,
        avgTreatment: agg.avgTreatment !== null ? String(agg.avgTreatment) : null,
        avgAvailability: agg.avgAvailability !== null ? String(agg.avgAvailability) : null,
        avgDifficulty: agg.avgDifficulty !== null ? String(agg.avgDifficulty) : null,
        recommendRate: agg.recommendPercent !== null ? String(agg.recommendPercent) : null,
        stars1: agg.distribution[1],
        stars2: agg.distribution[2],
        stars3: agg.distribution[3],
        stars4: agg.distribution[4],
        stars5: agg.distribution[5],
        updatedAt: new Date(),
      },
    });

  await tx
    .delete(professorSubjectStats)
    .where(eq(professorSubjectStats.professorId, professorId));

  const bySubject = new Map<string, StoredReview[]>();
  for (const r of mapped) {
    const list = bySubject.get(r.subjectId) || [];
    list.push(r);
    bySubject.set(r.subjectId, list);
  }

  for (const [subjectId, subReviews] of bySubject.entries()) {
    const subAgg = computeAggregatesFromReviews(subReviews);
    const subBayesian =
      subAgg.reviewCount > 0 && subAgg.avgOverall !== null
        ? String(
            Math.round(
              ((subAgg.reviewCount * subAgg.avgOverall + priorWeight * priorMean) /
                (subAgg.reviewCount + priorWeight)) *
                1000
            ) / 1000
          )
        : null;

    await tx.insert(professorSubjectStats).values({
      professorId,
      subjectId,
      reviewCount: subAgg.reviewCount,
      avgOverall: subAgg.avgOverall !== null ? String(subAgg.avgOverall) : null,
      bayesianScore: subBayesian,
      avgClarity: subAgg.avgClarity !== null ? String(subAgg.avgClarity) : null,
      avgTreatment: subAgg.avgTreatment !== null ? String(subAgg.avgTreatment) : null,
      avgAvailability: subAgg.avgAvailability !== null ? String(subAgg.avgAvailability) : null,
      avgDifficulty: subAgg.avgDifficulty !== null ? String(subAgg.avgDifficulty) : null,
      recommendRate: subAgg.recommendPercent !== null ? String(subAgg.recommendPercent) : null,
      stars1: subAgg.distribution[1],
      stars2: subAgg.distribution[2],
      stars3: subAgg.distribution[3],
      stars4: subAgg.distribution[4],
      stars5: subAgg.distribution[5],
      updatedAt: new Date(),
    });
  }
}

async function applyMergeAndRenamesTransaction(params: {
  db: any;
  facultyId: string;
  config: MergeConfig;
  snapshots: ProfessorSnapshot[];
}) {
  const { and, eq, ne } = await import('drizzle-orm');
  const {
    professors,
    professorAliases,
    commissionProfessors,
    electiveOfferingProfessors,
    enrollmentProfessors,
    reviewRecommendationDismissals,
    subjectEnrollments,
    professorSubjectLinks,
    professorReviews,
  } = await import('../db/schema.js');

  const { db, facultyId, config, snapshots } = params;

  // Resolver todos los IDs de antemano; si falta alguno, abortar antes de tocar la BD
  const resolvedMerges = config.merges.map((pair) => {
    const keepRes = resolveSnapshotByQuery(snapshots, pair.keep);
    const removeRes = resolveSnapshotByQuery(snapshots, pair.remove);
    if (!keepRes.match) {
      throw new Error(`No se puede aplicar: profesor KEEP "${pair.keep}" no encontrado o ambiguo.`);
    }
    if (!removeRes.match) {
      throw new Error(
        `No se puede aplicar: profesor REMOVE "${pair.remove}" no encontrado o ambiguo.`
      );
    }
    if (keepRes.match.id === removeRes.match.id) {
      throw new Error(
        `No se puede aplicar: "${pair.keep}" y "${pair.remove}" ya apuntan al mismo profesor (${keepRes.match.displayName}).`
      );
    }
    return {
      pair,
      keepId: keepRes.match.id,
      removeId: removeRes.match.id,
    };
  });

  const resolvedRenames = config.renames.map((ren) => {
    const fromRes = resolveSnapshotByQuery(snapshots, ren.from);
    if (!fromRes.match) {
      throw new Error(
        `No se puede aplicar: profesor a renombrar "${ren.from}" no encontrado o ambiguo.`
      );
    }
    return {
      ren,
      professorId: fromRes.match.id,
    };
  });

  return await db.transaction(async (tx: any) => {
    let totalMovedCommissions = 0;
    let totalMovedElectives = 0;
    let totalMovedEnrollments = 0;
    let totalMovedDismissals = 0;
    let totalMovedReviews = 0;
    let totalDeduplicatedReviews = 0;

    // 1. Ejecutar todas las fusiones en la misma transacción
    for (const item of resolvedMerges) {
      const [source] = await tx
        .select()
        .from(professors)
        .where(and(eq(professors.id, item.removeId), eq(professors.facultyId, facultyId)))
        .limit(1);
      const [target] = await tx
        .select()
        .from(professors)
        .where(and(eq(professors.id, item.keepId), eq(professors.facultyId, facultyId)))
        .limit(1);

      if (!source || !target) {
        throw new Error(
          `Inconsistencia transaccional al fusionar "${item.pair.remove}" -> "${item.pair.keep}".`
        );
      }

      const movedComm = await tx
        .update(commissionProfessors)
        .set({ professorId: target.id, updatedAt: new Date() })
        .where(eq(commissionProfessors.professorId, source.id))
        .returning({ id: commissionProfessors.id });
      totalMovedCommissions += movedComm.length;

      const movedElec = await tx
        .update(electiveOfferingProfessors)
        .set({ professorId: target.id, updatedAt: new Date() })
        .where(eq(electiveOfferingProfessors.professorId, source.id))
        .returning({ id: electiveOfferingProfessors.id });
      totalMovedElectives += movedElec.length;

      const sourceLinks = await tx
        .select()
        .from(professorSubjectLinks)
        .where(eq(professorSubjectLinks.professorId, source.id));

      for (const link of sourceLinks) {
        await tx
          .insert(professorSubjectLinks)
          .values({
            professorId: target.id,
            subjectId: link.subjectId,
            source: link.source,
            notes: link.notes,
            createdBy: link.createdBy,
          })
          .onConflictDoNothing();
      }

      await tx
        .update(professorAliases)
        .set({ professorId: target.id })
        .where(eq(professorAliases.professorId, source.id));

      await tx
        .insert(professorAliases)
        .values({
          professorId: target.id,
          facultyId: target.facultyId,
          aliasRaw: source.displayName,
          aliasNormalized: source.normalizedKey,
        })
        .onConflictDoNothing();

      // Reasignar enrollment_professors sin duplicados
      const sourceEnrollProfs = await tx
        .select()
        .from(enrollmentProfessors)
        .where(eq(enrollmentProfessors.professorId, source.id));

      for (const ep of sourceEnrollProfs) {
        await tx
          .insert(enrollmentProfessors)
          .values({
            enrollmentId: ep.enrollmentId,
            professorId: target.id,
          })
          .onConflictDoNothing();
      }
      await tx
        .delete(enrollmentProfessors)
        .where(eq(enrollmentProfessors.professorId, source.id));
      totalMovedEnrollments += sourceEnrollProfs.length;

      // Reasignar review_recommendation_dismissals sin duplicados
      const sourceDismissals = await tx
        .select()
        .from(reviewRecommendationDismissals)
        .where(eq(reviewRecommendationDismissals.professorId, source.id));

      for (const dm of sourceDismissals) {
        await tx
          .insert(reviewRecommendationDismissals)
          .values({
            userId: dm.userId,
            professorId: target.id,
            subjectId: dm.subjectId,
            createdAt: dm.createdAt,
          })
          .onConflictDoNothing();
      }
      await tx
        .delete(reviewRecommendationDismissals)
        .where(eq(reviewRecommendationDismissals.professorId, source.id));
      totalMovedDismissals += sourceDismissals.length;

      const sourceReviews = await tx
        .select()
        .from(professorReviews)
        .where(eq(professorReviews.professorId, source.id));
      const targetReviews = await tx
        .select()
        .from(professorReviews)
        .where(eq(professorReviews.professorId, target.id));

      const targetKeySet = new Set(
        targetReviews.map((r: any) => `${r.userId}::${r.subjectId}`)
      );

      for (const sr of sourceReviews) {
        const key = `${sr.userId}::${sr.subjectId}`;
        if (targetKeySet.has(key)) {
          await tx.delete(professorReviews).where(eq(professorReviews.id, sr.id));
          totalDeduplicatedReviews++;
        } else {
          await tx
            .update(professorReviews)
            .set({ professorId: target.id, updatedAt: new Date() })
            .where(eq(professorReviews.id, sr.id));
          targetKeySet.add(key);
          totalMovedReviews++;
        }
      }

      await tx.delete(professors).where(eq(professors.id, source.id));

      // Asegurar que el display_name final coincida con el solicitado en "keep"
      const desiredDisplayName = cleanDisplayName(item.pair.keep);
      if (target.displayName !== desiredDisplayName) {
        await tx
          .update(professors)
          .set({ displayName: desiredDisplayName, updatedAt: new Date() })
          .where(eq(professors.id, target.id));
      }

      // Recalcular attended_declared de todas las reseñas del docente destino
      const finalTargetReviews = await tx
        .select({
          id: professorReviews.id,
          userId: professorReviews.userId,
          subjectId: professorReviews.subjectId,
          attendedDeclared: professorReviews.attendedDeclared,
        })
        .from(professorReviews)
        .where(eq(professorReviews.professorId, target.id));

      if (finalTargetReviews.length > 0) {
        const declaredPairs = await tx
          .select({
            userId: subjectEnrollments.userId,
            subjectId: subjectEnrollments.subjectId,
          })
          .from(enrollmentProfessors)
          .innerJoin(subjectEnrollments, eq(enrollmentProfessors.enrollmentId, subjectEnrollments.id))
          .where(eq(enrollmentProfessors.professorId, target.id));

        const declaredKeySet = new Set(
          declaredPairs.map((p: any) => `${p.userId}::${p.subjectId}`)
        );
        for (const rev of finalTargetReviews) {
          const nextVal = declaredKeySet.has(`${rev.userId}::${rev.subjectId}`);
          if (Boolean(rev.attendedDeclared) !== nextVal) {
            await tx
              .update(professorReviews)
              .set({ attendedDeclared: nextVal })
              .where(eq(professorReviews.id, rev.id));
          }
        }
      }

      await recalculateProfessorStatsInTx(tx, target.id);
    }

    // 2. Ejecutar todos los renombres en la misma transacción
    for (const item of resolvedRenames) {
      const [prof] = await tx
        .select()
        .from(professors)
        .where(and(eq(professors.id, item.professorId), eq(professors.facultyId, facultyId)))
        .limit(1);

      if (!prof) {
        throw new Error(`No se encontró en transacción el docente a renombrar "${item.ren.from}".`);
      }

      const cleanedTo = cleanDisplayName(item.ren.to);
      const parsedTo = parseProfessorName(cleanedTo);
      const nextNormalizedKey = parsedTo.normalizedKey || prof.normalizedKey;

      // Verificar que la nueva normalized_key no colisione con OTRO docente distinto
      const [collidingProf] = await tx
        .select({ id: professors.id, displayName: professors.displayName })
        .from(professors)
        .where(
          and(
            eq(professors.facultyId, facultyId),
            eq(professors.normalizedKey, nextNormalizedKey),
            ne(professors.id, prof.id)
          )
        )
        .limit(1);

      if (collidingProf) {
        throw new Error(
          `El renombre "${item.ren.from}" -> "${cleanedTo}" colisiona con el docente existente "${collidingProf.displayName}". Usá "merges" en lugar de "renames".`
        );
      }

      const [collidingAlias] = await tx
        .select({ professorId: professorAliases.professorId })
        .from(professorAliases)
        .where(
          and(
            eq(professorAliases.facultyId, facultyId),
            eq(professorAliases.aliasNormalized, nextNormalizedKey),
            ne(professorAliases.professorId, prof.id)
          )
        )
        .limit(1);

      if (collidingAlias) {
        throw new Error(
          `El renombre "${item.ren.from}" -> "${cleanedTo}" colisiona con un alias registrado de otro docente. Usá "merges" en lugar de "renames".`
        );
      }

      // Preservar el nombre anterior como alias para trazabilidad y futuras importaciones de horarios
      await tx
        .insert(professorAliases)
        .values({
          professorId: prof.id,
          facultyId,
          aliasRaw: prof.displayName,
          aliasNormalized: prof.normalizedKey,
        })
        .onConflictDoNothing();

      await tx
        .update(professors)
        .set({
          displayName: cleanedTo,
          normalizedKey: nextNormalizedKey,
          updatedAt: new Date(),
        })
        .where(eq(professors.id, prof.id));

      await tx
        .insert(professorAliases)
        .values({
          professorId: prof.id,
          facultyId,
          aliasRaw: cleanedTo,
          aliasNormalized: nextNormalizedKey,
        })
        .onConflictDoNothing();
    }

    return {
      mergedCount: resolvedMerges.length,
      renamedCount: resolvedRenames.length,
      totalMovedCommissions,
      totalMovedElectives,
      totalMovedEnrollments,
      totalMovedDismissals,
      totalMovedReviews,
      totalDeduplicatedReviews,
    };
  });
}

// ==========================================
// 7. CLI ENTRYPOINT
// ==========================================

function parseCliArgs(argv: string[]) {
  let fileArg = '';
  let apply = false;
  let forceDryRun = false;
  let fromDb = false;
  let faculty = 'FRC';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--file' || arg === '-f') && argv[i + 1]) {
      fileArg = argv[i + 1];
      i++;
    } else if (arg.startsWith('--file=')) {
      fileArg = arg.slice('--file='.length);
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      forceDryRun = true;
    } else if (arg === '--from-db') {
      fromDb = true;
    } else if (arg === '--faculty' && argv[i + 1]) {
      faculty = argv[i + 1].toUpperCase();
      i++;
    } else if (arg.startsWith('--faculty=')) {
      faculty = arg.slice('--faculty='.length).toUpperCase();
    }
  }

  const effectiveApply = apply && !forceDryRun;
  return {
    fileArg,
    apply: effectiveApply,
    dryRun: !effectiveApply,
    fromDb,
    faculty,
  };
}

async function main() {
  const { fileArg, apply, dryRun, fromDb, faculty } = parseCliArgs(process.argv.slice(2));

  if (!fileArg) {
    console.error(
      '❌ Uso: npm --prefix server run merge-professors -- --file merges.json [--apply] [--from-db] [--faculty FRC]'
    );
    process.exit(1);
  }

  const resolvedFilePath = resolveInputFilePath(fileArg);
  const rawJson = JSON.parse(fs.readFileSync(resolvedFilePath, 'utf8'));
  const config = validateMergeConfig(rawJson);

  const excelOccurrences = scanRawExcelOccurrences(config.inspect);

  // Modo por defecto: --dry-run offline (sin tocar ni conectarse a Neon)
  if (dryRun && !fromDb) {
    const { snapshots, sourceLabel } = loadOfflineProfessorSnapshots();
    const { missingOrAmbiguousCount } = printMergePreviewReport({
      config,
      filePath: resolvedFilePath,
      snapshots,
      excelOccurrences,
      mode: 'DRY-RUN',
      sourceLabel,
      modeIsOffline: true,
    });

    if (missingOrAmbiguousCount > 0) {
      console.error(
        `\n⚠️  Atención: ${missingOrAmbiguousCount} referencia(s) no se encontraron o resultaron ambiguas.`
      );
      process.exitCode = 1;
    }
    return;
  }

  // Modo conectado a PostgreSQL (--from-db en dry-run o --apply transaccional)
  const dbCtx = await loadDatabaseProfessorSnapshots(faculty);
  try {
    const { missingOrAmbiguousCount } = printMergePreviewReport({
      config,
      filePath: resolvedFilePath,
      snapshots: dbCtx.snapshots,
      excelOccurrences,
      mode: apply ? 'APPLY' : 'DRY-RUN',
      sourceLabel: `PostgreSQL (${dbCtx.facultyName})`,
      modeIsOffline: false,
    });

    if (missingOrAmbiguousCount > 0) {
      throw new Error(
        `Se detectaron ${missingOrAmbiguousCount} docente(s) inexistentes o ambiguos. No se ejecutó ninguna escritura.`
      );
    }

    if (!apply) {
      return;
    }

    const summary = await applyMergeAndRenamesTransaction({
      db: dbCtx.db,
      facultyId: dbCtx.facultyId,
      config,
      snapshots: dbCtx.snapshots,
    });

    console.log('\n✅ TRANSACCIÓN APLICADA EXITOSAMENTE EN POSTGRESQL');
    console.log(`   • Pares fusionados:                ${summary.mergedCount}`);
    console.log(`   • Docentes renombrados:            ${summary.renamedCount}`);
    console.log(`   • Vínculos de comisiones movidos:  ${summary.totalMovedCommissions}`);
    console.log(`   • Vínculos de electivas movidos:   ${summary.totalMovedElectives}`);
    console.log(`   • Cursadas (enrollments) movidas:  ${summary.totalMovedEnrollments}`);
    console.log(`   • Recomendaciones descartadas mov.:${summary.totalMovedDismissals}`);
    console.log(`   • Reseñas movidas:                 ${summary.totalMovedReviews}`);
    console.log(`   • Reseñas duplicadas depuradas:    ${summary.totalDeduplicatedReviews}`);
  } finally {
    await dbCtx.pool.end();
  }
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  main().catch((err) => {
    console.error('❌ Error en merge-professors:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
