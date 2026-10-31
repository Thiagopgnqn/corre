import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const brandDir = path.join(publicDir, 'brand');

const BRAND_SVG_PATH = path.join(brandDir, 'stack-logo.svg');

/**
 * Función para empaquetar buffers PNG (16, 32, 48) dentro de un archivo binario ICO válido.
 */
function createIco(images) {
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo 1 = ICO
  header.writeUInt16LE(count, 4); // cantidad de imágenes

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.width === 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height === 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // paleta
    entry.writeUInt8(0, 3); // reservado
    entry.writeUInt16LE(1, 4); // planos de color
    entry.writeUInt16LE(32, 6); // bits por píxel
    entry.writeUInt32LE(img.buffer.length, 8); // tamaño del buffer
    entry.writeUInt32LE(offset, 12); // desplazamiento
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map((img) => img.buffer)]);
}

async function main() {
  console.log('🚀 Generando assets de marca Stack...');

  await fs.mkdir(brandDir, { recursive: true });

  const baseSvg = await fs.readFile(BRAND_SVG_PATH, 'utf-8');

  // 1. Favicon SVG optimizado (esquinas redondeadas para lectura nítida en pestaña del navegador)
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Stack">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2A2E8A"/>
      <stop offset="100%" stop-color="#171A52"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <g fill="#F4F5FB">
    <rect x="136" y="140" width="44" height="116" rx="12"/>
    <rect x="332" y="256" width="44" height="116" rx="12"/>
    <rect x="136" y="234" width="240" height="44" rx="12"/>
    <rect x="136" y="350" width="240" height="44" rx="12"/>
  </g>
  <rect x="136" y="118" width="240" height="44" rx="12" fill="#FFB938"/>
  <rect x="136" y="140" width="24" height="22" fill="#FFB938"/>
</svg>`;
  await fs.writeFile(path.join(publicDir, 'favicon.svg'), faviconSvg, 'utf-8');
  console.log('  ✓ public/favicon.svg generado');

  // 2. Favicon ICO (16, 32, 48)
  const icoSizes = [16, 32, 48];
  const icoBuffers = [];
  for (const size of icoSizes) {
    const buf = await sharp(Buffer.from(faviconSvg))
      .resize(size, size)
      .png()
      .toBuffer();
    icoBuffers.push({ width: size, height: size, buffer: buf });
  }
  const icoFileBuffer = createIco(icoBuffers);
  await fs.writeFile(path.join(publicDir, 'favicon.ico'), icoFileBuffer);
  console.log('  ✓ public/favicon.ico generado (16x16, 32x32, 48x48)');

  // 3. Apple Touch Icon (180x180)
  await sharp(Buffer.from(faviconSvg))
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('  ✓ public/apple-touch-icon.png generado (180x180)');

  // 4. Íconos PWA (192x192 y 512x512)
  await sharp(Buffer.from(faviconSvg))
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));
  console.log('  ✓ public/icon-192.png generado (192x192)');

  await sharp(Buffer.from(faviconSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));
  console.log('  ✓ public/icon-512.png generado (512x512)');

  // 5. Ícono Maskable con margen seguro (para recortes circulares de Android sin cortar el isotipo)
  const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2A2E8A"/>
      <stop offset="100%" stop-color="#171A52"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(64, 64) scale(0.75)">
    <g fill="#F4F5FB">
      <rect x="136" y="140" width="44" height="116" rx="12"/>
      <rect x="332" y="256" width="44" height="116" rx="12"/>
      <rect x="136" y="234" width="240" height="44" rx="12"/>
      <rect x="136" y="350" width="240" height="44" rx="12"/>
    </g>
    <rect x="136" y="118" width="240" height="44" rx="12" fill="#FFB938"/>
    <rect x="136" y="140" width="24" height="22" fill="#FFB938"/>
  </g>
</svg>`;
  await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icon-maskable.png'));
  console.log('  ✓ public/icon-maskable.png generado (512x512 maskable)');

  // 6. Open Graph Image (1200x630) para previsualizaciones en WhatsApp, Twitter, LinkedIn
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="ogbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b1e60"/>
      <stop offset="50%" stop-color="#171A52"/>
      <stop offset="100%" stop-color="#0b0e2b"/>
    </linearGradient>
    <radialGradient id="glow" cx="25%" cy="50%" r="40%">
      <stop offset="0%" stop-color="#2A2E8A" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#171A52" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#ogbg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Borde sutil -->
  <rect x="32" y="32" width="1136" height="566" rx="24" fill="none" stroke="#2A2E8A" stroke-width="2" stroke-opacity="0.4"/>

  <!-- Símbolo Isotipo Stack -->
  <g transform="translate(100, 175) scale(0.55)">
    <rect width="512" height="512" rx="96" fill="#171A52" stroke="#2A2E8A" stroke-width="12"/>
    <g fill="#F4F5FB">
      <rect x="136" y="140" width="44" height="116" rx="12"/>
      <rect x="332" y="256" width="44" height="116" rx="12"/>
      <rect x="136" y="234" width="240" height="44" rx="12"/>
      <rect x="136" y="350" width="240" height="44" rx="12"/>
    </g>
    <rect x="136" y="118" width="240" height="44" rx="12" fill="#FFB938"/>
    <rect x="136" y="140" width="24" height="22" fill="#FFB938"/>
  </g>

  <!-- Tipografía de Marca -->
  <text x="430" y="270" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Plus Jakarta Sans', sans-serif" font-weight="900" font-size="88" letter-spacing="-2">Stack</text>
  <text x="430" y="340" fill="#FFB938" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Plus Jakarta Sans', sans-serif" font-weight="700" font-size="34">Tu carrera, materia a materia</text>
  <text x="430" y="405" fill="#CBD5E1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Plus Jakarta Sans', sans-serif" font-weight="500" font-size="22">Seguí tu carrera, tus correlativas, tus horarios y las reseñas</text>
  <text x="430" y="440" fill="#94A3B8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Plus Jakarta Sans', sans-serif" font-weight="500" font-size="22">de profesores en un solo lugar.</text>
</svg>`;
  await sharp(Buffer.from(ogSvg))
    .resize(1200, 630)
    .png()
    .toFile(path.join(publicDir, 'og-image.png'));
  console.log('  ✓ public/og-image.png generado (1200x630)');

  // 7. Web Manifest
  const manifest = {
    name: 'Stack',
    short_name: 'Stack',
    description: 'Seguí tu carrera, tus correlativas, tus horarios y las reseñas de profesores en un solo lugar.',
    start_url: '/',
    display: 'standalone',
    background_color: '#090D16',
    theme_color: '#171A52',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  await fs.writeFile(
    path.join(publicDir, 'site.webmanifest'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  );
  console.log('  ✓ public/site.webmanifest generado');

  console.log('\n🎉 ¡Todos los assets de marca Stack han sido generados exitosamente en public/!');
}

main().catch((err) => {
  console.error('Error al generar assets de marca:', err);
  process.exit(1);
});

