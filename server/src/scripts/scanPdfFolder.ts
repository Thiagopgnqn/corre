import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { validateFileStream } from '../modules/library/library.validator.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resolveTargetDir(rawArg: string | undefined): string | null {
  if (!rawArg || !rawArg.trim()) return null;
  const trimmed = rawArg.trim();
  if (path.isAbsolute(trimmed)) return trimmed;

  const initCwd = process.env.INIT_CWD;
  if (initCwd) {
    const fromInit = path.resolve(initCwd, trimmed);
    if (fs.existsSync(fromInit)) return fromInit;
  }
  return path.resolve(process.cwd(), trimmed);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const targetDir = resolveTargetDir(args[0]);

  if (!targetDir) {
    console.error(
      'Uso: npm --prefix server run verify:scan-pdfs -- <ruta-de-carpeta-con-pdfs>'
    );
    process.exit(1);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetDir);
  } catch {
    console.error(`Error: la carpeta no existe o no es accesible: ${targetDir}`);
    process.exit(1);
  }

  if (!stat.isDirectory()) {
    console.error(`Error: la ruta indicada no es una carpeta: ${targetDir}`);
    process.exit(1);
  }

  const pdfNames = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (pdfNames.length === 0) {
    console.log(`No se encontraron archivos .pdf en: ${targetDir}`);
    process.exit(0);
  }

  console.log(`Escaneando ${pdfNames.length} PDF(s) en ${targetDir} (solo lectura)...\n`);

  let allowedCount = 0;
  let rejectedCount = 0;
  const suiteStart = performance.now();

  for (const name of pdfNames) {
    const fullPath = path.join(targetDir, name);
    const fileStat = fs.statSync(fullPath);

    const origWarn = console.warn;
    console.warn = () => {};
    const t0 = performance.now();
    let result;
    try {
      const stream = fs.createReadStream(fullPath);
      result = await validateFileStream(stream, 'application/pdf', fileStat.size);
    } finally {
      console.warn = origWarn;
    }
    const elapsedMs = performance.now() - t0;

    if (result.isValid) {
      allowedCount++;
      console.log(
        `[PERMITIDO] ${name} | ${formatBytes(fileStat.size)} | motivo: OK | ${elapsedMs.toFixed(1)} ms`
      );
    } else {
      rejectedCount++;
      const reason =
        result.technicalReason ||
        result.dangerousMarkFound ||
        result.error ||
        'Rechazado';
      console.log(
        `[RECHAZADO] ${name} | ${formatBytes(fileStat.size)} | motivo: ${reason} | ${elapsedMs.toFixed(1)} ms`
      );
    }
  }

  const totalMs = performance.now() - suiteStart;
  console.log(
    `\nResumen: ${pdfNames.length} analizados | ${allowedCount} permitidos | ${rejectedCount} rechazados | ${totalMs.toFixed(1)} ms totales`
  );
}

main().catch((err) => {
  console.error('Error ejecutando verify:scan-pdfs:', err);
  process.exit(1);
});
