import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_DESCRIPTION,
  SITE_URL,
  BRAND_COLORS,
} from '../src/config/brand.ts';
import { buildVerificationEmail } from '../server/src/modules/mailer/templates/verificationEmail.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('======================================================================');
console.log(' 🧪 TESTS DE IDENTIDAD DE MARCA "STACK" Y RECURSOS VISUALES');
console.log('======================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

// 1. Constantes y Tokens de Marca
assert(APP_NAME === 'Stack', 'APP_NAME es "Stack"');
assert(APP_TAGLINE === 'Tu carrera, materia a materia', 'APP_TAGLINE es "Tu carrera, materia a materia"');
assert(
  APP_DESCRIPTION.includes('Seguí tu carrera') && APP_DESCRIPTION.includes('reseñas de profesores'),
  'APP_DESCRIPTION contiene la descripción corta oficial'
);
assert(SITE_URL === 'https://corre-ten.vercel.app', 'SITE_URL apunta al dominio canónico en Vercel');
assert(
  BRAND_COLORS.indigo === '#2A2E8A' &&
    BRAND_COLORS.indigoDeep === '#171A52' &&
    BRAND_COLORS.amber === '#FFB938' &&
    BRAND_COLORS.slateLight === '#F4F5FB',
  'Paleta de colores oficial (índigo, índigo profundo, ámbar y blanco azulado) definida'
);

// 2. Existencia de Archivos de Marca en public/
const requiredFiles = [
  'public/brand/stack-logo.svg',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/apple-touch-icon.png',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/icon-maskable.png',
  'public/og-image.png',
  'public/site.webmanifest',
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(rootDir, relPath);
  const exists = fs.existsSync(fullPath);
  const size = exists ? fs.statSync(fullPath).size : 0;
  assert(exists && size > 0, `Archivo ${relPath} existe y no está vacío (${size} bytes)`);
}

// 3. Verificación de Web Manifest
const manifestPath = path.join(rootDir, 'public/site.webmanifest');
const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
assert(manifestContent.name === 'Stack', 'site.webmanifest name es "Stack"');
assert(manifestContent.short_name === 'Stack', 'site.webmanifest short_name es "Stack"');
assert(manifestContent.theme_color === '#171A52', 'site.webmanifest theme_color es "#171A52"');
assert(
  Array.isArray(manifestContent.icons) && manifestContent.icons.length >= 3,
  'site.webmanifest declara íconos 192, 512 y maskable'
);

// 4. Verificación de index.html
const indexHtmlPath = path.join(rootDir, 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');
assert(
  indexHtml.includes('<title>Stack — Tu carrera, materia a materia</title>'),
  'index.html: <title> oficial de Stack'
);
assert(
  indexHtml.includes('content="Seguí tu carrera, tus correlativas, tus horarios y las reseñas de profesores en un solo lugar."'),
  'index.html: meta description de Stack'
);
assert(
  indexHtml.includes('content="https://corre-ten.vercel.app/og-image.png"'),
  'index.html: og:image y twitter:image usan URL absoluta canónica con og-image.png'
);
assert(
  indexHtml.includes('href="/site.webmanifest"'),
  'index.html: enlace a /site.webmanifest'
);

// 5. Plantilla de Verificación por Email
const email = buildVerificationEmail('482910');
assert(email.subject === 'Tu código de verificación de Stack: 482910', 'Email subject menciona "Stack"');
assert(email.text.includes('Tu código de verificación de Stack es:'), 'Email text menciona "Stack"');
assert(email.html.includes('Stack') && email.html.includes('#FFB938'), 'Email HTML incluye "Stack" y color ámbar oficial');
assert(!email.html.includes('<img') && !email.html.includes('<a '), 'Email no incluye imágenes ni enlaces externos');

console.log('\n======================================================================');
console.log(` 📊 RESULTADO TESTS BRAND: ${passed} pasaron, ${failed} fallaron`);
console.log('======================================================================\n');

if (failed > 0) {
  process.exit(1);
}

