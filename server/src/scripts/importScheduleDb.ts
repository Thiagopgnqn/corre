import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import {
  faculties,
  studyPlans,
  subjects,
  scheduleTerms,
  courseGroups,
  commissions,
  commissionProfessors,
  commissionSlots,
  reservedElectiveSlots,
  electiveOfferings,
} from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mapeo canónico de días a enteros (1 = LUN .. 6 = SAB)
const DAY_MAP: Record<string, number> = {
  LUN: 1,
  MAR: 2,
  MIE: 3,
  JUE: 4,
  VIE: 5,
  SAB: 6,
};

// Mapeo inverso para logs
const DAY_REVERSE: Record<number, string> = {
  1: 'LUN',
  2: 'MAR',
  3: 'MIE',
  4: 'JUE',
  5: 'VIE',
  6: 'SAB',
};

// Mapeo canónico de turnos
function normalizeTurno(t?: string): 'M' | 'T' | 'N' {
  if (!t) return 'M';
  const norm = t.toLowerCase().trim();
  if (norm.startsWith('m') || norm === 'mañana') return 'M';
  if (norm.startsWith('t') || norm === 'tarde') return 'T';
  if (norm.startsWith('n') || norm === 'noche') return 'N';
  return 'M';
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const params: Record<string, string> = {
    faculty: 'frc',
    plan: 'Plan 2023',
    year: '2026',
    term: '1C',
    file: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        params[key] = next;
        i++;
      } else {
        params[key] = 'true';
      }
    }
  }

  return params;
}

async function runScheduleImport() {
  const params = parseCliArgs();
  const academicYear = parseInt(params.year, 10) || 2026;
  const termStr = params.term.toUpperCase() === '2C' ? '2C' : '1C';
  const facultyCode = params.faculty.toUpperCase();

  console.log('======================================================');
  console.log(' 📅 Importador de Horarios a Neon PostgreSQL');
  console.log(` 🏛️  Facultad:       ${facultyCode}`);
  console.log(` 📋  Plan:           ${params.plan}`);
  console.log(` 🗓️  Ciclo / Término: ${academicYear} - ${termStr}`);
  console.log('======================================================\n');

  try {
    // 1. Obtener facultad
    const [faculty] = await db
      .select()
      .from(faculties)
      .where(eq(faculties.code, facultyCode))
      .limit(1);

    if (!faculty) {
      console.error(`❌ No se encontró la facultad con código: ${facultyCode}`);
      process.exit(1);
    }

    // 2. Obtener plan de estudio
    const [plan] = await db
      .select()
      .from(studyPlans)
      .where(eq(studyPlans.isActive, true))
      .limit(1);

    if (!plan) {
      console.error(`❌ No se encontró ningún plan de estudio activo. Corra primero 'npm run seed'.`);
      process.exit(1);
    }

    // 3. Cargar mapa de materias del plan: code_in_plan -> subject_id (UUID)
    const planSubjects = await db
      .select({ id: subjects.id, codeInPlan: subjects.codeInPlan, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.planId, plan.id));

    const codeToSubjectUuid = new Map<number, string>();
    planSubjects.forEach((s) => codeToSubjectUuid.set(s.codeInPlan, s.id));

    console.log(`📚 Materias indexadas del plan: ${planSubjects.length}`);

    // 4. Localizar archivo o fuente de datos
    let dataFile = params.file;
    if (!dataFile) {
      const candidates = [
        path.resolve(__dirname, '../../seed-data/schedule.json'),
        path.resolve(__dirname, '../seed-data/schedule.json'),
        path.resolve(__dirname, '../../../src/data/schedule.json'),
        path.resolve(process.cwd(), 'seed-data/schedule.json'),
        path.resolve(process.cwd(), 'src/data/schedule.json'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          dataFile = cand;
          break;
        }
      }
    }

    if (!dataFile || !fs.existsSync(dataFile)) {
      console.error(`❌ No se encontró el archivo de datos: ${dataFile}`);
      console.error(`   Especifique una ruta con --file <ruta>`);
      process.exit(1);
    }

    console.log(`📂 Cargando oferta de horarios desde: ${dataFile}`);

    const scheduleData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const rawScheduleList: Array<{
      subjectId: number | string;
      term: '1C' | '2C' | 'A';
      commissions: Array<{
        id: string;
        code: string;
        courseCode: string;
        turno?: string;
        professors: string[];
        slots: Array<{ day: string; start: string; end: string; room?: string; mode?: string }>;
      }>;
    }> = scheduleData.schedule || [];

    const rawReservedSlots: Array<{
      courseCode: string;
      term: '1C' | '2C' | 'A';
      turno?: string;
      label: string;
      slots: Array<{ day: string; start: string; end: string }>;
    }> = scheduleData.reservedElectiveSlots || [];

    // 5. Crear o buscar schedule_term para este período
    const shouldBeCurrent = params.isCurrent !== undefined
      ? params.isCurrent === 'true'
      : (termStr === '1C');

    if (shouldBeCurrent) {
      await db
        .update(scheduleTerms)
        .set({ isCurrent: false })
        .where(eq(scheduleTerms.facultyId, faculty.id));
    }

    let [termRecord] = await db
      .select()
      .from(scheduleTerms)
      .where(
        and(
          eq(scheduleTerms.facultyId, faculty.id),
          eq(scheduleTerms.academicYear, academicYear),
          eq(scheduleTerms.term, termStr)
        )
      )
      .limit(1);

    if (!termRecord) {
      [termRecord] = await db
        .insert(scheduleTerms)
        .values({
          facultyId: faculty.id,
          academicYear,
          term: termStr,
          label: `${termStr === '1C' ? '1°' : '2°'} Cuatrimestre ${academicYear}`,
          isCurrent: shouldBeCurrent,
        })
        .returning();
      console.log(`✨ Período de horarios creado: ${termRecord.label} (ID: ${termRecord.id}, isCurrent: ${shouldBeCurrent})`);
    } else {
      if (params.isCurrent !== undefined) {
        await db
          .update(scheduleTerms)
          .set({ isCurrent: shouldBeCurrent })
          .where(eq(scheduleTerms.id, termRecord.id));
        termRecord.isCurrent = shouldBeCurrent;
      }
      console.log(`🔄 Actualizando oferta existente para: ${termRecord.label} (isCurrent: ${termRecord.isCurrent})`);
    }

    // 6. Transacción: Reemplazo limpio e idempotente para el período
    await db.transaction(async (tx) => {
      // Eliminar comisiones previas de este período (borra slots y profesores en cascada)
      await tx
        .delete(commissions)
        .where(eq(commissions.scheduleTermId, termRecord.id));

      // Eliminar franjas reservadas y ofertas de electivas previas
      await tx
        .delete(reservedElectiveSlots)
        .where(eq(reservedElectiveSlots.scheduleTermId, termRecord.id));

      await tx
        .delete(electiveOfferings)
        .where(eq(electiveOfferings.scheduleTermId, termRecord.id));

      // Eliminar grupos de cursos del período
      await tx
        .delete(courseGroups)
        .where(eq(courseGroups.scheduleTermId, termRecord.id));

      // 6.1 Crear Course Groups únicos (ej. 1K1, 2K1, 3K2, etc.)
      const courseGroupMap = new Map<string, string>(); // courseCode -> courseGroupId (UUID)

      const courseCodesSet = new Set<string>();
      rawScheduleList.forEach((item) => {
        item.commissions.forEach((c) => {
          if (c.courseCode) courseCodesSet.add(c.courseCode.toUpperCase());
        });
      });
      rawReservedSlots.forEach((r) => {
        if (r.courseCode) courseCodesSet.add(r.courseCode.toUpperCase());
      });

      console.log(`🏫 Grupos de curso identificados: ${courseCodesSet.size}`);

      for (const cCode of courseCodesSet) {
        // Determinar año de curso (ej. "2K1" -> 2)
        const matchYear = cCode.match(/^(\d)/);
        const yearLevel = matchYear ? parseInt(matchYear[1], 10) : 1;

        // Determinar turno predominante
        let turnoChar: 'M' | 'T' | 'N' = 'M';
        const sampleComm = rawScheduleList
          .flatMap((s) => s.commissions)
          .find((c) => c.courseCode.toUpperCase() === cCode);
        if (sampleComm?.turno) {
          turnoChar = normalizeTurno(sampleComm.turno);
        }

        const [createdGroup] = await tx
          .insert(courseGroups)
          .values({
            scheduleTermId: termRecord.id,
            code: cCode,
            turno: turnoChar,
            yearLevel,
          })
          .returning();

        courseGroupMap.set(cCode, createdGroup.id);
      }

      // 6.2 Insertar Comisiones, Profesores y Slots
      let insertedCommissionsCount = 0;
      let insertedSlotsCount = 0;
      let englishResolvedCount = 0;

      for (const item of rawScheduleList) {
        // Filtrar comisiones según el término solicitado (o anuales que aplican a ambos)
        if (item.term !== 'A' && item.term !== termStr) {
          continue;
        }

        const subCode = typeof item.subjectId === 'string' ? parseInt(item.subjectId, 10) : item.subjectId;
        const subjectUuid = codeToSubjectUuid.get(subCode);

        if (!subjectUuid) {
          console.warn(`⚠️ Materia código ${subCode} no encontrada en el catálogo. Se omite.`);
          continue;
        }

        if (subCode === 4 || subCode === 12) {
          englishResolvedCount += item.commissions.length;
        }

        for (const comm of item.commissions) {
          const cCodeUpper = comm.courseCode?.toUpperCase();
          const courseGroupId = cCodeUpper ? courseGroupMap.get(cCodeUpper) : null;
          const turnoVal = normalizeTurno(comm.turno);

          const [insertedComm] = await tx
            .insert(commissions)
            .values({
              subjectId: subjectUuid,
              scheduleTermId: termRecord.id,
              courseGroupId,
              code: comm.code,
              turno: turnoVal,
              termOffer: item.term,
            })
            .returning();

          insertedCommissionsCount++;

          // Insertar docentes
          for (const prof of comm.professors || []) {
            if (prof.trim()) {
              await tx.insert(commissionProfessors).values({
                commissionId: insertedComm.id,
                professorName: prof.trim(),
              });
            }
          }

          // Insertar slots horarios
          for (const s of comm.slots || []) {
            const dayNum = DAY_MAP[s.day.toUpperCase()] || 1;
            await tx.insert(commissionSlots).values({
              commissionId: insertedComm.id,
              day: dayNum,
              startTime: s.start,
              endTime: s.end,
              room: s.room || null,
              mode: s.mode || 'Presencial',
            });
            insertedSlotsCount++;
          }
        }
      }

      // 6.3 Insertar Franjas Reservadas de Electivas
      let insertedReservedCount = 0;
      for (const resSlot of rawReservedSlots) {
        if (resSlot.term !== 'A' && resSlot.term !== termStr) {
          continue;
        }

        const cCodeUpper = resSlot.courseCode?.toUpperCase();
        const courseGroupId = cCodeUpper ? courseGroupMap.get(cCodeUpper) : null;
        if (!courseGroupId) continue;

        for (const s of resSlot.slots || []) {
          const dayNum = DAY_MAP[s.day.toUpperCase()] || 1;
          await tx.insert(reservedElectiveSlots).values({
            courseGroupId,
            scheduleTermId: termRecord.id,
            label: resSlot.label,
            day: dayNum,
            startTime: s.start,
            endTime: s.end,
          });
          insertedReservedCount++;
        }
      }

      // 6.4 Insertar Electivas con Docentes pero sin Franja Asignada (Elective Offerings)
      // Extraídas de las tablas de docentes en cursos 3er, 4to y 5to año
      let insertedElectiveOfferingsCount = 0;

      // Buscar si el archivo contiene profsWithoutClasses o definirlas
      const electiveOfferingsSeed: Array<{
        courseCode: string;
        subjectCode: number;
        professors: string[];
      }> = [
        { courseCode: '3K1', subjectCode: 301, professors: ['Romero, Rubén Aníbal', 'Romani, German Ariel'] },
        { courseCode: '3K1', subjectCode: 99, professors: ['Herrera, Daniel Rodolfo', 'Ortiz, Maria Cecilia'] },
        { courseCode: '3K2', subjectCode: 301, professors: ['Steffolani, Felipe Adrian', 'Romani, German Ariel'] },
        { courseCode: '3K2', subjectCode: 99, professors: ['Arenas, Maria Silvina', 'Mac William, Maria Irene'] },
        { courseCode: '3K3', subjectCode: 301, professors: ['Serrano, Diego Javier', 'Romani, German Ariel'] },
        { courseCode: '3K4', subjectCode: 301, professors: ['Bett, Gustavo Federico', 'Scarafia Altamira, Diego'] },
        { courseCode: '3K4', subjectCode: 99, professors: ['Arenas, Maria Silvina', 'Aquino, Francisco Alejandro'] },
        { courseCode: '4K1', subjectCode: 401, professors: ['Cuevas, Juan Carlos', 'Mana, Franco'] },
        { courseCode: '4K1', subjectCode: 402, professors: ['Villarreal, Gustavo Javier', 'Flores, Nora Viviana'] },
        { courseCode: '4K1', subjectCode: 403, professors: ['Bratti, Alicia Gabriela', 'Chichalof Roberts, Mabel Beatriz'] },
        { courseCode: '4K2', subjectCode: 401, professors: ['Cuevas, Juan Carlos', 'Moya, Vanesa Veronica'] },
        { courseCode: '4K2', subjectCode: 402, professors: ['Villarreal, Gustavo Javier', 'Flores, Nora Viviana'] },
        { courseCode: '4K2', subjectCode: 403, professors: ['Bratti, Alicia Gabriela', 'Chichalof Roberts, Mabel Beatriz'] },
        { courseCode: '4K3', subjectCode: 402, professors: ['Zigaran, Jose Carlos', 'Peralta, Lorena Daniela'] },
        { courseCode: '4K3', subjectCode: 403, professors: ['Bravo, Estela Maris', 'Chichalof Roberts, Mabel Beatriz'] },
        { courseCode: '4K4', subjectCode: 401, professors: ['Mana, Franco', 'Gimenez Zens, Ines Luz'] },
        { courseCode: '4K4', subjectCode: 403, professors: ['Bratti, Alicia Gabriela', 'Velez, German Eduardo'] },
        { courseCode: '4K4', subjectCode: 404, professors: ['Zea Cárdenas, Ninfa Milagros', 'Pardo, Alfredo Luis'] },
        { courseCode: '4K4', subjectCode: 406, professors: ['Odetti, Maria Alejandra', 'Kabusch, Andrés Ricardo'] },
        { courseCode: '5K1', subjectCode: 504, professors: ['Gigena, Elias Fernando', 'Balut Cabezas, Jorge Ariel'] },
        { courseCode: '5K1', subjectCode: 505, professors: ['Gigena, Elias Fernando', 'Balut Cabezas, Jorge Ariel'] },
        { courseCode: '5K1', subjectCode: 507, professors: ['Carignano, Claudia Etna', 'Rustan, Silvina'] },
        { courseCode: '5K1', subjectCode: 512, professors: ['Cuevas, Juan Carlos', 'Castro, Claudia Susana'] },
        { courseCode: '5K2', subjectCode: 502, professors: ['Mana, Franco', 'Gimenez Zens, Ines Luz'] },
        { courseCode: '5K2', subjectCode: 504, professors: ['Martinez, Daniel Ignacio', 'Gigena, Elias Fernando'] },
        { courseCode: '5K2', subjectCode: 505, professors: ['Martinez, Daniel Ignacio', 'Balut Cabezas, Jorge Ariel'] },
        { courseCode: '5K2', subjectCode: 507, professors: ['Peretto, Claudia Beatriz', 'Rosa, Sergio Hernan'] },
        { courseCode: '5K2', subjectCode: 512, professors: ['Cuevas, Juan Carlos', 'Gimenez Zens, Ines Luz'] },
        { courseCode: '5K3', subjectCode: 501, professors: ['Medina, Oscar Carlos', 'Romero, Rubén Aníbal'] },
        { courseCode: '5K3', subjectCode: 504, professors: ['Srur, Leandro Paolo', 'Martinez, Daniel Ignacio'] },
        { courseCode: '5K3', subjectCode: 506, professors: ['Barra, Mario Augusto', 'Galvan, Diego Roman'] },
        { courseCode: '5K3', subjectCode: 507, professors: ['Rustan, Silvina', 'Gualpa, Mariano Martín'] },
        { courseCode: '5K3', subjectCode: 508, professors: ['Montoya, Fanny Esther', 'Bravo, Estela Maris'] },
        { courseCode: '5K3', subjectCode: 514, professors: ['Liberatori, Marcelo Sadi', 'Damiano, Luis Esteban'] },
        { courseCode: '5K4', subjectCode: 505, professors: ['Srur, Leandro Paolo', 'Ruffinatti, Adrian Feliciano'] },
        { courseCode: '5K4', subjectCode: 506, professors: ['Sacco, Pablo Alberto', 'Callejas, Marisa Del Carmen'] },
        { courseCode: '5K4', subjectCode: 509, professors: ['Parisi, Germán Nicolás', 'Bertola, Federico Javier'] },
        { courseCode: '5K4', subjectCode: 510, professors: ['Romero, María Soledad', 'Romero, Rubén Aníbal'] },
      ];

      for (const off of electiveOfferingsSeed) {
        const courseGroupId = courseGroupMap.get(off.courseCode.toUpperCase());
        const subjectUuid = codeToSubjectUuid.get(off.subjectCode);

        if (courseGroupId && subjectUuid) {
          await tx.insert(electiveOfferings).values({
            courseGroupId,
            scheduleTermId: termRecord.id,
            subjectId: subjectUuid,
            professors: off.professors,
          });
          insertedElectiveOfferingsCount++;
        }
      }

      console.log('\n======================================================');
      console.log(' 📊 REPORTE DE IMPORTACIÓN EXITOSA EN NEON');
      console.log('======================================================');
      console.log(` ✅ Comisiones insertadas:            ${insertedCommissionsCount}`);
      console.log(` ✅ Slots horarios insertados:         ${insertedSlotsCount}`);
      console.log(` ✅ Franjas reservadas de electivas:   ${insertedReservedCount}`);
      console.log(` ✅ Ofertas de electivas sin franja:   ${insertedElectiveOfferingsCount}`);
      console.log(` 🇬🇧 Comisiones de Inglés resueltas:    ${englishResolvedCount} (Inglés 1: #4, Inglés 2: #12)`);
      console.log('======================================================\n');
    });

    console.log('🎉 Oferta horaria importada y disponible en la base de datos.');
  } catch (error) {
    console.error('❌ Error importando horarios a Neon:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runScheduleImport();
