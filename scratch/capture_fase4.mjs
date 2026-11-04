import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACTS_DIR = 'C:\\Users\\msgar\\.gemini\\antigravity\\brain\\bbbcea45-94e2-4984-ab70-c1fbef39a5f5';
const SCRATCH_DIR = path.join(ARTIFACTS_DIR, 'scratch');
const PROFILE_DIR = path.join(SCRATCH_DIR, 'edge-profile-fase4');

if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

console.log('1. Starting Mock HTTP Server in Python...');
const serverProc = spawn('python', [path.join(SCRATCH_DIR, 'test_server.py')], {
  stdio: 'ignore'
});

await new Promise(r => setTimeout(r, 1500));

console.log('2. Starting Edge process with CDP on port 9222...');
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
  'http://127.0.0.1:8080/'
]);

async function getWsUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      const tabs = await res.json();
      const page = tabs.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch (e) {
      // retry
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Could not connect to Edge DevTools');
}

async function main() {
  const wsUrl = await getWsUrl();
  console.log('Connected to CDP at:', wsUrl);

  const ws = new WebSocket(wsUrl);
  await new Promise(resolve => ws.onopen = resolve);

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
    return new Promise(resolve => {
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
      awaitPromise: true
    });
    return res.result?.result?.value;
  };

  const capture = async (filename) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.result.data, 'base64');
    const outPath = path.join(ARTIFACTS_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[Captured] ${filename} (${buffer.length} bytes)`);
  };

  const setViewport = async (width, height, isMobileDevice = true) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobileDevice
    });
    await new Promise(r => setTimeout(r, 400));
  };

  const checkOverflow = async (viewLabel) => {
    const overflowInfo = await evaluate(`
      (() => {
        const bodyWidth = document.body.scrollWidth;
        const innerW = window.innerWidth;
        const docWidth = document.documentElement.scrollWidth;
        const maxScroll = Math.max(bodyWidth, docWidth);
        return {
          view: '${viewLabel}',
          maxScroll,
          innerW,
          hasOverflow: maxScroll > innerW
        };
      })()
    `);
    console.log(`[Overflow Check] ${viewLabel}: scrollWidth=${overflowInfo?.maxScroll}px, innerWidth=${overflowInfo?.innerW}px => ${overflowInfo?.hasOverflow ? 'FAIL (OVERFLOW)' : 'PASS (NO OVERFLOW)'}`);
    return overflowInfo;
  };

  const navigateTo = async (hash) => {
    await evaluate(`window.location.hash = '${hash}';`);
    await new Promise(r => setTimeout(r, 800));
  };

  console.log('\n--- 1. SEMESTER PLANNER (CUATRIMESTRE) ---');
  await setViewport(360, 640);
  await navigateTo('#planner');
  await checkOverflow('Planner 360x640');
  await capture('screenshot_fase4_planner_360.png');

  // Open basket BottomSheet
  await evaluate(`(() => {
    const btn = document.querySelector('[data-testid="planner-open-basket-btn"]');
    if (btn) btn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  await capture('screenshot_fase4_planner_basket_360.png');

  // Close sheet
  await evaluate(`(() => {
    const closeBtn = document.querySelector('[aria-label="Cerrar panel"]');
    if (closeBtn) closeBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 300));

  await setViewport(412, 740);
  await checkOverflow('Planner 412x740');
  await capture('screenshot_fase4_planner_412.png');

  console.log('\n--- 2. ELECTIVES PICKER (ELECTIVAS) ---');
  await setViewport(360, 640);
  await navigateTo('#electives');
  await checkOverflow('Electives 360x640');
  await capture('screenshot_fase4_electives_360.png');

  // Open Add Elective Modal
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const addBtn = btns.find(b => b.textContent.includes('Agregar electiva'));
    if (addBtn) addBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  await capture('screenshot_fase4_electives_modal_360.png');

  // Close modal
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const closeBtn = btns.find(b => b.textContent.includes('Listo'));
    if (closeBtn) closeBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 300));

  await setViewport(412, 740);
  await checkOverflow('Electives 412x740');
  await capture('screenshot_fase4_electives_412.png');

  console.log('\n--- 3. STATS DASHBOARD (ESTADÍSTICAS) ---');
  await setViewport(360, 640);
  await navigateTo('#stats');
  await checkOverflow('Stats Overview 360x640');
  await capture('screenshot_fase4_stats_overview_360.png');

  // Switch to Camino Crítico
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const critBtn = btns.find(b => b.textContent.includes('Camino Crítico'));
    if (critBtn) critBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  await checkOverflow('Stats Critical Path 360x640');
  await capture('screenshot_fase4_stats_critical_360.png');

  await setViewport(412, 740);
  await checkOverflow('Stats Critical Path 412x740');
  await capture('screenshot_fase4_stats_overview_412.png');

  console.log('\n--- 4. PROFESSORS DIRECTORY (PROFESORES) ---');
  await setViewport(360, 640);
  await navigateTo('#professors');
  await checkOverflow('Professors Directory 360x640');
  await capture('screenshot_fase4_professors_dir_360.png');

  // Open Filters BottomSheet
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const filterBtn = btns.find(b => b.textContent.includes('Filtros'));
    if (filterBtn) filterBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  await capture('screenshot_fase4_professors_filters_360.png');

  // Close Filters
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const applyBtn = btns.find(b => b.textContent.includes('Aplicar filtros'));
    if (applyBtn) applyBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 300));

  await setViewport(412, 740);
  await checkOverflow('Professors Directory 412x740');
  await capture('screenshot_fase4_professors_dir_412.png');

  // Open Professor Detail Modal
  await evaluate(`(() => {
    const card = document.querySelector('button.group');
    if (card) card.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));
  await capture('screenshot_fase4_professor_detail_360.png');

  // Open Review Form Modal
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const revBtn = btns.find(b => b.textContent.includes('Dejar reseña'));
    if (revBtn) revBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));
  await capture('screenshot_fase4_review_form_360.png');

  console.log('\n--- 5. LIBRARY (BIBLIOTECA) ---');
  await setViewport(360, 640);
  await navigateTo('#library');
  await checkOverflow('Library Home 360x640');
  await capture('screenshot_fase4_library_home_360.png');

  await setViewport(412, 740);
  await checkOverflow('Library Home 412x740');
  await capture('screenshot_fase4_library_home_412.png');

  // Open Upload Material Modal
  await setViewport(360, 640);
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const upBtn = btns.find(b => b.textContent.includes('Subir Material'));
    if (upBtn) upBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));
  await capture('screenshot_fase4_library_upload_360.png');

  // Close Upload Modal
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cancelBtn = btns.find(b => b.textContent.includes('Cancelar'));
    if (cancelBtn) cancelBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 300));

  // Open Subject Library View
  await evaluate(`(() => {
    const subCard = document.querySelector('button.group');
    if (subCard) subCard.click();
  })()`);
  await new Promise(r => setTimeout(r, 600));
  await checkOverflow('Subject Library View 360x640');
  await capture('screenshot_fase4_library_subject_360.png');

  // Open My Uploads View
  await navigateTo('#library/my-uploads');
  await new Promise(r => setTimeout(r, 600));
  await checkOverflow('My Uploads View 360x640');
  await capture('screenshot_fase4_library_myuploads_360.png');

  console.log('\nCDP Verification Completed Successfully!');
  ws.close();
  edgeProc.kill();
  serverProc.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('CDP Error:', err);
  edgeProc.kill();
  serverProc.kill();
  process.exit(1);
});

