import type { Subject } from '../../../types/career';
import type {
  AdminPlanImportTargetMode,
  AdminSharedSubjectDecision,
  AdminSharedSubjectSuggestion,
} from '../../../api/admin.api';

export const PUBLISH_DISABLED_REASON =
  'Disponible en Tramo 2C/2D tras habilitar la selección multi-plan.';

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function normalizeSharedDecisionMap(
  suggestions: AdminSharedSubjectSuggestion[]
): Record<number, AdminSharedSubjectDecision | null> {
  const next: Record<number, AdminSharedSubjectDecision | null> = {};
  for (const s of suggestions) {
    next[s.subjectCode] = s.selectedDecision ? { ...s.selectedDecision } : null;
  }
  return next;
}

export function serializeSharedDecisionsForApi(
  decisionMap: Record<number, AdminSharedSubjectDecision | null>
): AdminSharedSubjectDecision[] {
  return Object.values(decisionMap)
    .filter((d): d is AdminSharedSubjectDecision => d !== null)
    .map((d) => ({
      subjectCode: d.subjectCode,
      action: d.action,
      ...(d.action === 'link_existing' && d.sharedSubjectId
        ? { sharedSubjectId: d.sharedSubjectId }
        : {}),
    }))
    .sort((a, b) => a.subjectCode - b.subjectCode);
}

export function buildPreviewStateSignature(params: {
  fileBase64: string;
  facultyId: string;
  targetMode: AdminPlanImportTargetMode;
  careerId: string;
  careerName: string;
  careerCode: string;
  planId: string;
  decisions: AdminSharedSubjectDecision[];
}): string {
  const normalizedDecisions = [...params.decisions]
    .sort((a, b) => a.subjectCode - b.subjectCode)
    .map((d) => ({
      subjectCode: d.subjectCode,
      action: d.action,
      sharedSubjectId: d.action === 'link_existing' ? d.sharedSubjectId || null : null,
    }));

  return JSON.stringify({
    fileBase64: params.fileBase64,
    facultyId: params.facultyId,
    targetMode: params.targetMode,
    careerId: params.targetMode === 'existing_career_new_plan' ? params.careerId : '',
    careerName: params.targetMode === 'new_career_and_plan' ? params.careerName.trim() : '',
    careerCode: params.targetMode === 'new_career_and_plan' ? params.careerCode.trim().toUpperCase() : '',
    planId: params.targetMode === 'existing_draft_plan' ? params.planId : '',
    decisions: normalizedDecisions,
  });
}

export function groupCatalogSubjectsByLevel(subjects: Subject[]): Array<{
  level: number;
  subjects: Subject[];
}> {
  const byLevel = new Map<number, Subject[]>();
  for (const s of subjects) {
    const bucket = byLevel.get(s.level) || [];
    bucket.push(s);
    byLevel.set(s.level, bucket);
  }
  return Array.from(byLevel.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([level, list]) => ({
      level,
      subjects: [...list].sort((a, b) => a.id - b.id),
    }));
}

export function formatSubjectCodeLabel(code: number, codeMap: Map<number, Subject>): string {
  const sub = codeMap.get(code);
  if (!sub) return String(code);
  return sub.code || String(sub.id);
}

export function formatModalityLabel(modality: Subject['modality']): string {
  switch (modality) {
    case 'A':
      return 'Anual';
    case '1C':
      return '1° Cuatrimestre';
    case '2C':
      return '2° Cuatrimestre';
    case '1C-CC':
      return '1° Cuat. / Contracuat.';
    case '2C-CC':
      return '2° Cuat. / Contracuat.';
    case '1C/2C':
      return '1° o 2° Cuatrimestre';
    default:
      return modality;
  }
}

export function getPlanStatusBadgeStyle(status: string): string {
  switch (status) {
    case 'published':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'draft':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'archived':
      return 'bg-slate-700/60 text-slate-300 border-slate-600/40';
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}
