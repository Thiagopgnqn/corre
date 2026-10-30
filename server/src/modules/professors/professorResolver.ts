import { and, eq } from 'drizzle-orm';
import { professors, professorAliases, professorStats } from '../../db/schema.js';
import { parseProfessorName, pickBestDisplayName } from './professorNormalizer.js';

/**
 * Resuelve o crea una entidad `professors` dentro de una transacción Drizzle,
 * consultando primero `professor_aliases` (respeta fusiones previas de admin)
 * y luego `professors.normalized_key` por facultad.
 */
export async function resolveOrCreateProfessorInTx(
  tx: any,
  facultyId: string,
  rawName: string,
  cache?: Map<string, string>
): Promise<string | null> {
  const parsed = parseProfessorName(rawName);
  if (!parsed.normalizedKey) return null;

  const cacheKey = `${facultyId}::${parsed.normalizedKey}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // 1. Buscar primero en alias normalizados (cubre fusiones manuales previas, ej. "Oscar, Botta" -> "Botta, Oscar Ernesto")
  const [existingAlias] = await tx
    .select({ professorId: professorAliases.professorId })
    .from(professorAliases)
    .where(
      and(
        eq(professorAliases.facultyId, facultyId),
        eq(professorAliases.aliasNormalized, parsed.normalizedKey)
      )
    )
    .limit(1);

  if (existingAlias) {
    cache?.set(cacheKey, existingAlias.professorId);
    return existingAlias.professorId;
  }

  // 2. Buscar en tabla canónica de profesores
  const [existingProf] = await tx
    .select({ id: professors.id, displayName: professors.displayName })
    .from(professors)
    .where(
      and(
        eq(professors.facultyId, facultyId),
        eq(professors.normalizedKey, parsed.normalizedKey)
      )
    )
    .limit(1);

  if (existingProf) {
    // Mejorar displayName si la variante nueva aporta tildes o coma
    const bestName = pickBestDisplayName([existingProf.displayName, parsed.cleanDisplay]);
    if (bestName && bestName !== existingProf.displayName) {
      await tx
        .update(professors)
        .set({ displayName: bestName, updatedAt: new Date() })
        .where(eq(professors.id, existingProf.id));
    }

    await tx
      .insert(professorAliases)
      .values({
        professorId: existingProf.id,
        facultyId,
        aliasRaw: parsed.raw,
        aliasNormalized: parsed.normalizedKey,
      })
      .onConflictDoNothing();

    cache?.set(cacheKey, existingProf.id);
    return existingProf.id;
  }

  // 3. Crear nuevo profesor, alias inicial y fila base de stats
  const [created] = await tx
    .insert(professors)
    .values({
      facultyId,
      displayName: parsed.cleanDisplay,
      normalizedKey: parsed.normalizedKey,
    })
    .returning({ id: professors.id });

  await tx
    .insert(professorAliases)
    .values({
      professorId: created.id,
      facultyId,
      aliasRaw: parsed.raw,
      aliasNormalized: parsed.normalizedKey,
    })
    .onConflictDoNothing();

  await tx
    .insert(professorStats)
    .values({
      professorId: created.id,
      reviewCount: 0,
    })
    .onConflictDoNothing();

  cache?.set(cacheKey, created.id);
  return created.id;
}

