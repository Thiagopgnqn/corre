import { apiFetch } from './client';
import type { Subject } from '../types/career';
import type { SubjectSchedule, ReservedElectiveSlot, ProfessorRef } from '../types/schedule';

export interface Institution {
  id: string;
  name: string;
  code: string;
  faculties: Array<{
    id: string;
    name: string;
    code: string;
    careers: Array<{
      id: string;
      name: string;
      code: string;
      plans: Array<{
        id: string;
        name: string;
        year: number;
        config: {
          requiredElectiveCredits: number;
          defaultMinPassingGrade: number;
          intermediateDegrees?: Array<{
            key: string;
            name: string;
            requiredElectiveCredits?: number;
            specialRuleSubjectCode?: number;
          }>;
          [key: string]: unknown;
        };
      }>;
    }>;
  }>;
}

export interface PlanDetailResponse {
  success: boolean;
  data: {
    plan: {
      id: string;
      name: string;
      year: number;
      config: {
        requiredElectiveCredits: number;
        defaultMinPassingGrade: number;
        intermediateDegrees?: Array<{
          key: string;
          name: string;
          requiredElectiveCredits?: number;
          specialRuleSubjectCode?: number;
        }>;
        [key: string]: unknown;
      };
      updatedAt: string;
    };
    subjects: Subject[];
    rules: Array<{
      id: string;
      subjectCode: number;
      ruleType: string;
      params: Record<string, unknown>;
      description: string;
    }>;
    acronyms: Record<string, number>;
  };
}

export interface ScheduleResponse {
  success: boolean;
  data: {
    schedule: SubjectSchedule[];
    reservedElectiveSlots: ReservedElectiveSlot[];
    electiveOfferings: Array<{
      courseCode: string;
      subjectCode: number;
      subjectName: string;
      professors: string[];
      professorRefs?: ProfessorRef[];
    }>;
    term: {
      id?: string;
      label?: string;
      academicYear?: number;
      term?: string;
    };
  };
}

export const catalogApi = {
  async getCareers(): Promise<{ success: boolean; data: Institution[] }> {
    return apiFetch<{ success: boolean; data: Institution[] }>('/api/catalog/careers');
  },

  async getPlan(planId: string = 'current'): Promise<PlanDetailResponse> {
    return apiFetch<PlanDetailResponse>(`/api/catalog/plans/${planId}`);
  },

  async getSchedule(params?: { planId?: string; year?: number; term?: '1C' | '2C' }): Promise<ScheduleResponse> {
    const query = new URLSearchParams();
    if (params?.planId) query.set('planId', params.planId);
    if (params?.year) query.set('year', String(params.year));
    if (params?.term) query.set('term', params.term);
    const qs = query.toString();
    return apiFetch<ScheduleResponse>(`/api/catalog/schedule${qs ? `?${qs}` : ''}`);
  },

  async updateSelectedPlan(planId: string): Promise<{ success: boolean; data: { selectedPlanId: string; planName: string } }> {
    return apiFetch<{ success: boolean; data: { selectedPlanId: string; planName: string } }>('/api/me/plan', {
      method: 'PUT',
      body: JSON.stringify({ planId }),
    });
  },
};

