export type RatingStatus = 'sin_resenas' | 'pocas_resenas' | 'confiable';

export type ReviewStatus = 'published' | 'hidden' | 'removed';

export type ReportReason = 'ofensiva' | 'datos personales' | 'falsa o spam' | 'otra';

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface ReviewsThresholdsMeta {
  minReviewsForReliableAverage: number;
  minReviewsToShowAttendedPeriod: number;
  bayesianPriorGlobalMean: number;
  bayesianPriorWeight: number;
  maxNewReviewsPerDay: number;
  autoHideOpenReportsThreshold: number;
  allowedSubjectStatuses: string[];
}

export interface PublicAggregate {
  reviewCount: number;
  hasReliableAverage: boolean;
  ratingStatus: RatingStatus;
  averageOverall: number | null;
  bayesianScore: number;
  averageClarity: number | null;
  averageTreatment: number | null;
  averageAvailability: number | null;
  averageDifficulty: number | null;
  recommendPercent: number | null;
  recommendCount: number;
  recommendTotal: number;
  distribution: RatingDistribution;
}

export interface PublicProfessorReview {
  id: string;
  professorId: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  studentLabel: string;
  academicYear: number | null;
  term: '1C' | '2C' | 'A' | null;
  attendedPeriod: string | null;
  overall: number;
  clarity: number | null;
  treatment: number | null;
  availability: number | null;
  difficulty: number | null;
  wouldRecommend: boolean | null;
  comment: string | null;
  helpfulCount: number;
  viewerHasVotedHelpful: boolean;
  viewerHasReported: boolean;
  publishedMonthYear: string;
  publishedLabel: string;
}

export interface ProfessorSubjectTag {
  subjectId: string;
  subjectCode: number;
  name: string;
  shortName: string;
  level: number;
  isCurrentTerm: boolean;
  isHistoricalLink: boolean;
}

export interface ProfessorListItem extends PublicAggregate {
  id: string;
  displayName: string;
  normalizedKey: string;
  subjects: ProfessorSubjectTag[];
}

export interface ProfessorSubjectBreakdownItem extends PublicAggregate, ProfessorSubjectTag {
  termLabels: string[];
}

export interface ProfessorDetail extends PublicAggregate {
  id: string;
  displayName: string;
  normalizedKey: string;
  aliases: string[];
  subjects: ProfessorSubjectBreakdownItem[];
}

export interface PaginatedReviewsResponse {
  items: PublicProfessorReview[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProfessorDetailResponse {
  professor: ProfessorDetail;
  reviewsPage: PaginatedReviewsResponse;
  thresholds: ReviewsThresholdsMeta;
}

export interface ProfessorBatchRating extends PublicAggregate {
  professorId: string;
  displayName: string;
  normalizedKey: string;
  recentReviews: PublicProfessorReview[];
}

export interface RatingsBatchData {
  byId: Record<string, ProfessorBatchRating>;
  byNormalizedName: Record<string, string>;
  thresholds: ReviewsThresholdsMeta;
}

export interface ReviewablePair {
  professorId: string;
  professorName: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  subjectLevel: number;
  userSubjectStatus: string;
  isCurrentTerm: boolean;
  isHistoricalLink: boolean;
  alreadyReviewed: boolean;
  existingReviewId: string | null;
}

export interface BlockedReviewablePair {
  professorId: string;
  professorName: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  subjectLevel: number;
  userSubjectStatus: string;
  blockedReason: string;
}

export interface OwnReviewItem {
  id: string;
  professorId: string;
  professorName: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  academicYear: number | null;
  term: '1C' | '2C' | 'A' | null;
  overall: number;
  clarity: number | null;
  treatment: number | null;
  availability: number | null;
  difficulty: number | null;
  wouldRecommend: boolean | null;
  comment: string | null;
  status: ReviewStatus;
  helpfulCount: number;
  publishedMonthYear: string;
  publishedLabel: string;
}

export interface ReviewableData {
  eligible: ReviewablePair[];
  blocked: BlockedReviewablePair[];
  myReviews: OwnReviewItem[];
  allowedStatuses: string[];
  dailyLimit: {
    maxPerDay: number;
    usedLast24h: number;
    remainingToday: number;
  };
}

export interface CreateReviewInput {
  professorId: string;
  subjectId: string | number;
  academicYear?: number | null;
  term?: '1C' | '2C' | 'A' | null;
  overall: number;
  clarity?: number | null;
  treatment?: number | null;
  availability?: number | null;
  difficulty?: number | null;
  wouldRecommend?: boolean | null;
  comment?: string | null;
}

export interface UpdateReviewInput {
  academicYear?: number | null;
  term?: '1C' | '2C' | 'A' | null;
  overall: number;
  clarity?: number | null;
  treatment?: number | null;
  availability?: number | null;
  difficulty?: number | null;
  wouldRecommend?: boolean | null;
  comment?: string | null;
}

export interface AdminModerationReportItem {
  reportId: string;
  reviewId: string;
  reason: ReportReason;
  note: string | null;
  reportStatus: 'open' | 'dismissed' | 'actioned';
  reportedMonthYear: string;
  openReportsOnReview: number;
  review: {
    id: string;
    professorId: string;
    professorName: string;
    subjectId: string;
    subjectCode: number;
    subjectName: string;
    overall: number;
    comment: string | null;
    status: ReviewStatus;
    publishedMonthYear: string;
  };
}

export interface AdminHiddenReviewItem {
  id: string;
  professorId: string;
  professorName: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  overall: number;
  comment: string | null;
  status: ReviewStatus;
  openReportsCount: number;
  publishedMonthYear: string;
}

export interface AdminModerationQueueData {
  openReports: AdminModerationReportItem[];
  hiddenReviews: AdminHiddenReviewItem[];
}

