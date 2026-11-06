import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_cdp_profile_diag');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log('1. Iniciando servidor Mock Python en puerto 8086...');
const serverProc = spawn('python', [
  path.join(process.cwd(), 'scripts', 'mobile-check', 'mock-server.py'),
  '8086',
  path.resolve('dist')
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 1500));

console.log('2. Iniciando Edge CDP en puerto 9226...');
const edgeProc = spawn(EDGE_PATH, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=9226',
  `--user-data-dir=${PROFILE_DIR}`,
  '--window-size=411,740',
  'http://127.0.0.1:8086/',
]);

async function getWsUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9226/json');
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === 'page');
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

    // Emulate 411x740 mobile device with visual viewport 630px high (simulating 110px address bar)
    await send('Emulation.setDeviceMetricsOverride', {
      width: 411,
      height: 740,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send('Emulation.setVisibleSize', { width: 411, height: 630 });
    await new Promise((r) => setTimeout(r, 400));

    await send('Page.navigate', { url: 'http://127.0.0.1:8086/#/' });
    await new Promise((r) => setTimeout(r, 2000));

    async function evalScript(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return res?.result?.value;
    }

    // Open Sheet "Más" and click "Ver tutorial interactivo"
    console.log('Abriendo Sheet Más para iniciar tutorial...');
    await evalScript(`
      const moreBtn = document.querySelector('[data-tour="more-menu-btn"]');
      if (moreBtn) moreBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 800));

    console.log('Clicking "Ver tutorial interactivo"...');
    const started = await evalScript(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const tutBtn = buttons.find(b => b.textContent && b.textContent.includes('Ver tutorial interactivo'));
        if (tutBtn) {
          tutBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Tutorial iniciado:', started);
    await new Promise((r) => setTimeout(r, 1000));

    const stepsData = [];

    // Step through available steps (up to 16 in mobile)
    for (let stepIndex = 0; stepIndex < 16; stepIndex++) {
      // Jump to step explicitly
      await evalScript(`
        if (typeof window.__startTutorial === 'function') {
          window.__startTutorial(${stepIndex});
        }
      `);
      // Let any animations settle
      await new Promise((r) => setTimeout(r, 700));

      const stepInfo = await evalScript(`
        (() => {
          const cardEl = document.querySelector('[data-tour="tutorial-card"]') ||
                         document.querySelector('[role="dialog"]');
          const ringEl = document.querySelector('[data-tour="tutorial-spotlight-ring"]');
          
          const titleEl = cardEl ? cardEl.querySelector('h3') : null;
          const title = titleEl ? titleEl.textContent.trim() : 'Sin título';
          
          const cardRect = cardEl ? {
            top: Math.round(cardEl.getBoundingClientRect().top),
            left: Math.round(cardEl.getBoundingClientRect().left),
            width: Math.round(cardEl.getBoundingClientRect().width),
            height: Math.round(cardEl.getBoundingClientRect().height),
            bottom: Math.round(cardEl.getBoundingClientRect().bottom),
          } : null;
          
          let maskRect = null;
          if (ringEl) {
            const b = ringEl.getBoundingClientRect();
            maskRect = {
              top: Math.round(b.top),
              left: Math.round(b.left),
              width: Math.round(b.width),
              height: Math.round(b.height),
              bottom: Math.round(b.bottom),
            };
          }

          // Expected target selector by stepIndex
          const stepTargets = [
            null, // 1 welcome
            '[data-tour="graph-canvas"]', // 2
            '[data-tour="graph-controls"]', // 3
            '[data-tour="sample-subject"]', // 4
            '[data-tour="drawer-status-btn"]', // 5
            '[data-tour="edge-legend"]', // 6
            '[data-tour="simulation-button"]', // 7
            '[data-tour="electives-banner"]', // 8
            '[data-tour="analista-button"]', // 9
            '[data-tour="nav-tabs"]', // 10
            '[data-tour="professors-directory"]', // 11
            '[data-tour="professors-directory"]', // 12
            '[data-tour="stats-rings"]', // 13 (stats)
            '[data-tour="more-menu-btn"]', // 14
            null, // 15 library
            '[data-tour="onboarding-menu-item"]' // 16
          ];

          const targetSel = stepTargets[${stepIndex}];
          let realTargetRect = null;
          if (targetSel) {
            // Check all matching elements and pick the visible one
            const els = Array.from(document.querySelectorAll(targetSel));
            const visibleEl = els.find(el => {
              const cs = window.getComputedStyle(el);
              return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
            }) || els[0];

            if (visibleEl) {
              const b = visibleEl.getBoundingClientRect();
              realTargetRect = {
                top: Math.round(b.top),
                left: Math.round(b.left),
                width: Math.round(b.width),
                height: Math.round(b.height),
                bottom: Math.round(b.bottom),
                display: window.getComputedStyle(visibleEl).display,
                visibility: window.getComputedStyle(visibleEl).visibility,
                elementTagName: visibleEl.tagName,
                elementClass: visibleEl.className.slice(0, 50),
              };
            }
          }

          let overlap = false;
          let overlapHeight = 0;
          if (realTargetRect && cardRect) {
            const xOverlap = Math.max(0, Math.min(realTargetRect.left + realTargetRect.width, cardRect.left + cardRect.width) - Math.max(realTargetRect.left, cardRect.left));
            const yOverlap = Math.max(0, Math.min(realTargetRect.bottom, cardRect.bottom) - Math.max(realTargetRect.top, cardRect.top));
            if (xOverlap > 0 && yOverlap > 0) {
              overlap = true;
              overlapHeight = Math.round(yOverlap);
            }
          }

          // Check difference between realTargetRect and maskRect
          let diffY = null;
          if (realTargetRect && maskRect) {
            diffY = Math.round(maskRect.top - (realTargetRect.top - 8));
          }

          return {
            stepIndex: ${stepIndex} + 1,
            title,
            targetSelector: targetSel,
            realTargetRect,
            maskRect,
            cardRect,
            overlap,
            overlapHeight,
            diffY,
            visualViewport: {
              width: window.visualViewport ? window.visualViewport.width : window.innerWidth,
              height: window.visualViewport ? window.visualViewport.height : window.innerHeight,
              offsetTop: window.visualViewport ? window.visualViewport.offsetTop : 0,
            }
          };
        })()
      `);

      stepsData.push(stepInfo);

      // Take screenshot of step
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(ARTIFACTS_DIR, `diag_step_${stepIndex + 1}_411x740.png`), Buffer.from(data, 'base64'));

      // Advance to next step
      await evalScript(`
        const nextBtn = document.querySelector('[role="dialog"] button:has(svg.lucide-arrow-right)') || 
                        Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent.includes('Siguiente') || b.textContent.includes('Empezar'));
        if (nextBtn) nextBtn.click();
        else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      `);
    }

    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'tutorial_diagnosis_data.json'), JSON.stringify(stepsData, null, 2));
    console.log('\n=== DIAGNÓSTICO TUTORIAL COMPLETADO ===\n');
    console.log(JSON.stringify(stepsData, null, 2));

    ws.close();
  } catch (err) {
    console.error('Error durante diagnóstico:', err);
  } finally {
    edgeProc.kill();
    serverProc.kill();
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch {}
  }
}

run();
