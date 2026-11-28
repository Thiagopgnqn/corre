import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi, type User } from '../api/auth.api';
import {
  normalizeReturnToHash,
  resolveReturnToHashAfterAuth,
  runInitialSessionCheck,
  writeAuthHint,
} from '../utils/authGate';

export interface OpenLoginOptions {
  returnToHash?: string;
  mode?: 'login' | 'register';
}

export interface LoginPromptRequest {
  actionLabel: string;
  description?: string;
  returnToHash?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  isLoading: boolean;
  isWakingServer: boolean;
  sessionCheckError: string | null;
  retrySessionCheck: () => Promise<void>;
  isLoginOpen: boolean;
  loginInitialMode: 'login' | 'register';
  returnToHash: string | null;
  loginPrompt: LoginPromptRequest | null;
  openLoginPrompt: (
    actionLabel: string,
    options?: { description?: string; returnToHash?: string }
  ) => void;
  closeLoginPrompt: () => void;
  openLogin: (options?: OpenLoginOptions) => void;
  closeLogin: () => void;
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
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState<boolean>(false);
  const [loginInitialMode, setLoginInitialMode] = useState<'login' | 'register'>('login');
  const [returnToHash, setReturnToHash] = useState<string | null>(null);
  const [loginPrompt, setLoginPrompt] = useState<LoginPromptRequest | null>(null);
  const returnToHashRef = useRef<string | null>(null);

  const checkSession = useCallback(async () => {
    setIsLoading(true);
    setSessionCheckError(null);
    try {
      const outcome = await runInitialSessionCheck<User>({
        fetchMe: () => authApi.getMe(),
        onWakingChange: setIsWakingServer,
        wakingDelayMs: 2500,
      });
      if (outcome.status === 'transient_error') {
        setUser(null);
        setSessionCheckError(
          'El servidor está despertando o hay un problema temporal de conexión. Tu sesión sigue guardada.'
        );
      } else {
        setUser(outcome.user);
      }
    } finally {
      setIsWakingServer(false);
      setIsLoading(false);
    }
  }, []);

  const retrySessionCheck = useCallback(async () => {
    await checkSession();
  }, [checkSession]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const openLoginPrompt = useCallback(
    (actionLabel: string, options?: { description?: string; returnToHash?: string }) => {
      const fallbackHash =
        options?.returnToHash !== undefined
          ? options.returnToHash
          : typeof window !== 'undefined'
            ? window.location.hash
            : '';
      setLoginPrompt({
        actionLabel,
        description: options?.description,
        returnToHash: normalizeReturnToHash(fallbackHash) ?? undefined,
      });
    },
    []
  );

  const closeLoginPrompt = useCallback(() => {
    setLoginPrompt(null);
  }, []);

  const openLogin = useCallback((options?: OpenLoginOptions) => {
    const rawHash =
      options?.returnToHash !== undefined
        ? options.returnToHash
        : typeof window !== 'undefined'
          ? window.location.hash
          : '';
    const normalized = normalizeReturnToHash(rawHash);
    returnToHashRef.current = normalized;
    setReturnToHash(normalized);
    setLoginPrompt(null);
    setSessionCheckError(null);
    setLoginInitialMode(options?.mode ?? 'login');
    setIsLoginOpen(true);
  }, []);

  const closeLogin = useCallback(() => {
    setIsLoginOpen(false);
  }, []);

  const handleAuthCompletion = useCallback((emailVerified: boolean) => {
    const resolution = resolveReturnToHashAfterAuth({
      currentReturnToHash: returnToHashRef.current,
      emailVerified,
      applyHash: (targetHash) => {
        if (typeof window !== 'undefined') {
          window.location.hash = targetHash;
        }
      },
    });
    returnToHashRef.current = resolution.remainingReturnToHash;
    setReturnToHash(resolution.remainingReturnToHash);
    if (resolution.shouldCloseLogin) {
      setIsLoginOpen(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    if (res.success && res.user) {
      writeAuthHint('1');
      setUser(res.user);
      handleAuthCompletion(Boolean(res.user.emailVerified === true));
    }
  };

  const loginWithGoogle = async (credential: string) => {
    const res = await authApi.loginWithGoogle(credential);
    if (res.success && res.user) {
      writeAuthHint('1');
      setUser(res.user);
      handleAuthCompletion(Boolean(res.user.emailVerified === true));
    }
  };

  const register = async (email: string, password: string, selectedPlanId?: string) => {
    const res = await authApi.register(email, password, selectedPlanId);
    if (res.success && res.user) {
      writeAuthHint('1');
      setUser(res.user);
      handleAuthCompletion(Boolean(res.user.emailVerified === true));
    }
    return { emailDeliveryFailed: Boolean(res.emailDeliveryFailed) };
  };

  const verifyEmail = async (code: string) => {
    const res = await authApi.verifyEmail(code);
    if (res.success && res.user) {
      writeAuthHint('1');
      setUser(res.user);
      handleAuthCompletion(true);
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
      writeAuthHint('0');
      setUser(null);
      setIsLoginOpen(false);
      returnToHashRef.current = null;
      setReturnToHash(null);
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (e) {
      console.error('Error logging out:', e);
    } finally {
      writeAuthHint('0');
      setUser(null);
      setIsLoginOpen(false);
      returnToHashRef.current = null;
      setReturnToHash(null);
    }
  };

  const deleteAccount = async () => {
    try {
      await authApi.deleteAccount();
    } finally {
      writeAuthHint('0');
      setUser(null);
      setIsLoginOpen(false);
      returnToHashRef.current = null;
      setReturnToHash(null);
    }
  };

  const refreshUser = async () => {
    try {
      const res = await authApi.getMe();
      if (res.success && res.user) {
        writeAuthHint('1');
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
        sessionCheckError,
        retrySessionCheck,
        isLoginOpen,
        loginInitialMode,
        returnToHash,
        loginPrompt,
        openLoginPrompt,
        closeLoginPrompt,
        openLogin,
        closeLogin,
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

export const useOptionalAuth = (): AuthContextType | undefined => {
  return useContext(AuthContext);
};
