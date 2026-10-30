import { apiFetch } from './client';

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  selectedPlanId: string | null;
  lastLoginAt?: string;
}

export interface AuthResponse {
  success: boolean;
  user: User;
  message?: string;
}

export const authApi = {
  async register(email: string, password: string, selectedPlanId?: string): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, selectedPlanId }),
    });
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async logout(): Promise<{ success: boolean; message: string }> {
    return apiFetch<{ success: boolean; message: string }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  async getMe(): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/me');
  },

  async deleteAccount(): Promise<{ success: boolean; message: string }> {
    return apiFetch<{ success: boolean; message: string }>('/api/me', {
      method: 'DELETE',
    });
  },
};

