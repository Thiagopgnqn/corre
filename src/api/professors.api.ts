import { apiFetch } from './client';
import type {
  AdminModerationQueueData,
  CreateReviewInput,
  PaginatedReviewsResponse,
  ProfessorDetailResponse,
  ProfessorListItem,
  PublicProfessorReview,
  RatingsBatchData,
  ReportReason,
  ReviewableData,
  ReviewStatus,
  ReviewsThresholdsMeta,
  UpdateReviewInput,
} from '../types/professor';

export const professorsApi = {
  async listProfessors(params?: {
    search?: string;
    subjectId?: string;
    minRating?: number;
    withReviewsOnly?: boolean;
    sort?: 'rating' | 'reviews' | 'name';
    planId?: string;
  }): Promise<{
    success: boolean;
    data: { professors: ProfessorListItem[]; thresholds: ReviewsThresholdsMeta };
  }> {
    const qs = new URLSearchParams();
    if (params?.search?.trim()) qs.set('search', params.search.trim());
    if (params?.subjectId?.trim()) qs.set('subjectId', params.subjectId.trim());
    if (params?.minRating && params.minRating > 0) qs.set('minRating', String(params.minRating));
    if (params?.withReviewsOnly) qs.set('withReviews', 'true');
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.planId) qs.set('planId', params.planId);
    const query = qs.toString();
    return apiFetch(`/api/professors${query ? `?${query}` : ''}`);
  },

  async getProfessorDetail(
    professorId: string,
    planId?: string
  ): Promise<{ success: boolean; data: ProfessorDetailResponse }> {
    const qs = planId ? `?planId=${encodeURIComponent(planId)}` : '';
    return apiFetch(`/api/professors/${encodeURIComponent(professorId)}${qs}`);
  },

  async getProfessorReviews(
    professorId: string,
    params?: {
      subjectId?: string;
      page?: number;
      pageSize?: number;
      sort?: 'recent' | 'helpful';
    }
  ): Promise<{ success: boolean; data: PaginatedReviewsResponse }> {
    const qs = new URLSearchParams();
    if (params?.subjectId) qs.set('subjectId', params.subjectId);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.sort) qs.set('sort', params.sort);
    const query = qs.toString();
    return apiFetch(
      `/api/professors/${encodeURIComponent(professorId)}/reviews${query ? `?${query}` : ''}`
    );
  },

  async getRatingsBatch(params?: {
    ids?: string[];
    names?: string[];
  }): Promise<{ success: boolean; data: RatingsBatchData }> {
    const qs = new URLSearchParams();
    if (params?.ids && params.ids.length > 0) {
      qs.set('ids', params.ids.join(','));
    }
    if (params?.names && params.names.length > 0) {
      qs.set('names', params.names.join('|'));
    }
    const query = qs.toString();
    return apiFetch(`/api/professors/ratings${query ? `?${query}` : ''}`);
  },

  async getReviewable(): Promise<{ success: boolean; data: ReviewableData }> {
    return apiFetch('/api/me/reviewable');
  },

  async createReview(
    input: CreateReviewInput
  ): Promise<{ success: boolean; data: PublicProfessorReview }> {
    return apiFetch('/api/reviews', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateReview(
    reviewId: string,
    input: UpdateReviewInput
  ): Promise<{ success: boolean; data: PublicProfessorReview }> {
    return apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async deleteReview(reviewId: string): Promise<{ success: boolean; data: { deleted: boolean } }> {
    return apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'DELETE',
    });
  },

  async toggleHelpful(
    reviewId: string
  ): Promise<{ success: boolean; data: { voted: boolean; helpfulCount: number } }> {
    return apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/helpful`, {
      method: 'POST',
    });
  },

  async reportReview(
    reviewId: string,
    input: { reason: ReportReason; note?: string }
  ): Promise<{
    success: boolean;
    data: {
      reportId: string;
      openReportsCount: number;
      autoHidden: boolean;
      message: string;
    };
  }> {
    return apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}/report`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // ── Endpoints exclusivos para rol admin ──
  async adminGetModerationQueue(): Promise<{
    success: boolean;
    data: AdminModerationQueueData;
  }> {
    return apiFetch('/api/admin/reviews/reports');
  },

  async adminSetReviewStatus(
    reviewId: string,
    status: ReviewStatus
  ): Promise<{
    success: boolean;
    data: { id: string; professorId: string; status: ReviewStatus };
  }> {
    return apiFetch(`/api/admin/reviews/${encodeURIComponent(reviewId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async adminResolveReport(
    reportId: string,
    payload: { status: 'dismissed' | 'actioned'; reviewStatus?: ReviewStatus }
  ): Promise<{
    success: boolean;
    data: { reportId: string; status: 'dismissed' | 'actioned' };
  }> {
    return apiFetch(`/api/admin/reviews/reports/${encodeURIComponent(reportId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};

