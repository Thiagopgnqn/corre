/**
 * Script de verificación móvil con Chrome DevTools Protocol (CDP).
 * Ejecuta pruebas visuales automatizadas en Edge headless contra el servidor mock local.
 * Verifica desbordes horizontales reales comparando contra el targetWidth exacto
 * fijado por Emulation.setDeviceMetricsOverride (NO contra window.innerWidth).
 *
 * Requisitos estrictos de Parte 0.9:
 * a. Set width with Emulation.setDeviceMetricsOverride y compara contra requested width.
 * b. Revisa todos los elementos visibles en el DOM: si rect.right > targetWidth + 1.5 o rect.left < -1.5
 *    sin ancestro intencionalmente scrollable (overflow-x: auto|scroll), marca FAIL y lista culpables con selector, rect y clases.
 * c. Revisa ancestros con overflow: hidden|clip donde scrollWidth > clientWidth + 1.5 (contenido recortado).
 * d. Usa datos sintéticos realistas provistos por mock-server.py.
 * e. Mide todas las pantallas requeridas en 320x568, 360x640, 412x740 y 640x360.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_cdp_profile');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log('1. Iniciando servidor Mock Python en puerto 8080...');
const serverProc = spawn('python', [path.join(SCRIPT_DIR, 'mock-server.py')], {
  stdio: 'ignore'
});

await new Promise((r) => setTimeout(r, 1500));

console.log('2. Iniciando Microsoft Edge con CDP en puerto 9222...');
const edgeProc = spawn(EDGE_PATH, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-fre',
  '--disable-sync',
  '--remote-debugging-port=9222',
  `--user-data-dir=${PROFILE_DIR}`,
  '--window-size=1280,800',
  'http://127.0.0.1:8080/',
]);

async function getWsUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No se pudo conectar a CDP en el puerto 9222');
}

async function main() {
  const wsUrl = await getWsUrl();
  console.log('Conectado a CDP:', wsUrl);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => (ws.onopen = resolve));

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.result?.value;
  };

  const capture = async (filename) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const b64 = res?.data || res?.result?.data;
    if (!b64) return;
    const buffer = Buffer.from(b64, 'base64');
    const outPath = path.join(ARTIFACTS_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`  📸 [Captura] ${filename} (${buffer.length} bytes)`);
  };

  const setViewport = async (width, height, isMobileDevice = true) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobileDevice,
      screenOrientation: width > height ? { angle: 90, type: 'landscapePrimary' } : { angle: 0, type: 'portraitPrimary' }
    });
    await new Promise((r) => setTimeout(r, 450));
  };

  const measurements = [];

  const checkOverflow = async (label, targetWidth, targetHeight) => {
    const m = await evaluate(`
      (() => {
        const bodyW = document.body ? document.body.scrollWidth : 0;
        const docW = document.documentElement ? document.documentElement.scrollWidth : 0;
        const maxScroll = Math.max(bodyW, docW);
        const innerW = window.innerWidth;
        const targetW = ${targetWidth};

        const isScrollable = (el) => {
          let cur = el;
          while (cur && cur !== document.body && cur !== document.documentElement) {
            const style = window.getComputedStyle(cur);
            const ox = style.overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
            cur = cur.parentElement;
          }
          return false;
        };

        const allElements = Array.from(document.querySelectorAll('*'));
        const overflowingElements = [];
        const clippedElements = [];

        for (const el of allElements) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          // b. Element extends beyond viewport bounds without an intentionally scrollable ancestor
          if ((rect.right > targetW + 1.5 || rect.left < -1.5) && !isScrollable(el)) {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? '#' + el.id : '';
            const cls = el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
              : '';
            overflowingElements.push({
              selector: tag + id + cls,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width)
            });
          }

          // c. Ancestor with overflow: hidden or clip where scrollWidth > clientWidth + 1.5
          if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1.5) {
            if (el !== document.documentElement && el !== document.body) {
              const tag = el.tagName.toLowerCase();
              const id = el.id ? '#' + el.id : '';
              const cls = el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
                : '';
              clippedElements.push({
                selector: tag + id + cls,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                diff: el.scrollWidth - el.clientWidth
              });
            }
          }
        }

        const globalOverflow = maxScroll > targetW + 1 || innerW > targetW + 1;
        const hasOverflow = globalOverflow || overflowingElements.length > 0;

        return {
          label: '${label}',
          targetW,
          maxScroll,
          innerW,
          globalOverflow,
          overflowingElements: overflowingElements.slice(0, 5),
          clippedElements: clippedElements.slice(0, 5),
          hasOverflow
        };
      })()
    `);

    const status = m?.hasOverflow ? 'FAIL' : 'PASS';
    const statusIcon = m?.hasOverflow
      ? `❌ FAIL: DESBORDE (${m.overflowingElements.length} elementos fuera de límites)`
      : '✅ PASS';

    console.log(`  [Overflow Check] ${label}: target=${m?.targetW}px, scrollWidth=${m?.maxScroll}px, innerWidth=${m?.innerW}px => ${statusIcon}`);
    if (m?.overflowingElements?.length > 0) {
      console.log('    ⚠️ Culpables de desborde:', JSON.stringify(m.overflowingElements));
    }
    if (m?.clippedElements?.length > 0) {
      console.log('    ℹ️ Contenido recortado (overflow:hidden):', JSON.stringify(m.clippedElements));
    }

    measurements.push({
      label,
      targetWidth,
      targetHeight,
      scrollWidth: m?.maxScroll,
      innerWidth: m?.innerW,
      overflowingCount: m?.overflowingElements?.length || 0,
      clippedCount: m?.clippedElements?.length || 0,
      status,
    });

    return m;
  };

  const navigateTo = async (hash) => {
    await evaluate(`window.location.hash = '${hash}';`);
    await new Promise((r) => setTimeout(r, 850));
  };

  console.log('\n======================================================');
  console.log(' SECCIÓN 1: MEDICIÓN EN VIEWPORTS MÓVILES (320, 360, 412, 640x360)');
  console.log('======================================================');

  const mobileViewports = [
    { w: 320, h: 568, label: '320x568' },
    { w: 360, h: 640, label: '360x640' },
    { w: 412, h: 740, label: '412x740' },
    { w: 640, h: 360, label: '640x360' },
  ];

  for (const vp of mobileViewports) {
    console.log(`\n--- Evaluando Viewport ${vp.label} ---`);
    await setViewport(vp.w, vp.h, true);

    // 1. Mapa (Vista Grafo)
    await evaluate(`localStorage.setItem('ui_mobile_graph_view', 'graph');`);
    await navigateTo('#graph');
    await checkOverflow(`Mapa Grafo (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_mapa_360.png');
    if (vp.w === 412) await capture('screenshot_mobile_mapa_412.png');
    if (vp.w === 640) await capture('screenshot_fase5_landscape_640x360.png');

    // 2. Mapa (Vista Lista)
    await evaluate(`localStorage.setItem('ui_mobile_graph_view', 'list');`);
    await navigateTo('#graph');
    await checkOverflow(`Mapa Lista (${vp.label})`, vp.w, vp.h);

    // 3. Horarios (Modo Por Día)
    await navigateTo('#schedule');
    await evaluate(`
      const btns = Array.from(document.querySelectorAll('button'));
      const mh = btns.find(b => b.textContent && b.textContent.includes('Mi Horario'));
      if (mh) mh.click();
      const pd = btns.find(b => b.textContent && b.textContent.includes('Por Día'));
      if (pd) pd.click();
    `);
    await new Promise((r) => setTimeout(r, 600));
    await checkOverflow(`Horarios Por Día (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_horarios_pordia_360.png');
    if (vp.w === 412) await capture('screenshot_mobile_horarios_pordia_412.png');

    // 4. Horarios (Modo Comisiones)
    await evaluate(`
      const btns = Array.from(document.querySelectorAll('button'));
      const com = btns.find(b => b.textContent && b.textContent.includes('Comisiones'));
      if (com) com.click();
    `);
    await new Promise((r) => setTimeout(r, 600));
    await checkOverflow(`Horarios Comisiones (${vp.label})`, vp.w, vp.h);

    // 5. Kanban
    await navigateTo('#kanban');
    await checkOverflow(`Kanban (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_kanban_360.png');

    // 6. Planificador de Cuatrimestre
    await navigateTo('#planner');
    await checkOverflow(`Cuatrimestre (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_planner_360.png');

    // 7. Electivas
    await navigateTo('#electives');
    await checkOverflow(`Electivas (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_electives_360.png');

    // 8. Estadísticas
    await navigateTo('#stats');
    await checkOverflow(`Estadísticas (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_stats_360.png');
    if (vp.w === 412) await capture('screenshot_mobile_stats_412.png');

    // 9. Profesores y Reseñas
    await navigateTo('#professors');
    await checkOverflow(`Profesores (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_professors_360.png');

    // 10. Biblioteca (Home)
    await navigateTo('#library');
    await checkOverflow(`Biblioteca Home (${vp.label})`, vp.w, vp.h);
    if (vp.w === 360) await capture('screenshot_mobile_library_home_360.png');
    if (vp.w === 412) await capture('screenshot_mobile_library_home_412.png');

    // 11. Biblioteca (Mis Aportes)
    await navigateTo('#library/my-uploads');
    await checkOverflow(`Biblioteca Mis Aportes (${vp.label})`, vp.w, vp.h);

    // 12. Biblioteca (Términos)
    await navigateTo('#library/terms');
    await checkOverflow(`Biblioteca Términos (${vp.label})`, vp.w, vp.h);
  }

  console.log('\n======================================================');
  console.log(' SECCIÓN 2: TABLETS (768, 820) Y DESKTOP (900, 1280)');
  console.log('======================================================');

  // 1. 768 px iPad Touch
  await setViewport(768, 1024, true);
  await navigateTo('#graph');
  await checkOverflow('Tablet 768px Touch Navbar (#graph)', 768, 1024);
  await capture('screenshot_tablet_navbar_touch_768.png');

  // 2. 820 px iPad Air Touch
  await setViewport(820, 1180, true);
  await checkOverflow('Tablet 820px Touch Navbar (#graph)', 820, 1180);
  await capture('screenshot_tablet_navbar_touch_820.png');

  // 3. 900 px Desktop
  await setViewport(900, 600, false);
  await checkOverflow('Desktop 900x600 (#graph)', 900, 600);

  // 4. 1280 px Desktop
  await setViewport(1280, 800, false);
  await checkOverflow('Desktop 1280x800 (#graph)', 1280, 800);

  console.log('\n======================================================');
  console.log(' SECCIÓN 3: AUTENTICACIÓN Y ADMIN EN 320px Y 360px');
  console.log('======================================================');

  // Admin en 360x640
  await setViewport(360, 640, true);
  await navigateTo('#admin');
  await checkOverflow('Admin Overview (360x640)', 360, 640);
  await capture('screenshot_fase5_admin_overview_360.png');

  // Auth en 320x568 y 360x640
  await evaluate(`
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'http://127.0.0.1:8080/';
  `);
  await new Promise((r) => setTimeout(r, 1200));

  await setViewport(320, 568, true);
  await checkOverflow('AuthScreen (320x568)', 320, 568);
  await capture('screenshot_fase5_auth_320.png');

  await setViewport(360, 640, true);
  await checkOverflow('AuthScreen (360x640)', 360, 640);
  await capture('screenshot_fase5_auth_360.png');

  console.log('\n======================================================');
  console.log(' TABLA RESUMEN DE MEDICIONES CDP');
  console.log('======================================================');
  console.table(measurements);

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'cdp_measurements.json'),
    JSON.stringify(measurements, null, 2),
    'utf8'
  );

  console.log('\n🎉 ¡TODAS LAS MEDICIONES Y CAPTURAS FINALIZADAS CON ÉXITO!');
  ws.close();
  edgeProc.kill();
  serverProc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error durante ejecución CDP:', err);
  edgeProc.kill();
  serverProc.kill();
  process.exit(1);
});
