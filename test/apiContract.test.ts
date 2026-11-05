import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('API Contract Integrity: Frontend apiFetch vs Express Routes', () => {
  const rootDir = process.cwd();
  const apiDir = path.join(rootDir, 'src', 'api');
  const serverDir = path.join(rootDir, 'server', 'src');

  // 1. Extraer todas las llamadas apiFetch del frontend
  const clientFiles = fs.readdirSync(apiDir).filter(f => f.endsWith('.ts') && f !== 'client.ts');
  const clientCalls: Array<{ file: string; line: number; urlExpr: string; method: string }> = [];

  for (const file of clientFiles) {
    const content = fs.readFileSync(path.join(apiDir, file), 'utf-8');
    const lines = content.split('\n');

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.includes('apiFetch')) {
        let stmt = '';
        let j = i;
        while (j < lines.length && !stmt.includes(');')) {
          stmt += lines[j] + '\n';
          j++;
        }

        const afterFetch = stmt.slice(stmt.indexOf('apiFetch'));
        const openParen = afterFetch.indexOf('(');
        const argsPart = afterFetch.slice(openParen + 1);

        let urlExpr = '';
        let method = 'GET';

        const methodMatch = stmt.match(/method:\s*['"]([A-Z]+)['"]/);
        if (methodMatch) {
          method = methodMatch[1];
        }

        let quoteChar: string | null = null;
        let argStart = -1;
        let depth = 0;
        for (let k = 0; k < argsPart.length; k++) {
          const c = argsPart[k];
          if (quoteChar === null && (c === '`' || c === "'" || c === '"')) {
            quoteChar = c;
            argStart = k + 1;
          } else if (quoteChar !== null) {
            if (quoteChar === '`' && c === '$' && argsPart[k + 1] === '{') {
              depth++;
            } else if (quoteChar === '`' && depth > 0 && c === '}') {
              depth--;
            } else if (c === quoteChar && depth === 0) {
              urlExpr = argsPart.slice(argStart, k);
              break;
            }
          }
        }

        if (urlExpr && urlExpr.startsWith('/api')) {
          clientCalls.push({
            file: `src/api/${file}`,
            line: i + 1,
            urlExpr,
            method,
          });
        }
      }
      i++;
    }
  }

  // 2. Extraer rutas declaradas en Express (server/src)
  function getRouterRoutes(filePath: string, mountPrefix: string) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const routes: Array<{ method: string; path: string; file: string; line: number }> = [];

    const regex = /(?:router|instance|app|authRouter)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gs;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const subPath = match[2];
      const full = (mountPrefix === '/' ? '' : mountPrefix) + (subPath === '/' ? '' : subPath);
      const line = content.slice(0, match.index).split('\n').length;
      routes.push({
        method,
        path: full || '/',
        file: path.relative(rootDir, filePath),
        line,
      });
    }
    return routes;
  }

  const allServerRoutes = [
    ...getRouterRoutes(path.join(serverDir, 'app.ts'), ''),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'auth', 'auth.routes.ts'), '/api/auth'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'catalog', 'catalog.routes.ts'), '/api/catalog'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'professors', 'professors.routes.ts'), '/api/professors'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'reviews', 'reviews.routes.ts'), '/api/reviews'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'reviews', 'reviews.routes.ts'), '/api/admin'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'enrollments', 'enrollments.routes.ts'), '/api/enrollments'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'admin', 'admin.routes.ts'), '/api/admin'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'library', 'library.routes.ts'), '/api/library'),
    ...getRouterRoutes(path.join(serverDir, 'modules', 'user-state', 'userState.routes.ts'), '/api'),
  ];

  function resolveClientPath(urlExpr: string) {
    let str = urlExpr;
    str = str.replace(/\$\{(?:query|qs)\b[\s\S]*$/, '');
    str = str.replace(/\$\{[^}]+\}/g, 'SAMPLE_PARAM');
    str = str.split('?')[0];
    return str;
  }

  it('Todas las llamadas apiFetch del cliente deben tener un endpoint correspondiente en el servidor Express', () => {
    assert.ok(clientCalls.length > 0, 'Debe haber llamadas de cliente analizadas');
    assert.ok(allServerRoutes.length > 0, 'Debe haber rutas de servidor analizadas');

    const mismatches: Array<{ client: typeof clientCalls[0]; evaluated: string }> = [];

    for (const call of clientCalls) {
      const evaluated = resolveClientPath(call.urlExpr);

      const serverMatch = allServerRoutes.find(sr => {
        if (sr.method !== call.method) return false;
        const serverPattern = '^' + sr.path.replace(/:[a-zA-Z0-9_]+/g, '[^/?#]+') + '$';
        const reg = new RegExp(serverPattern);
        return reg.test(evaluated);
      });

      if (!serverMatch) {
        mismatches.push({ client: call, evaluated });
      }
    }

    assert.equal(
      mismatches.length,
      0,
      `Existen llamadas frontend sin ruta Express coincidente:\n${mismatches.map(m => ` - [${m.client.method}] ${m.client.urlExpr} -> ${m.evaluated} (${m.client.file}:${m.client.line})`).join('\n')}`
    );
  });

  it('Rutas canónicas /api/me y /api/state existen y están correctamente montadas en el backend', () => {
    const hasMe = allServerRoutes.some(r => r.method === 'GET' && r.path === '/api/me');
    const hasState = allServerRoutes.some(r => r.method === 'GET' && r.path === '/api/state');
    assert.ok(hasMe, 'Ruta /api/me debe estar definida en server/src/app.ts');
    assert.ok(hasState, 'Ruta /api/state debe estar definida vía userState.routes.ts montada en /api');

    // Comprobamos que rutas apócrifas como /api/user-state/state NO existan
    const hasFakeUserState = allServerRoutes.some(r => r.path.startsWith('/api/user-state'));
    assert.equal(hasFakeUserState, false, 'No debe existir prefijo apócrifo /api/user-state en el servidor');
  });
});

