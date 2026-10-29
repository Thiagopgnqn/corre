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
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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

export const commissionProfessors = pgTable('commission_professors', {
  id: uuid('id').defaultRandom().primaryKey(),
  commissionId: uuid('commission_id')
    .notNull()
    .references(() => commissions.id, { onDelete: 'cascade' }),
  professorName: text('professor_name').notNull(),
  ...timestamps,
});

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
}));

