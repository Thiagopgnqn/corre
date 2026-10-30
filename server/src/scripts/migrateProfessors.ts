import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as xlsxModule from 'xlsx';
import { analyzeProfessorNames } from '../modules/professors/professorNormalizer.js';
import { ELECTIVE_OFFERINGS_SEED } from './electiveOfferingsSeed.js';

const XLSX = (xlsxModule as any).default || xlsxModule;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function scanRawSpreadsheetAnomalies(): Array<{ location: string; rawCell: string; note: string }> {
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
  if (!dir) return [];

  const found: Array<{ location: string; rawCell: string; note: string }> = [];
  const seen = new Set<string>();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx'));
  for (const file of files) {
    try {
      const wb = XLSX.readFile(path.join(dir, file));
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet || !sheet['!ref']) continue;
        const range = XLSX.utils.decode_range(sheet['!ref']);
        let docenteCol = -1;
        let docHeaderRow = -1;
        for (let r = 0; r <= Math.min(range.e.r, 5); r++) {
          for (let c = 8; c <= range.e.c; c++) {
            const val = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
            if (typeof val === 'string' && val.toLowerCase().trim() === 'materia') {
              docenteCol = c + 1;
              docHeaderRow = r;
              break;
            }
          }
          if (docenteCol !== -1) break;
        }
        if (docenteCol === -1) continue;
        for (let r = docHeaderRow + 1; r <= range.e.r; r++) {
          const val = sheet[XLSX.utils.encode_cell({ r, c: docenteCol })]?.v;
          if (typeof val !== 'string' || !val.trim()) continue;
          const lines = val.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          if (/[;/|]/.test(val)) {
            const key = `${file}:${sheetName}:${val}`;
            if (!seen.has(key)) {
              seen.add(key);
              found.push({
                location: `${file} [${sheetName}]`,
                rawCell: val.replace(/\r?\n/g, ' ; '),
                note: 'Separador múltiple en celda de planilla original',
              });
            }
          } else if (lines.some((l) => !l.includes(','))) {
            const key = `${file}:${sheetName}:${val}`;
            if (!seen.has(key)) {
              seen.add(key);
              found.push({
                location: `${file} [${sheetName}]`,
                rawCell: val.replace(/\r?\n/g, '; '),
                note: 'Línea partida sin coma en celda Excel (unida por el importador como continuación de nombre)',
              });
            }
          }
        }
      }
    } catch {
      // Ignorar si no se puede abrir alguna planilla local
    }
  }
  return found;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply || args.includes('--dry-run');
  let faculty = 'FRC';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--faculty' && args[i + 1]) {
      faculty = args[i + 1].toUpperCase();
    }
  }
  return { dryRun, apply: apply && !args.includes('--dry-run'), faculty };
}

function loadLocalRawProfessorNames(): {
  commissionProfessorNames: string[];
  electiveOfferingProfessorNames: string[];
  dataFile: string;
} {
  const candidates = [
    path.resolve(__dirname, '../../seed-data/schedule.json'),
    path.resolve(__dirname, '../seed-data/schedule.json'),
    path.resolve(__dirname, '../../../src/data/schedule.json'),
    path.resolve(process.cwd(), 'seed-data/schedule.json'),
    path.resolve(process.cwd(), 'server/seed-data/schedule.json'),
  ];

  let dataFile = '';
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      dataFile = cand;
      break;
    }
  }

  if (!dataFile) {
    throw new Error('No se encontró seed-data/schedule.json para ejecutar --dry-run local.');
  }

  const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const commissionProfessorNames: string[] = [];

  // Recolectar tanto 1C como 2C (anuales aparecen en ambos cuatrimestres en la BD)
  for (const termStr of ['1C', '2C'] as const) {
    for (const item of parsed.schedule || []) {
      if (item.term !== 'A' && item.term !== termStr) continue;
      for (const comm of item.commissions || []) {
        for (const prof of comm.professors || []) {
          if (typeof prof === 'string' && prof.trim()) {
            commissionProfessorNames.push(prof.trim());
          }
        }
      }
    }
  }

  const electiveOfferingProfessorNames: string[] = [];
  for (const _termStr of ['1C', '2C'] as const) {
    for (const off of ELECTIVE_OFFERINGS_SEED) {
      for (const prof of off.professors) {
        if (prof.trim()) {
          electiveOfferingProfessorNames.push(prof.trim());
        }
      }
    }
  }

  return {
    commissionProfessorNames,
    electiveOfferingProfessorNames,
    dataFile,
  };
}

function printMigrationReport(
  analysis: ReturnType<typeof analyzeProfessorNames>,
  meta: {
    mode: 'DRY-RUN' | 'APPLY';
    sourceLabel: string;
    spreadsheetAnomalies?: Array<{ location: string; rawCell: string; note: string }>;
  }
) {
  console.log('======================================================================');
  console.log(` 🎓 REPORTE DE UNIFICACIÓN DE PROFESORES (${meta.mode})`);
  console.log(` 📂 Fuente: ${meta.sourceLabel}`);
  console.log('======================================================================\n');

  console.log('📌 1. RESUMEN GENERAL');
  console.log(`   • Apariciones totales en comisiones/ofertas: ${analysis.totalRawOccurrences}`);
  console.log(`   • Strings crudos distintos encontrados:      ${analysis.distinctRawStrings}`);
  console.log(`   • Docentes únicos resultantes (professors):  ${analysis.uniqueProfessors.length}`);
  console.log(`   • Unificaciones exactas seguras aplicadas:   ${analysis.exactMerges.length}`);
  console.log(
    `   • Propuestas alta/media prob. (separados):   ${analysis.proposedSameCandidates.length}`
  );
  console.log(
    `   • Mismo apellido / distinto nombre (sep.):   ${analysis.possibleDuplicatesSameSurname.length}`
  );
  console.log(
    `   • Nombres con formato raro / anomalías:      ${
      analysis.anomalousNames.length + (meta.spreadsheetAnomalies?.length || 0)
    }\n`
  );

  console.log('📌 2. UNIFICACIONES EXACTAS AUTOMÁTICAS (mismas palabras normalizadas)');
  if (analysis.exactMerges.length === 0) {
    console.log('   (Ninguna variante exacta con distinta tilde/orden en el conjunto actual)\n');
  } else {
    for (const m of analysis.exactMerges) {
      console.log(
        `   ✅ "${m.displayName}" [key: "${m.normalizedKey}"] <- [${m.mergedRawStrings
          .map((s) => `"${s}"`)
          .join(' | ')}]`
      );
    }
    console.log('');
  }

  console.log(
    '📌 3. POSIBLES DUPLICADOS — PROPUESTOS COMO MISMO DOCENTE (NO unificados automáticamente)'
  );
  if (analysis.proposedSameCandidates.length === 0) {
    console.log('   (Ninguno detectado)\n');
  } else {
    for (const c of analysis.proposedSameCandidates) {
      console.log(
        `   🔸 [${c.confidence.toUpperCase()}] "${c.professorA.displayName}"  <-->  "${c.professorB.displayName}"`
      );
      console.log(`      Motivo: ${c.reason}`);
    }
    console.log('');
  }

  console.log(
    '📌 4. POSIBLES DUPLICADOS — MISMO APELLIDO Y NOMBRES DISTINTOS (dejados separados)'
  );
  if (analysis.possibleDuplicatesSameSurname.length === 0) {
    console.log('   (Ninguno detectado)\n');
  } else {
    for (const c of analysis.possibleDuplicatesSameSurname) {
      console.log(`   🔹 "${c.professorA.displayName}"  vs  "${c.professorB.displayName}" (${c.reason})`);
    }
    console.log('');
  }

  console.log('📌 5. NOMBRES CON FORMATO RARO O ANOMALÍAS');
  const sheetAnoms = meta.spreadsheetAnomalies || [];
  if (analysis.anomalousNames.length === 0 && sheetAnoms.length === 0) {
    console.log('   (Ningún formato raro detectado)\n');
  } else {
    for (const a of analysis.anomalousNames) {
      console.log(`   ⚠️  "${a.raw}" -> ${a.anomalies.join('; ')}`);
    }
    for (const sa of sheetAnoms) {
      console.log(`   ⚠️  "${sa.rawCell}" (${sa.location}) -> ${sa.note}`);
    }
    console.log('');
  }

  console.log('======================================================================');
  if (meta.mode === 'DRY-RUN') {
    console.log(' ℹ️  MODO SIMULACIÓN (--dry-run): NO se realizó ninguna conexión ni escritura en Neon.');
  } else {
    console.log(' ✅ Migración aplicada y enlazada exitosamente en PostgreSQL.');
  }
  console.log('======================================================================');
}

async function main() {
  const { dryRun, apply, faculty } = parseArgs();

  if (dryRun || !apply) {
    const local = loadLocalRawProfessorNames();
    const allNames = [
      ...local.commissionProfessorNames,
      ...local.electiveOfferingProfessorNames,
    ];
    const analysis = analyzeProfessorNames(allNames);
    const spreadsheetAnomalies = scanRawSpreadsheetAnomalies();
    printMigrationReport(analysis, {
      mode: 'DRY-RUN',
      sourceLabel: `Catálogo local (${path.basename(local.dataFile)} + ofertas electivas 1C/2C)`,
      spreadsheetAnomalies,
    });
    return;
  }

  // Modo --apply (solo cuando el administrador lo ejecute explícitamente contra la BD)
  const { eq } = await import('drizzle-orm');
  const { db, pool } = await import('../db/index.js');
  const {
    faculties,
    commissionProfessors,
    electiveOfferings,
    electiveOfferingProfessors,
  } = await import('../db/schema.js');
  const { resolveOrCreateProfessorInTx } = await import(
    '../modules/professors/professorResolver.js'
  );

  try {
    const [fac] = await db
      .select()
      .from(faculties)
      .where(eq(faculties.code, faculty))
      .limit(1);

    if (!fac) {
      console.error(`❌ No se encontró la facultad con código: ${faculty}`);
      process.exit(1);
    }

    const commProfs = await db.select().from(commissionProfessors);
    const elecOffs = await db.select().from(electiveOfferings);

    const allRawNames: string[] = [
      ...commProfs.map((cp) => cp.professorName),
      ...elecOffs.flatMap((eo) => eo.professors || []),
    ];

    const analysis = analyzeProfessorNames(allRawNames);

    await db.transaction(async (tx) => {
      const cache = new Map<string, string>();

      for (const cp of commProfs) {
        const profId = await resolveOrCreateProfessorInTx(tx, fac.id, cp.professorName, cache);
        if (profId && cp.professorId !== profId) {
          await tx
            .update(commissionProfessors)
            .set({ professorId: profId, updatedAt: new Date() })
            .where(eq(commissionProfessors.id, cp.id));
        }
      }

      // Reconstruir vínculos de elective_offering_professors
      for (const eo of elecOffs) {
        await tx
          .delete(electiveOfferingProfessors)
          .where(eq(electiveOfferingProfessors.electiveOfferingId, eo.id));

        for (const rawProf of eo.professors || []) {
          if (!rawProf.trim()) continue;
          const profId = await resolveOrCreateProfessorInTx(tx, fac.id, rawProf, cache);
          await tx.insert(electiveOfferingProfessors).values({
            electiveOfferingId: eo.id,
            professorId: profId,
            professorName: rawProf.trim(),
          });
        }
      }
    });

    printMigrationReport(analysis, {
      mode: 'APPLY',
      sourceLabel: `Neon PostgreSQL (Facultad ${fac.code})`,
    });
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error en migrateProfessors:', err);
  process.exit(1);
});
