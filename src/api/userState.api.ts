import { apiFetch } from './client';
import type { UserSubjectState, AssignedElectivesByYear } from '../types/career';
import type { AppSettings } from '../utils/storage';
import type { ScheduleDraft } from '../types/schedule';
import type { SubjectEnrollment } from '../types/enrollment';

export interface ConsolidatedUserState {
  selectedPlanId: string | null;
  hasSavedData: boolean;
  settings: AppSettings;
  progress: Record<number, UserSubjectState>;
  progressByUuid: Record<string, UserSubjectState>;
  assignedElectives: AssignedElectivesByYear;
  basket: number[];
  scheduleSelections: Record<number, string>;
  scheduleProposals: ScheduleDraft[];
  enrollments?: SubjectEnrollment[];
}

export const userStateApi = {
  async getState(): Promise<{ success: boolean; data: ConsolidatedUserState }> {
    return apiFetch<{ success: boolean; data: ConsolidatedUserState }>('/api/state');
  },

  async updateProgress(
    subjectId: number | string,
    status: string,
    grade?: number
  ): Promise<{ success: boolean; data: { subjectId: number; uuid: string; status: string; grade: number | null } }> {
    return apiFetch(`/api/progress/${subjectId}`, {
      method: 'PUT',
      body: JSON.stringify({ status, grade }),
    });
  },

  async updateElectives(assignedElectives: AssignedElectivesByYear): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/electives', {
      method: 'PUT',
      body: JSON.stringify({ assignedElectives }),
    });
  },

  async updateBasket(basket: number[]): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/basket', {
      method: 'PUT',
      body: JSON.stringify({ basket }),
    });
  },

  async updateSettings(settings: Partial<AppSettings>): Promise<{ success: boolean; data: AppSettings }> {
    return apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  async getScheduleProposals(): Promise<{ success: boolean; data: ScheduleDraft[] }> {
    return apiFetch('/api/schedule/proposals');
  },

  async saveScheduleProposal(proposal: {
    id?: string;
    name: string;
    scheduleTermId?: string;
    selections: Record<string, string>;
  }): Promise<{ success: boolean; data: any }> {
    return apiFetch('/api/schedule/proposals', {
      method: 'POST',
      body: JSON.stringify(proposal),
    });
  },

  async deleteScheduleProposal(id: string): Promise<{ success: boolean; message: string }> {
    return apiFetch(`/api/schedule/proposals/${id}`, {
      method: 'DELETE',
    });
  },

  async saveScheduleSelections(
    selections: Record<string | number, string>,
    scheduleTermId?: string
  ): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/schedule/selections', {
      method: 'PUT',
      body: JSON.stringify({ selections, scheduleTermId }),
    });
  },

  async importLegacyData(payload: unknown): Promise<{
    success: boolean;
    data: {
      progressCount: number;
      electivesCount: number;
      basketCount: number;
      proposalsCount: number;
      enrollmentsCount?: number;
    };
  }> {
    return apiFetch('/api/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async exportData(): Promise<{ success: boolean; data: unknown }> {
    return apiFetch('/api/export');
  },
};

