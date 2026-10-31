import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { GraduationCap, Lock, Mail, ArrowRight, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { GoogleLoginButton } from './GoogleLoginButton';

export const AuthScreen: React.FC = () => {
  const { login, register, loginWithGoogle, isWakingServer } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGoogleSuccess = async (credential: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await loginWithGoogle(credential);
    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión con Google.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleError = (errorMsg: string) => {
    setError(errorMsg);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
      setError('Por favor ingresá un correo electrónico válido');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(normEmail, password);
      } else {
        await register(normEmail, password);
      }
    } catch (err: any) {
      setError(
        err?.message ||
          (mode === 'login'
            ? 'Email o contraseña incorrectos'
            : 'Error al registrar usuario')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Glow ambient background */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[350px] h-[350px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Cold start warning banner */}
      {isWakingServer && (
        <div className="mb-6 max-w-md w-full bg-amber-500/10 border border-amber-500/30 text-amber-300 px-4 py-3 rounded-xl flex items-center gap-3 text-sm animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin shrink-0 text-amber-400" />
          <span>Despertando el servidor en Render, esto puede demorar unos segundos en la primera petición...</span>
        </div>
      )}

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-2xl shadow-2xl p-6 sm:p-8 relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 mb-3 shadow-inner">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            Mi Carrera <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">Cloud</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {mode === 'login'
              ? 'Iniciá sesión para acceder a tu plan y horarios sincronizados'
              : 'Creá tu cuenta para guardar tu avance en la nube'}
          </p>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 p-1 bg-slate-950/60 rounded-xl mb-5 border border-slate-800">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(null); }}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              mode === 'login'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Iniciar Sesión
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(null); }}
            className={`py-2 text-sm font-medium rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Registrarse
          </button>
        </div>

        {/* Error box */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Google Authentication Button */}
        <div className="space-y-4">
          <GoogleLoginButton
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
            disabled={isSubmitting}
            mode={mode}
          />

          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative px-3 bg-slate-900 text-slate-500 text-xs uppercase tracking-wider font-semibold">
              o
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu.email@ejemplo.com"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-11 pr-4 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-sm"
              />
            </div>
            {mode === 'register' && (
              <p className="text-[11px] text-slate-400 mt-1">Mínimo 8 caracteres</p>
            )}
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Confirmar Contraseña
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-2.5 bg-slate-950/70 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-sm"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Procesando...</span>
              </>
            ) : (
              <>
                <span>{mode === 'login' ? 'Ingresar a Mi Carrera' : 'Crear Mi Cuenta'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Feature badge */}
        <div className="mt-6 pt-5 border-t border-slate-800 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Tus notas, electivas y horarios seguros y accesibles en cualquier dispositivo</span>
        </div>
      </div>
    </div>
  );
};

