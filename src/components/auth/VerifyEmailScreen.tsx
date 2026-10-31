import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { SixDigitInput } from './SixDigitInput';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  RotateCcw,
  LogOut,
  Edit3,
} from 'lucide-react';
import { BrandLogo, StackSymbol } from '../common/BrandLogo';

interface VerifyEmailScreenProps {
  initialDeliveryFailed?: boolean;
}

export const VerifyEmailScreen: React.FC<VerifyEmailScreenProps> = ({
  initialDeliveryFailed = false,
}) => {
  const { user, verifyEmail, resendVerificationCode, cancelRegistration, logout } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [deliveryWarning, setDeliveryWarning] = useState(initialDeliveryFailed);

  // Contador de reenvío de 60 segundos
  const [cooldownSeconds, setCooldownSeconds] = useState(60);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  const handleVerify = useCallback(
    async (codeToVerify?: string) => {
      const targetCode = (codeToVerify || code).trim();
      if (targetCode.length !== 6 || isVerifying) return;

      setError(null);
      setSuccessMsg(null);
      setIsVerifying(true);

      try {
        await verifyEmail(targetCode);
        setSuccessMsg('¡Correo verificado con éxito! Ingresando...');
      } catch (err: any) {
        setError(
          err?.message ||
            'Código incorrecto o expirado. Por favor verificá los números ingresados.'
        );
      } finally {
        setIsVerifying(false);
      }
    },
    [code, isVerifying, verifyEmail]
  );

  const handleResend = async () => {
    if (cooldownSeconds > 0 || isResending) return;

    setError(null);
    setSuccessMsg(null);
    setIsResending(true);

    try {
      const res = await resendVerificationCode();
      if (res.emailDeliveryFailed) {
        setDeliveryWarning(true);
        setError(
          'No se pudo enviar el correo electrónico en este momento. Por favor intentá nuevamente en unos segundos.'
        );
      } else {
        setDeliveryWarning(false);
        setSuccessMsg('Te enviamos un nuevo código a tu correo.');
        setCooldownSeconds(60);
      }
    } catch (err: any) {
      setError(
        err?.message || 'Error al reenviar el código. Por favor intentá más tarde.'
      );
    } finally {
      setIsResending(false);
    }
  };

  const handleCancelRegistration = async () => {
    if (!window.confirm('¿Querés cambiar de dirección de correo? Se cancelará el registro actual para que puedas ingresar el email correcto.')) {
      return;
    }

    setIsCanceling(true);
    try {
      await cancelRegistration();
    } catch (err: any) {
      setError(err?.message || 'Error al cancelar el registro.');
      setIsCanceling(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Glow ambient background with brand indigo & subtle symbol watermark */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-[#2A2E8A]/20 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[360px] h-[360px] bg-[#171A52]/35 rounded-full blur-[110px] pointer-events-none" />
      <div className="absolute -left-16 -bottom-16 w-96 h-96 opacity-[0.03] pointer-events-none -rotate-12">
        <StackSymbol />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="w-full max-w-md bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-2xl shadow-2xl p-6 sm:p-8 relative z-10 space-y-6"
      >
        {/* Header with Brand Logo */}
        <div className="text-center space-y-3">
          <div className="flex justify-center mb-1">
            <BrandLogo variant="symbol" size="md" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Verificá tu correo
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Te enviamos un código de 6 dígitos a{' '}
            <strong className="text-white font-semibold">{user?.email || 'tu email'}</strong>
          </p>
        </div>

        {/* Delivery Warning Banner */}
        {deliveryWarning && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Si no encontrás el correo (revisá también la carpeta de Spam), podés solicitar un nuevo código tocando <strong>&ldquo;Reenviar código&rdquo;</strong> abajo.
            </span>
          </div>
        )}

        {/* Error Alert Box */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 6 Digit Input */}
        <div className="py-2">
          <SixDigitInput
            value={code}
            onChange={setCode}
            onComplete={(fullCode) => handleVerify(fullCode)}
            disabled={isVerifying}
            hasError={Boolean(error)}
          />
        </div>

        {/* Verify Action Button */}
        <button
          type="button"
          disabled={code.length !== 6 || isVerifying}
          onClick={() => handleVerify()}
          className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verificando...</span>
            </>
          ) : (
            <>
              <span>Verificar y continuar</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {/* Resend Code Section */}
        <div className="text-center text-xs text-slate-400 pt-2 border-t border-slate-800 space-y-2">
          <div className="flex items-center justify-center gap-1.5">
            <span>¿No recibiste el código?</span>
            {cooldownSeconds > 0 ? (
              <span className="text-slate-500 font-mono">
                Reenviar en {cooldownSeconds}s
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                disabled={isResending}
                className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline flex items-center gap-1 disabled:opacity-50"
              >
                {isResending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                <span>Reenviar código</span>
              </button>
            )}
          </div>
        </div>

        {/* Secondary options: Change email or Logout */}
        <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
          <button
            type="button"
            onClick={handleCancelRegistration}
            disabled={isCanceling}
            className="hover:text-slate-200 cursor-pointer flex items-center gap-1 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Cambiar de email</span>
          </button>

          <button
            type="button"
            onClick={() => logout()}
            className="hover:text-slate-200 cursor-pointer flex items-center gap-1 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};

