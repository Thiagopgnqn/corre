import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const PROFILE_DIR = path.join(process.cwd(), 'node_modules', '.tmp_edge_cdp_profile_partea');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log('1. Iniciando servidor Mock Python en puerto 8085...');
const serverProc = spawn('python', [
  path.join(process.cwd(), 'scripts', 'mobile-check', 'mock-server.py'),
  '8085',
  path.resolve('dist')
], { stdio: 'ignore' });

await new Promise((r) => setTimeout(r, 1500));

console.log('2. Iniciando Microsoft Edge con CDP en puerto 9225...');
const edgeProc = spawn(EDGE_PATH, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=9225',
  `--user-data-dir=${PROFILE_DIR}`,
  '--window-size=1280,800',
  'http://127.0.0.1:8085/',
]);

async function getWsUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9225/json');
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

    async function setViewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 1024,
      });
      await send('Emulation.setVisibleSize', { width, height });
      await new Promise((r) => setTimeout(r, 300));
    }

    async function navigate(url) {
      await send('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, 1200));
    }

    async function capture(filename) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(ARTIFACTS_DIR, filename);
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      console.log(`📸 Guardada captura: ${filename}`);
    }

    async function evalScript(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return res?.result?.value;
    }

    console.log('\n--- 3. Capturando Avisos de Indisponibilidad en Mobile & Tablets Verticales ---');
    const noticeViewports = [
      { name: 'notice_320x568.png', w: 320, h: 568 },
      { name: 'notice_360x640.png', w: 360, h: 640 },
      { name: 'notice_412x740.png', w: 412, h: 740 },
      { name: 'notice_932x430_landscape.png', w: 932, h: 430 },
      { name: 'notice_768x1024_tablet_portrait.png', w: 768, h: 1024 },
      { name: 'notice_820x1180_tablet_portrait.png', w: 820, h: 1180 },
    ];

    for (const vp of noticeViewports) {
      await setViewport(vp.w, vp.h);
      await navigate('http://127.0.0.1:8085/#schedule');
      await new Promise((r) => setTimeout(r, 400));
      await capture(vp.name);
    }

    console.log('\n--- 4. Capturando Armador de Horarios en Desktop & Tablets Horizontales ---');
    const scheduleViewports = [
      { name: 'schedule_1024x768.png', w: 1024, h: 768 },
      { name: 'schedule_1180x820.png', w: 1180, h: 820 },
      { name: 'schedule_1366x1024.png', w: 1366, h: 1024 },
      { name: 'schedule_1280x800_actual.png', w: 1280, h: 800 },
    ];

    for (const vp of scheduleViewports) {
      await setViewport(vp.w, vp.h);
      await navigate('http://127.0.0.1:8085/#schedule');
      await new Promise((r) => setTimeout(r, 600));
      await capture(vp.name);
    }

    console.log('\n--- 5. Capturando Barra de Navegación Móvil (360x640) ---');
    await setViewport(360, 640);
    await navigate('http://127.0.0.1:8085/#/');
    await new Promise((r) => setTimeout(r, 500));
    await capture('nav_mobile_5buttons_360.png');

    console.log('\n--- 6. Capturando Sheet "Más" con Badge "Solo en PC" (360x640) ---');
    await evalScript(`
      const moreBtn = document.querySelector('[data-tour="more-menu-btn"]');
      if (moreBtn) moreBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 500));
    await capture('nav_more_sheet_360.png');

    console.log('\n✅ Todas las capturas generadas exitosamente!');
    ws.close();
  } catch (err) {
    console.error('Error durante la ejecución CDP:', err);
  } finally {
    edgeProc.kill();
    serverProc.kill();
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch {}
  }
}

run();

