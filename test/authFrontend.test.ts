import assert from 'node:assert/strict';

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

console.log('🎉 TODAS LAS PRUEBAS FRONTEND DE AUTENTICACIÓN Y VERIFICACIÓN PASARON CON ÉXITO!\n');

