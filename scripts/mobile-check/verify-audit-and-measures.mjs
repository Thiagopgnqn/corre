import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const DIST_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const REPORT_NAME = process.argv[3] || 'audit_and_measures_report.json';
const TAKE_SCREENSHOTS = process.argv[4] !== 'no-screenshots';

const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_cdp_profile_audit_' + Math.floor(Math.random() * 10000));
if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log(`1. Iniciando servidor Mock Python en puerto 8093 sirviendo ${DIST_DIR}...`);
const serverProc = spawn('python', [
  path.join(process.cwd(), 'scripts', 'mobile-check', 'mock-server.py'),
  '8093',
  DIST_DIR,
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

function getExpectedSelector(stepIndex1Based, isMobile, vpHeight, isLegacy397abb9) {
  const isShort = vpHeight < 480;
  const isCompact = vpHeight < 680;
  if (isMobile) {
    switch (stepIndex1Based) {
      case 1: return null; // welcome
      case 2: return null; // graph-overview
      case 3: return '[data-tour="graph-controls"]';
      case 4: return '[data-tour="sample-subject"]';
      case 5: return '[data-tour="drawer-status-btn"]';
      case 6: return '[data-tour="edge-legend"]';
      case 7: return '[data-tour="simulation-button"]';
      case 8:
        if (isLegacy397abb9) {
          return isShort ? '[data-tour="electives-banner"] > div:first-child' : '[data-tour="electives-banner"]';
        }
        return isCompact ? '[data-tour="electives-banner"] > div:first-child' : '[data-tour="electives-banner"]';
      case 9: return '[data-tour="analista-button"]';
      case 10: return '[data-tour="more-menu-btn"]';
      case 11:
        if (isLegacy397abb9) {
          return isShort ? '[data-tour="professors-directory"] > div:first-child h1' : '[data-tour="professors-directory"] > div:first-child';
        }
        return '[data-tour="professors-directory-header"]';
      case 12:
        if (isLegacy397abb9) {
          return isShort ? '[data-tour="professors-directory"] > div:first-child h1' : '[data-tour="professors-directory"] > div:first-child';
        }
        return '[data-tour="enrollments-recommendations-banner"]';
      case 13: return '[data-tour="stats-rings"] > div:first-child';
      case 14: return isLegacy397abb9 ? '[data-tour="more-menu-btn"]' : '[data-tour="sync-status-badge"]';
      case 15:
        if (isLegacy397abb9) {
          return isShort ? '[data-tour="library-header"] h1' : '[data-tour="library-header"]';
        }
        return isCompact ? '[data-tour="library-header"] h1' : '[data-tour="library-header"]';
      case 16: return '[data-tour="onboarding-menu-item"]';
      default: return null;
    }
  } else {
    switch (stepIndex1Based) {
      case 1: return null;
      case 2: return null;
      case 3: return '[data-tour="graph-controls"]';
      case 4: return '[data-tour="sample-subject"]';
      case 5: return '[data-tour="drawer-status-btn"]';
      case 6: return '[data-tour="edge-legend"]';
      case 7: return '[data-tour="simulation-button"]';
      case 8: return '[data-tour="electives-banner"]';
      case 9: return '[data-tour="analista-button"]';
      case 10: return '[data-tour="nav-tabs"]';
      case 11: return isLegacy397abb9 ? '[data-tour="nav-tabs"]' : '[data-tour="schedule-builder-toolbar"]';
      case 12: return isLegacy397abb9 ? '[data-tour="professors-directory"] > div:first-child' : '[data-tour="professors-directory-header"]';
      case 13: return isLegacy397abb9 ? '[data-tour="professors-directory"] > div:first-child' : '[data-tour="enrollments-recommendations-banner"]';
      case 14: return '[data-tour="stats-rings"] > div:first-child';
      case 15: return isLegacy397abb9 ? '[data-tour="more-menu-btn"]' : '[data-tour="sync-status-badge"]';
      case 16: return '[data-tour="library-header"]';
      case 17: return '[data-tour="onboarding-menu-item"]';
      default: return null;
    }
  }
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

    async function evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return res?.result?.value;
    }

    // Punto 3b: simular barra del navegador reduciendo el viewport real de CDP (sin hack de getter)
    async function setViewport(w, h, isMobile, fontScale = 1.0) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: isMobile,
        screenWidth: w,
        screenHeight: h,
      });
      await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      if (fontScale !== 1.0) {
        await evaluate(`document.documentElement.style.fontSize = '${Math.round(fontScale * 100)}%';`);
      } else {
        await evaluate(`document.documentElement.style.fontSize = '';`);
      }
      await evaluate(`window.dispatchEvent(new Event('resize'));`);
      await new Promise((r) => setTimeout(r, 250));
    }

    async function captureScreenshot(filename) {
      if (!TAKE_SCREENSHOTS) return null;
      const res = await send('Page.captureScreenshot', { format: 'png' });
      const filepath = path.join(ARTIFACTS_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
      return filepath;
    }

    console.log('Esperando app...');
    await send('Page.navigate', { url: 'http://127.0.0.1:8093/#/' });
    await new Promise((r) => setTimeout(r, 2000));

    // Cerrar tutorial inicial si abrió por defecto
    await evaluate(`
      (() => {
        const closeBtn = document.querySelector('[data-tour="tutorial-card"] button[title*="Cerrar tutorial"]');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // =========================================================================
    // PUNTO 4: BARRA SUPERIOR DEL MAPA EN CELULAR (Mapa y Lista, 320/360/411/430, 100/130/150%)
    // =========================================================================
    console.log('\n--- PUNTO 4: Barra superior del mapa en celular (Mapa y Lista) ---');
    const mapBarViewports = [
      { w: 320, h: 568 },
      { w: 360, h: 640 },
      { w: 411, h: 740 },
      { w: 430, h: 932 },
    ];
    const mapBarFonts = [1.0, 1.30, 1.50];
    const mapBarModes = ['mapa', 'lista'];
    const mapTopBarMatrix = [];

    await evaluate(`window.location.hash = 'graph';`);
    await new Promise((r) => setTimeout(r, 800));

    for (const mode of mapBarModes) {
      for (const vp of mapBarViewports) {
        for (const scale of mapBarFonts) {
          if (vp.w === 430 && scale !== 1.0) continue; // 430 pedido al 100% + las 18 combinaciones
          await setViewport(vp.w, vp.h, true, scale);
          await evaluate(`
            (() => {
              const bar = document.querySelector('[data-tour="graph-controls"]');
              if (!bar) return;
              const targetText = ${JSON.stringify(mode === 'mapa' ? 'Mapa' : 'Lista')};
              const btn = Array.from(bar.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes(targetText));
              if (btn) btn.click();
            })()
          `);
          await new Promise((r) => setTimeout(r, 350));

          const m = await evaluate(`
            (() => {
              const bar = document.querySelector('[data-tour="graph-controls"]');
              const barRect = bar ? bar.getBoundingClientRect() : null;
              const buttons = bar ? Array.from(bar.querySelectorAll('button')).filter(b => {
                const s = window.getComputedStyle(b);
                return s.display !== 'none' && s.visibility !== 'hidden' && b.getBoundingClientRect().width > 0;
              }) : [];

              const btnRects = buttons.map(b => {
                const r = b.getBoundingClientRect();
                return {
                  label: b.textContent.trim() || b.getAttribute('aria-label') || 'icon',
                  top: Math.round(r.top),
                  left: Math.round(r.left),
                  right: Math.round(r.right),
                  bottom: Math.round(r.bottom),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                  clippedText: b.scrollWidth > b.clientWidth + 2,
                };
              });

              let buttonOverlaps = 0;
              for (let i = 0; i < btnRects.length; i++) {
                for (let j = i + 1; j < btnRects.length; j++) {
                  const a = btnRects[i];
                  const b = btnRects[j];
                  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
                  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                  if (ix > 1 && iy > 1) buttonOverlaps++;
                }
              }

              const uniqueRowTops = [];
              for (const b of btnRects) {
                if (!uniqueRowTops.some(t => Math.abs(t - b.top) <= 8)) {
                  uniqueRowTops.push(b.top);
                }
              }

              const sw = document.documentElement.scrollWidth;
              const barOutRight = barRect ? Math.max(0, Math.round(barRect.right - ${vp.w})) : 0;
              const barOutLeft = barRect ? Math.max(0, Math.round(-barRect.left)) : 0;
              const minBtnHeight = btnRects.length ? Math.min(...btnRects.map(b => b.height)) : 0;
              const anyClipped = btnRects.some(b => b.clippedText);

              return {
                mode: ${JSON.stringify(mode)},
                viewport: '${vp.w}x${vp.h}',
                fontPct: '${Math.round(scale * 100)}%',
                scrollWidth: sw,
                overflowPx: Math.max(0, sw - ${vp.w}, barOutRight, barOutLeft),
                rowsCount: uniqueRowTops.length,
                barRect: barRect ? {
                  top: Math.round(barRect.top),
                  left: Math.round(barRect.left),
                  right: Math.round(barRect.right),
                  bottom: Math.round(barRect.bottom),
                  width: Math.round(barRect.width),
                  height: Math.round(barRect.height),
                } : null,
                buttonOverlaps,
                minBtnHeight,
                anyClipped,
                buttons: btnRects,
              };
            })()
          `);
          mapTopBarMatrix.push(m);
          console.log(`[MapBar] ${m.mode} ${m.viewport} @ ${m.fontPct} -> rows=${m.rowsCount}, barH=${m.barRect?.height}px, overflow=${m.overflowPx}px, overlaps=${m.buttonOverlaps}, minBtnH=${m.minBtnHeight}px`);

          if (mode === 'mapa' && vp.w === 411 && scale === 1.0) {
            await captureScreenshot('verify_map_bar_mapa_411_100.png');
          }
        }
      }
    }

    // Volver a modo Mapa
    await setViewport(411, 630, true, 1.0);
    await evaluate(`
      (() => {
        const bar = document.querySelector('[data-tour="graph-controls"]');
        if (!bar) return;
        const btn = Array.from(bar.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Mapa'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // =========================================================================
    // PUNTO 3: MATRIZ COMPLETA DEL TUTORIAL CON MÉTRICA INDEPENDIENTE Y 411x630 REAL
    // =========================================================================
    console.log('\n--- PUNTO 3: Matriz completa del tutorial (81 filas) ---');
    const isLegacy397abb9 = REPORT_NAME.includes('397abb9');

    async function startTutorialViaUI() {
      await evaluate(`
        (() => {
          const closeBtn = document.querySelector('[data-tour="tutorial-card"] button[title*="Cerrar tutorial"]');
          if (closeBtn) closeBtn.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 200));

      const startedDirect = await evaluate(`
        (() => {
          const directBtn = document.querySelector('button[title="Ver Tutorial Interactivo"]');
          if (directBtn && directBtn.getBoundingClientRect().width > 0) {
            directBtn.click();
            return true;
          }
          const moreBtns = Array.from(document.querySelectorAll('[data-tour="more-menu-btn"]')).filter(el => el.getBoundingClientRect().width > 0);
          if (moreBtns.length > 0) {
            moreBtns[moreBtns.length - 1].click();
          }
          return false;
        })()
      `);
      if (!startedDirect) {
        await new Promise((r) => setTimeout(r, 350));
        await evaluate(`
          (() => {
            const tutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Ver tutorial interactivo'));
            if (tutBtn) tutBtn.click();
          })()
        `);
      }
      await new Promise((r) => setTimeout(r, 750));
    }

    async function clickNextTutorialStepUI() {
      await evaluate(`
        (() => {
          const card = document.querySelector('[data-tour="tutorial-card"]');
          if (!card) return;
          const nextBtn = Array.from(card.querySelectorAll('button')).find(b => {
            const t = b.textContent ? b.textContent.trim() : '';
            return t.includes('Comenzar') || t.includes('Siguiente') || t.includes('¡Empezar!') || t.includes('Empezar solo');
          });
          if (nextBtn) nextBtn.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 800));
    }

    const tutorialViewports = [
      { name: '360x640', w: 360, h: 640, isMobile: true, fontScale: 1.0 },
      { name: '411x630', w: 411, h: 630, isMobile: true, fontScale: 1.0 },
      { name: '640x360', w: 640, h: 360, isMobile: true, fontScale: 1.0 },
      { name: '1280x800', w: 1280, h: 800, isMobile: false, fontScale: 1.0 },
      { name: '411x630_font130', w: 411, h: 630, isMobile: true, fontScale: 1.30 },
    ];

    const tutorialFullMatrix = {};
    let bottomNavAt411x630 = null;

    for (const vp of tutorialViewports) {
      console.log(`\nRecorriendo tutorial en ${vp.name}...`);
      await setViewport(vp.w, vp.h, vp.isMobile, vp.fontScale);
      await send('Page.navigate', { url: 'http://127.0.0.1:8093/?graph_view=mapa#graph' });
      await new Promise((r) => setTimeout(r, 1200));
      if (vp.fontScale !== 1.0) {
        await evaluate(`document.documentElement.style.fontSize = '${Math.round(vp.fontScale * 100)}%';`);
        await new Promise((r) => setTimeout(r, 250));
      }
      // Cerrar tutorial inicial si hubiera abierto
      await evaluate(`
        (() => {
          const closeBtn = document.querySelector('[data-tour="tutorial-card"] button[title*="Cerrar tutorial"]');
          if (closeBtn) closeBtn.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 250));

      if (vp.name === '411x630') {
        bottomNavAt411x630 = await evaluate(`
          (() => {
            const nav = document.querySelector('nav.fixed.bottom-0');
            if (!nav) return null;
            const r = nav.getBoundingClientRect();
            return {
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              visualViewportHeight: window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight,
              navRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) },
            };
          })()
        `);
        console.log('[411x630 BottomNav Check]', JSON.stringify(bottomNavAt411x630));
      }

      await startTutorialViaUI();

      const numSteps = vp.w < 1024 ? 16 : 17;
      const stepsRecord = [];

      for (let sIdx = 0; sIdx < numSteps; sIdx++) {
        const stepNum = sIdx + 1;
        const expectedSelector = getExpectedSelector(stepNum, vp.isMobile, vp.h, isLegacy397abb9);

        const stepData = await evaluate(`
          (() => {
            const selector = ${JSON.stringify(expectedSelector)};
            const vpW = ${vp.w};
            const vpH = ${vp.h};
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

            // Medir el objetivo directamente desde el DOM con el selector real del paso (SIN usar el estado interno del tutorial ni Math.max(0,...))
            let domTargetEl = null;
            if (selector) {
              const candidates = Array.from(document.querySelectorAll(selector));
              for (const el of candidates) {
                const s = window.getComputedStyle(el);
                if (s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    domTargetEl = el;
                    break;
                  }
                }
              }
            }

            let domTargetRect = null;
            let targetVisiblePct = null;
            let spotlightDiffPx = null;

            if (domTargetEl) {
              const tr = domTargetEl.getBoundingClientRect();
              domTargetRect = {
                top: Math.round(tr.top),
                bottom: Math.round(tr.bottom),
                left: Math.round(tr.left),
                right: Math.round(tr.right),
                width: Math.round(tr.width),
                height: Math.round(tr.height),
              };
              const visW = Math.max(0, Math.min(tr.right, vpW) - Math.max(tr.left, 0));
              const visH = Math.max(0, Math.min(tr.bottom, vpH) - Math.max(tr.top, 0));
              const area = tr.width * tr.height;
              targetVisiblePct = area > 0 ? Math.round((visW * visH * 100) / area) : 0;

              if (ringRect) {
                // Comparar el rect del objetivo directo del DOM contra el recuadro del spotlight dibujado menos el padding declarado (8 px), SIN clampear a 0
                const pad = 8;
                const spotlightInnerTop = ringRect.top + pad;
                const spotlightInnerLeft = ringRect.left + pad;
                const spotlightInnerRight = ringRect.right - pad;
                const spotlightInnerBottom = ringRect.bottom - pad;

                const dTop = Math.abs(spotlightInnerTop - domTargetRect.top);
                const dLeft = Math.abs(spotlightInnerLeft - domTargetRect.left);
                const dRight = Math.abs(spotlightInnerRight - domTargetRect.right);
                const dBottom = Math.abs(spotlightInnerBottom - domTargetRect.bottom);
                spotlightDiffPx = Math.round(Math.max(dTop, dLeft, dRight, dBottom));
              }
            }

            let distance = null;
            let overlap = false;
            if (cardRect && ringRect) {
              const dx = Math.max(0, cardRect.left - ringRect.right, ringRect.left - cardRect.right);
              const dy = Math.max(0, cardRect.top - ringRect.bottom, ringRect.top - cardRect.bottom);
              if (dx > 0 || dy > 0) {
                distance = Math.max(dx, dy);
                overlap = false;
              } else {
                overlap = true;
                const ox = Math.min(cardRect.right, ringRect.right) - Math.max(cardRect.left, ringRect.left);
                const oy = Math.min(cardRect.bottom, ringRect.bottom) - Math.max(cardRect.top, ringRect.top);
                distance = -Math.min(ox, oy);
              }
            }

            const isCenteredStep = selector === null;
            const targetFound = isCenteredStep ? 'N/A (centrado)' : (domTargetEl ? 'Sí' : 'No');
            const cardInVisualVp = cardRect
              ? (cardRect.top >= 0 && cardRect.bottom <= vpH + 2 && cardRect.left >= 0 && cardRect.right <= vpW + 2)
              : false;

            let pass = true;
            const failReasons = [];
            if (!cardInVisualVp) {
              pass = false;
              failReasons.push('cardOutVp');
            }
            if (overlap) {
              pass = false;
              failReasons.push('overlap');
            }
            if (!isCenteredStep) {
              if (!domTargetEl) {
                pass = false;
                failReasons.push('targetNotFoundInDOM');
              } else if (targetVisiblePct < 90) {
                pass = false;
                failReasons.push('targetVisiblePct=' + targetVisiblePct + '% (<90%)');
              } else if (!ringRect) {
                pass = false;
                failReasons.push('noSpotlightRing');
              } else if (spotlightDiffPx > 2) {
                pass = false;
                failReasons.push('spotlightDiffPx=' + spotlightDiffPx + 'px (>2px)');
              }
            }

            return {
              stepIndex: ${stepNum},
              title,
              selector: selector || '(centrado)',
              targetFound,
              domTargetRect,
              targetVisiblePct,
              ringRect,
              spotlightDiffPx,
              cardRect,
              distance,
              overlap,
              cardInVisualVp,
              status: pass ? 'PASS' : 'FAIL',
              failReasons,
            };
          })()
        `);

        stepsRecord.push(stepData);
        console.log(
          `  Paso ${stepData.stepIndex} [${stepData.status}] (${stepData.title}): sel=${stepData.selector}, vis=${stepData.targetVisiblePct ?? 'N/A'}%, diff=${stepData.spotlightDiffPx ?? 'N/A'}px, dist=${stepData.distance ?? 'N/A'}px` +
          (stepData.failReasons.length ? ` -> FAIL: ${stepData.failReasons.join(', ')}` : '')
        );

        if (vp.name === '411x630' && [4, 10, 11, 12, 14].includes(stepNum)) {
          await captureScreenshot(`verify_step_${stepNum}_411x630.png`);
        }

        await clickNextTutorialStepUI();
      }

      tutorialFullMatrix[vp.name] = stepsRecord;
    }

    const finalReport = {
      mapTopBarMatrix,
      bottomNavAt411x630,
      tutorialFullMatrix,
    };

    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, REPORT_NAME),
      JSON.stringify(finalReport, null, 2)
    );
    console.log(`\nReporte completo guardado en ${REPORT_NAME}`);
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
