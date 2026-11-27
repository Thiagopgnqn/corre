import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getCatalogStore } from '../catalog/catalog.store.js';
import { isValidUuid } from '../catalog/catalog.helpers.js';
import { formatPlanCatalogPayload } from '../catalog/planConfig.helpers.js';
import { getLibraryService } from '../library/library.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { resolvePublicPlanOr404 } from './public.plan.js';
import {
  serializePublicCatalogTree,
  serializePublicLibraryFile,
  serializePublicLibrarySubject,
  serializePublicPlanCatalog,
  serializePublicProfessorDetail,
  serializePublicProfessorListItem,
  serializePublicProfessorReviewItem,
  serializePublicThresholds,
} from './public.serializers.js';

const CACHE_VERSION = 'public, max-age=60, stale-while-revalidate=300';
const CACHE_PLAN = 'public, max-age=3600, stale-while-revalidate=86400';
const CACHE_LISTINGS = 'public, max-age=300, stale-while-revalidate=600';
const CACHE_REVIEWS = 'public, max-age=60';

function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function createPublicController(reviewsService: ReviewsService) {
  return {
    async getCatalogVersion(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const version = await getCatalogStore().getCatalogVersion();
        res.setHeader('Cache-Control', CACHE_VERSION);
        res.json({ success: true, version });
      } catch (err) {
        next(err);
      }
    },

    async getCareers(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const sources = await getCatalogStore().getPublishedTreeSources();
        const tree = serializePublicCatalogTree(sources);
        res.setHeader('Cache-Control', CACHE_LISTINGS);
        res.json({ success: true, data: tree });
      } catch (err) {
        next(err);
      }
    },

    async getPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const resolved = await resolvePublicPlanOr404(req.params.planId, res);
        if (!resolved) return;

        const { plan, career, faculty, institution } = resolved;
        const store = getCatalogStore();
        const artifacts = await store.getPlanArtifacts(plan.id);
        const formatted = formatPlanCatalogPayload({
          plan,
          career,
          faculty,
          institution,
          subjects: artifacts.subjects,
          prerequisites: artifacts.prerequisites,
          rules: artifacts.rules,
          acronyms: artifacts.acronyms,
        });
        const responseData = serializePublicPlanCatalog(formatted);

        const catalogVer = await store.getCatalogVersion();
        const hash = crypto
          .createHash('sha256')
          .update(catalogVer + ':' + JSON.stringify(responseData))
          .digest('hex');
        const etag = `"${hash}"`;

        if (req.headers['if-none-match'] === etag) {
          res.status(304).end();
          return;
        }

        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', CACHE_PLAN);
        res.json({ success: true, data: responseData });
      } catch (err) {
        next(err);
      }
    },

    async listProfessors(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const resolved = await resolvePublicPlanOr404(req.query.planId, res);
        if (!resolved) return;

        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
        const minRating =
          typeof req.query.minRating === 'string' && req.query.minRating !== ''
            ? Number(req.query.minRating)
            : undefined;
        const withReviewsOnly =
          req.query.withReviews === 'true' || req.query.withReviewsOnly === 'true';
        const rawSort = typeof req.query.sort === 'string' ? req.query.sort : 'rating';
        const sort: 'rating' | 'reviews' | 'name' =
          rawSort === 'reviews' || rawSort === 'name' ? rawSort : 'rating';

        const data = await reviewsService.listPublicProfessors({
          planId: resolved.plan.id,
          facultyId: resolved.career.facultyId,
          search,
          subjectId,
          minRating,
          withReviewsOnly,
          sort,
        });

        res.setHeader('Cache-Control', CACHE_LISTINGS);
        res.json({
          success: true,
          data: {
            professors: data.professors.map(serializePublicProfessorListItem),
            thresholds: serializePublicThresholds(data.thresholds),
          },
        });
      } catch (err) {
        next(err);
      }
    },

    async getProfessorDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const resolved = await resolvePublicPlanOr404(req.query.planId, res);
        if (!resolved) return;

        const data = await reviewsService.getPublicProfessorDetail({
          planId: resolved.plan.id,
          facultyId: resolved.career.facultyId,
          professorId: String(req.params.id),
        });

        res.setHeader('Cache-Control', CACHE_LISTINGS);
        res.json({
          success: true,
          data: {
            professor: serializePublicProfessorDetail(data.professor),
            thresholds: serializePublicThresholds(data.thresholds),
          },
        });
      } catch (err) {
        next(err);
      }
    },

    async getProfessorReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const resolved = await resolvePublicPlanOr404(req.query.planId, res);
        if (!resolved) return;

        const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
        const page = parseBoundedInt(req.query.page, 1, 1, 10000);
        const pageSize = parseBoundedInt(req.query.pageSize, 10, 1, 10);
        const sort = req.query.sort === 'helpful' ? 'helpful' : 'recent';

        const raw = await reviewsService.getPublicProfessorReviewsRaw({
          planId: resolved.plan.id,
          facultyId: resolved.career.facultyId,
          professorId: String(req.params.id),
          subjectId,
          page,
          pageSize,
          sort,
        });

        const items = raw.items.map((review) =>
          serializePublicProfessorReviewItem({
            review,
            subject: raw.subjectMap.get(review.subjectId),
            professorPublishedReviewCount: raw.professorPublishedReviewCount,
          })
        );

        res.setHeader('Cache-Control', CACHE_REVIEWS);
        res.json({
          success: true,
          data: {
            items,
            page: raw.page,
            pageSize: raw.pageSize,
            total: raw.total,
            totalPages: raw.totalPages,
          },
        });
      } catch (err) {
        next(err);
      }
    },

    async listLibrarySubjects(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const resolved = await resolvePublicPlanOr404(req.query.planId, res);
        if (!resolved) return;

        const rawSubjects = await getLibraryService().listSubjectsWithCounts(resolved.plan.id);
        res.setHeader('Cache-Control', CACHE_LISTINGS);
        res.json({
          success: true,
          data: rawSubjects.map(serializePublicLibrarySubject),
        });
      } catch (err) {
        next(err);
      }
    },

    async listLibraryFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const resolved = await resolvePublicPlanOr404(req.query.planId, res);
        if (!resolved) return;

        const subjectId =
          typeof req.query.subjectId === 'string' && req.query.subjectId.trim()
            ? req.query.subjectId.trim()
            : undefined;
        const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
        const parsedYear =
          typeof req.query.year === 'string' && /^\d{4}$/.test(req.query.year.trim())
            ? parseInt(req.query.year.trim(), 10)
            : undefined;
        const term = typeof req.query.term === 'string' ? req.query.term : undefined;
        const rawProfessorId =
          typeof req.query.professorId === 'string' && req.query.professorId.trim()
            ? req.query.professorId.trim()
            : undefined;
        const hasSolution =
          req.query.hasSolution === 'true'
            ? true
            : req.query.hasSolution === 'false'
            ? false
            : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const rawSort = typeof req.query.sort === 'string' ? req.query.sort : 'recent';
        const sort: 'recent' | 'downloads' | 'helpful' =
          rawSort === 'downloads' || rawSort === 'helpful' ? rawSort : 'recent';
        const page = parseBoundedInt(req.query.page, 1, 1, 10000);
        const pageSize = parseBoundedInt(req.query.pageSize, 20, 1, 30);

        if (rawProfessorId && !isValidUuid(rawProfessorId)) {
          res.setHeader('Cache-Control', CACHE_LISTINGS);
          res.json({
            success: true,
            data: { items: [], total: 0, page, pageSize, totalPages: 0 },
          });
          return;
        }

        const result = await getLibraryService().listFiles(
          {
            planId: resolved.plan.id,
            subjectId,
            kind,
            year: parsedYear,
            term,
            professorId: rawProfessorId,
            hasSolution,
            search,
            sort,
            page,
            pageSize,
          },
          undefined
        );

        res.setHeader('Cache-Control', CACHE_LISTINGS);
        res.json({
          success: true,
          data: {
            items: (result.items || []).map(serializePublicLibraryFile),
            total: Number(result.total || 0),
            page: Number(result.page || page),
            pageSize: Number(result.pageSize || pageSize),
            totalPages: Number(result.totalPages || 0),
          },
        });
      } catch (err) {
        next(err);
      }
    },
  };
}
