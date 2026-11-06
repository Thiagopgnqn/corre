/**
 * Verificación integral y automatizada con Edge CDP para:
 * PARTE A: Tutorial interactivo (16 pasos en mobile, 17 en desktop) en 5 viewports
 * PARTE B: Biblioteca SubjectLibraryView en columna sin desborde
 * PARTE C: Carteles de Comunidad (C1 Bienvenida en BottomSheet/Modal y C2 Toast flotante)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_verify_abc');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

const PORT_SERVER = 8092;
const PORT_CDP = 9232;

console.log('1. Iniciando servidor Mock Python en puerto', PORT_SERVER);
const serverProc = spawn('python', [
  path.join(process.cwd(), 'scripts', 'mobile-check', 'mock-server.py'),
  String(PORT_SERVER),
  path.resolve('dist'),
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 1200));

console.log('2. Iniciando Edge CDP en puerto', PORT_CDP);
const edgeProc = spawn(EDGE_PATH, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-fre',
  '--disable-sync',
  `--remote-debugging-port=${PORT_CDP}`,
  `--user-data-dir=${PROFILE_DIR}`,
  '--window-size=1280,800',
  `http://127.0.0.1:${PORT_SERVER}/`,
]);

async function getWsUrl() {
  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT_CDP}/json`);
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error('No se pudo conectar a CDP');
}

async function run() {
  try {
    const wsUrl = await getWsUrl();
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

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        pending.set(id, (res) => resolve(res));
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: PROFILE_DIR });

    async function evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return res?.result?.result?.value;
    }

    async function waitForElement(selector, timeoutMs = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (found) return true;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    }

    async function capture(filename) {
      const res = await send('Page.captureScreenshot', { format: 'png' });
      const b64 = res?.result?.data || res?.data;
      if (!b64) return;
      const buffer = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(ARTIFACTS_DIR, filename), buffer);
      console.log(`  📸 [Captura] ${filename} (${buffer.length} bytes)`);
    }

    async function setViewport(width, height, isMobileDevice = true) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: isMobileDevice,
      });
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log('Esperando montaje completo de la aplicación...');
    await waitForElement('main');
    console.log('Aplicación montada.');

    // ---------------------------------------------------------------------------------
    // PARTE A: VERIFICACIÓN MULTI-VIEWPORT DEL TUTORIAL INTERACTIVO
    // ---------------------------------------------------------------------------------
    console.log('\n=== PARTE A: VERIFICACIÓN DEL TUTORIAL (16/17 PASOS) ===');
    const viewportsToTest = [
      { name: '360x640', w: 360, h: 640 },
      { name: '411x740 (visual 630)', w: 411, h: 740, visualH: 630 },
      { name: '640x360 (landscape)', w: 640, h: 360 },
      { name: '820x1180 (tablet)', w: 820, h: 1180 },
      { name: '1280x800 (desktop)', w: 1280, h: 800 },
    ];

    const tutorialResultsByViewport = {};

    for (const vp of viewportsToTest) {
      console.log(`\nProbando viewport ${vp.name}...`);
      await setViewport(vp.w, vp.h, vp.w < 768);

      if (vp.visualH) {
        await send('Emulation.setVisibleSize', { width: vp.w, height: vp.visualH });
      }

      // Asegurar hash raíz del grafo
      await evaluate(`window.location.hash = 'graph';`);
      await new Promise((r) => setTimeout(r, 400));

      // Iniciar tutorial
      await evaluate(`
        if (typeof window.__startTutorial === 'function') {
          window.__startTutorial(0);
        }
      `);
      await waitForElement('[data-tour="tutorial-card"]', 4000);
      const isTutorialActive = await evaluate(`Boolean(document.querySelector('[data-tour="tutorial-card"]'))`);
      console.log(`Tutorial iniciado en ${vp.name}:`, isTutorialActive);

      const stepsResult = [];
      const numSteps = vp.w < 1024 ? 16 : 17;

      for (let stepIdx = 0; stepIdx < numSteps; stepIdx++) {
        await evaluate(`
          if (typeof window.__startTutorial === 'function') {
            window.__startTutorial(${stepIdx});
          }
        `);
        // Esperar rAF y animaciones de framer-motion
        await new Promise((r) => setTimeout(r, 850));

        const metrics = await evaluate(`
          (() => {
            const cardEl = document.querySelector('[data-tour="tutorial-card"]');
            const ringEl = document.querySelector('[data-tour="tutorial-spotlight-ring"]');
            const titleEl = cardEl ? cardEl.querySelector('h3') : null;
            const title = titleEl ? titleEl.textContent.trim() : 'Sin título';

            const cardRect = cardEl ? {
              top: Math.round(cardEl.getBoundingClientRect().top),
              bottom: Math.round(cardEl.getBoundingClientRect().bottom),
              left: Math.round(cardEl.getBoundingClientRect().left),
              right: Math.round(cardEl.getBoundingClientRect().right),
              width: Math.round(cardEl.getBoundingClientRect().width),
              height: Math.round(cardEl.getBoundingClientRect().height),
            } : null;

            const ringRect = ringEl ? {
              top: Math.round(ringEl.getBoundingClientRect().top),
              bottom: Math.round(ringEl.getBoundingClientRect().bottom),
              left: Math.round(ringEl.getBoundingClientRect().left),
              right: Math.round(ringEl.getBoundingClientRect().right),
              width: Math.round(ringEl.getBoundingClientRect().width),
              height: Math.round(ringEl.getBoundingClientRect().height),
            } : null;

            // Chequeo de pantalla negra
            const bgRect = document.querySelector('svg > rect:last-child');
            const bgFill = bgRect ? bgRect.getAttribute('fill') : null;
            const isBlackScreen = !cardEl || (bgFill === 'rgba(2, 6, 23, 0.78)' && !ringEl);

            let verticalDistance = null;
            let overlap = false;

            if (cardRect && ringRect) {
              if (cardRect.top >= ringRect.bottom) {
                verticalDistance = cardRect.top - ringRect.bottom;
              } else if (cardRect.bottom <= ringRect.top) {
                verticalDistance = ringRect.top - cardRect.bottom;
              } else {
                overlap = true;
                verticalDistance = -Math.min(cardRect.bottom - ringRect.top, ringRect.bottom - cardRect.top);
              }
            }

            return {
              stepIndex: ${stepIdx + 1},
              title,
              cardRect,
              ringRect,
              verticalDistance,
              overlap,
              isBlackScreen,
            };
          })()
        `);

        stepsResult.push(metrics);

        // Guardar capturas para los pasos clave en 411x740
        if (vp.w === 411 && (stepIdx + 1 === 5 || stepIdx + 1 === 9 || stepIdx + 1 === 10 || stepIdx + 1 === 14)) {
          await capture(`verify_step_${stepIdx + 1}_411x740.png`);
        }
      }

      tutorialResultsByViewport[vp.name] = stepsResult;
    }

    // Cerrar tutorial
    await evaluate(`
      const closeBtn = document.querySelector('[aria-label="Cerrar tutorial"]');
      if (closeBtn) closeBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 600));

    // ---------------------------------------------------------------------------------
    // PARTE B: BIBLIOTECA - VISTA DE MATERIA (SubjectLibraryView) A 411x740
    // ---------------------------------------------------------------------------------
    console.log('\n=== PARTE B: VERIFICACIÓN DE BIBLIOTECA (SubjectLibraryView) ===');
    await setViewport(411, 740, true);

    // Navegar a biblioteca catálogo
    await evaluate(`
      localStorage.setItem('stack:library-welcome-seen:anon', 'true');
      window.location.hash = 'library';
    `);
    await waitForElement('button h3');
    await new Promise((r) => setTimeout(r, 800));

    // Abrir la primera materia (#1 Análisis Matemático I)
    await evaluate(`
      const buttons = Array.from(document.querySelectorAll('button'));
      const subjectBtn = buttons.find(b => b.querySelector('h3') && b.textContent.includes('Análisis Matemático'));
      if (subjectBtn) subjectBtn.click();
      else if (buttons[0]) buttons[0].click();
    `);
    await waitForElement('input[placeholder*="Buscar por título"]');
    await new Promise((r) => setTimeout(r, 800));

    const libraryMetrics = await evaluate(`
      (() => {
        const searchInput = document.querySelector('input[placeholder*="Buscar por título"]');
        const searchRect = searchInput ? searchInput.getBoundingClientRect() : null;

        const solutionLabel = document.querySelector('label:has(input[type="checkbox"])');
        const solutionRect = solutionLabel ? solutionLabel.getBoundingClientRect() : null;

        const sortSelect = document.querySelector('#sort-select') || document.querySelector('select');
        const sortRect = sortSelect ? sortSelect.getBoundingClientRect() : null;
        const sortFontSize = sortSelect ? window.getComputedStyle(sortSelect).fontSize : null;

        const chipsContainer = document.querySelector('[role="region"][aria-label*="Filtrar por tipo"]') ||
                              document.querySelector('.snap-x');
        const chipsScrollWidth = chipsContainer ? chipsContainer.scrollWidth : null;
        const chipsClientWidth = chipsContainer ? chipsContainer.clientWidth : null;

        const fadeEl = document.querySelector('.bg-gradient-to-l');

        return {
          searchWidth: searchRect ? Math.round(searchRect.width) : 0,
          searchFullWidth: searchRect ? searchRect.width >= 350 : false,
          solutionTouchTargetHeight: solutionRect ? Math.round(solutionRect.height) : 0,
          solutionTouchTargetOk: solutionRect ? solutionRect.height >= 44 : false,
          sortSelectWidth: sortRect ? Math.round(sortRect.width) : 0,
          sortSelectFullWidth: sortRect ? sortRect.width >= 350 : false,
          sortSelectFontSize: sortFontSize,
          chipsScrollWidth,
          chipsClientWidth,
          chipsHasOverflow: chipsScrollWidth > chipsClientWidth,
          hasGradientFade: Boolean(fadeEl),
          totalWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      })()
    `);

    console.log('Métricas de SubjectLibraryView 411x740:', JSON.stringify(libraryMetrics, null, 2));
    await capture('verify_subject_library_411x740.png');

    // ---------------------------------------------------------------------------------
    // PARTE C: CARTELES DE COMUNIDAD (C1 Bienvenida & C2 Descarga)
    // ---------------------------------------------------------------------------------
    console.log('\n=== PARTE C: VERIFICACIÓN DE CARTELES DE COMUNIDAD ===');

    // C1: Probar Cartel de Bienvenida en 411x740 (Mobile -> BottomSheet)
    await evaluate(`
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('stack:library-welcome-seen')) localStorage.removeItem(k);
      });
      window.location.hash = 'library';
      window.location.reload();
    `);
    await waitForElement('#library-welcome-title');
    await new Promise((r) => setTimeout(r, 600));

    const welcomeMobileMetrics = await evaluate(`
      (() => {
        const sheetEl = document.querySelector('[role="dialog"]:has(#library-welcome-title)') ||
                        document.querySelector('[role="dialog"]');
        const titleEl = document.querySelector('#library-welcome-title');
        const uploadBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Subir un archivo'));
        const nowNotBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Ahora no'));

        const isBottomSheet = Boolean(sheetEl && (sheetEl.classList.contains('fixed') || sheetEl.closest('.fixed')));

        return {
          hasWelcomeModal: Boolean(titleEl),
          titleText: titleEl ? titleEl.textContent.trim() : null,
          hasUploadButton: Boolean(uploadBtn),
          hasNowNotButton: Boolean(nowNotBtn),
          isBottomSheet,
          bottomSheetRect: sheetEl ? sheetEl.getBoundingClientRect() : null,
        };
      })()
    `);
    console.log('Métricas de Cartel de Bienvenida en Mobile:', JSON.stringify(welcomeMobileMetrics, null, 2));
    await capture('verify_welcome_banner_mobile_411x740.png');

    // Cerrar cartel de bienvenida con "Ahora no"
    await evaluate(`
      const nowNotBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Ahora no'));
      if (nowNotBtn) nowNotBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 600));

    const welcomeDismissedSeenKey = await evaluate(`
      Object.keys(localStorage).find(k => k.startsWith('stack:library-welcome-seen'))
    `);
    console.log('Clave localStorage guardada tras "Ahora no":', welcomeDismissedSeenKey);

    // C2: Probar Cartel de Descarga en 411x740 (Flotante sobre BottomNav)
    // Entrar a materia y disparar descarga
    await waitForElement('button h3');
    await evaluate(`
      const card = Array.from(document.querySelectorAll('button')).find(b => b.querySelector('h3'));
      if (card) card.click();
    `);
    await waitForElement('input[placeholder*="Buscar por título"]');
    await waitForElement('button:has(svg.lucide-download)', 4000);
    await new Promise((r) => setTimeout(r, 600));

    // Click en botón de descarga
    await evaluate(`
      const dlBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Descargar'));
      if (dlBtn) dlBtn.click();
    `);
    await waitForElement('aside[role="status"]', 4000);
    await new Promise((r) => setTimeout(r, 600));

    const toastMetrics = await evaluate(`
      (() => {
        const toastEl = document.querySelector('aside[role="status"]');
        const navEl = document.querySelector('nav.fixed.bottom-0');
        const navRect = navEl ? navEl.getBoundingClientRect() : null;
        const toastRect = toastEl ? toastEl.getBoundingClientRect() : null;

        return {
          toastPresent: Boolean(toastEl),
          toastTitle: toastEl ? toastEl.querySelector('h3')?.textContent.trim() : null,
          toastBottomCss: toastEl ? window.getComputedStyle(toastEl).bottom : null,
          toastRect: toastRect ? {
            top: Math.round(toastRect.top),
            bottom: Math.round(toastRect.bottom),
            left: Math.round(toastRect.left),
            right: Math.round(toastRect.right),
            width: Math.round(toastRect.width),
            height: Math.round(toastRect.height),
          } : null,
          navRect: navRect ? {
            top: Math.round(navRect.top),
            bottom: Math.round(navRect.bottom),
            left: Math.round(navRect.left),
            right: Math.round(navRect.right),
            width: Math.round(navRect.width),
            height: Math.round(navRect.height),
          } : null,
          clearanceAboveNav: (toastRect && navRect) ? Math.round(navRect.top - toastRect.bottom) : null,
          ariaLive: toastEl ? toastEl.getAttribute('aria-live') : null,
        };
      })()
    `);
    console.log('Métricas de Cartel de Descarga en Mobile:', JSON.stringify(toastMetrics, null, 2));
    await capture('verify_download_toast_mobile_411x740.png');

    // Guardar reporte JSON global
    const fullReport = {
      tutorialResultsByViewport,
      libraryMetrics,
      welcomeMobileMetrics,
      welcomeDismissedSeenKey,
      toastMetrics,
    };

    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'verification_report_abc.json'),
      JSON.stringify(fullReport, null, 2),
      'utf8'
    );
    console.log('\nReporte guardado exitosamente en verification_report_abc.json');

    ws.close();
  } catch (err) {
    console.error('Error durante la verificación:', err);
  } finally {
    try {
      edgeProc.kill();
      serverProc.kill();
    } catch {}
    process.exit(0);
  }
}

run();
