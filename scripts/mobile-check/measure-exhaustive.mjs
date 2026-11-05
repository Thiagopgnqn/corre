import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_cdp_profile_exhaustive');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log('1. Iniciando servidor Mock Python en puerto 8080...');
const serverProc = spawn('python', [
  path.join(process.cwd(), 'scripts', 'mobile-check', 'mock-server.py'),
  '8080',
  path.resolve('dist')
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 1500));

console.log('2. Iniciando Microsoft Edge con CDP en puerto 9222...');
const edgeProc = spawn(EDGE_PATH, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
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

    const send = (method, params = {}) => {
      const id = msgId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    await send('Page.enable');
    await send('Runtime.enable');

    const evalJs = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return res.result?.result?.value;
    };

    const setViewport = async (width, height, isMobileDevice = true) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: isMobileDevice,
      });
      await new Promise((r) => setTimeout(r, 350));
    };

    const runDetector = async (targetW) => {
      return await evalJs(`
        (() => {
          const targetW = ${targetW};
          const bodyW = document.body ? document.body.scrollWidth : 0;
          const docW = document.documentElement ? document.documentElement.scrollWidth : 0;
          const maxScroll = Math.max(bodyW, docW);
          const innerW = window.innerWidth;

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

          const overflowingElements = [];
          const clippedElements = [];
          const clippedSvgs = [];

          const all = Array.from(document.querySelectorAll('*'));
          for (const el of all) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;

            if ((rect.right > targetW + 1.5 || rect.left < -1.5) && !isScrollable(el)) {
              const tag = el.tagName.toLowerCase();
              const id = el.id ? '#' + el.id : '';
              const cls = el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
                : '';
              overflowingElements.push({
                selector: tag + id + cls,
                rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
              });
            }

            if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1.5) {
              if (el !== document.documentElement && el !== document.body) {
                const tag = el.tagName.toLowerCase();
                const id = el.id ? '#' + el.id : '';
                const cls = el.className && typeof el.className === 'string'
                  ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
                  : '';
                clippedElements.push({
                  selector: tag + id + cls,
                  diff: el.scrollWidth - el.clientWidth
                });
              }
            }

            if (el.tagName.toLowerCase() === 'svg') {
              const svg = el;
              let vb = null;
              if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
                const b = svg.viewBox.baseVal;
                vb = { x: b.x, y: b.y, width: b.width, height: b.height };
              }
              const boundX = vb ? vb.x : 0;
              const boundY = vb ? vb.y : 0;
              const boundW = vb ? vb.width : svg.clientWidth;
              const boundH = vb ? vb.height : svg.clientHeight;

              const children = Array.from(svg.querySelectorAll('circle, path, rect, line, polyline, polygon, g'));
              for (const child of children) {
                try {
                  const bbox = child.getBBox();
                  const cstyle = window.getComputedStyle(child);
                  const stroke = parseFloat(cstyle.strokeWidth || '0') || 0;
                  const half = stroke / 2;
                  const minX = bbox.x - half;
                  const minY = bbox.y - half;
                  const maxX = bbox.x + bbox.width + half;
                  const maxY = bbox.y + bbox.height + half;

                  if (minX < boundX - 1.5 || minY < boundY - 1.5 || maxX > boundX + boundW + 1.5 || maxY > boundY + boundH + 1.5) {
                    clippedSvgs.push({
                      svgSelector: 'svg' + (svg.className && typeof svg.className === 'string' ? '.' + svg.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
                      diffRight: Math.round(maxX - (boundX + boundW)),
                      diffBottom: Math.round(maxY - (boundY + boundH))
                    });
                    break;
                  }
                } catch(e) {}
              }
            }
          }

          const hasOverflow = maxScroll > targetW + 1 || overflowingElements.length > 0 || clippedSvgs.length > 0;
          return {
            targetW,
            maxScroll,
            innerW,
            overflowingCount: overflowingElements.length,
            clippedCount: clippedElements.length,
            clippedSvgCount: clippedSvgs.length,
            overflowingElements: overflowingElements.slice(0, 3),
            clippedSvgs: clippedSvgs.slice(0, 3),
            hasOverflow
          };
        })()
      `);
    };

    const rows = [];

    // Screen definition runners
    const screens = [
      {
        name: 'Mapa (Grafo)',
        setup: async () => {
          await evalJs(`window.location.hash = 'graph';`);
          await new Promise(r => setTimeout(r, 600));
          await evalJs(`
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Mapa'));
            if (btn) btn.click();
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }, { w: 640, h: 360 }
        ]
      },
      {
        name: 'Mapa (Lista)',
        setup: async () => {
          await evalJs(`window.location.hash = 'graph';`);
          await new Promise(r => setTimeout(r, 600));
          await evalJs(`
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lista'));
            if (btn) btn.click();
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }, { w: 640, h: 360 }
        ]
      },
      {
        name: 'Kanban',
        setup: async () => {
          await evalJs(`window.location.hash = 'kanban';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }, { w: 640, h: 360 }
        ]
      },
      {
        name: 'Cuatrimestre (Canasta abierta)',
        setup: async () => {
          await evalJs(`window.location.hash = 'planner';`);
          await new Promise(r => setTimeout(r, 700));
          // Open basket sheet
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Mi Canasta') || x.textContent.includes('Canasta') || x.textContent.includes('materias'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Electivas',
        setup: async () => {
          await evalJs(`window.location.hash = 'electives';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Electivas (Modal)',
        setup: async () => {
          await evalJs(`window.location.hash = 'electives';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const card = Array.from(document.querySelectorAll('div, button')).find(x => x.textContent.includes('Criptografía') || x.textContent.includes('Testing') || x.textContent.includes('Cloud'));
            if (card) card.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Estadísticas (General)',
        setup: async () => {
          await evalJs(`window.location.hash = 'stats';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Estadísticas (Camino Crítico)',
        setup: async () => {
          await evalJs(`window.location.hash = 'stats';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Camino Crítico'));
            if (btn) btn.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Horarios (Comisiones)',
        setup: async () => {
          await evalJs(`window.location.hash = 'schedule';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Comisiones'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }, { w: 640, h: 360 }
        ]
      },
      {
        name: 'Horarios (Sheet Filtros)',
        setup: async () => {
          await evalJs(`window.location.hash = 'schedule';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Filtros') || x.getAttribute('aria-label')?.includes('Filtros'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Horarios (Por Día con clases)',
        setup: async () => {
          await evalJs(`window.location.hash = 'schedule';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Mi Horario'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
          // Select day with classes (VIE or MIE)
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim().startsWith('VIE') || x.textContent.trim().startsWith('MIE'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }, { w: 640, h: 360 }
        ]
      },
      {
        name: 'Horarios (Por Día sin clases / Día Libre)',
        setup: async () => {
          await evalJs(`window.location.hash = 'schedule';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Mi Horario'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
          // Select Thursday (JUE)
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim().startsWith('JUE'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Horarios (Semana Completa)',
        setup: async () => {
          await evalJs(`window.location.hash = 'schedule';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Mi Horario'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Semana Completa'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Profesores (Directorio)',
        setup: async () => {
          await evalJs(`window.location.hash = 'professors';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Profesores (Sheet Filtros)',
        setup: async () => {
          await evalJs(`window.location.hash = 'professors';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Filtros') || x.getAttribute('aria-label')?.includes('Filtros'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Profesores (Ficha / Detalle)',
        setup: async () => {
          await evalJs(`window.location.hash = 'professors';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const card = Array.from(document.querySelectorAll('div, button')).find(x => x.textContent.includes('García') || x.textContent.includes('Colina'));
            if (card) card.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Profesores (Formulario de Reseña)',
        setup: async () => {
          await evalJs(`window.location.hash = 'professors';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Dejar Reseña') || x.textContent.includes('Opinar') || x.textContent.includes('Escribir'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Biblioteca (Portada / Home)',
        setup: async () => {
          await evalJs(`window.location.hash = 'library';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Biblioteca (Vista de Materia)',
        setup: async () => {
          await evalJs(`window.location.hash = 'library';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const card = Array.from(document.querySelectorAll('div, button, a')).find(x => x.textContent.includes('Análisis Matemático') || x.textContent.includes('Álgebra'));
            if (card) card.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Biblioteca (Modal de Subida)',
        setup: async () => {
          await evalJs(`window.location.hash = 'library';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Subir Material'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Biblioteca (Mis Aportes)',
        setup: async () => {
          await evalJs(`window.location.hash = 'library/my-uploads';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Biblioteca (Términos)',
        setup: async () => {
          await evalJs(`window.location.hash = 'library/terms';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Configuración / Menú Usuario',
        setup: async () => {
          await evalJs(`window.location.hash = 'graph';`);
          await new Promise(r => setTimeout(r, 600));
          // Open user menu / more bottom sheet
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button, a')).find(x => x.textContent.includes('Más') || x.getAttribute('aria-label')?.includes('menú'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Cursadas (Enrollment Modal)',
        setup: async () => {
          await evalJs(`window.location.hash = 'graph';`);
          await new Promise(r => setTimeout(r, 600));
          // Trigger quick status or enrollment
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Cursadas') || x.getAttribute('data-tour')?.includes('enroll'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Admin (Overview)',
        setup: async () => {
          await evalJs(`window.location.hash = 'admin';`);
          await new Promise(r => setTimeout(r, 700));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Admin (Usuarios)',
        setup: async () => {
          await evalJs(`window.location.hash = 'admin';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Usuarios'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Admin (Horarios)',
        setup: async () => {
          await evalJs(`window.location.hash = 'admin';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Horarios') || x.textContent.includes('Comisiones'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Admin (Reseñas)',
        setup: async () => {
          await evalJs(`window.location.hash = 'admin';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Reseñas'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Admin (Biblioteca)',
        setup: async () => {
          await evalJs(`window.location.hash = 'admin';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Biblioteca'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Admin (Auditoría)',
        setup: async () => {
          await evalJs(`window.location.hash = 'admin';`);
          await new Promise(r => setTimeout(r, 700));
          await evalJs(`
            const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Auditoría'));
            if (b) b.click();
          `);
          await new Promise(r => setTimeout(r, 500));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Auth (Login / Registro)',
        setup: async () => {
          await evalJs(`
            localStorage.clear();
            sessionStorage.clear();
          `);
          await send('Page.navigate', { url: 'http://127.0.0.1:8080/' });
          await new Promise(r => setTimeout(r, 800));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      },
      {
        name: 'Auth (Verificación de Email)',
        setup: async () => {
          // Keep unverified state
          await evalJs(`
            localStorage.setItem('auth_pending_email', 'estudiante@alumnos.frc.utn.edu.ar');
          `);
          await new Promise(r => setTimeout(r, 400));
        },
        viewports: [
          { w: 320, h: 568 }, { w: 360, h: 640 }, { w: 412, h: 740 }
        ]
      }
    ];

    console.log(`Ejecutando mediciones exhaustivas para ${screens.length} pantallas...`);

    let totalRowCount = 0;

    for (const screen of screens) {
      for (const vp of screen.viewports) {
        totalRowCount++;
        await setViewport(vp.w, vp.h);
        await screen.setup();
        const res = await runDetector(vp.w);

        const status = res.hasOverflow ? 'FAIL ❌' : 'PASS ✅';
        const culpritsStr = res.hasOverflow
          ? [...res.overflowingElements.map(e => e.selector), ...res.clippedSvgs.map(s => s.svgSelector)].join(', ')
          : 'Ninguno (0)';

        rows.push({
          num: totalRowCount,
          screen: screen.name,
          viewport: `${vp.w}x${vp.h}`,
          target: `${vp.w} px`,
          scrollWidth: `${res.maxScroll} px`,
          innerWidth: `${res.innerW} px`,
          overflowingCount: res.overflowingCount,
          clippedCount: res.clippedCount,
          clippedSvgCount: res.clippedSvgCount,
          culprits: culpritsStr,
          status
        });

        console.log(`[#${totalRowCount}] ${screen.name} (${vp.w}x${vp.h}) => ${status} (scroll: ${res.maxScroll}px, culpables: ${culpritsStr})`);
      }
    }

    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'exhaustive_measurements.json'), JSON.stringify(rows, null, 2));
    console.log(`\n🎉 Total real de filas medidas y declaradas: ${rows.length}`);

    ws.close();
  } catch (err) {
    console.error('Error during exhaustive measurement:', err);
  } finally {
    serverProc.kill();
    edgeProc.kill();
  }
}

run();

