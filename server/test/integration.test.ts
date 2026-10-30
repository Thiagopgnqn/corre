import http from 'http';
import { app } from '../src/app.js';
import { pool, db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

interface SessionJar {
  accessToken?: string;
  refreshToken?: string;
}

function parseCookies(setCookieHeaders: string[]): SessionJar {
  const jar: SessionJar = {};
  for (const str of setCookieHeaders) {
    const parts = str.split(';')[0].split('=');
    const name = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    if (name === 'accessToken') jar.accessToken = val;
    if (name === 'refreshToken') jar.refreshToken = val;
  }
  return jar;
}

function formatCookieHeader(jar: SessionJar): string {
  const list: string[] = [];
  if (jar.accessToken) list.push(`accessToken=${jar.accessToken}`);
  if (jar.refreshToken) list.push(`refreshToken=${jar.refreshToken}`);
  return list.join('; ');
}

async function runTests() {
  console.log('======================================================');
  console.log(' 🧪 INICIANDO TESTS DE INTEGRACIÓN Y AISLAMIENTO');
  console.log('======================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}`;

  const clientOrigin = 'http://localhost:5173';

  async function api(
    method: string,
    endpoint: string,
    body?: any,
    jar?: SessionJar
  ): Promise<{ status: number; data: any; jar: SessionJar }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': clientOrigin,
    };

    if (jar) {
      const cookieStr = formatCookieHeader(jar);
      if (cookieStr) headers['Cookie'] = cookieStr;
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Node 18+ has getSetCookie()
    const rawSetCookies = (res.headers as any).getSetCookie
      ? (res.headers as any).getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie')!]
      : [];

    const newCookies = parseCookies(rawSetCookies);
    const updatedJar: SessionJar = {
      accessToken: newCookies.accessToken || jar?.accessToken,
      refreshToken: newCookies.refreshToken || jar?.refreshToken,
    };

    const data = await res.json().catch(() => null);
    return { status: res.status, data, jar: updatedJar };
  }

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ ${testName}${detail ? `: ${detail}` : ''}`);
      failed++;
    }
  }

  const timestamp = Date.now();
  const emailA = `test_user_a_${timestamp}@example.com`;
  const emailB = `test_user_b_${timestamp}@example.com`;
  const passwordValid = 'Password123#';
  const passwordWeak = '12345';

  let jarA: SessionJar = {};
  let jarB: SessionJar = {};

  try {
    // -------------------------------------------------------------------------
    // 1. REGISTRO Y VALIDACIONES
    // -------------------------------------------------------------------------
    console.log('📌 1. Pruebas de Registro y Validación');

    // 1.1 Rechazo de contraseña débil (< 8 caracteres)
    const regWeak = await api('POST', '/api/auth/register', {
      email: emailA,
      password: passwordWeak,
    });
    assert(
      regWeak.status === 400 && regWeak.data.error.includes('al menos 8 caracteres'),
      'Rechazo de registro con contraseña débil (< 8 caracteres)'
    );

    // 1.2 Rechazo de email inválido
    const regBadEmail = await api('POST', '/api/auth/register', {
      email: 'notanemail',
      password: passwordValid,
    });
    assert(
      regBadEmail.status === 400,
      'Rechazo de registro con formato de email inválido'
    );

    // 1.3 Registro exitoso de Usuario A
    const regA = await api('POST', '/api/auth/register', {
      email: emailA,
      password: passwordValid,
    });
    jarA = regA.jar;
    assert(
      regA.status === 201 && regA.data.user?.email === emailA && !!jarA.accessToken && !!jarA.refreshToken,
      'Registro exitoso de Usuario A con emisión de tokens HttpOnly'
    );

    // 1.4 Rechazo de email duplicado (case-insensitive)
    const regDup = await api('POST', '/api/auth/register', {
      email: emailA.toUpperCase(),
      password: passwordValid,
    });
    assert(
      regDup.status === 409,
      'Rechazo de registro con email duplicado (409 Conflict)'
    );

    // 1.5 Registro exitoso de Usuario B
    const regB = await api('POST', '/api/auth/register', {
      email: emailB,
      password: passwordValid,
    });
    jarB = regB.jar;
    assert(
      regB.status === 201 && regB.data.user?.email === emailB,
      'Registro exitoso de Usuario B'
    );

    // -------------------------------------------------------------------------
    // 2. LOGIN Y CREDENCIALES
    // -------------------------------------------------------------------------
    console.log('\n📌 2. Pruebas de Inicio de Sesión (Login)');

    // 2.1 Login con contraseña errónea
    const logBad = await api('POST', '/api/auth/login', {
      email: emailA,
      password: 'WrongPassword999',
    });
    assert(
      logBad.status === 401 && logBad.data.error.includes('Email o contraseña incorrectos'),
      'Rechazo de login incorrecto con mensaje genérico seguro'
    );

    // 2.2 Login exitoso con Usuario A
    const logA = await api('POST', '/api/auth/login', {
      email: emailA,
      password: passwordValid,
    });
    jarA = logA.jar;
    assert(
      logA.status === 200 && logA.data.user?.email === emailA,
      'Login exitoso con Usuario A'
    );

    // 2.3 Acceso a /api/me con token de Usuario A
    const meA = await api('GET', '/api/me', undefined, jarA);
    assert(
      meA.status === 200 && meA.data.user?.email === emailA,
      'Ruta /api/me devuelve perfil correcto del usuario autenticado'
    );

    // -------------------------------------------------------------------------
    // 3. REFRESH TOKEN: ROTACIÓN, GRACIA Y DETECCIÓN DE REUTILIZACIÓN
    // -------------------------------------------------------------------------
    console.log('\n📌 3. Pruebas de Refresh Token, Rotación y Seguridad');

    const firstRefreshToken = jarA.refreshToken!;

    // 3.1 Refresco exitoso y rotación
    const ref1 = await api('POST', '/api/auth/refresh', undefined, jarA);
    const rotatedJarA = ref1.jar;
    assert(
      ref1.status === 200 &&
      !!rotatedJarA.refreshToken &&
      rotatedJarA.refreshToken !== firstRefreshToken,
      'Refresh exitoso rota el token emitiendo un nuevo refreshToken'
    );

    // 3.2 Ventana de gracia (20 segundos): el token recién rotado aún es aceptado para pestañas concurrentes
    const refGrace = await api('POST', '/api/auth/refresh', undefined, { refreshToken: firstRefreshToken });
    assert(
      refGrace.status === 200,
      'Ventana de gracia permite renovación concurrente con el token anterior'
    );

    // -------------------------------------------------------------------------
    // 4. AISLAMIENTO ESTRICTO MULTI-USUARIO (TENANT ISOLATION)
    // -------------------------------------------------------------------------
    console.log('\n📌 4. Pruebas de Aislamiento Estricto entre Usuarios');

    // 4.1 Usuario A guarda progreso en Materia 1 (Álgebra) con nota 9
    const progA = await api('PUT', '/api/progress/1', { status: 'aprobada', grade: 9 }, jarA);
    assert(
      progA.status === 200 && progA.data.data?.status === 'aprobada',
      'Usuario A guarda progreso en Materia 1 (aprobada, nota 9)'
    );

    // 4.2 Usuario A crea una propuesta de horario
    const propA = await api(
      'POST',
      '/api/schedule/proposals',
      {
        name: 'Propuesta Secreta Usuario A',
        selections: { '1': '1K1' },
      },
      jarA
    );
    const proposalA_Id = propA.data.data?.id;
    assert(
      propA.status === 201 && !!proposalA_Id,
      'Usuario A crea propuesta de horarios'
    );

    // 4.3 Usuario A modifica su configuración
    await api('PUT', '/api/settings', { minPassingGrade: 6, soundEnabled: false }, jarA);

    // 4.4 Usuario B consulta su estado (/api/state) y verifica que NO ve los datos de Usuario A
    const stateB = await api('GET', '/api/state', undefined, jarB);
    const userB_Progress1 = stateB.data.data?.progress?.[1];
    const userB_Proposals = stateB.data.data?.scheduleProposals || [];
    const userB_Settings = stateB.data.data?.settings;

    assert(
      userB_Progress1 === undefined,
      'Aislamiento de Progreso: Usuario B NO tiene acceso al avance de Usuario A'
    );
    assert(
      !userB_Proposals.some((p: any) => p.name === 'Propuesta Secreta Usuario A'),
      'Aislamiento de Horarios: Usuario B NO ve las propuestas de Usuario A'
    );
    assert(
      userB_Settings?.minPassingGrade === 4 && userB_Settings?.soundEnabled === true,
      'Aislamiento de Ajustes: Configuraciones de Usuario A no contaminan a Usuario B'
    );

    // 4.5 Usuario B intenta borrar la propuesta de horario de Usuario A
    const delHack = await api('DELETE', `/api/schedule/proposals/${proposalA_Id}`, undefined, jarB);
    assert(
      delHack.status === 200, // API responde pero la query está acotada por userId
      'Petición de eliminación procesada'
    );

    // Verificar que la propuesta de Usuario A sigue existiendo intacta
    const proposalsA = await api('GET', '/api/schedule/proposals', undefined, jarA);
    const stillExists = (proposalsA.data.data || []).some((p: any) => p.id === proposalA_Id);
    assert(
      stillExists,
      'Seguridad de Borrado: Usuario B NO pudo eliminar la propuesta de Usuario A'
    );

    // 4.6 Usuario B actualiza su propio progreso en Materia 1 como 'cursando'
    await api('PUT', '/api/progress/1', { status: 'cursando' }, jarB);

    // Verificar que Usuario A sigue teniendo 'aprobada' con nota 9
    const stateA = await api('GET', '/api/state', undefined, jarA);
    assert(
      stateA.data.data?.progress?.[1]?.status === 'aprobada' &&
      stateA.data.data?.progress?.[1]?.grade === 9,
      'Integridad: El cambio de Usuario B no alteró el progreso de Usuario A'
    );

    // -------------------------------------------------------------------------
    // 5. LIMPIEZA CASCADA
    // -------------------------------------------------------------------------
    console.log('\n📌 5. Limpieza de Usuarios de Prueba (Cascada ON DELETE)');
    const delA = await api('DELETE', '/api/me', undefined, jarA);
    const delB = await api('DELETE', '/api/me', undefined, jarB);
    assert(delA.status === 200 && delB.status === 200, 'Cuentas de prueba eliminadas correctamente');
  } catch (error) {
    console.error('Error durante la ejecución de tests:', error);
    failed++;
  } finally {
    // Limpieza de seguridad en la BD si algo falló
    await db.delete(users).where(eq(users.email, emailA)).catch(() => {});
    await db.delete(users).where(eq(users.email, emailB)).catch(() => {});

    server.close();
    await pool.end();
  }

  console.log('\n======================================================');
  console.log(` 🏁 RESULTADO FINAL: ${passed} pasados, ${failed} fallados`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();

