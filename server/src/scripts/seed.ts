import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import {
  institutions,
  faculties,
  careers,
  studyPlans,
  subjects,
  subjectPrerequisites,
  planSpecialRules,
  acronyms,
} from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeed() {
  console.log('🌱 Iniciando carga de seed del catálogo en Neon PostgreSQL...');

  const dataPath = path.resolve(__dirname, '../../seed-data/plan2023-catalog.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`❌ No se encontró el archivo de catálogo en: ${dataPath}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  try {
    // 1. Institución
    console.log(`🏛️ Verificando institución: ${catalog.institution.name} (${catalog.institution.code})`);
    let [inst] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.code, catalog.institution.code))
      .limit(1);

    if (!inst) {
      [inst] = await db
        .insert(institutions)
        .values({
          name: catalog.institution.name,
          code: catalog.institution.code,
        })
        .returning();
      console.log(`  + Institución creada con id: ${inst.id}`);
    }

    // 2. Facultad
    console.log(`🏫 Verificando facultad: ${catalog.faculty.name} (${catalog.faculty.code})`);
    let [fac] = await db
      .select()
      .from(faculties)
      .where(
        and(
          eq(faculties.institutionId, inst.id),
          eq(faculties.code, catalog.faculty.code)
        )
      )
      .limit(1);

    if (!fac) {
      [fac] = await db
        .insert(faculties)
        .values({
          institutionId: inst.id,
          name: catalog.faculty.name,
          code: catalog.faculty.code,
        })
        .returning();
      console.log(`  + Facultad creada con id: ${fac.id}`);
    }

    // 3. Carrera
    console.log(`🎓 Verificando carrera: ${catalog.career.name} (${catalog.career.code})`);
    let [car] = await db
      .select()
      .from(careers)
      .where(
        and(
          eq(careers.facultyId, fac.id),
          eq(careers.code, catalog.career.code)
        )
      )
      .limit(1);

    if (!car) {
      [car] = await db
        .insert(careers)
        .values({
          facultyId: fac.id,
          name: catalog.career.name,
          code: catalog.career.code,
        })
        .returning();
      console.log(`  + Carrera creada con id: ${car.id}`);
    }

    // 4. Plan de Estudios
    console.log(`📋 Verificando plan de estudio: ${catalog.studyPlan.name} (${catalog.studyPlan.year})`);
    let [plan] = await db
      .select()
      .from(studyPlans)
      .where(
        and(
          eq(studyPlans.careerId, car.id),
          eq(studyPlans.year, catalog.studyPlan.year)
        )
      )
      .limit(1);

    if (!plan) {
      [plan] = await db
        .insert(studyPlans)
        .values({
          careerId: car.id,
          name: catalog.studyPlan.name,
          year: catalog.studyPlan.year,
          isActive: catalog.studyPlan.isActive,
          config: catalog.studyPlan.config,
        })
        .returning();
      console.log(`  + Plan de estudio creado con id: ${plan.id}`);
    } else {
      // Actualizar config
      await db
        .update(studyPlans)
        .set({ config: catalog.studyPlan.config, updatedAt: new Date() })
        .where(eq(studyPlans.id, plan.id));
    }

    // 5. Materias (Core + Electivas)
    console.log(`📚 Insertando / actualizando ${catalog.subjects.length} materias...`);
    const codeToSubjectId = new Map<number, string>();

    for (const sub of catalog.subjects) {
      let [existingSub] = await db
        .select()
        .from(subjects)
        .where(
          and(
            eq(subjects.planId, plan.id),
            eq(subjects.codeInPlan, sub.codeInPlan)
          )
        )
        .limit(1);

      if (!existingSub) {
        [existingSub] = await db
          .insert(subjects)
          .values({
            planId: plan.id,
            codeInPlan: sub.codeInPlan,
            name: sub.name,
            shortName: sub.shortName,
            level: sub.level,
            modality: sub.modality,
            contraCuatrimestral: sub.contraCuatrimestral,
            weeklyHours: String(sub.weeklyHours),
            kind: sub.kind,
            credits: sub.credits,
            isOptionalTrack: sub.isOptionalTrack,
            trackKey: sub.trackKey,
          })
          .returning();
      } else {
        await db
          .update(subjects)
          .set({
            name: sub.name,
            shortName: sub.shortName,
            level: sub.level,
            modality: sub.modality,
            contraCuatrimestral: sub.contraCuatrimestral,
            weeklyHours: String(sub.weeklyHours),
            kind: sub.kind,
            credits: sub.credits,
            isOptionalTrack: sub.isOptionalTrack,
            trackKey: sub.trackKey,
            updatedAt: new Date(),
          })
          .where(eq(subjects.id, existingSub.id));
      }

      codeToSubjectId.set(sub.codeInPlan, existingSub.id);
    }

    // 6. Correlativas (Prerequisites)
    console.log('🔗 Sincronizando correlativas...');
    for (const sub of catalog.subjects) {
      const subjectId = codeToSubjectId.get(sub.codeInPlan);
      if (!subjectId) continue;

      // Correlativas regulares
      for (const reqCode of sub.regularPrereqs || []) {
        const requiresSubjectId = codeToSubjectId.get(reqCode);
        if (requiresSubjectId) {
          const exists = await db
            .select()
            .from(subjectPrerequisites)
            .where(
              and(
                eq(subjectPrerequisites.subjectId, subjectId),
                eq(subjectPrerequisites.requiresSubjectId, requiresSubjectId),
                eq(subjectPrerequisites.type, 'regular')
              )
            )
            .limit(1);

          if (exists.length === 0) {
            await db.insert(subjectPrerequisites).values({
              subjectId,
              requiresSubjectId,
              type: 'regular',
            });
          }
        }
      }

      // Correlativas aprobadas
      for (const reqCode of sub.approvedPrereqs || []) {
        const requiresSubjectId = codeToSubjectId.get(reqCode);
        if (requiresSubjectId) {
          const exists = await db
            .select()
            .from(subjectPrerequisites)
            .where(
              and(
                eq(subjectPrerequisites.subjectId, subjectId),
                eq(subjectPrerequisites.requiresSubjectId, requiresSubjectId),
                eq(subjectPrerequisites.type, 'aprobada')
              )
            )
            .limit(1);

          if (exists.length === 0) {
            await db.insert(subjectPrerequisites).values({
              subjectId,
              requiresSubjectId,
              type: 'aprobada',
            });
          }
        }
      }
    }

    // 7. Reglas Especiales
    console.log('⚡ Sincronizando reglas especiales...');
    for (const rule of catalog.specialRules || []) {
      const subjectId = codeToSubjectId.get(rule.subjectCode);
      if (!subjectId) continue;

      const [existingRule] = await db
        .select()
        .from(planSpecialRules)
        .where(
          and(
            eq(planSpecialRules.planId, plan.id),
            eq(planSpecialRules.subjectId, subjectId)
          )
        )
        .limit(1);

      if (!existingRule) {
        await db.insert(planSpecialRules).values({
          planId: plan.id,
          subjectId,
          ruleType: rule.ruleType,
          params: rule.params,
          description: rule.description,
        });
      } else {
        await db
          .update(planSpecialRules)
          .set({
            ruleType: rule.ruleType,
            params: rule.params,
            description: rule.description,
            updatedAt: new Date(),
          })
          .where(eq(planSpecialRules.id, existingRule.id));
      }
    }

    // 8. Siglas (Acronyms)
    console.log('🏷️ Sincronizando siglas...');
    for (const acr of catalog.acronyms || []) {
      const subjectId = codeToSubjectId.get(acr.subjectCode);
      if (!subjectId) continue;

      const [existingAcr] = await db
        .select()
        .from(acronyms)
        .where(
          and(
            eq(acronyms.planId, plan.id),
            eq(acronyms.acronym, acr.acronym)
          )
        )
        .limit(1);

      if (!existingAcr) {
        await db.insert(acronyms).values({
          planId: plan.id,
          acronym: acr.acronym,
          subjectId,
        });
      } else {
        await db
          .update(acronyms)
          .set({ subjectId, updatedAt: new Date() })
          .where(eq(acronyms.id, existingAcr.id));
      }
    }

    console.log('✅ Seed completado con éxito en Neon.');
  } catch (error) {
    console.error('❌ Error ejecutando seed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSeed();

