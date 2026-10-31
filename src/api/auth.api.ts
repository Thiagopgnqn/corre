import { apiFetch } from './client';

export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  selectedPlanId: string | null;
  emailVerified?: boolean;
  authProviders?: string[];
  lastLoginAt?: string;
}

export interface AuthResponse {
  success: boolean;
  user: User;
  message?: string;
  emailDeliveryFailed?: boolean;
}

export const authApi = {
  async register(
    email: string,
    password: string,
    selectedPlanId?: string
  ): Promise<AuthResponse> {
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

  async loginWithGoogle(
    credential: string,
    selectedPlanId?: string
  ): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential, selectedPlanId }),
    });
  },

  async verifyEmail(code: string): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  async resendVerificationCode(): Promise<{
    success: boolean;
    message: string;
    emailDeliveryFailed?: boolean;
  }> {
    return apiFetch<{ success: boolean; message: string; emailDeliveryFailed?: boolean }>(
      '/api/auth/resend-code',
      {
        method: 'POST',
      }
    );
  },

  async cancelRegistration(): Promise<{ success: boolean; message: string }> {
    return apiFetch<{ success: boolean; message: string }>(
      '/api/auth/cancel-registration',
      {
        method: 'POST',
      }
    );
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


