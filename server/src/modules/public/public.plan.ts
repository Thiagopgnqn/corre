import { Response } from 'express';
import { getCatalogStore } from '../catalog/catalog.store.js';
import type { PublishedPlanWithCareer } from '../catalog/catalog.helpers.js';

/**
 * Resuelve estrictamente un plan PUBLICADO y activo perteneciente a una carrera PUBLICADA
 * para endpoints anónimos/públicos (`/api/public/*`).
 * Si el parámetro es vacío o "current"/"default", resuelve el plan publicado por defecto.
 * Si es draft, archived, inactivo, de carrera draft o inexistente/no-UUID, responde 404 y retorna null.
 */
export async function resolvePublicPlanOr404(
  rawPlanId: unknown,
  res: Response
): Promise<PublishedPlanWithCareer | null> {
  if (Array.isArray(rawPlanId)) {
    res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
    return null;
  }

  const trimmed =
    typeof rawPlanId === 'string'
      ? rawPlanId.trim()
      : rawPlanId === undefined || rawPlanId === null
      ? ''
      : String(rawPlanId).trim();

  const planKey = trimmed.length > 0 ? trimmed : 'current';
  const resolved = await getCatalogStore().resolvePublishedPlan(planKey);

  if (!resolved) {
    res.status(404).json({ success: false, error: 'Plan de estudio no encontrado' });
    return null;
  }

  return resolved;
}
