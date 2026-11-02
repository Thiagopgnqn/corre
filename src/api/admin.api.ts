import { apiFetch } from './client';
import type { AdminReviewCatalogItem } from '../types/professor';

export interface AdminStatsResponse {
  range: '7d' | '30d' | '90d';
  overview: {
    totalUsers: number;
    activeUsersCount: number;
    suspendedUsersCount: number;
    adminsCount: number;
    newUsersInRange: number;
    totalEnrollments: number;
    totalReviews: number;
    pendingReportsCount: number;
  };
  library?: {
    approvedCount: number;
    pendingCount: number;
    totalSizeBytes: number;
    openReportsCount: number;
    warningNearLimit: boolean;
  };
  charts: {
    signupsByDay: Array<{ date: string; count: number }>;
    activeUsersByDay: Array<{ date: string; count: number }>;
  };
  catalog: {
    totalSubjects: number;
    totalCommissions: number;
    totalProfessors: number;
    qualityAlerts: Array<{
      type: 'missing_professor' | 'missing_schedule' | 'high_reports';
      message: string;
      details?: any;
    }>;
  };
  health: {
    database: 'connected' | 'error';
    uptimeSeconds: number;
    cachedAt: string;
  };
}

export interface AdminUserListItem {
  id: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  emailVerified: boolean;
  selectedPlanId: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  identities: Array<{ provider: string }>;
}

export interface AdminUserDetail extends AdminUserListItem {
  counters: {
    enrollmentsCount: number;
    reviewsCount: number;
    reportsSubmittedCount: number;
  };
}

export interface AdminTerm {
  id: string;
  name: string;
  year: number;
  isDefault: boolean;
  isDraft: boolean;
  createdAt: string;
  commissionsCount?: number;
}

export interface AdminCommissionItem {
  id: string;
  termId: string;
  subjectId: string;
  subjectName?: string;
  subjectCode?: number;
  subjectLevel?: number;
  code: string;
  shift: 'M' | 'T' | 'N';
  classroom?: string | null;
  professorName?: string | null;
  isRetired: boolean;
  scheduleSlots: Array<{
    day: number;
    start: string;
    end: string;
    classroom?: string;
  }>;
}

export interface CommissionImpactSummary {
  commissionId: string;
  commissionCode: string;
  activeEnrollmentsCount: number;
  historyEnrollmentsCount: number;
  hasEnrolledStudents: boolean;
  recommendation: 'retire' | 'safe_delete';
}

export interface ScheduleImportPreview {
  previewHash: string;
  totalTerms: number;
  totalCommissions: number;
  termsFound: string[];
  sampleCommissions: Array<{
    termId: string;
    code: string;
    subjectId: string;
    professor?: string;
  }>;
}

export interface AdminAuditLogItem {
  id: string;
  createdAt: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetEmail: string | null;
  details: any;
  ipAddress: string | null;
}

export const adminApi = {
  // ── Reautenticación ──
  async reauthPassword(password: string): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/admin/reauth', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async reauthGoogle(idToken: string): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/admin/reauth', {
      method: 'POST',
      body: JSON.stringify({ googleIdToken: idToken }),
    });
  },

  async checkReauth(): Promise<{ authenticated: boolean; user?: any }> {
    return apiFetch('/api/admin/reauth/status');
  },

  // ── Estadísticas ──
  async getStats(range: '7d' | '30d' | '90d' = '30d'): Promise<{ success: boolean; data: AdminStatsResponse }> {
    return apiFetch(`/api/admin/stats?range=${range}`);
  },

  // ── Gestión de Usuarios ──
  async listUsers(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: string;
    status?: string;
    emailVerified?: string;
    sort?: string;
  }): Promise<{
    success: boolean;
    data: {
      users: AdminUserListItem[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    };
  }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.search) qs.set('search', params.search);
    if (params?.role && params.role !== 'all') qs.set('role', params.role);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    if (params?.emailVerified && params.emailVerified !== 'all') qs.set('emailVerified', params.emailVerified);
    if (params?.sort) qs.set('sort', params.sort);
    const query = qs.toString();
    return apiFetch(`/api/admin/users${query ? `?${query}` : ''}`);
  },

  async getUser(userId: string): Promise<{ success: boolean; data: AdminUserDetail }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`);
  },

  async setUserStatus(
    userId: string,
    status: 'active' | 'suspended'
  ): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async setUserRole(
    userId: string,
    role: 'user' | 'admin'
  ): Promise<{ success: boolean; role: 'user' | 'admin' }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  async revokeUserSessions(userId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      method: 'POST',
    });
  },

  async verifyUserEmail(userId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/verify-email`, {
      method: 'POST',
    });
  },

  async resendVerificationCode(userId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/resend-code`, {
      method: 'POST',
    });
  },

  async deleteUser(
    userId: string,
    confirmEmail: string
  ): Promise<{ success: boolean; message?: string }> {
    return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail }),
    });
  },

  getExportUsersCsvUrl(filters?: { search?: string; role?: string; status?: string }): string {
    const qs = new URLSearchParams();
    if (filters?.search) qs.set('search', filters.search);
    if (filters?.role && filters.role !== 'all') qs.set('role', filters.role);
    if (filters?.status && filters.status !== 'all') qs.set('status', filters.status);
    const query = qs.toString();
    return `/api/admin/users/export.csv${query ? `?${query}` : ''}`;
  },

  // ── Períodos y Comisiones ──
  async listTerms(): Promise<{ success: boolean; data: AdminTerm[] }> {
    return apiFetch('/api/admin/terms');
  },

  async createTerm(payload: {
    id?: string;
    name: string;
    year: number;
    isDefault?: boolean;
    isDraft?: boolean;
  }): Promise<{ success: boolean; data: AdminTerm }> {
    return apiFetch('/api/admin/terms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async duplicateTerm(
    sourceTermId: string,
    payload: { newTermId: string; newName: string; newYear: number }
  ): Promise<{ success: boolean; data: AdminTerm }> {
    return apiFetch(`/api/admin/terms/${encodeURIComponent(sourceTermId)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async setTermDefault(termId: string): Promise<{ success: boolean; data: AdminTerm }> {
    return apiFetch(`/api/admin/terms/${encodeURIComponent(termId)}/default`, {
      method: 'PATCH',
    });
  },

  async listCommissions(
    termId: string,
    params?: { subjectId?: string; search?: string }
  ): Promise<{ success: boolean; data: AdminCommissionItem[] }> {
    const qs = new URLSearchParams();
    if (params?.subjectId) qs.set('subjectId', params.subjectId);
    if (params?.search) qs.set('search', params.search);
    const query = qs.toString();
    return apiFetch(`/api/admin/terms/${encodeURIComponent(termId)}/commissions${query ? `?${query}` : ''}`);
  },

  async saveCommission(commission: Partial<AdminCommissionItem> & { termId: string; subjectId: string; code: string }): Promise<{
    success: boolean;
    data: AdminCommissionItem;
  }> {
    return apiFetch('/api/admin/commissions', {
      method: 'POST',
      body: JSON.stringify(commission),
    });
  },

  async previewCommissionImpact(commissionId: string): Promise<{ success: boolean; data: CommissionImpactSummary }> {
    return apiFetch(`/api/admin/commissions/${encodeURIComponent(commissionId)}/impact`);
  },

  async retireCommission(commissionId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/commissions/${encodeURIComponent(commissionId)}/retire`, {
      method: 'PATCH',
    });
  },

  async deleteCommission(commissionId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/admin/commissions/${encodeURIComponent(commissionId)}`, {
      method: 'DELETE',
    });
  },

  async previewScheduleImport(scheduleData: any): Promise<{ success: boolean; data: ScheduleImportPreview }> {
    return apiFetch('/api/admin/schedule/preview-import', {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    });
  },

  async applyScheduleImport(previewHash: string, scheduleData: any): Promise<{ success: boolean; message: string; appliedCount: number }> {
    return apiFetch('/api/admin/schedule/apply-import', {
      method: 'POST',
      body: JSON.stringify({ previewHash, scheduleData }),
    });
  },

  // ── Moderación de Reseñas y Docentes ──
  async listReviews(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }): Promise<{
    success: boolean;
    data: {
      items: AdminReviewCatalogItem[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.search) qs.set('search', params.search);
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return apiFetch(`/api/admin/reviews${query ? `?${query}` : ''}`);
  },

  async suspendReviewAuthor(reviewId: string): Promise<{ success: boolean; message: string; authorEmail?: string }> {
    return apiFetch(`/api/admin/reviews/${encodeURIComponent(reviewId)}/suspend-author`, {
      method: 'POST',
    });
  },

  async listDuplicateCandidates(): Promise<{ success: boolean; data: any[] }> {
    return apiFetch('/api/admin/professors/duplicates');
  },

  async mergeProfessors(sourceProfessorId: string, targetProfessorId: string): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/admin/professors/merge', {
      method: 'POST',
      body: JSON.stringify({ sourceProfessorId, targetProfessorId }),
    });
  },

  async renameProfessor(professorId: string, displayName: string): Promise<{ success: boolean; data: any }> {
    return apiFetch(`/api/admin/professors/${encodeURIComponent(professorId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    });
  },

  async createHistoricalProfessor(payload: { displayName: string; subjectId?: string }): Promise<{ success: boolean; data: any }> {
    return apiFetch('/api/admin/professors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ── Registro de Auditoría ──
  async listAuditLogs(params?: {
    page?: number;
    pageSize?: number;
    action?: string;
    adminUserId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{
    success: boolean;
    data: {
      logs: AdminAuditLogItem[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    };
  }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.action) qs.set('action', params.action);
    if (params?.adminUserId) qs.set('adminUserId', params.adminUserId);
    if (params?.fromDate) qs.set('fromDate', params.fromDate);
    if (params?.toDate) qs.set('toDate', params.toDate);
    const query = qs.toString();
    return apiFetch(`/api/admin/audit-logs${query ? `?${query}` : ''}`);
  },
};

