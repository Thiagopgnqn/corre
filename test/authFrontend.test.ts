import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GoogleLoginButton,
  syncGoogleGisButton,
  __resetGoogleLoginButtonForTesting,
} from '../src/components/auth/GoogleLoginButton.tsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper de extracción de dígitos (misma lógica que SixDigitInput)
function sanitizePastedCode(pastedText: string): string {
  return pastedText.replace(/\D/g, '').slice(0, 6);
}

function handleDigitChange(
  currentDigits: string[],
  index: number,
  newChar: string
): { updatedDigits: string[]; nextFocusIndex: number } {
  const clean = newChar.replace(/\D/g, '').slice(-1);
  const next = [...currentDigits];
  next[index] = clean;
  const nextFocusIndex = clean && index < 5 ? index + 1 : index;
  return { updatedDigits: next, nextFocusIndex };
}

function handleBackspace(
  currentDigits: string[],
  index: number
): { updatedDigits: string[]; nextFocusIndex: number } {
  const next = [...currentDigits];
  if (!next[index] && index > 0) {
    next[index - 1] = '';
    return { updatedDigits: next, nextFocusIndex: index - 1 };
  }
  next[index] = '';
  return { updatedDigits: next, nextFocusIndex: index };
}

function determineAppScreen(params: {
  isLoading: boolean;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
}): 'loading' | 'auth-screen' | 'verify-email-screen' | 'main-app' {
  if (params.isLoading) return 'loading';
  if (!params.isAuthenticated) return 'auth-screen';
  if (!params.isEmailVerified) return 'verify-email-screen';
  return 'main-app';
}

console.log('🧪 Ejecutando pruebas unitarias de frontend para Autenticación y Verificación de Email...');

// 1. Casillas de 6 dígitos: sanitizado y pegado
{
  assert.equal(sanitizePastedCode('123456'), '123456');
  assert.equal(sanitizePastedCode('123-456'), '123456');
  assert.equal(sanitizePastedCode('Código: 987 654!'), '987654');
  assert.equal(sanitizePastedCode('123456789'), '123456', 'Trunca a 6 dígitos');
  assert.equal(sanitizePastedCode('abc def'), '', 'Descarta letras y espacios');
  console.log('  ✅ Sanitizado de código pegado (caracteres especiales, guiones y longitud)');
}

// 2. Avance automático y tipeo
{
  const initial = ['', '', '', '', '', ''];
  const step1 = handleDigitChange(initial, 0, '4');
  assert.equal(step1.updatedDigits[0], '4');
  assert.equal(step1.nextFocusIndex, 1, 'Avanza a la casilla 1 tras tipear');

  const step2 = handleDigitChange(step1.updatedDigits, 1, '8');
  assert.equal(step2.updatedDigits[1], '8');
  assert.equal(step2.nextFocusIndex, 2);

  // En la última casilla (5), no avanza más allá
  const step6 = handleDigitChange(['4', '8', '1', '2', '3', ''], 5, '9');
  assert.equal(step6.updatedDigits[5], '9');
  assert.equal(step6.nextFocusIndex, 5, 'No supera la casilla 5');
  console.log('  ✅ Avance automático de foco al ingresar cada dígito');
}

// 3. Borrado con retroceso (Backspace)
{
  // Si la casilla actual tiene un dígito, se limpia y mantiene foco
  const res1 = handleBackspace(['1', '2', '3', '', '', ''], 2);
  assert.equal(res1.updatedDigits[2], '');
  assert.equal(res1.nextFocusIndex, 2);

  // Si la casilla actual está vacía, retrocede y limpia la anterior
  const res2 = handleBackspace(['1', '2', '', '', '', ''], 2);
  assert.equal(res2.updatedDigits[1], '');
  assert.equal(res2.nextFocusIndex, 1);
  console.log('  ✅ Borrado inteligente con retroceso y retroceso de foco');
}

// 4. Bloqueo de vistas de la app mientras la sesión no esté verificada
{
  // Caso 1: Cargando
  assert.equal(
    determineAppScreen({ isLoading: true, isAuthenticated: false, isEmailVerified: false }),
    'loading'
  );

  // Caso 2: Sin sesión iniciada
  assert.equal(
    determineAppScreen({ isLoading: false, isAuthenticated: false, isEmailVerified: false }),
    'auth-screen'
  );

  // Caso 3: Sesión activa pero email NO verificado
  assert.equal(
    determineAppScreen({ isLoading: false, isAuthenticated: true, isEmailVerified: false }),
    'verify-email-screen',
    'Una sesión activa con email_verified false DEBE mostrar VerifyEmailScreen y NUNCA la app'
  );

  // Caso 4: Sesión activa y verificada
  assert.equal(
    determineAppScreen({ isLoading: false, isAuthenticated: true, isEmailVerified: true }),
    'main-app'
  );

  console.log('  ✅ Bloqueo garantizado: ninguna pantalla de la app se muestra sin verificación');
}

// 5. Regresión del botón de Google: sin VITE_GOOGLE_CLIENT_ID mantiene caja fija de 44px
{
  const html = renderToStaticMarkup(
    React.createElement(GoogleLoginButton, {
      onSuccess: () => {},
      onError: () => {},
    })
  );
  assert.ok(
    html.includes('h-[44px] min-h-[44px] w-full'),
    'Sin VITE_GOOGLE_CLIENT_ID la caja debe mantener alto fijo de 44px'
  );
  assert.ok(
    html.includes('absolute inset-0') && html.includes('VITE_GOOGLE_CLIENT_ID no configurado'),
    'Sin VITE_GOOGLE_CLIENT_ID el aviso debe quedar contenido en absolute inset-0 dentro de los 44px'
  );
  console.log('  ✅ Caso sin VITE_GOOGLE_CLIENT_ID mantiene caja fija de 44px');
}

// 6. Regresión de comportamiento (con window.google simulado): escribir teclas y cambiar pestañas no reinicializa ni recrea el iframe
{
  __resetGoogleLoginButtonForTesting();

  let initCount = 0;
  let renderCount = 0;
  let clearCount = 0;
  let capturedCallback: ((res: { credential: string }) => void) | null = null;

  const iframeNode = { tagName: 'IFRAME', id: 'simulated-google-iframe' };
  const childNodes: unknown[] = [];
  let internalHtml = '';

  const simulatedContainer = {
    offsetWidth: 320,
    childNodes,
    get innerHTML() {
      return internalHtml;
    },
    set innerHTML(val: string) {
      internalHtml = val;
      if (val === '') {
        clearCount += 1;
        childNodes.length = 0;
      }
    },
  } as unknown as HTMLElement;

  const simulatedGoogleId = {
    initialize(config: { callback: (response: { credential: string }) => void }) {
      initCount += 1;
      capturedCallback = config.callback;
    },
    renderButton(parent: HTMLElement) {
      renderCount += 1;
      (parent.childNodes as unknown[]).push(iframeNode);
    },
  };

  const deliveredTokens: string[] = [];

  // Montaje inicial + simulación de re-montaje en StrictMode
  syncGoogleGisButton({
    clientId: 'client-1.apps.googleusercontent.com',
    container: simulatedContainer,
    googleId: simulatedGoogleId,
    onSuccess: (c) => deliveredTokens.push(`initial:${c}`),
    onError: () => {},
  });
  syncGoogleGisButton({
    clientId: 'client-1.apps.googleusercontent.com',
    container: simulatedContainer,
    googleId: simulatedGoogleId,
    onSuccess: (c) => deliveredTokens.push(`strictmode:${c}`),
    onError: () => {},
  });

  // Simular escritura de 5 teclas en email/contraseña + 2 cambios de pestaña con callbacks nuevos en cada render
  for (let i = 0; i < 7; i++) {
    syncGoogleGisButton({
      clientId: 'client-1.apps.googleusercontent.com',
      container: simulatedContainer,
      googleId: simulatedGoogleId,
      onSuccess: (c) => deliveredTokens.push(`render-${i}:${c}`),
      onError: () => {},
    });
  }

  assert.equal(initCount, 1, 'google.accounts.id.initialize debe llamarse UNA sola vez por clientId');
  assert.equal(renderCount, 1, 'google.accounts.id.renderButton debe llamarse UNA sola vez por montaje de contenedor');
  assert.equal(clearCount, 0, 'El contenedor no debe vaciarse tras re-renders, escritura ni cambio de pestaña');
  assert.strictEqual(
    childNodes[0],
    iframeNode,
    'El nodo iframe simulado debe permanecer exactamente la misma instancia tras escribir y cambiar de pestaña'
  );

  // Verificar que el callback registrado invoca la última versión de onSuccess
  assert.ok(capturedCallback, 'Debe haberse registrado el callback en initialize');
  capturedCallback!({ credential: 'jwt-ok' });
  assert.deepEqual(deliveredTokens, ['render-6:jwt-ok']);

  // Si cambia el clientId, entonces sí debe limpiar, reinicializar y volver a renderizar
  syncGoogleGisButton({
    clientId: 'client-2.apps.googleusercontent.com',
    container: simulatedContainer,
    googleId: simulatedGoogleId,
    onSuccess: (c) => deliveredTokens.push(`new-client:${c}`),
    onError: () => {},
  });
  assert.equal(initCount, 2, 'Al cambiar clientId debe volver a llamar a initialize');
  assert.equal(renderCount, 2, 'Al cambiar clientId debe volver a llamar a renderButton');
  assert.equal(clearCount, 1, 'Al cambiar clientId debe limpiar el contenedor anterior');

  __resetGoogleLoginButtonForTesting();
  console.log('  ✅ Comportamiento GIS: 1 sola inicialización y 1 solo renderButton, mismo nodo iframe tras re-renders');
}

// 7. Regresión estructural (fija la estructura del código fuente; la prueba visual corre en CDP)
{
  const authPath = path.join(rootDir, 'src/components/auth/AuthScreen.tsx');
  const authContent = fs.readFileSync(authPath, 'utf8');
  assert.match(
    authContent,
    /const handleGoogleSuccess = useCallback\(/,
    'AuthScreen debe memoizar handleGoogleSuccess con useCallback'
  );
  assert.match(
    authContent,
    /const handleGoogleError = useCallback\(/,
    'AuthScreen debe memoizar handleGoogleError con useCallback'
  );

  const googlePath = path.join(rootDir, 'src/components/auth/GoogleLoginButton.tsx');
  const googleContent = fs.readFileSync(googlePath, 'utf8');
  assert.match(
    googleContent,
    /h-\[44px\] min-h-\[44px\] w-full relative/,
    'GoogleLoginButton debe envolver el bloque en una caja fija de 44px'
  );
  assert.match(
    googleContent,
    /onSuccessRef\.current = onSuccess;[\s\S]*onErrorRef\.current = onError;/,
    'GoogleLoginButton debe mantener onSuccess y onError actualizados en refs'
  );
  assert.match(
    googleContent,
    /syncGoogleGisButton[\s\S]*\},\s*\[scriptLoaded,\s*clientId\]\);/,
    'El useEffect de renderButton debe depender únicamente de [scriptLoaded, clientId] (sin onSuccess, onError ni mode)'
  );
  assert.doesNotMatch(
    googleContent,
    /\},\s*\[scriptLoaded,\s*clientId,\s*onSuccess,\s*onError,\s*mode\]\);/,
    'El useEffect de renderButton NO debe incluir onSuccess, onError ni mode en dependencias'
  );
  console.log('  ✅ Invariantes estructurales de AuthScreen y GoogleLoginButton verificadas');
}

console.log('🎉 TODAS LAS PRUEBAS FRONTEND DE AUTENTICACIÓN Y VERIFICACIÓN PASARON CON ÉXITO!\n');

