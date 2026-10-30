import { apiFetch } from './client';
import type {
  SubjectEnrollment,
  SubjectEnrollmentOptions,
  UpsertEnrollmentInput,
} from '../types/enrollment';

export const enrollmentsApi = {
  async listEnrollments(planId?: string): Promise<{
    success: boolean;
    data: { enrollments: SubjectEnrollment[] };
  }> {
    const qs = planId ? `?planId=${encodeURIComponent(planId)}` : '';
    return apiFetch(`/api/enrollments${qs}`);
  },

  async getSubjectOptions(
    subjectIdOrCode: string | number,
    planId?: string
  ): Promise<{
    success: boolean;
    data: SubjectEnrollmentOptions;
  }> {
    const qs = planId ? `?planId=${encodeURIComponent(planId)}` : '';
    return apiFetch(
      `/api/enrollments/options/${encodeURIComponent(String(subjectIdOrCode))}${qs}`
    );
  },

  async upsertEnrollment(
    subjectIdOrCode: string | number,
    input: UpsertEnrollmentInput
  ): Promise<{
    success: boolean;
    data: SubjectEnrollment;
  }> {
    return apiFetch(`/api/enrollments/${encodeURIComponent(String(subjectIdOrCode))}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async deleteEnrollment(enrollmentId: string): Promise<{
    success: boolean;
    data: { deleted: boolean; id: string };
  }> {
    return apiFetch(`/api/enrollments/${encodeURIComponent(enrollmentId)}`, {
      method: 'DELETE',
    });
  },
};

