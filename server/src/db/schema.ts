import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
  unique,
  uniqueIndex,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Helper para timestamps automáticos
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

// ==========================================
// 1. CATÁLOGO COMPARTIDO
// ==========================================

export const institutions = pgTable('institutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  ...timestamps,
});

export const faculties = pgTable('faculties', {
  id: uuid('id').defaultRandom().primaryKey(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  ...timestamps,
});

export const careers = pgTable('careers', {
  id: uuid('id').defaultRandom().primaryKey(),
  facultyId: uuid('faculty_id')
    .notNull()
    .references(() => faculties.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  ...timestamps,
});

export const studyPlans = pgTable('study_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  careerId: uuid('career_id')
    .notNull()
    .references(() => careers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  year: integer('year').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  config: jsonb('config')
    .$type<{
      requiredElectiveCredits: number;
      defaultMinPassingGrade: number;
      intermediateDegrees?: Array<{
        key: string;
        name: string;
        requiredElectiveCredits?: number;
        specialRuleSubjectCode?: number;
      }>;
      [key: string]: unknown;
    }>()
    .notNull()
    .default({ requiredElectiveCredits: 20, defaultMinPassingGrade: 4 }),
  ...timestamps,
});

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    codeInPlan: integer('code_in_plan').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    level: integer('level').notNull(),
    modality: text('modality').notNull(), // 'A' | '1C' | '2C'
    contraCuatrimestral: boolean('contra_cuatrimestral').default(false).notNull(),
    weeklyHours: numeric('weekly_hours', { precision: 4, scale: 1 }).notNull(),
    kind: text('kind').notNull(), // 'obligatoria' | 'electiva'
    credits: integer('credits'),
    isOptionalTrack: boolean('is_optional_track').default(false).notNull(),
    trackKey: text('track_key'), // ej. 'analista'
    ...timestamps,
  },
  (table) => [
    unique('uq_subject_plan_code').on(table.planId, table.codeInPlan),
    index('idx_subjects_plan_level').on(table.planId, table.level),
  ]
);

export const subjectPrerequisites = pgTable(
  'subject_prerequisites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    requiresSubjectId: uuid('requires_subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'regular' | 'aprobada'
    ...timestamps,
  },
  (table) => [
    unique('uq_subject_prereq').on(table.subjectId, table.requiresSubjectId, table.type),
    index('idx_prereqs_subject').on(table.subjectId),
    index('idx_prereqs_requires').on(table.requiresSubjectId),
  ]
);

export const planSpecialRules = pgTable('plan_special_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => studyPlans.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  ruleType: text('rule_type').notNull(), // 'approved_range' | 'all_previous_core_approved'
  params: jsonb('params')
    .$type<{
      fromCode?: number;
      toCode?: number;
      excludeTrackKeys?: string[];
      [key: string]: unknown;
    }>()
    .notNull()
    .default({}),
  description: text('description').notNull(),
  ...timestamps,
});

export const acronyms = pgTable(
  'acronyms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    acronym: text('acronym').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('uq_acronym_plan').on(table.planId, table.acronym),
  ]
);

export const scheduleTerms = pgTable(
  'schedule_terms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    facultyId: uuid('faculty_id')
      .notNull()
      .references(() => faculties.id, { onDelete: 'cascade' }),
    academicYear: integer('academic_year').notNull(),
    term: text('term').notNull(), // '1C' | '2C'
    label: text('label').notNull(),
    isCurrent: boolean('is_current').default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    unique('uq_schedule_term').on(table.facultyId, table.academicYear, table.term),
  ]
);

export const courseGroups = pgTable(
  'course_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleTermId: uuid('schedule_term_id')
      .notNull()
      .references(() => scheduleTerms.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // '2K1', '1K03'
    turno: text('turno').notNull(), // 'M' | 'T' | 'N'
    yearLevel: integer('year_level').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('uq_course_group_term').on(table.scheduleTermId, table.code),
    index('idx_course_groups_term').on(table.scheduleTermId),
  ]
);

export const commissions = pgTable(
  'commissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    scheduleTermId: uuid('schedule_term_id')
      .notNull()
      .references(() => scheduleTerms.id, { onDelete: 'cascade' }),
    courseGroupId: uuid('course_group_id').references(() => courseGroups.id, {
      onDelete: 'set null',
    }),
    code: text('code').notNull(), // '2K01'
    turno: text('turno').notNull(), // 'M' | 'T' | 'N'
    termOffer: text('term_offer').notNull(), // '1C' | '2C' | 'A'
    ...timestamps,
  },
  (table) => [
    index('idx_commissions_subject').on(table.subjectId),
    index('idx_commissions_term').on(table.scheduleTermId),
  ]
);

export const professors = pgTable(
  'professors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    facultyId: uuid('faculty_id')
      .notNull()
      .references(() => faculties.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    normalizedKey: text('normalized_key').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('uq_professor_faculty_norm').on(table.facultyId, table.normalizedKey),
    index('idx_professors_faculty').on(table.facultyId),
  ]
);

export const professorAliases = pgTable(
  'professor_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    professorId: uuid('professor_id')
      .notNull()
      .references(() => professors.id, { onDelete: 'cascade' }),
    facultyId: uuid('faculty_id')
      .notNull()
      .references(() => faculties.id, { onDelete: 'cascade' }),
    aliasRaw: text('alias_raw').notNull(),
    aliasNormalized: text('alias_normalized').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_professor_alias_faculty_norm').on(table.facultyId, table.aliasNormalized),
    index('idx_professor_aliases_prof').on(table.professorId),
  ]
);

export const commissionProfessors = pgTable(
  'commission_professors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commissionId: uuid('commission_id')
      .notNull()
      .references(() => commissions.id, { onDelete: 'cascade' }),
    professorId: uuid('professor_id').references(() => professors.id, {
      onDelete: 'set null',
    }),
    professorName: text('professor_name').notNull(),
    ...timestamps,
  },
  (table) => [
    index('idx_comm_profs_comm').on(table.commissionId),
    index('idx_comm_profs_prof').on(table.professorId),
  ]
);

export const commissionSlots = pgTable(
  'commission_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commissionId: uuid('commission_id')
      .notNull()
      .references(() => commissions.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(), // 1 = LUN .. 6 = SAB
    startTime: text('start_time').notNull(), // 'HH:MM'
    endTime: text('end_time').notNull(), // 'HH:MM'
    room: text('room'),
    mode: text('mode'), // 'Presencial' | 'Virtual'
    ...timestamps,
  },
  (table) => [
    index('idx_commission_slots_comm').on(table.commissionId),
  ]
);

export const reservedElectiveSlots = pgTable('reserved_elective_slots', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseGroupId: uuid('course_group_id')
    .notNull()
    .references(() => courseGroups.id, { onDelete: 'cascade' }),
  scheduleTermId: uuid('schedule_term_id')
    .notNull()
    .references(() => scheduleTerms.id, { onDelete: 'cascade' }),
  label: text('label').notNull(), // ej. 'Electiva 1'
  day: integer('day').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  ...timestamps,
});

export const electiveOfferings = pgTable('elective_offerings', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseGroupId: uuid('course_group_id')
    .notNull()
    .references(() => courseGroups.id, { onDelete: 'cascade' }),
  scheduleTermId: uuid('schedule_term_id')
    .notNull()
    .references(() => scheduleTerms.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  professors: jsonb('professors').$type<string[]>().notNull().default([]),
  ...timestamps,
});

export const electiveOfferingProfessors = pgTable(
  'elective_offering_professors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    electiveOfferingId: uuid('elective_offering_id')
      .notNull()
      .references(() => electiveOfferings.id, { onDelete: 'cascade' }),
    professorId: uuid('professor_id').references(() => professors.id, {
      onDelete: 'set null',
    }),
    professorName: text('professor_name').notNull(),
    ...timestamps,
  },
  (table) => [
    index('idx_elective_off_profs_off').on(table.electiveOfferingId),
    index('idx_elective_off_profs_prof').on(table.professorId),
  ]
);

// ==========================================
// 2. DATOS DE CADA USUARIO
// ==========================================

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'), // 'user' | 'admin'
  selectedPlanId: uuid('selected_plan_id').references(() => studyPlans.id, {
    onDelete: 'set null',
  }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedByHash: text('replaced_by_hash'),
    ...timestamps,
  },
  (table) => [
    index('idx_refresh_tokens_hash').on(table.tokenHash),
    index('idx_refresh_tokens_user').on(table.userId),
  ]
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  includePromotionsInGPA: boolean('include_promotions_in_gpa').default(true).notNull(),
  minPassingGrade: integer('min_passing_grade').default(4).notNull(),
  includeAnalistaTrack: boolean('include_analista_track').default(false).notNull(),
  allowBlockedElectivesPlanning: boolean('allow_blocked_electives_planning')
    .default(false)
    .notNull(),
  includeElectivesInProgress: boolean('include_electives_in_progress').default(true).notNull(),
  soundEnabled: boolean('sound_enabled').default(true).notNull(),
  tutorialCompleted: boolean('tutorial_completed').default(false).notNull(),
  extraSettings: jsonb('extra_settings').$type<Record<string, unknown>>().default({}),
  ...timestamps,
});

export const subjectProgress = pgTable(
  'subject_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // 'pendiente' | 'cursando' | 'regularizada' | 'aprobada' | 'promocionada'
    grade: numeric('grade', { precision: 4, scale: 2 }),
    ...timestamps,
  },
  (table) => [
    unique('uq_user_subject_progress').on(table.userId, table.subjectId),
    index('idx_user_progress_user').on(table.userId),
  ]
);

export const electiveAssignments = pgTable(
  'elective_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(), // 1..5
    ...timestamps,
  },
  (table) => [
    unique('uq_user_elective_assignment').on(table.userId, table.subjectId),
    index('idx_user_electives_user').on(table.userId),
  ]
);

export const userBasket = pgTable(
  'user_basket',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('uq_user_basket').on(table.userId, table.subjectId),
    index('idx_user_basket_user').on(table.userId),
  ]
);

export const scheduleSelections = pgTable(
  'schedule_selections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduleTermId: uuid('schedule_term_id')
      .notNull()
      .references(() => scheduleTerms.id, { onDelete: 'cascade' }),
    selections: jsonb('selections')
      .$type<Record<string, string>>() // { [subjectId]: commissionId }
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    unique('uq_user_schedule_selection').on(table.userId, table.scheduleTermId),
  ]
);

export const scheduleProposals = pgTable(
  'schedule_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduleTermId: uuid('schedule_term_id')
      .notNull()
      .references(() => scheduleTerms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    selections: jsonb('selections')
      .$type<Record<string, string>>() // { [subjectId]: commissionId }
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    index('idx_schedule_proposals_user').on(table.userId),
  ]
);

// ==========================================
// 2B. RESEÑAS DE PROFESORES Y MODERACIÓN
// ==========================================

/**
 * Vínculos manuales/históricos creados por administración para permitir reseñar
 * profesores que dictaron una materia en períodos anteriores no cargados en horarios.
 */
export const professorSubjectLinks = pgTable(
  'professor_subject_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    professorId: uuid('professor_id')
      .notNull()
      .references(() => professors.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('manual_admin'), // 'manual_admin' | 'historical'
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_prof_subject_link').on(table.professorId, table.subjectId),
    index('idx_prof_subject_links_prof').on(table.professorId),
    index('idx_prof_subject_links_sub').on(table.subjectId),
  ]
);

export const professorReviews = pgTable(
  'professor_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    professorId: uuid('professor_id')
      .notNull()
      .references(() => professors.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    academicYear: integer('academic_year'),
    term: text('term'), // '1C' | '2C' | 'A'
    overall: integer('overall').notNull(), // 1..5
    clarity: integer('clarity'), // 1..5
    treatment: integer('treatment'), // 1..5
    availability: integer('availability'), // 1..5
    difficulty: integer('difficulty'), // 1..5 (5 = muy exigente)
    wouldRecommend: boolean('would_recommend'),
    comment: text('comment'), // máx 600 chars
    status: text('status').notNull().default('published'), // 'published' | 'hidden' | 'removed'
    helpfulCount: integer('helpful_count').notNull().default(0),
    attendedDeclared: boolean('attended_declared').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique('uq_user_professor_subject_review').on(
      table.userId,
      table.professorId,
      table.subjectId
    ),
    index('idx_prof_reviews_prof_status').on(table.professorId, table.status),
    index('idx_prof_reviews_prof_sub_status').on(
      table.professorId,
      table.subjectId,
      table.status
    ),
    index('idx_prof_reviews_user_created').on(table.userId, table.createdAt),
  ]
);

export const reviewHelpfulVotes = pgTable(
  'review_helpful_votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => professorReviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_review_helpful_vote').on(table.reviewId, table.userId),
    index('idx_review_helpful_review').on(table.reviewId),
  ]
);

export const reviewReports = pgTable(
  'review_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => professorReviews.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(), // 'ofensiva' | 'datos personales' | 'falsa o spam' | 'otra'
    note: text('note'),
    status: text('status').notNull().default('open'), // 'open' | 'dismissed' | 'actioned'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_review_reporter').on(table.reviewId, table.reporterUserId),
    index('idx_review_reports_status').on(table.status),
    index('idx_review_reports_review').on(table.reviewId),
  ]
);

export const professorStats = pgTable('professor_stats', {
  professorId: uuid('professor_id')
    .primaryKey()
    .references(() => professors.id, { onDelete: 'cascade' }),
  reviewCount: integer('review_count').notNull().default(0),
  avgOverall: numeric('avg_overall', { precision: 4, scale: 2 }),
  bayesianScore: numeric('bayesian_score', { precision: 5, scale: 3 }),
  stars1: integer('stars_1').notNull().default(0),
  stars2: integer('stars_2').notNull().default(0),
  stars3: integer('stars_3').notNull().default(0),
  stars4: integer('stars_4').notNull().default(0),
  stars5: integer('stars_5').notNull().default(0),
  avgClarity: numeric('avg_clarity', { precision: 4, scale: 2 }),
  avgTreatment: numeric('avg_treatment', { precision: 4, scale: 2 }),
  avgAvailability: numeric('avg_availability', { precision: 4, scale: 2 }),
  avgDifficulty: numeric('avg_difficulty', { precision: 4, scale: 2 }),
  recommendRate: numeric('recommend_rate', { precision: 5, scale: 2 }), // 0..100
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const professorSubjectStats = pgTable(
  'professor_subject_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    professorId: uuid('professor_id')
      .notNull()
      .references(() => professors.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    reviewCount: integer('review_count').notNull().default(0),
    avgOverall: numeric('avg_overall', { precision: 4, scale: 2 }),
    bayesianScore: numeric('bayesian_score', { precision: 5, scale: 3 }),
    stars1: integer('stars_1').notNull().default(0),
    stars2: integer('stars_2').notNull().default(0),
    stars3: integer('stars_3').notNull().default(0),
    stars4: integer('stars_4').notNull().default(0),
    stars5: integer('stars_5').notNull().default(0),
    avgClarity: numeric('avg_clarity', { precision: 4, scale: 2 }),
    avgTreatment: numeric('avg_treatment', { precision: 4, scale: 2 }),
    avgAvailability: numeric('avg_availability', { precision: 4, scale: 2 }),
    avgDifficulty: numeric('avg_difficulty', { precision: 4, scale: 2 }),
    recommendRate: numeric('recommend_rate', { precision: 5, scale: 2 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_prof_subject_stats').on(table.professorId, table.subjectId),
    index('idx_prof_sub_stats_prof').on(table.professorId),
  ]
);

// ==========================================
// 2C. CURSADAS REGISTRADAS Y RECOMENDACIONES DE RESEÑAS
// ==========================================

export const subjectEnrollments = pgTable(
  'subject_enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    commissionId: uuid('commission_id').references(() => commissions.id, {
      onDelete: 'set null',
    }),
    academicYear: integer('academic_year'),
    term: text('term'), // '1C' | '2C' | 'A' | null
    source: text('source').notNull().default('manual'), // 'manual' | 'schedule_builder'
    ...timestamps,
  },
  (table) => [
    uniqueIndex('uq_subject_enrollment_period')
      .on(table.userId, table.subjectId, table.academicYear, table.term)
      .where(sql`${table.academicYear} IS NOT NULL AND ${table.term} IS NOT NULL`),
    index('idx_subject_enrollments_user').on(table.userId),
    index('idx_subject_enrollments_user_subject').on(table.userId, table.subjectId),
  ]
);

export const enrollmentProfessors = pgTable(
  'enrollment_professors',
  {
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => subjectEnrollments.id, { onDelete: 'cascade' }),
    professorId: uuid('professor_id')
      .notNull()
      .references(() => professors.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({
      columns: [table.enrollmentId, table.professorId],
      name: 'pk_enrollment_professors',
    }),
    index('idx_enrollment_professors_prof').on(table.professorId),
  ]
);

export const reviewRecommendationDismissals = pgTable(
  'review_recommendation_dismissals',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    professorId: uuid('professor_id')
      .notNull()
      .references(() => professors.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.professorId, table.subjectId],
      name: 'pk_review_rec_dismissals',
    }),
    index('idx_review_rec_dismissals_user').on(table.userId),
    index('idx_review_rec_dismissals_prof').on(table.professorId),
  ]
);

// ==========================================
// 3. RELACIONES DRIZZLE
// ==========================================

export const institutionsRelations = relations(institutions, ({ many }) => ({
  faculties: many(faculties),
}));

export const facultiesRelations = relations(faculties, ({ one, many }) => ({
  institution: one(institutions, {
    fields: [faculties.institutionId],
    references: [institutions.id],
  }),
  careers: many(careers),
  scheduleTerms: many(scheduleTerms),
}));

export const careersRelations = relations(careers, ({ one, many }) => ({
  faculty: one(faculties, {
    fields: [careers.facultyId],
    references: [faculties.id],
  }),
  studyPlans: many(studyPlans),
}));

export const studyPlansRelations = relations(studyPlans, ({ one, many }) => ({
  career: one(careers, {
    fields: [studyPlans.careerId],
    references: [careers.id],
  }),
  subjects: many(subjects),
  specialRules: many(planSpecialRules),
  acronyms: many(acronyms),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  plan: one(studyPlans, {
    fields: [subjects.planId],
    references: [studyPlans.id],
  }),
  prerequisites: many(subjectPrerequisites, { relationName: 'subjectPrereqs' }),
  requiredBy: many(subjectPrerequisites, { relationName: 'requiredByPrereqs' }),
  commissions: many(commissions),
}));

export const subjectPrerequisitesRelations = relations(subjectPrerequisites, ({ one }) => ({
  subject: one(subjects, {
    fields: [subjectPrerequisites.subjectId],
    references: [subjects.id],
    relationName: 'subjectPrereqs',
  }),
  requiredSubject: one(subjects, {
    fields: [subjectPrerequisites.requiresSubjectId],
    references: [subjects.id],
    relationName: 'requiredByPrereqs',
  }),
}));

export const commissionsRelations = relations(commissions, ({ one, many }) => ({
  subject: one(subjects, {
    fields: [commissions.subjectId],
    references: [subjects.id],
  }),
  scheduleTerm: one(scheduleTerms, {
    fields: [commissions.scheduleTermId],
    references: [scheduleTerms.id],
  }),
  courseGroup: one(courseGroups, {
    fields: [commissions.courseGroupId],
    references: [courseGroups.id],
  }),
  professors: many(commissionProfessors),
  slots: many(commissionSlots),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  selectedPlan: one(studyPlans, {
    fields: [users.selectedPlanId],
    references: [studyPlans.id],
  }),
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  progress: many(subjectProgress),
  electives: many(electiveAssignments),
  basket: many(userBasket),
  refreshTokens: many(refreshTokens),
  scheduleSelections: many(scheduleSelections),
  scheduleProposals: many(scheduleProposals),
  professorReviews: many(professorReviews),
}));

export const professorsRelations = relations(professors, ({ one, many }) => ({
  faculty: one(faculties, {
    fields: [professors.facultyId],
    references: [faculties.id],
  }),
  aliases: many(professorAliases),
  commissionProfessors: many(commissionProfessors),
  electiveOfferingProfessors: many(electiveOfferingProfessors),
  subjectLinks: many(professorSubjectLinks),
  reviews: many(professorReviews),
  stats: one(professorStats, {
    fields: [professors.id],
    references: [professorStats.professorId],
  }),
  subjectStats: many(professorSubjectStats),
}));

export const professorReviewsRelations = relations(professorReviews, ({ one, many }) => ({
  user: one(users, {
    fields: [professorReviews.userId],
    references: [users.id],
  }),
  professor: one(professors, {
    fields: [professorReviews.professorId],
    references: [professors.id],
  }),
  subject: one(subjects, {
    fields: [professorReviews.subjectId],
    references: [subjects.id],
  }),
  reports: many(reviewReports),
  helpfulVotes: many(reviewHelpfulVotes),
}));

export const subjectEnrollmentsRelations = relations(subjectEnrollments, ({ one, many }) => ({
  user: one(users, {
    fields: [subjectEnrollments.userId],
    references: [users.id],
  }),
  subject: one(subjects, {
    fields: [subjectEnrollments.subjectId],
    references: [subjects.id],
  }),
  commission: one(commissions, {
    fields: [subjectEnrollments.commissionId],
    references: [commissions.id],
  }),
  enrollmentProfessors: many(enrollmentProfessors),
}));

export const enrollmentProfessorsRelations = relations(enrollmentProfessors, ({ one }) => ({
  enrollment: one(subjectEnrollments, {
    fields: [enrollmentProfessors.enrollmentId],
    references: [subjectEnrollments.id],
  }),
  professor: one(professors, {
    fields: [enrollmentProfessors.professorId],
    references: [professors.id],
  }),
}));


