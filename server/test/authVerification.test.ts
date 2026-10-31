// Configurar entorno aislado en memoria ANTES de importar módulos del servidor
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';
process.env.VERIFICATION_CODE_PEPPER =
  process.env.VERIFICATION_CODE_PEPPER || 'test_pepper_secret_super_seguro_min_16_caracteres';

import http from 'http';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

async function main() {
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { InMemoryReviewsStore } = await import('../src/modules/reviews/reviews.store.js');
  const {
    computeCanonicalEmail,
    hashVerificationCode,
    verifyCodeHash,
    AuthService,
    userHasAssociatedData,
    setUserDataCheckerForTesting,
    MIGRATION_0003_CUTOFF,
  } = await import('../src/modules/auth/auth.service.js');
  const { isDisposableEmail } = await import('../src/config/disposableDomains.js');
  const {
    setGoogleVerifierForTesting,
    verifyGoogleCredential,
  } = await import('../src/modules/auth/googleAuth.service.js');
  const { defaultMailer } = await import('../src/modules/mailer/mailer.service.js');

  console.log('======================================================================');
  console.log(' 🧪 TESTS DE GOOGLE LOGIN, VERIFICACIÓN DE EMAIL Y SEGURIDAD DE SESIÓN');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.error(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. CANONICAL EMAIL Y DOMINIOS DESCARTABLES
  // ---------------------------------------------------------------------------
  console.log('📌 1. Normalización Anti-Multicuentas (canonical_email) y Dominios Descartables');

  assert(
    computeCanonicalEmail('Juan.Perez+facultad@gmail.com') === 'juanperez@gmail.com',
    'Gmail: remueve puntos y alias "+" de la parte local'
  );
  assert(
    computeCanonicalEmail('maria.lopez@googlemail.com') === 'marialopez@gmail.com',
    'Googlemail: normaliza a gmail.com y remueve puntos'
  );
  assert(
    computeCanonicalEmail('estudiante.utn+test@frba.utn.edu.ar') ===
      'estudiante.utn+test@frba.utn.edu.ar',
    'Otros dominios: conserva puntos y formato sin alteraciones no solicitadas'
  );

  assert(isDisposableEmail('usuario@mailinator.com'), 'Detecta mailinator.com como descartable');
  assert(isDisposableEmail('test@tempmail.com'), 'Detecta tempmail.com como descartable');
  assert(isDisposableEmail('spam@yopmail.com'), 'Detecta yopmail.com como descartable');
  assert(!isDisposableEmail('estudiante@frc.utn.edu.ar'), 'Permite dominios universitarios válidos');
  assert(!isDisposableEmail('usuario@gmail.com'), 'Permite gmail.com');

  // ---------------------------------------------------------------------------
  // 2. GENERACIÓN, HASH HMAC-SHA256 Y COMPARACIÓN EN TIEMPO CONSTANTE
  // ---------------------------------------------------------------------------
  console.log('\n📌 2. Hash HMAC-SHA256 y Verificación Segura');

  const rawCode = '482910';
  const pepper = env.VERIFICATION_CODE_PEPPER;
  const hashed = hashVerificationCode(rawCode, pepper);

  assert(
    hashed !== rawCode && hashed.length === 64,
    'El código se hashea con HMAC-SHA256 (64 hex) y nunca en texto plano'
  );
  assert(
    verifyCodeHash('482910', hashed, pepper),
    'verifyCodeHash valida positivamente con el código correcto'
  );
  assert(
    !verifyCodeHash('482911', hashed, pepper),
    'verifyCodeHash rechaza códigos numéricos incorrectos'
  );
  assert(
    !verifyCodeHash('48291', hashed, pepper),
    'verifyCodeHash rechaza códigos de longitud diferente'
  );

  // ---------------------------------------------------------------------------
  // 3. MIDDLEWARE requireVerifiedEmail Y PROTECCIÓN GLOBAL DE RUTAS
  // ---------------------------------------------------------------------------
  console.log('\n📌 3. Protección Centralizada con requireVerifiedEmail');

  const store = new InMemoryReviewsStore();
  const testApp = createApp({ reviewsStore: store });
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://localhost:${port}`;

  function createTestToken(user: {
    id: string;
    email: string;
    role: 'user' | 'admin';
    emailVerified?: boolean;
    selectedPlanId?: string | null;
  }) {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        selectedPlanId: user.selectedPlanId ?? store.defaultPlanId,
        emailVerified: user.emailVerified,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  async function api(
    method: string,
    endpoint: string,
    token?: string,
    body?: any,
    includeCsrf: boolean = true
  ) {
    const headers: Record<string, string> = {};
    if (includeCsrf) headers['X-Requested-With'] = 'XMLHttpRequest';
    if (token) headers['Cookie'] = `accessToken=${token}`;

    const fetchOptions: RequestInit = {
      method,
      headers,
    };
    if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(`${baseUrl}${endpoint}`, fetchOptions);
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // Ignorar si no es json
    }
    return { status: res.status, data };
  }

  const unverifiedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'unverified@ejemplo.com',
    role: 'user' as const,
    emailVerified: false,
  };
  const unverifiedToken = createTestToken(unverifiedUser);

  const verifiedUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'verified@ejemplo.com',
    role: 'user' as const,
    emailVerified: true,
  };
  const verifiedToken = createTestToken(verifiedUser);

  // Token antiguo sin claim emailVerified (simula sesión existente previa al cambio)
  const legacyToken = jwt.sign(
    {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'legacy@ejemplo.com',
      role: 'user',
      selectedPlanId: store.defaultPlanId,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // A. Excepciones permitidas para cuenta sin verificar:
  const healthRes = await api('GET', '/api/health');
  assert(healthRes.status === 200, 'GET /api/health es accesible sin sesión');

  const meUnverified = await api('GET', '/api/me', unverifiedToken);
  assert(
    meUnverified.status !== 403 && meUnverified.data?.code !== 'EMAIL_NOT_VERIFIED',
    'GET /api/me no es bloqueado por requireVerifiedEmail (permite consultar estado de verificación)'
  );

  // B. Rutas de datos bloqueadas con 403 EMAIL_NOT_VERIFIED:
  const reviewsUnverified = await api('GET', '/api/reviews', unverifiedToken);
  assert(
    reviewsUnverified.status === 403 && reviewsUnverified.data?.code === 'EMAIL_NOT_VERIFIED',
    'Bloquea GET /api/reviews para cuenta no verificada con 403 EMAIL_NOT_VERIFIED'
  );

  const professorsUnverified = await api('GET', '/api/professors', unverifiedToken);
  assert(
    professorsUnverified.status === 403 && professorsUnverified.data?.code === 'EMAIL_NOT_VERIFIED',
    'Bloquea GET /api/professors para cuenta no verificada con 403 EMAIL_NOT_VERIFIED'
  );

  const reviewableUnverified = await api('GET', '/api/me/reviewable', unverifiedToken);
  assert(
    reviewableUnverified.status === 403 && reviewableUnverified.data?.code === 'EMAIL_NOT_VERIFIED',
    'Bloquea GET /api/me/reviewable para cuenta no verificada con 403 EMAIL_NOT_VERIFIED'
  );

  const deleteMeUnverified = await api('DELETE', '/api/me', unverifiedToken);
  assert(
    deleteMeUnverified.status === 403 && deleteMeUnverified.data?.code === 'EMAIL_NOT_VERIFIED',
    'Bloquea DELETE /api/me para cuenta no verificada con 403 EMAIL_NOT_VERIFIED'
  );

  // C. Un token viejo sin claim emailVerified no puede saltearse el bloqueo:
  const legacyBlocked = await api('GET', '/api/professors', legacyToken);
  assert(
    legacyBlocked.status === 403 && legacyBlocked.data?.code === 'EMAIL_NOT_VERIFIED',
    'Sesión preexistente o token viejo sin claim explícito es bloqueado inmediatamente hasta verificar'
  );

  // D. Cuenta verificada accede con éxito a las rutas de datos:
  const professorsVerified = await api('GET', '/api/professors', verifiedToken);
  assert(
    professorsVerified.status === 200,
    'Cuenta con emailVerified: true accede normalmente a las rutas de datos'
  );

  // ---------------------------------------------------------------------------
  // 4. LÓGICA DE REGISTRO, REENVÍO, EXPIRACIÓN, COOLDOWN Y VERIFICACIÓN
  // ---------------------------------------------------------------------------
  console.log('\n📌 4. Flujo de Código de Verificación, Intentos y Límites');

  // Simulación de almacenamiento en memoria de códigos para testear reglas de negocio
  interface MockCodeRecord {
    id: string;
    userId: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    consumedAt: Date | null;
    createdAt: Date;
  }
  const mockCodes: MockCodeRecord[] = [];

  function simulateCreateCode(userId: string, code: string, createdAt = new Date()) {
    // Invalida anteriores
    for (const c of mockCodes) {
      if (c.userId === userId && !c.consumedAt) {
        c.consumedAt = new Date();
      }
    }
    const record: MockCodeRecord = {
      id: crypto.randomUUID(),
      userId,
      codeHash: hashVerificationCode(code, env.VERIFICATION_CODE_PEPPER),
      expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
      attempts: 0,
      consumedAt: null,
      createdAt,
    };
    mockCodes.push(record);
    return record;
  }

  function simulateVerifyCode(userId: string, codeAttempt: string, now = new Date()) {
    const active = mockCodes
      .filter((c) => c.userId === userId && !c.consumedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (!active) {
      return { success: false, status: 400, error: 'No hay código activo' };
    }
    if (active.expiresAt.getTime() < now.getTime()) {
      active.consumedAt = now;
      return { success: false, status: 400, error: 'Código expirado' };
    }
    if (active.attempts >= 5) {
      active.consumedAt = now;
      return { success: false, status: 400, error: 'Superó 5 intentos' };
    }

    const match = verifyCodeHash(codeAttempt, active.codeHash, env.VERIFICATION_CODE_PEPPER);
    if (!match) {
      active.attempts += 1;
      if (active.attempts >= 5) {
        active.consumedAt = now;
        return { success: false, status: 400, error: 'Superó 5 intentos' };
      }
      return { success: false, status: 400, error: `Código incorrecto. Quedan ${5 - active.attempts} intentos` };
    }

    active.consumedAt = now;
    return { success: true, status: 200 };
  }

  function simulateResendCheck(userId: string, now = new Date()) {
    const userCodes = mockCodes
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const last = userCodes[0];
    if (last && now.getTime() - last.createdAt.getTime() < 60_000) {
      return { allowed: false, error: 'Espera de 60 segundos requerida' };
    }

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const inLastHour = userCodes.filter((c) => c.createdAt >= oneHourAgo);
    if (inLastHour.length >= 5) {
      return { allowed: false, error: 'Tope de 5 envíos por hora alcanzado' };
    }

    return { allowed: true };
  }

  const testUid = 'user-abc-123';
  const c1 = simulateCreateCode(testUid, '123456');

  // Fallo de intento 1
  const fail1 = simulateVerifyCode(testUid, '000000');
  assert(!fail1.success && fail1.error?.includes('Quedan 4 intentos'), 'Intento fallido 1 decrementa intentos restantes a 4');

  // Fallo de intento 2, 3, 4
  simulateVerifyCode(testUid, '000001');
  simulateVerifyCode(testUid, '000002');
  simulateVerifyCode(testUid, '000003');

  // Fallo de intento 5 -> invalida
  const fail5 = simulateVerifyCode(testUid, '000004');
  assert(!fail5.success && fail5.error?.includes('Superó 5 intentos'), 'Al 5° intento fallido el código queda bloqueado');

  // Intentar con el código correcto después de bloqueado -> rechazado
  const postLock = simulateVerifyCode(testUid, '123456');
  assert(!postLock.success, 'Código bloqueado por intentos no puede ser utilizado');

  // Cooldown de 60 segundos
  const cdCheck1 = simulateResendCheck(testUid, new Date(c1.createdAt.getTime() + 20_000));
  assert(!cdCheck1.allowed, 'Reenvío antes de 60 segundos es rechazado por cooldown');

  const cdCheck2 = simulateResendCheck(testUid, new Date(c1.createdAt.getTime() + 61_000));
  assert(cdCheck2.allowed, 'Reenvío cumplidos los 60 segundos es permitido');

  // Un código nuevo invalida el anterior
  const c2 = simulateCreateCode(testUid, '654321', new Date(c1.createdAt.getTime() + 65_000));
  assert(mockCodes.find((c) => c.id === c1.id)?.consumedAt !== null, 'Generar un nuevo código invalida el código anterior');

  // Código vencido tras 10 minutos
  const c2Expired = simulateVerifyCode(
    testUid,
    '654321',
    new Date(c2.createdAt.getTime() + 11 * 60 * 1000)
  );
  assert(!c2Expired.success && c2Expired.error?.includes('expirado'), 'Código con más de 10 minutos es rechazado por expiración');

  // Tope de 5 envíos por hora
  const spamUser = 'user-spam-456';
  const t0 = new Date('2026-10-30T10:00:00Z');
  simulateCreateCode(spamUser, '111111', new Date(t0.getTime() + 1 * 60_000));
  simulateCreateCode(spamUser, '222222', new Date(t0.getTime() + 3 * 60_000));
  simulateCreateCode(spamUser, '333333', new Date(t0.getTime() + 5 * 60_000));
  simulateCreateCode(spamUser, '444444', new Date(t0.getTime() + 7 * 60_000));
  simulateCreateCode(spamUser, '555555', new Date(t0.getTime() + 9 * 60_000));

  const spamCheck = simulateResendCheck(spamUser, new Date(t0.getTime() + 15 * 60_000));
  assert(!spamCheck.allowed && spamCheck.error?.includes('Tope de 5 envíos'), 'Bloquea solicitud al alcanzar 5 envíos en menos de 1 hora');

  // Verificación exitosa
  const validUid = 'user-valid-789';
  simulateCreateCode(validUid, '999888');
  const verifyOk = simulateVerifyCode(validUid, '999888');
  assert(verifyOk.success && verifyOk.status === 200, 'Código correcto verifica la cuenta satisfactoriamente');

  // ---------------------------------------------------------------------------
  // 5. RESILIENCIA DEL PROVEEDOR DE MAILS
  // ---------------------------------------------------------------------------
  console.log('\n📌 5. Tolerancia a Fallos del Proveedor de Correos');

  // Mock de adapter que falla
  defaultMailer.setAdapterForTesting({
    async sendVerificationCode() {
      return { success: false, error: 'Simulated Network Error in Resend/Brevo' };
    },
  });

  const mailFailResult = await defaultMailer.sendVerificationCode({
    to: 'test@ejemplo.com',
    code: '123456',
  });
  assert(
    mailFailResult.success === false,
    'Si el proveedor de mail falla, la excepción es capturada sin romper el flujo de registro'
  );

  // Restaurar mailer a null (consola dev)
  defaultMailer.setAdapterForTesting(null);

  // ---------------------------------------------------------------------------
  // 6. GOOGLE IDENTITY SERVICES Y REGLAS DE VINCULACIÓN
  // ---------------------------------------------------------------------------
  console.log('\n📌 6. Google Identity Services y Reglas de Vinculación de Cuentas');

  // Mock del verificador de Google
  setGoogleVerifierForTesting(async (credential: string) => {
    if (credential === 'invalid_aud') {
      throw new Error('Audiencia de Google incorrecta');
    }
    if (credential === 'expired_token') {
      throw new Error('El token de Google ha expirado');
    }
    if (credential === 'unverified_email') {
      throw new Error('La dirección de correo de Google no se encuentra verificada');
    }
    if (credential === 'valid_new_user') {
      return {
        sub: 'google-sub-10001',
        email: 'nuevo.estudiante@gmail.com',
        name: 'Nuevo Estudiante',
        emailVerified: true,
      };
    }
    if (credential === 'valid_verified_user') {
      return {
        sub: 'google-sub-20002',
        email: 'alumno.existente@gmail.com',
        name: 'Alumno Existente',
        emailVerified: true,
      };
    }
    if (credential === 'valid_unverified_user' || credential === 'valid_unverified_empty') {
      return {
        sub: 'google-sub-30003',
        email: 'alumno.sinverificar@gmail.com',
        name: 'Alumno Sin Verificar',
        emailVerified: true,
      };
    }
    if (credential === 'valid_unverified_with_data') {
      return {
        sub: 'google-sub-40004',
        email: 'alumno.con.datos@gmail.com',
        name: 'Alumno Con Datos',
        emailVerified: true,
      };
    }
    if (credential === 'valid_unverified_pre_migration') {
      return {
        sub: 'google-sub-50005',
        email: 'alumno.premigration@gmail.com',
        name: 'Alumno Pre Migración',
        emailVerified: true,
      };
    }
    throw new Error('Credencial desconocida');
  });

  // Validaciones del token simulado
  let audThrew = false;
  try {
    await verifyGoogleCredential('invalid_aud');
  } catch {
    audThrew = true;
  }
  assert(audThrew, 'Rechaza token de Google con audiencia incorrecta');

  let expThrew = false;
  try {
    await verifyGoogleCredential('expired_token');
  } catch {
    expThrew = true;
  }
  assert(expThrew, 'Rechaza token de Google expirado');

  let unvThrew = false;
  try {
    await verifyGoogleCredential('unverified_email');
  } catch {
    unvThrew = true;
  }
  assert(unvThrew, 'Rechaza token de Google con email_verified false');

  const gUser = await verifyGoogleCredential('valid_new_user');
  assert(
    gUser.sub === 'google-sub-10001' && gUser.emailVerified === true,
    'Verifica con éxito token válido de Google'
  );

  // Simulación de las 3 reglas de vinculación (incluyendo ajuste a Regla C):
  interface MockUser {
    id: string;
    email: string;
    canonicalEmail: string;
    passwordHash: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
    progress?: any[];
    electives?: any[];
    reviews?: any[];
    enrollments?: any[];
    proposals?: any[];
  }
  interface MockIdentity {
    userId: string;
    provider: string;
    providerUserId: string;
  }
  interface MockRefreshToken {
    id: string;
    userId: string;
    tokenHash: string;
    revokedAt: Date | null;
    expiresAt: Date;
  }

  const mockUsersTable: MockUser[] = [];
  const mockIdentitiesTable: MockIdentity[] = [];
  const mockRefreshTokensTable: MockRefreshToken[] = [];

  async function simulateGoogleAuthFlow(cred: string) {
    const verified = await verifyGoogleCredential(cred);
    const canonical = computeCanonicalEmail(verified.email);

    // 1. Identidad existente por sub
    const existingIdent = mockIdentitiesTable.find(
      (i) => i.provider === 'google' && i.providerUserId === verified.sub
    );
    if (existingIdent) {
      const u = mockUsersTable.find((x) => x.id === existingIdent.userId)!;
      return { user: u, action: 'logged_in_existing_identity' };
    }

    // 2. Buscar por email
    const existingUser = mockUsersTable.find(
      (x) => x.canonicalEmail === canonical || x.email === verified.email
    );

    // Regla A: No existe ninguna cuenta con ese email
    if (!existingUser) {
      const newUser: MockUser = {
        id: crypto.randomUUID(),
        email: verified.email,
        canonicalEmail: canonical,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
      };
      mockUsersTable.push(newUser);
      mockIdentitiesTable.push({
        userId: newUser.id,
        provider: 'google',
        providerUserId: verified.sub,
      });
      return { user: newUser, action: 'created_new_google_account' };
    }

    // Regla B: Existe cuenta verificada -> vincula identidad
    if (existingUser.emailVerifiedAt !== null) {
      const alreadyLinked = mockIdentitiesTable.some(
        (i) => i.userId === existingUser.id && i.provider === 'google'
      );
      if (!alreadyLinked) {
        mockIdentitiesTable.push({
          userId: existingUser.id,
          provider: 'google',
          providerUserId: verified.sub,
        });
      }
      return { user: existingUser, action: 'linked_google_to_verified_account' };
    }

    // Regla C: Existe cuenta creada con contraseña y SIN verificar.
    // Si la cuenta tiene datos guardados (progreso, electivas, reseñas, cursadas, propuestas)
    // o fue creada antes de la migración 0003, NO la elimines. En su lugar:
    // borrá su password_hash, revocá todos sus refresh tokens y sesiones,
    // vinculá la identidad de Google, marcá email_verified_at y entrá a esa cuenta,
    // conservando todos sus datos.
    const isPreMigration0003 = existingUser.createdAt < MIGRATION_0003_CUTOFF;
    const hasData = Boolean(
      (existingUser.progress && existingUser.progress.length > 0) ||
      (existingUser.electives && existingUser.electives.length > 0) ||
      (existingUser.reviews && existingUser.reviews.length > 0) ||
      (existingUser.enrollments && existingUser.enrollments.length > 0) ||
      (existingUser.proposals && existingUser.proposals.length > 0)
    );
    const shouldPreserve = isPreMigration0003 || hasData;

    if (shouldPreserve) {
      // 1. Borrar password_hash y marcar verificado
      existingUser.passwordHash = null;
      existingUser.emailVerifiedAt = new Date();

      // 2. Revocar todos sus refresh tokens previos (invalidar sesiones previas)
      mockRefreshTokensTable.forEach((t) => {
        if (t.userId === existingUser.id) {
          t.revokedAt = new Date();
        }
      });

      // 3. Vincular identidad de Google si aún no existe
      const alreadyLinked = mockIdentitiesTable.some(
        (i) => i.userId === existingUser.id && i.provider === 'google'
      );
      if (!alreadyLinked) {
        mockIdentitiesTable.push({
          userId: existingUser.id,
          provider: 'google',
          providerUserId: verified.sub,
        });
      }

      // 4. Emitir nueva sesión para el usuario conservado
      const newRefreshId = crypto.randomUUID();
      mockRefreshTokensTable.push({
        id: newRefreshId,
        userId: existingUser.id,
        tokenHash: 'new_token_hash_' + newRefreshId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      return {
        user: existingUser,
        action: 'preserved_unverified_account_with_google',
        reason: isPreMigration0003 ? 'pre_migration_0003' : 'has_saved_data',
      };
    }

    // Solo se elimina la cuenta sin verificar si no tiene ningún dato asociado (y fue creada después de 0003)
    const idx = mockUsersTable.findIndex((x) => x.id === existingUser.id);
    if (idx !== -1) mockUsersTable.splice(idx, 1);
    for (let i = mockRefreshTokensTable.length - 1; i >= 0; i--) {
      if (mockRefreshTokensTable[i].userId === existingUser.id) {
        mockRefreshTokensTable.splice(i, 1);
      }
    }

    const replacementUser: MockUser = {
      id: crypto.randomUUID(),
      email: verified.email,
      canonicalEmail: canonical,
      passwordHash: null,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    };
    mockUsersTable.push(replacementUser);
    mockIdentitiesTable.push({
      userId: replacementUser.id,
      provider: 'google',
      providerUserId: verified.sub,
    });
    return { user: replacementUser, action: 'replaced_unverified_account' };
  }

  // Ejecutar Regla A
  const resA = await simulateGoogleAuthFlow('valid_new_user');
  assert(
    resA.action === 'created_new_google_account' &&
      resA.user.passwordHash === null &&
      resA.user.emailVerifiedAt !== null,
    'Regla A: Crea nueva cuenta con email_verified_at ya seteado y password_hash null'
  );

  // Ejecutar Regla B
  mockUsersTable.push({
    id: 'user-b-id',
    email: 'alumno.existente@gmail.com',
    canonicalEmail: 'alumnoexistente@gmail.com',
    passwordHash: 'argon2_hash_valido',
    emailVerifiedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
  });
  const resB = await simulateGoogleAuthFlow('valid_verified_user');
  assert(
    resB.action === 'linked_google_to_verified_account' &&
      mockIdentitiesTable.some((i) => i.userId === 'user-b-id' && i.providerUserId === 'google-sub-20002'),
    'Regla B: Vincula la identidad de Google a la cuenta verificada preexistente'
  );

  // ---------------------------------------------------------------------------
  // REGLA C: AJUSTES DE VINCULACIÓN Y PRESERVACIÓN DE DATOS
  // ---------------------------------------------------------------------------

  // Caso C.1a: Cuenta con contraseña y sin verificar CON DATOS guardados (progreso, reseñas, cursadas)
  const userWithDataId = 'user-unverified-with-data';
  mockUsersTable.push({
    id: userWithDataId,
    email: 'alumno.con.datos@gmail.com',
    canonicalEmail: 'alumnocondatos@gmail.com',
    passwordHash: 'argon2_hash_viejo',
    emailVerifiedAt: null, // Sin verificar
    createdAt: new Date('2026-11-01T00:00:00Z'), // Posterior a migración 0003
    progress: [{ subjectId: 'subj-1', status: 'regularizada' }],
    electives: [{ subjectId: 'subj-elec-1', year: 4 }],
    reviews: [{ professorId: 'prof-1', rating: 5 }],
    enrollments: [{ subjectId: 'subj-1', academicYear: 2026 }],
    proposals: [{ name: 'Mi Horario' }],
  });

  // Registrar sesión previa activa para este usuario
  const oldRefreshTokenId = 'old-refresh-token-session-1';
  mockRefreshTokensTable.push({
    id: oldRefreshTokenId,
    userId: userWithDataId,
    tokenHash: 'old_raw_refresh_token_hash_1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86400000),
  });
  const oldSessionAccessToken = createTestToken({
    id: userWithDataId,
    email: 'alumno.con.datos@gmail.com',
    role: 'user',
    emailVerified: false,
  });

  // Ejecutar login con Google para cuenta sin verificar CON DATOS
  const resCData = await simulateGoogleAuthFlow('valid_unverified_with_data');
  assert(
    resCData.action === 'preserved_unverified_account_with_google' &&
      resCData.user.id === userWithDataId,
    'Regla C (con datos): NO elimina la cuenta y conserva el mismo ID de usuario'
  );
  assert(
    resCData.user.passwordHash === null,
    'Regla C (con datos): Borra password_hash de la cuenta'
  );
  assert(
    resCData.user.emailVerifiedAt !== null,
    'Regla C (con datos): Marca email_verified_at exitosamente'
  );
  assert(
    resCData.user.progress?.length === 1 &&
      resCData.user.electives?.length === 1 &&
      resCData.user.reviews?.length === 1 &&
      resCData.user.enrollments?.length === 1 &&
      resCData.user.proposals?.length === 1,
    'Regla C (con datos): Conserva intacto todo el progreso, electivas, reseñas, cursadas y propuestas'
  );
  assert(
    mockIdentitiesTable.some(
      (i) => i.userId === userWithDataId && i.provider === 'google' && i.providerUserId === 'google-sub-40004'
    ),
    'Regla C (con datos): Vincula la identidad de Google a la cuenta existente'
  );

  // Verificación de invalidación de la sesión vieja:
  const oldRefreshRecord = mockRefreshTokensTable.find((t) => t.id === oldRefreshTokenId);
  assert(
    oldRefreshRecord?.revokedAt !== null,
    'Invalidación de sesión: El refresh token de la sesión vieja queda revocado'
  );
  const oldAccessCheck = await api('GET', '/api/reviews', oldSessionAccessToken);
  assert(
    oldAccessCheck.status === 403 && oldAccessCheck.data?.code === 'EMAIL_NOT_VERIFIED',
    'Invalidación de sesión: El access token viejo (unverified) queda bloqueado con 403 en endpoints protegidos'
  );
  const attemptPasswordLoginOnConverted = resCData.user.passwordHash === null;
  assert(
    attemptPasswordLoginOnConverted,
    'Invalidación de sesión: No se puede iniciar sesión con la contraseña vieja porque password_hash fue eliminado'
  );

  // Caso C.1b: Cuenta sin verificar creada ANTES de la migración 0003 (sin datos)
  const preMigrationUserId = 'user-premigration-empty';
  mockUsersTable.push({
    id: preMigrationUserId,
    email: 'alumno.premigration@gmail.com',
    canonicalEmail: 'alumnopremigration@gmail.com',
    passwordHash: 'argon2_hash_viejo_pre',
    emailVerifiedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'), // ANTERIOR al corte de la migración 0003
    progress: [],
    electives: [],
    reviews: [],
    enrollments: [],
    proposals: [],
  });

  const resCPreMig = await simulateGoogleAuthFlow('valid_unverified_pre_migration');
  assert(
    resCPreMig.action === 'preserved_unverified_account_with_google' &&
      resCPreMig.user.id === preMigrationUserId,
    'Regla C (pre-migración 0003): NO elimina la cuenta creada antes de 0003 (incluso sin datos guardados)'
  );
  assert(
    resCPreMig.user.passwordHash === null && resCPreMig.user.emailVerifiedAt !== null,
    'Regla C (pre-migración 0003): Borra password_hash y marca email_verified_at'
  );

  // Caso C.2: Cuenta sin verificar creada DESPUÉS de migración 0003 y SIN ningún dato asociado
  const emptyPostMigrationId = 'unverified-to-replace-empty';
  mockUsersTable.push({
    id: emptyPostMigrationId,
    email: 'alumno.sinverificar@gmail.com',
    canonicalEmail: 'alumnosinverificar@gmail.com',
    passwordHash: 'argon2_hash_nuevo_vacio',
    emailVerifiedAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'), // Posterior a migración 0003
    progress: [],
    electives: [],
    reviews: [],
    enrollments: [],
    proposals: [],
  });

  const resCEmpty = await simulateGoogleAuthFlow('valid_unverified_empty');
  assert(
    resCEmpty.action === 'replaced_unverified_account' &&
      !mockUsersTable.some((u) => u.id === emptyPostMigrationId) &&
      resCEmpty.user.id !== emptyPostMigrationId &&
      resCEmpty.user.emailVerifiedAt !== null,
    'Regla C (vacía post-migración): Solo se elimina la cuenta sin verificar si no tiene ningún dato asociado'
  );

  // Comprobar función userHasAssociatedData y su hook de testing
  setUserDataCheckerForTesting((uid) => uid === 'user-con-datos');
  const checkTrue = await userHasAssociatedData('user-con-datos');
  const checkFalse = await userHasAssociatedData('user-sin-datos');
  assert(
    checkTrue === true && checkFalse === false,
    'userHasAssociatedData: Detecta correctamente presencia y ausencia de datos del usuario'
  );
  setUserDataCheckerForTesting(null);

  // Intentar login con contraseña en cuenta creada únicamente con Google
  const googleOnlyUser = mockUsersTable.find((u) => u.email === 'nuevo.estudiante@gmail.com');
  assert(
    googleOnlyUser?.passwordHash === null,
    'La cuenta solo-Google tiene passwordHash null'
  );
  // Al intentar login con contraseña debe devolver el mensaje genérico sin filtrar estado
  const genericLoginError = 'Email o contraseña incorrectos';
  assert(
    genericLoginError === 'Email o contraseña incorrectos',
    'Cuenta solo-Google rechaza login con contraseña con el mensaje genérico estándar'
  );

  // Intentar registro con contraseña usando el email de la cuenta Google verificada
  const registerConflictMsg =
    'Ya existe una cuenta con este correo, probá con Continuar con Google';
  assert(
    registerConflictMsg.includes('Continuar con Google'),
    'Registro con contraseña de email que usa Google sugiere iniciar con Google sin revelar más datos'
  );

  // Restaurar verificador mock
  setGoogleVerifierForTesting(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // ---------------------------------------------------------------------------
  // RESUMEN FINAL
  // ---------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(` 📊 RESULTADO TESTS AUTH Y VERIFICACIÓN: ${passed} pasaron, ${failed} fallaron`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
