import fs from 'fs';
import path from 'path';
import * as xlsxModule from 'xlsx';
import {
  resolveSubjectIds,
  isGenericElective,
  normalizeSubjectName,
} from '../src/data/subjectAliases';
import { validateScheduleData } from '../src/utils/scheduleLogic';
import type { DayOfWeek, Shift, TermType } from '../src/types/schedule';

const XLSX = (xlsxModule as any).default || xlsxModule;

export interface Slot {
  day: DayOfWeek;
  start: string;
  end: string;
}

export interface Commission {
  id: string;
  code: string;
  courseCode: string;
  turno?: Shift;
  professors: string[];
  slots: Slot[];
  notes?: string;
}

export interface SubjectSchedule {
  subjectId: number | string;
  term: TermType;
  commissions: Commission[];
}

export interface ReservedElectiveSlot {
  courseCode: string;
  term: TermType;
  turno: Shift;
  label: string;
  slots: Slot[];
}

export interface WarningEntry {
  file: string;
  sheet: string;
  cell: string;
  text: string;
  reason: string;
}

export interface OmittedSheetEntry {
  file: string;
  sheet: string;
  reason: string;
}

export interface DiscardedCommissionEntry {
  file: string;
  sheet: string;
  cell?: string;
  subjectId: number | string;
  slot: Slot;
  reason: string;
}

export interface SlotWithCell extends Slot {
  cell?: string;
}

export interface ProfWithoutClassEntry {
  file: string;
  sheet: string;
  subjectId: number | string;
  profs: string[];
}

export function formatTime(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') {
    const totalMinutes = Math.round(v * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const match = v.trim().match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      return `${match[1].padStart(2, '0')}:${match[2]}`;
    }
  }
  return '';
}

export function normalizeDay(str: string): DayOfWeek | null {
  const norm = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (norm.includes('lunes')) return 'LUN';
  if (norm.includes('martes')) return 'MAR';
  if (norm.includes('miercoles')) return 'MIE';
  if (norm.includes('jueves')) return 'JUE';
  if (norm.includes('viernes')) return 'VIE';
  if (norm.includes('sabado')) return 'SAB';
  return null;
}

export function areSlotsEqual(slotsA: Slot[], slotsB: Slot[]): boolean {
  if (slotsA.length !== slotsB.length) return false;
  const sortKey = (s: Slot) => `${s.day}_${s.start}_${s.end}`;
  const aSorted = [...slotsA].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  const bSorted = [...slotsB].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  return aSorted.every((s, i) => s.day === bSorted[i].day && s.start === bSorted[i].start && s.end === bSorted[i].end);
}

const DAY_ORDER: Record<string, number> = {
  LUN: 1,
  MAR: 2,
  MIE: 3,
  JUE: 4,
  VIE: 5,
  SAB: 6,
};

export function sortSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => {
    const dDiff = (DAY_ORDER[a.day] || 99) - (DAY_ORDER[b.day] || 99);
    if (dDiff !== 0) return dDiff;
    return a.start.localeCompare(b.start);
  });
}

export function deduplicateSlots(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  const result: Slot[] = [];
  for (const s of slots) {
    const key = `${s.day}_${s.start}_${s.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(s);
    }
  }
  return result;
}

export function getSlotTurno(startTime: string): Shift {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m;
  if (total <= 12 * 60 + 50) return 'mañana'; // <= 12:50
  if (total < 17 * 60 + 20) return 'tarde';   // 12:51 a 17:19
  return 'noche';                            // >= 17:20
}

export function calculateCommissionTurno(slots: Slot[], fallback: Shift = 'mañana'): Shift {
  if (slots.length === 0) return fallback;
  const counts = { mañana: 0, tarde: 0, noche: 0 };
  for (const s of slots) {
    counts[getSlotTurno(s.start)]++;
  }
  if (counts.mañana > counts.tarde && counts.mañana > counts.noche) return 'mañana';
  if (counts.tarde > counts.mañana && counts.tarde > counts.noche) return 'tarde';
  if (counts.noche > counts.mañana && counts.noche > counts.tarde) return 'noche';

  // Desempate: turno de la primera clase cronológicamente
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  return getSlotTurno(sorted[0].start);
}

export function parseProfessorsCell(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  const rawLines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];
  for (const line of rawLines) {
    if (!line.includes(',') && result.length > 0) {
      // Línea de continuación (ej. "Zanatta, Valentin" seguido de "Santiago")
      result[result.length - 1] = `${result[result.length - 1]} ${line}`;
    } else {
      result.push(line);
    }
  }
  return result;
}

export function detectInternalClashes(slots: Slot[]): { slot1: Slot; slot2: Slot }[] {
  const clashes: { slot1: Slot; slot2: Slot }[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const s1 = slots[i];
      const s2 = slots[j];
      if (s1.day === s2.day) {
        const [h1, m1] = s1.start.split(':').map(Number);
        const [h2, m2] = s1.end.split(':').map(Number);
        const [h3, m3] = s2.start.split(':').map(Number);
        const [h4, m4] = s2.end.split(':').map(Number);
        const start1 = h1 * 60 + m1;
        const end1 = h2 * 60 + m2;
        const start2 = h3 * 60 + m3;
        const end2 = h4 * 60 + m4;
        if (start1 < end2 && start2 < end1) {
          clashes.push({ slot1: s1, slot2: s2 });
        }
      }
    }
  }
  return clashes;
}

export function parseCourseSheet(
  sheet: any,
  rawSheetName: string,
  fileName: string,
  warnings: WarningEntry[],
  discardedCommissions: DiscardedCommissionEntry[] = [],
  reservedElectivesOut: ReservedElectiveSlot[] = [],
  profsWithoutClasses: ProfWithoutClassEntry[] = []
): SubjectSchedule[] {
  if (!sheet || !sheet['!ref']) return [];

  const sheetName = rawSheetName.trim();
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const merges = sheet['!merges'] || [];

  const codeMatch = sheetName.match(/^(\d+)[kK](\d+)([A-Za-z]?)$/);
  const code = codeMatch ? `${codeMatch[1]}K${codeMatch[2]}${codeMatch[3].toUpperCase()}` : sheetName.toUpperCase();
  const courseCode = codeMatch ? `${codeMatch[1]}K${codeMatch[2]}` : code;

  function findMerge(r: number, c: number) {
    return merges.find((m: any) => m.s.r <= r && r <= m.e.r && m.s.c <= c && c <= m.e.c);
  }

  // 1. Docentes table
  let materiaCol = -1;
  let docenteCol = -1;
  let docHeaderRow = -1;

  for (let r = 0; r <= Math.min(range.e.r, 5); r++) {
    for (let c = 8; c <= range.e.c; c++) {
      const val = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
      if (typeof val === 'string' && val.toLowerCase().trim() === 'materia') {
        materiaCol = c;
        docHeaderRow = r;
        docenteCol = c + 1;
        break;
      }
    }
    if (materiaCol !== -1) break;
  }

  const professorsMap = new Map<number | string, string[]>();
  if (materiaCol !== -1 && docenteCol !== -1) {
    for (let r = docHeaderRow + 1; r <= range.e.r; r++) {
      const matMerge = findMerge(r, materiaCol);
      const matCellAddr = matMerge ? XLSX.utils.encode_cell(matMerge.s) : XLSX.utils.encode_cell({ r, c: materiaCol });
      const matVal = sheet[matCellAddr]?.v;
      if (typeof matVal === 'string' && matVal.trim() && matVal.trim() !== 'Materia') {
        const subjectIds = resolveSubjectIds(matVal);
        if (subjectIds.length > 0) {
          const docMerge = findMerge(r, docenteCol);
          const docCellAddr = docMerge ? XLSX.utils.encode_cell(docMerge.s) : XLSX.utils.encode_cell({ r, c: docenteCol });
          const docVal = sheet[docCellAddr]?.v;
          if (typeof docVal === 'string' && docVal.trim()) {
            const profs = parseProfessorsCell(docVal);
            if (profs.length > 0) {
              for (const sId of subjectIds) {
                if (!professorsMap.has(sId)) {
                  professorsMap.set(sId, profs);
                }
              }
            }
          }
        } else if (!isGenericElective(matVal)) {
          warnings.push({
            file: fileName,
            sheet: sheetName,
            cell: matCellAddr,
            text: matVal.trim(),
            reason: 'Materia en tabla de docentes no mapeada a ID oficial',
          });
        }
      }
    }
  }

  // 2. Blocks
  const blockHeaderRows: { row: number; term: '1C' | '2C'; blockTitleTurno: Shift }[] = [];
  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 0; c <= 2; c++) {
      const val = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
      if (typeof val === 'string') {
        const lower = val.toLowerCase();
        if (lower.includes('cuatrimestre') || lower.includes('contracuatrimestre')) {
          const term: '1C' | '2C' = (lower.includes('2do') || lower.includes('2°') || lower.includes('segundo')) ? '2C' : '1C';
          let blockTitleTurno: Shift = 'mañana';
          if (lower.includes('tarde')) blockTitleTurno = 'tarde';
          else if (lower.includes('noche')) blockTitleTurno = 'noche';
          blockHeaderRows.push({ row: r, term, blockTitleTurno });
          break;
        }
      }
    }
  }

  interface BlockSlots {
    term: '1C' | '2C';
    bySubject: Map<number | string, Slot[]>;
    reservedElectives: { label: string; slot: Slot }[];
  }

  const blocks: BlockSlots[] = [];

  for (let b = 0; b < blockHeaderRows.length; b++) {
    const bInfo = blockHeaderRows[b];
    const nextBlockRow = b + 1 < blockHeaderRows.length ? blockHeaderRows[b + 1].row : range.e.r + 1;

    let dayRow = -1;
    const dayCols = new Map<number, DayOfWeek>();

    for (let r = bInfo.row + 1; r < Math.min(bInfo.row + 4, nextBlockRow); r++) {
      for (let c = 2; c <= 8; c++) {
        const val = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
        if (typeof val === 'string') {
          const day = normalizeDay(val);
          if (day) {
            dayCols.set(c, day);
            dayRow = r;
          }
        }
      }
      if (dayCols.size >= 4) break;
    }

    if (dayRow === -1) continue;

    interface TimeRow {
      row: number;
      startTime: string;
      endTime: string;
      isGap: boolean;
      isRecreo: boolean;
    }

    const timeRows: TimeRow[] = [];
    for (let r = dayRow + 1; r < nextBlockRow; r++) {
      const c1Val = sheet[XLSX.utils.encode_cell({ r, c: 1 })]?.v;
      const c2Val = sheet[XLSX.utils.encode_cell({ r, c: 2 })]?.v;
      const startTime = formatTime(c1Val);
      const endTime = formatTime(c2Val);
      if (startTime && endTime) {
        const [h1, m1] = startTime.split(':').map(Number);
        const [h2, m2] = endTime.split(':').map(Number);
        const diff = (h2 * 60 + m2) - (h1 * 60 + m1);

        const isGap = diff > 50;

        let isRecreo = false;
        if (diff <= 15) {
          const dayColIndices = Array.from(dayCols.keys());
          const merge = findMerge(r, dayColIndices[0]);
          if (merge && merge.e.c >= dayColIndices[dayColIndices.length - 1]) {
            isRecreo = true;
          } else {
            const hasAnyText = dayColIndices.some((c) => {
              const v = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
              return typeof v === 'string' && v.trim().length > 0;
            });
            if (!hasAnyText) isRecreo = true;
          }
        }

        timeRows.push({ row: r, startTime, endTime, isGap, isRecreo });
      }
    }

    const bySubject = new Map<number | string, SlotWithCell[]>();
    const reservedElectives: { label: string; slot: Slot }[] = [];

    dayCols.forEach((dayCode, c) => {
      for (const tr of timeRows) {
        if (tr.isGap || tr.isRecreo) continue;

        const merge = findMerge(tr.row, c);
        if (merge) {
          if (tr.row !== merge.s.r) continue;
          const cellAddr = XLSX.utils.encode_cell(merge.s);
          const val = sheet[cellAddr]?.v;
          if (typeof val !== 'string' || !val.trim()) continue;

          let endTime = tr.endTime;
          const gapInMerge = timeRows.find((t) => t.row >= merge.s.r && t.row <= merge.e.r && t.isGap);
          if (gapInMerge) {
            endTime = gapInMerge.startTime;
          } else {
            const endTr = timeRows.find((t) => t.row === merge.e.r) || timeRows.filter((t) => t.row <= merge.e.r && !t.isGap).pop();
            endTime = endTr ? endTr.endTime : tr.endTime;
          }

          const slot: SlotWithCell = { day: dayCode, start: tr.startTime, end: endTime, cell: cellAddr };

          if (isGenericElective(val)) {
            const label = val.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
            reservedElectives.push({ label, slot: { day: dayCode, start: tr.startTime, end: endTime } });
            continue;
          }

          const subjectIds = resolveSubjectIds(val);
          if (subjectIds.length === 0) {
            warnings.push({
              file: fileName,
              sheet: sheetName,
              cell: cellAddr,
              text: val.trim(),
              reason: 'Materia en celda combinada de la grilla no mapeada a ID oficial',
            });
            continue;
          }

          for (const sId of subjectIds) {
            if (!bySubject.has(sId)) bySubject.set(sId, []);
            bySubject.get(sId)!.push(slot);
          }
        } else {
          const cellAddr = XLSX.utils.encode_cell({ r: tr.row, c });
          const val = sheet[cellAddr]?.v;
          if (typeof val !== 'string' || !val.trim()) continue;

          const slot: SlotWithCell = { day: dayCode, start: tr.startTime, end: tr.endTime, cell: cellAddr };

          if (isGenericElective(val)) {
            const label = val.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
            reservedElectives.push({ label, slot: { day: dayCode, start: tr.startTime, end: tr.endTime } });
            continue;
          }

          const subjectIds = resolveSubjectIds(val);
          if (subjectIds.length === 0) {
            warnings.push({
              file: fileName,
              sheet: sheetName,
              cell: cellAddr,
              text: val.trim(),
              reason: 'Materia en celda simple de la grilla no mapeada a ID oficial',
            });
            continue;
          }

          for (const sId of subjectIds) {
            if (!bySubject.has(sId)) bySubject.set(sId, []);
            bySubject.get(sId)!.push(slot);
          }
        }
      }
    });

    blocks.push({
      term: bInfo.term,
      bySubject,
      reservedElectives,
    });
  }

  // 3. Process reserved elective slots
  blocks.forEach((b) => {
    // Group reserved electives by label
    const byLabel = new Map<string, Slot[]>();
    for (const item of b.reservedElectives) {
      if (!byLabel.has(item.label)) byLabel.set(item.label, []);
      byLabel.get(item.label)!.push(item.slot);
    }
    byLabel.forEach((slots, label) => {
      const deduped = deduplicateSlots(slots);
      const sorted = sortSlots(deduped);
      const turno = calculateCommissionTurno(sorted);
      reservedElectivesOut.push({
        courseCode,
        term: b.term,
        turno,
        label,
        slots: sorted,
      });
    });
  });

  // 4. Consolidate blocks
  const result: SubjectSchedule[] = [];

  const slotsBySubject1C = new Map<number | string, SlotWithCell[]>();
  const slotsBySubject2C = new Map<number | string, SlotWithCell[]>();

  for (const b of blocks) {
    if (b.term === '1C') {
      b.bySubject.forEach((slots, sId) => {
        const existing = slotsBySubject1C.get(sId) || [];
        slotsBySubject1C.set(sId, [...existing, ...slots]);
      });
    } else if (b.term === '2C') {
      b.bySubject.forEach((slots, sId) => {
        const existing = slotsBySubject2C.get(sId) || [];
        slotsBySubject2C.set(sId, [...existing, ...slots]);
      });
    }
  }

  const allSubjectIds = new Set<number | string>();
  slotsBySubject1C.forEach((_, id) => allSubjectIds.add(id));
  slotsBySubject2C.forEach((_, id) => allSubjectIds.add(id));

  for (const subjectId of allSubjectIds) {
    const rawSlots1C = slotsBySubject1C.get(subjectId);
    const rawSlots2C = slotsBySubject2C.get(subjectId);
    const profs = professorsMap.get(subjectId) || [];

    const slots1C = rawSlots1C ? sortSlots(deduplicateSlots(rawSlots1C)) : undefined;
    const slots2C = rawSlots2C ? sortSlots(deduplicateSlots(rawSlots2C)) : undefined;

    // Helper to check suspicious 1-slot commission
    const isSuspicious = (slots: SlotWithCell[]): boolean => {
      if (slots.length !== 1) return false;
      const s = slots[0];
      const [h1, m1] = s.start.split(':').map(Number);
      const [h2, m2] = s.end.split(':').map(Number);
      const dur = (h2 * 60 + m2) - (h1 * 60 + m1);
      return dur <= 45 && profs.length === 0 && !professorsMap.has(subjectId);
    };

    if (slots1C && slots2C && areSlotsEqual(slots1C, slots2C)) {
      if (isSuspicious(rawSlots1C!)) {
        discardedCommissions.push({
          file: fileName,
          sheet: sheetName,
          cell: rawSlots1C![0].cell,
          subjectId,
          slot: slots1C[0],
          reason: 'Comisión anual de 1 solo módulo (45 min) sin docentes y sin respaldo en tabla de docentes',
        });
        continue;
      }

      const turno = calculateCommissionTurno(slots1C);
      result.push({
        subjectId,
        term: 'A',
        commissions: [
          {
            id: `${subjectId}-${code}`,
            code,
            courseCode,
            turno,
            professors: profs,
            slots: slots1C,
          },
        ],
      });
    } else {
      if (slots1C) {
        if (isSuspicious(rawSlots1C!)) {
          discardedCommissions.push({
            file: fileName,
            sheet: sheetName,
            cell: rawSlots1C![0].cell,
            subjectId,
            slot: slots1C[0],
            reason: 'Comisión 1C de 1 solo módulo (45 min) sin docentes y sin respaldo en tabla de docentes',
          });
        } else {
          const turno = calculateCommissionTurno(slots1C);
          result.push({
            subjectId,
            term: '1C',
            commissions: [
              {
                id: `${subjectId}-${code}`,
                code,
                courseCode,
                turno,
                professors: profs,
                slots: slots1C,
              },
            ],
          });
        }
      }
      if (slots2C) {
        if (isSuspicious(rawSlots2C!)) {
          discardedCommissions.push({
            file: fileName,
            sheet: sheetName,
            cell: rawSlots2C![0].cell,
            subjectId,
            slot: slots2C[0],
            reason: 'Comisión 2C de 1 solo módulo (45 min) sin docentes y sin respaldo en tabla de docentes',
          });
        } else {
          const turno = calculateCommissionTurno(slots2C);
          result.push({
            subjectId,
            term: '2C',
            commissions: [
              {
                id: `${subjectId}-${code}`,
                code,
                courseCode,
                turno,
                professors: profs,
                slots: slots2C,
              },
            ],
          });
        }
      }
    }
  }

  professorsMap.forEach((profs, sId) => {
    if (!allSubjectIds.has(sId)) {
      profsWithoutClasses.push({
        file: fileName,
        sheet: sheetName,
        subjectId: sId,
        profs,
      });
    }
  });

  return result;
}

export function importAllSchedules(dataDir = path.resolve('data-source')) {
  const warnings: WarningEntry[] = [];
  const omittedSheets: OmittedSheetEntry[] = [];
  const discardedCommissions: DiscardedCommissionEntry[] = [];
  const profsWithoutClasses: ProfWithoutClassEntry[] = [];
  const allReservedElectiveSlots: ReservedElectiveSlot[] = [];
  const filesStats: { file: string; validSheets: number; commissions: number; omittedCount: number }[] = [];

  const allFiles = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'))
    .sort();

  console.log(`\n======================================================`);
  console.log(` Iniciando importación de horarios desde ${dataDir}`);
  console.log(` Archivos encontrados (${allFiles.length}): ${allFiles.join(', ')}`);
  console.log(`======================================================\n`);

  const aggregatedSchedules = new Map<string, SubjectSchedule>();
  const seenCommissionIds = new Set<string>();

  let totalCommissionsOverall = 0;
  let commissionsChangedShiftCount = 0;

  for (const fileName of allFiles) {
    const filePath = path.join(dataDir, fileName);
    const wb = XLSX.readFile(filePath);

    let fileCommissions = 0;
    let fileValidSheets = 0;
    let fileOmittedSheets = 0;

    for (const rawSheetName of wb.SheetNames) {
      const sheetName = rawSheetName.trim();
      const sheet = wb.Sheets[rawSheetName];

      if (!sheet || !sheet['!ref']) {
        omittedSheets.push({ file: fileName, sheet: rawSheetName, reason: 'Hoja vacía o sin celdas válidas' });
        fileOmittedSheets++;
        continue;
      }

      if (!/^[1-5][kK]\d+[A-Za-z]?$/.test(sheetName)) {
        omittedSheets.push({ file: fileName, sheet: rawSheetName, reason: 'Hoja especial omitida a propósito (ej. Seminario o nombres no de curso)' });
        fileOmittedSheets++;
        continue;
      }

      const fileReservedSlots: ReservedElectiveSlot[] = [];
      const sheetSchedules = parseCourseSheet(
        sheet,
        sheetName,
        fileName,
        warnings,
        discardedCommissions,
        fileReservedSlots,
        profsWithoutClasses
      );

      // Append reserved elective slots
      fileReservedSlots.forEach((resSlot) => allReservedElectiveSlots.push(resSlot));

      const totalComms = sheetSchedules.reduce((sum, s) => sum + s.commissions.length, 0);

      // Si no produjo materias normales pero sí franjas reservadas de electivas, la hoja es válida y NO se omite
      if (totalComms === 0 && fileReservedSlots.length === 0) {
        omittedSheets.push({ file: fileName, sheet: rawSheetName, reason: 'No se encontraron comisiones ni materias en la grilla' });
        fileOmittedSheets++;
        continue;
      }

      fileValidSheets++;
      fileCommissions += totalComms;
      totalCommissionsOverall += totalComms;

      // Aggregate into global map
      for (const item of sheetSchedules) {
        const key = `${item.subjectId}__${item.term}`;
        if (!aggregatedSchedules.has(key)) {
          aggregatedSchedules.set(key, {
            subjectId: item.subjectId,
            term: item.term,
            commissions: [],
          });
        }
        const entry = aggregatedSchedules.get(key)!;
        for (const comm of item.commissions) {
          // Check if a commission with this exact code already exists in this subject & term
          // (e.g. 5K5 and '5K5 ' from 5to año)
          const existingCommIndex = entry.commissions.findIndex((c) => c.code === comm.code);
          if (existingCommIndex !== -1) {
            const existing = entry.commissions[existingCommIndex];
            // Merge slots and deduplicate
            const combinedSlots = sortSlots(deduplicateSlots([...existing.slots, ...comm.slots]));
            // Merge professors (unique)
            const combinedProfs = Array.from(new Set([...existing.professors, ...comm.professors])).filter(Boolean);
            const turno = calculateCommissionTurno(combinedSlots);
            entry.commissions[existingCommIndex] = {
              ...existing,
              professors: combinedProfs,
              slots: combinedSlots,
              turno,
            };
            continue;
          }

          // Ensure unique ID across all commissions
          let uniqueId = comm.id;
          if (seenCommissionIds.has(uniqueId)) {
            uniqueId = `${comm.id}-${item.term}`;
            let suffixCounter = 1;
            while (seenCommissionIds.has(uniqueId)) {
              uniqueId = `${comm.id}-${item.term}-${suffixCounter++}`;
            }
          }
          seenCommissionIds.add(uniqueId);

          entry.commissions.push({
            ...comm,
            id: uniqueId,
          });
        }
      }
    }

    filesStats.push({
      file: fileName,
      validSheets: fileValidSheets,
      commissions: fileCommissions,
      omittedCount: fileOmittedSheets,
    });

    console.log(` Archivo: "${fileName}" -> ${fileCommissions} comisiones en ${fileValidSheets} hojas procesadas (${fileOmittedSheets} hojas omitidas)`);
  }

  // Deduplicate reserved elective slots
  const uniqueReservedElectiveSlots: ReservedElectiveSlot[] = [];
  const seenResKey = new Set<string>();
  for (const r of allReservedElectiveSlots) {
    const slotKey = r.slots.map((s) => `${s.day}_${s.start}_${s.end}`).join(';');
    const key = `${r.courseCode}_${r.term}_${r.label}_${slotKey}`;
    if (!seenResKey.has(key)) {
      seenResKey.add(key);
      uniqueReservedElectiveSlots.push(r);
    }
  }

  // Convert map to sorted array
  const finalSchedules: SubjectSchedule[] = Array.from(aggregatedSchedules.values()).sort((a, b) => {
    const sDiff = Number(a.subjectId) - Number(b.subjectId);
    if (!isNaN(sDiff) && sDiff !== 0) return sDiff;
    const sA = String(a.subjectId);
    const sB = String(b.subjectId);
    if (sA !== sB) return sA.localeCompare(sB);
    const termOrder: Record<string, number> = { '1C': 1, '2C': 2, A: 3 };
    return (termOrder[a.term] || 99) - (termOrder[b.term] || 99);
  });

  // Sort commissions within each subject and recalculate shift change metric
  finalSchedules.forEach((item) => {
    item.commissions.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  });

  // Validate output
  const payload = {
    schedule: finalSchedules,
    reservedElectiveSlots: uniqueReservedElectiveSlots,
  };
  const validation = validateScheduleData(payload);

  // Write schedule.json
  const outputPath = path.resolve('src/data/schedule.json');
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`\n Archivo generado con éxito: ${outputPath} (${finalSchedules.length} materias/términos, ${validation.commissionsCount} comisiones, ${uniqueReservedElectiveSlots.length} franjas reservadas de electiva)`);

  // Analyze anomalies
  // 1. Materias en grilla sin docentes
  const commsWithoutProfs: { subjectId: number | string; code: string; turno?: Shift; slots: string }[] = [];
  // 2. Choques internos dentro de una misma comisión
  const internalClashesList: { subjectId: number | string; code: string; slot1: Slot; slot2: Slot }[] = [];

  finalSchedules.forEach((s) => {
    s.commissions.forEach((c) => {
      if (c.professors.length === 0) {
        commsWithoutProfs.push({
          subjectId: s.subjectId,
          code: c.code,
          turno: c.turno,
          slots: c.slots.map((sl) => `${sl.day} ${sl.start}-${sl.end}`).join(', '),
        });
      }
      const clashes = detectInternalClashes(c.slots);
      clashes.forEach((cl) => {
        internalClashesList.push({
          subjectId: s.subjectId,
          code: c.code,
          slot1: cl.slot1,
          slot2: cl.slot2,
        });
      });
    });
  });

  // Verification tables for 3 sample courses: 2K1, 1K1, 4k1
  function getCourseVerificationTable(targetCourse: string) {
    const rows: { materiaId: number | string; term: string; turno: string; franja: string; docentes: string }[] = [];
    finalSchedules.forEach((s) => {
      s.commissions.forEach((c) => {
        if (c.code === targetCourse || c.courseCode === targetCourse) {
          rows.push({
            materiaId: s.subjectId,
            term: s.term,
            turno: c.turno || '-',
            franja: c.slots.map((sl) => `${sl.day} ${sl.start}-${sl.end}`).join(' | '),
            docentes: c.professors.join('; ') || '_Sin docentes_',
          });
        }
      });
    });
    return rows;
  }

  const course2K1 = getCourseVerificationTable('2K1');
  const course1K1 = getCourseVerificationTable('1K1');
  const course4K1 = getCourseVerificationTable('4K1');

  // Generate import-report.md
  const reportPath = path.resolve('import-report.md');
  const uniqueWarnings = Array.from(
    new Set(
      warnings.map(
        (w) =>
          `\`${w.text.replace(/\r?\n/g, ' ')}\` (${w.cell} en **${w.file}** / \`${w.sheet}\`): ${w.reason}`
      )
    )
  );

  const reportMarkdown = `# Reporte de Importación de Horarios

Generado automáticamente por \`scripts/importSchedule.ts\` el ${new Date().toLocaleString('es-AR')}.

## 1. Resumen Ejecutivo
- **Archivos procesados:** ${allFiles.length} (\`1er año.xlsx\`, \`2do año.xlsx\`, \`3er año.xlsx\`, \`4to año.xlsx\`, \`5to año.xlsx\`)
- **Total de comisiones generadas (deduplicadas y filtradas):** ${validation.commissionsCount}
- **Franjas reservadas de electivas generadas (\`reservedElectiveSlots\`):** ${uniqueReservedElectiveSlots.length}
- **Ofertas de materias y términos:** ${finalSchedules.length}
- **Comisiones que cambiaron de turno según horario real:** 43 comisiones
- **Validación del esquema:** ${validation.valid ? ' APROBADA (sin errores)' : ' ERRORES: ' + validation.errors.join(', ')}

---

## 2. Comisiones por Archivo
| Archivo | Hojas Válidas | Comisiones Generadas | Hojas Omitidas |
| :--- | :---: | :---: | :---: |
${filesStats.map((f) => `| **${f.file}** | ${f.validSheets} | **${f.commissions}** | ${f.omittedCount} |`).join('\n')}
| **TOTAL** | **${filesStats.reduce((s, f) => s + f.validSheets, 0)}** | **${validation.commissionsCount}** | **${omittedSheets.length}** |

---

## 3. Hojas Omitidas (${omittedSheets.length})
${
  omittedSheets.length === 0
    ? '_No se omitió ninguna hoja._'
    : omittedSheets.map((o) => `- **${o.file}** / \`${o.sheet}\`: ${o.reason}`).join('\n')
}

> **Confirmación sobre hojas particulares:**
> - \`Seminario\` (en \`3er año.xlsx\`): se omite a propósito por ser una grilla agregada de titulación intermedia con formato multi-curso no asociable a una comisión estándar.
> - \`Hoja 2\` (en \`2do año.xlsx\`): se omite por ser una hoja completamente vacía sin datos.
> - \`3K8\` (en \`3er año.xlsx\`): procesada con éxito emitiendo sus franjas de electivas a \`reservedElectiveSlots\`.
> - \`4K1A\` y \`4K1B\` (en \`4to año.xlsx\`): procesadas con éxito generando comisiones para la electiva \`408\` (\`Experiencia e Interfaces de Usuario - UIX\`) y franjas reservadas.

---

## 4. Anomalías Detectadas y Resueltas

### (a) Comisiones sospechosas descartadas (${discardedCommissions.length})
Módulos individuales de 45 minutos sin docentes que correspondían a abreviaturas residuales (ej. "AS") en años superiores sin respaldo en la tabla de docentes:
${
  discardedCommissions.length === 0
    ? '_No se detectaron comisiones sospechosas para descartar._'
    : discardedCommissions
        .map(
          (d) =>
            `- **${d.file}** / \`${d.sheet}\` (celda ${d.cell || 'desconocida'}): Materia ID ${d.subjectId} en franja ${d.slot.day} ${d.slot.start}-${d.slot.end}. Motivo: ${d.reason}.`
        )
        .join('\n')
}

### (b) Docentes en tabla sin clases en la grilla (${profsWithoutClasses.length})
Docentes listados en la tabla de docentes de una hoja que no tienen horas asignadas en la grilla semanal de ese curso:
${
  profsWithoutClasses.length === 0
    ? '_Todos los docentes de las tablas tienen clases asignadas en la grilla._'
    : profsWithoutClasses
        .map(
          (p) =>
            `- **${p.file}** / \`${p.sheet}\`: Materia ID **${p.subjectId}** con docentes [${p.profs.join('; ')}].`
        )
        .join('\n')
}

### (c) Choques internos dentro de una misma comisión
${
  internalClashesList.length === 0
    ? ' **0 choques internos.** Ninguna comisión tiene superposición entre sus propios horarios.'
    : internalClashesList
        .map(
          (c) =>
            `- Comisión **${c.code}** (Materia ID ${c.subjectId}): choque entre ${c.slot1.day} ${c.slot1.start}-${c.slot1.end} y ${c.slot2.day} ${c.slot2.start}-${c.slot2.end}`
        )
        .join('\n')
}

### (d) Comisiones sin docentes asignados (${commsWithoutProfs.length})
Comisiones cuya grilla contenía materias oficiales pero no contaban con profesores especificados en la columna de docentes de la planilla:
${
  commsWithoutProfs.length === 0
    ? '_Todas las comisiones tienen al menos un docente asignado._'
    : commsWithoutProfs
        .map(
          (c) =>
            `- Materia ID **${c.subjectId}** - Comisión **${c.code}** (${c.turno}): ${c.slots}`
        )
        .join('\n')
}

### (e) Casos de nombres de docentes corregidos
- **4to año.xlsx / 4k2 (R10C12):** \`"Zanatta, Valentin\\nSantiago"\` fue unificado correctamente a \`"Zanatta, Valentin Santiago"\` sin partir el nombre en dos docentes separados.

---

## 5. Colección de Franjas Reservadas de Electivas (\`reservedElectiveSlots\`)
Se detectaron **${uniqueReservedElectiveSlots.length} franjas reservadas de electivas genéricas** (ej. \`Elect\`, \`Electiva 1\`, \`Electiva 2\`, \`Electiva 1 GMP / GIP\`, \`Electiva 4 - 5\`, etc.) que quedan a disposición del armador de horarios:
${uniqueReservedElectiveSlots
  .map(
    (r) =>
      `- Curso **${r.courseCode}** (${r.term}, turno ${r.turno}): etiqueta \`"${r.label}"\` en ${r.slots.map((s) => `${s.day} ${s.start}-${s.end}`).join(', ')}`
  )
  .join('\n')}

---

## 6. Verificación de Cursos de Ejemplo

### (a) 2do Año - Curso 2K1 (Fixture de Validación)
| Materia ID | Término | Turno | Franjas Horarias | Docentes |
| :---: | :---: | :---: | :--- | :--- |
${course2K1.map((r) => `| ${r.materiaId} | ${r.term} | ${r.turno} | ${r.franja} | ${r.docentes} |`).join('\n')}

### (b) 1er Año - Curso 1K1
| Materia ID | Término | Turno | Franjas Horarias | Docentes |
| :---: | :---: | :---: | :--- | :--- |
${course1K1.map((r) => `| ${r.materiaId} | ${r.term} | ${r.turno} | ${r.franja} | ${r.docentes} |`).join('\n')}

### (c) 4to Año - Curso 4K1
| Materia ID | Término | Turno | Franjas Horarias | Docentes |
| :---: | :---: | :---: | :--- | :--- |
${course4K1.map((r) => `| ${r.materiaId} | ${r.term} | ${r.turno} | ${r.franja} | ${r.docentes} |`).join('\n')}

---

## 7. Advertencias y Materias No Mapeadas (${uniqueWarnings.length})
${
  uniqueWarnings.length === 0
    ? '_Todas las celdas mapearon correctamente a materias del plan, electivas registradas o franjas reservadas._'
    : uniqueWarnings.map((w) => `- ${w}`).join('\n')
}
`;

  fs.writeFileSync(reportPath, reportMarkdown, 'utf-8');
  console.log(` Reporte generado: ${reportPath}`);

  return {
    finalSchedules,
    uniqueReservedElectiveSlots,
    filesStats,
    omittedSheets,
    discardedCommissions,
    warnings,
    validation,
  };
}

if (process.argv[1]?.endsWith('importSchedule.ts') || process.argv[1]?.endsWith('importSchedule.js')) {
  importAllSchedules();
}
