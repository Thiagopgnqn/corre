import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_cdp_profile_audit');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log('1. Iniciando servidor Mock Python en puerto 8093...');
const serverProc = spawn('python', [
  path.join(process.cwd(), 'scripts', 'mobile-check', 'mock-server.py'),
  '8093',
  path.resolve('dist')
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 1500));

console.log('2. Iniciando Edge CDP en puerto 9233...');
const edgeProc = spawn(EDGE_PATH, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=9233',
  `--user-data-dir=${PROFILE_DIR}`,
  '--window-size=1280,800',
  'http://127.0.0.1:8093/',
]);

async function getWsUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9233/json');
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === 'page' && t.url && t.url.startsWith('http://127.0.0.1:8093'));
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
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
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, (res) => {
          if (res.error) reject(new Error(`${method} error: ${JSON.stringify(res.error)}`));
          else resolve(res.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    const downloadDir = path.join(process.cwd(), 'node_modules', '.tmp_downloads');
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
    await send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });

    async function evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return res?.result?.value;
    }

    async function setViewport(w, h, isMobile, visualH = null, fontScale = 1.0) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: isMobile,
      });
      if (visualH) {
        await send('Emulation.setVisibleSize', { width: w, height: visualH });
      } else {
        await send('Emulation.setVisibleSize', { width: w, height: h });
      }
      if (fontScale !== 1.0) {
        await evaluate(`document.documentElement.style.fontSize = '${Math.round(fontScale * 100)}%';`);
      } else {
        await evaluate(`document.documentElement.style.fontSize = '';`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    async function captureScreenshot(filename) {
      const res = await send('Page.captureScreenshot', { format: 'png' });
      const filepath = path.join(ARTIFACTS_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
      return filepath;
    }

    console.log('Esperando app...');
    await send('Page.navigate', { url: 'http://127.0.0.1:8093/#/' });
    await new Promise((r) => setTimeout(r, 2000));

    // =========================================================================
    // AUDITORÍA 1: MEDICIONES DE SubjectLibraryView CON ARCHIVOS REALISTAS (4.a)
    // =========================================================================
    console.log('\n--- AUDITORÍA 1: SubjectLibraryView (Anchos x Fuentes) ---');
    const libraryTestWidths = [320, 360, 411];
    const fontScales = [1.0, 1.15, 1.30, 1.50];
    const subjectLibraryMatrix = [];

    // Navigate to subject 1
    await evaluate(`window.location.hash = 'library/1';`);
    await new Promise((r) => setTimeout(r, 1000));

    for (const w of libraryTestWidths) {
      for (const scale of fontScales) {
        await setViewport(w, 740, true, null, scale);
        await new Promise((r) => setTimeout(r, 300));

        const m = await evaluate(`
          (() => {
            const sw = document.documentElement.scrollWidth;
            const iw = window.innerWidth;
            const searchInput = document.querySelector('input[placeholder*="Buscar por"]');
            const sortSelect = document.querySelector('select');
            const fileCards = Array.from(document.querySelectorAll('.rounded-2xl.border'));
            let maxCardW = 0;
            fileCards.forEach(c => {
              maxCardW = Math.max(maxCardW, c.getBoundingClientRect().width);
            });

            return {
              width: ${w},
              fontScale: ${scale},
              scrollWidth: sw,
              innerWidth: iw,
              overflowPx: Math.max(0, sw - ${w}),
              searchWidth: searchInput ? Math.round(searchInput.getBoundingClientRect().width) : 0,
              sortSelectWidth: sortSelect ? Math.round(sortSelect.getBoundingClientRect().width) : 0,
              maxCardWidth: Math.round(maxCardW)
            };
          })()
        `);
        subjectLibraryMatrix.push(m);
        console.log(`[SubjectView] ${w}px @ ${Math.round(scale*100)}% font -> scrollWidth: ${m.scrollWidth}px (Desborde: ${m.overflowPx}px)`);
      }
    }

    // =========================================================================
    // AUDITORÍA 2: VISTAS RESTANTES DE BIBLIOTECA CON FUENTE 130% (4.c)
    // =========================================================================
    console.log('\n--- AUDITORÍA 2: Portada, Mis Aportes, Términos y Modales (4.c) ---');
    await setViewport(411, 740, true, null, 1.30);
    const libraryViewsAudit = {};

    // 1. Portada
    await evaluate(`window.location.hash = 'library';`);
    await new Promise((r) => setTimeout(r, 800));
    libraryViewsAudit.portada = await evaluate(`
      (() => ({
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > 411,
        hasHeader: Boolean(document.querySelector('[data-tour="library-header"]')),
      }))()
    `);

    // 2. Mis Aportes
    await evaluate(`window.location.hash = 'library/my-uploads';`);
    await new Promise((r) => setTimeout(r, 800));
    libraryViewsAudit.myUploads = await evaluate(`
      (() => ({
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > 411,
        hasList: Boolean(document.querySelector('main')),
      }))()
    `);

    // 3. Términos
    await evaluate(`window.location.hash = 'library/terms';`);
    await new Promise((r) => setTimeout(r, 800));
    libraryViewsAudit.terms = await evaluate(`
      (() => ({
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > 411,
        hasEmail: !document.body.innerText.includes('frba'),
      }))()
    `);

    // 4. Modal de Subida
    await evaluate(`
      const uploadBtn = document.querySelector('button[title*="Subir"], button:has(svg)');
      // disparar modal de subida desde el hash de portada
      window.location.hash = 'library';
    `);
    await new Promise((r) => setTimeout(r, 600));
    await evaluate(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Subir Material'));
      if (btn) btn.click();
    `);
    await new Promise((r) => setTimeout(r, 600));
    libraryViewsAudit.uploadModal = await evaluate(`
      (() => {
        const modal = document.querySelector('[role="dialog"]') || document.querySelector('form');
        return {
          isOpen: Boolean(modal),
          scrollWidth: document.documentElement.scrollWidth,
          overflow: document.documentElement.scrollWidth > 411,
        };
      })()
    `);
    // Cerrar modal de subida
    await evaluate(`
      const closeBtn = document.querySelector('button[aria-label*="Cerrar"], button:has(.lucide-x)');
      if (closeBtn) closeBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    // 5. Modal de Reporte
    await evaluate(`window.location.hash = 'library/1';`);
    await new Promise((r) => setTimeout(r, 800));
    await evaluate(`
      const reportBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Reportar'));
      if (reportBtn) reportBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 600));
    libraryViewsAudit.reportModal = await evaluate(`
      (() => {
        const form = document.querySelector('form');
        const reasonSelect = form ? form.querySelector('select') : null;
        return {
          isOpen: Boolean(form),
          selectMinHeight: reasonSelect ? reasonSelect.getBoundingClientRect().height : 0,
          overflow: document.documentElement.scrollWidth > 411,
        };
      })()
    `);
    await evaluate(`
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Cancelar'));
      if (cancelBtn) cancelBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    // Reset root font size
    await evaluate(`document.documentElement.style.fontSize = '';`);

    // =========================================================================
    // AUDITORÍA 3: CARTELES DE COMUNIDAD (5)
    // =========================================================================
    console.log('\n--- AUDITORÍA 3: Carteles de Comunidad (5) ---');
    const bannersViewports = [
      { name: '320x568', w: 320, h: 568, isMobile: true },
      { name: '360x640', w: 360, h: 640, isMobile: true },
      { name: '411x740', w: 411, h: 740, isMobile: true },
      { name: '640x360', w: 640, h: 360, isMobile: true },
      { name: '1280x800', w: 1280, h: 800, isMobile: false },
      { name: '411x740_font130', w: 411, h: 740, isMobile: true, fontScale: 1.30 },
    ];

    const bannersAuditResults = [];

    for (const vp of bannersViewports) {
      await setViewport(vp.w, vp.h, vp.isMobile, null, vp.fontScale || 1.0);

      // Limpiar localStorage y navegar para disparar Bienvenida limpia
      await evaluate(`
        localStorage.removeItem('stack:library-welcome-seen:mock-admin-1');
        localStorage.removeItem('stack:library-welcome-seen:anon');
        window.location.hash = 'graph';
      `);
      await new Promise((r) => setTimeout(r, 400));
      await evaluate(`window.location.hash = 'library';`);
      await new Promise((r) => setTimeout(r, 800));

      const welcomeMetrics = await evaluate(`
        (() => {
          const titleEl = Array.from(document.querySelectorAll('h2')).find(h => h.textContent && h.textContent.includes('La Biblioteca la hacemos entre todos'));
          const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
            const t = b.textContent ? b.textContent.trim() : '';
            return t === 'Subir un archivo' || t === 'Ahora no' || b.getAttribute('aria-label') === 'Cerrar bienvenida';
          });
          const buttonMetrics = buttons.map(b => ({
            text: b.textContent?.trim() || b.getAttribute('aria-label'),
            width: Math.round(b.getBoundingClientRect().width),
            height: Math.round(b.getBoundingClientRect().height),
            touchTargetPass: b.getBoundingClientRect().height >= 44
          }));
          const termsLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent && a.textContent.includes('Términos'));

          return {
            titleFound: Boolean(titleEl),
            buttonMetrics,
            termsLinkFound: Boolean(termsLink),
            scrollWidth: document.documentElement.scrollWidth,
            overflow: document.documentElement.scrollWidth > ${vp.w}
          };
        })()
      `);

      if (vp.name === '411x740') {
        await captureScreenshot('verify_banner_welcome_411x740.png');
      }

      // Cerrar bienvenida
      await evaluate(`
        const ahoraNoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Ahora no'));
        if (ahoraNoBtn) ahoraNoBtn.click();
      `);
      await new Promise((r) => setTimeout(r, 500));

      // Ir a materia 1 y descargar un archivo para evaluar cartel de descarga
      await evaluate(`
        window.location.hash = 'graph';
      `);
      await new Promise((r) => setTimeout(r, 300));
      await evaluate(`
        window.location.hash = 'library/1';
      `);
      await new Promise((r) => setTimeout(r, 1200));

      await evaluate(`
        const dlBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Descargar'));
        if (dlBtn) dlBtn.click();
      `);
      await new Promise((r) => setTimeout(r, 1000));

      const downloadToastMetrics = await evaluate(`
        (() => {
          const toastEl = document.querySelector('aside[role="status"]');
          const navEl = document.querySelector('nav.fixed.bottom-0') ||
                        document.querySelector('nav[data-tour="nav-tabs"]') ||
                        Array.from(document.querySelectorAll('nav')).pop();
          const toastRect = toastEl ? {
            top: Math.round(toastEl.getBoundingClientRect().top),
            bottom: Math.round(toastEl.getBoundingClientRect().bottom),
            left: Math.round(toastEl.getBoundingClientRect().left),
            right: Math.round(toastEl.getBoundingClientRect().right),
            height: Math.round(toastEl.getBoundingClientRect().height),
          } : null;
          const navRect = navEl ? {
            top: Math.round(navEl.getBoundingClientRect().top),
            height: Math.round(navEl.getBoundingClientRect().height),
          } : null;

          const toastTitle = toastEl ? toastEl.querySelector('h3')?.textContent?.trim() : null;
          const uploadBtn = toastEl ? Array.from(toastEl.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Subir un archivo')) : null;
          const closeBtn = toastEl ? toastEl.querySelector('button[aria-label="Cerrar aviso"]') : null;

          let clearanceAboveNav = null;
          if (toastRect && navRect) {
            clearanceAboveNav = navRect.top - toastRect.bottom;
          }

          return {
            toastPresent: Boolean(toastEl),
            toastTitle,
            clearanceAboveNav,
            toastRect,
            navRect,
            uploadBtnHeight: uploadBtn ? Math.round(uploadBtn.getBoundingClientRect().height) : 0,
            closeBtnHeight: closeBtn ? Math.round(closeBtn.getBoundingClientRect().height) : 0,
            overflow: document.documentElement.scrollWidth > ${vp.w}
          };
        })()
      `);

      if (vp.name === '411x740') {
        await captureScreenshot('verify_banner_download_411x740.png');
      }

      bannersAuditResults.push({
        viewport: vp.name,
        welcome: welcomeMetrics,
        download: downloadToastMetrics
      });
      console.log(`[Banners] ${vp.name} -> Welcome OK: ${welcomeMetrics.titleFound}, Toast OK: ${downloadToastMetrics.toastPresent}, Clearance Nav: ${downloadToastMetrics.clearanceAboveNav}px`);
    }

    // Reset font
    await evaluate(`document.documentElement.style.fontSize = '';`);

    // =========================================================================
    // AUDITORÍA 4: TUTORIAL MULTI-VIEWPORT CON CAPTURAS PASO A PASO (3.b & 3.g)
    // =========================================================================
    console.log('\n--- AUDITORÍA 4: Tutorial Completo y Capturas Paso a Paso ---');
    const tutorialViewports = [
      { name: '360x640', w: 360, h: 640, isMobile: true },
      { name: '411x740 (visual 630)', w: 411, h: 740, isMobile: true, visualH: 630 },
      { name: '640x360', w: 640, h: 360, isMobile: true },
      { name: '820x1180', w: 820, h: 1180, isMobile: true },
      { name: '1024x768', w: 1024, h: 768, isMobile: false },
      { name: '1280x800', w: 1280, h: 800, isMobile: false },
      { name: '411x740_font130', w: 411, h: 740, isMobile: true, fontScale: 1.30 },
    ];

    const tutorialFullMatrix = {};

    for (const vp of tutorialViewports) {
      console.log(`\nVerificando tutorial en ${vp.name}...`);
      await setViewport(vp.w, vp.h, vp.isMobile, vp.visualH || null, vp.fontScale || 1.0);
      await evaluate(`window.location.hash = 'graph';`);
      await new Promise((r) => setTimeout(r, 400));

      const numSteps = vp.w < 1024 ? 16 : 17;
      const stepsRecord = [];

      for (let sIdx = 0; sIdx < numSteps; sIdx++) {
        await evaluate(`
          if (typeof window.__closeTutorial === 'function') window.__closeTutorial();
        `);
        await new Promise((r) => setTimeout(r, 100));
        await evaluate(`
          if (typeof window.__startTutorial === 'function') {
            window.__startTutorial(${sIdx});
          }
        `);
        await new Promise((r) => setTimeout(r, 700));

        const stepData = await evaluate(`
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

            let distance = null;
            let overlap = false;
            if (cardRect && ringRect) {
              if (cardRect.top >= ringRect.bottom) {
                distance = cardRect.top - ringRect.bottom;
              } else if (cardRect.bottom <= ringRect.top) {
                distance = ringRect.top - cardRect.bottom;
              } else {
                overlap = true;
                distance = -Math.min(cardRect.bottom - ringRect.top, ringRect.bottom - cardRect.top);
              }
            }

            const targetFound = Boolean(ringEl);
            const vpHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const cardInVisualVp = cardRect ? (cardRect.top >= 0 && cardRect.bottom <= vpHeight + 2) : false;
            const horizontalOverflow = document.documentElement.scrollWidth > ${vp.w};

            return {
              stepIndex: ${sIdx + 1},
              title,
              targetFound,
              ringRect,
              cardRect,
              distance,
              overlap,
              cardInVisualVp,
              horizontalOverflow
            };
          })()
        `);

        stepsRecord.push(stepData);

        // Si es 411x740 (font normal), capturar cada paso
        if (vp.name === '411x740 (visual 630)') {
          const capName = `verify_step_${sIdx + 1}_411x740.png`;
          await captureScreenshot(capName);
        }
      }

      tutorialFullMatrix[vp.name] = stepsRecord;
    }

    // Guardar resultados completos en archivo JSON
    const finalReport = {
      subjectLibraryMatrix,
      libraryViewsAudit,
      bannersAuditResults,
      tutorialFullMatrix,
    };
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'audit_and_measures_report.json'),
      JSON.stringify(finalReport, null, 2)
    );
    console.log('\nReporte completo guardado en audit_and_measures_report.json');

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
