import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi, type User } from '../api/auth.api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  isLoading: boolean;
  isWakingServer: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    selectedPlanId?: string
  ) => Promise<{ emailDeliveryFailed?: boolean }>;
  verifyEmail: (code: string) => Promise<void>;
  resendVerificationCode: () => Promise<{ emailDeliveryFailed?: boolean }>;
  cancelRegistration: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isWakingServer, setIsWakingServer] = useState<boolean>(false);
  const coldStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkSession = useCallback(async () => {
    setIsLoading(true);

    // Si tarda más de 2.5s, avisar que el servidor se está despertando (Render free tier)
    coldStartTimerRef.current = setTimeout(() => {
      setIsWakingServer(true);
    }, 2500);

    try {
      const res = await authApi.getMe();
      if (res.success && res.user) {
        setUser(res.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      if (coldStartTimerRef.current) {
        clearTimeout(coldStartTimerRef.current);
      }
      setIsWakingServer(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    if (res.success && res.user) {
      setUser(res.user);
    }
  };

  const loginWithGoogle = async (credential: string) => {
    const res = await authApi.loginWithGoogle(credential);
    if (res.success && res.user) {
      setUser(res.user);
    }
  };

  const register = async (email: string, password: string, selectedPlanId?: string) => {
    const res = await authApi.register(email, password, selectedPlanId);
    if (res.success && res.user) {
      setUser(res.user);
    }
    return { emailDeliveryFailed: Boolean(res.emailDeliveryFailed) };
  };

  const verifyEmail = async (code: string) => {
    const res = await authApi.verifyEmail(code);
    if (res.success && res.user) {
      setUser(res.user);
    }
  };

  const resendVerificationCode = async () => {
    const res = await authApi.resendVerificationCode();
    return { emailDeliveryFailed: Boolean(res.emailDeliveryFailed) };
  };

  const cancelRegistration = async () => {
    try {
      await authApi.cancelRegistration();
    } finally {
      setUser(null);
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (e) {
      console.error('Error logging out:', e);
    } finally {
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      await authApi.deleteAccount();
    } finally {
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const res = await authApi.getMe();
      if (res.success && res.user) {
        setUser(res.user);
      }
    } catch {
      // Ignorar
    }
  };

  const isEmailVerified = Boolean(user && user.emailVerified === true);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isEmailVerified,
        isLoading,
        isWakingServer,
        login,
        loginWithGoogle,
        register,
        verifyEmail,
        resendVerificationCode,
        cancelRegistration,
        logout,
        deleteAccount,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
