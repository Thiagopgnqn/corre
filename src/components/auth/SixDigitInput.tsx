import React, { useRef, useEffect } from 'react';

interface SixDigitInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

export const SixDigitInput: React.FC<SixDigitInputProps> = ({
  value,
  onChange,
  onComplete,
  disabled = false,
  hasError = false,
}) => {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Array de 6 caracteres (rellenado con espacios o vacío)
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');

  // Foco automático en la primera casilla vacía al montar
  useEffect(() => {
    const firstEmptyIndex = digits.findIndex((d) => !d);
    const targetIdx = firstEmptyIndex === -1 ? 5 : firstEmptyIndex;
    inputsRef.current[targetIdx]?.focus();
  }, []);

  const handleInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    // Solo permitir dígitos
    const cleanDigit = rawVal.replace(/\D/g, '').slice(-1);

    const newDigits = [...digits];
    newDigits[index] = cleanDigit;
    const combined = newDigits.join('');
    onChange(combined);

    if (cleanDigit && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }

    if (combined.length === 6 && onComplete) {
      onComplete(combined);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Si está vacía, retroceder al anterior y limpiarlo
        e.preventDefault();
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        const combined = newDigits.join('');
        onChange(combined);
        inputsRef.current[index - 1]?.focus();
      } else if (digits[index]) {
        // Limpiar casilla actual
        const newDigits = [...digits];
        newDigits[index] = '';
        onChange(newDigits.join(''));
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text');
    const digitsOnly = pastedData.replace(/\D/g, '').slice(0, 6);

    if (digitsOnly.length > 0) {
      onChange(digitsOnly);
      const targetFocus = Math.min(digitsOnly.length, 5);
      inputsRef.current[targetFocus]?.focus();

      if (digitsOnly.length === 6 && onComplete) {
        onComplete(digitsOnly);
      }
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoComplete="one-time-code"
          disabled={disabled}
          value={digits[i]}
          onChange={(e) => handleInputChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-label={`Dígito ${i + 1} de 6`}
          className={`w-11 h-13 sm:w-13 sm:h-16 text-center text-xl sm:text-2xl font-bold font-mono rounded-xl border bg-slate-950/80 transition-all outline-none selection:bg-transparent ${
            hasError
              ? 'border-red-500/60 text-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-500/20'
              : digits[i]
              ? 'border-indigo-500 text-white shadow-md shadow-indigo-500/10 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/25'
              : 'border-slate-800 text-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20'
          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      ))}
    </div>
  );
};
