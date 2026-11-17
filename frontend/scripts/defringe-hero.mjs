import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const brandDir = path.resolve(__dirname, '../public/brand');
const inputPng = path.join(brandDir, 'kids-uniform.png');
const outCleanPng = path.join(brandDir, 'kids-uniform.clean.png');
const outCleanWebp = path.join(brandDir, 'kids-uniform.clean.webp');
const outCleanAvif = path.join(brandDir, 'kids-uniform.clean.avif');

async function defringe() {
  console.log('Loading:', inputPng);
  const image = sharp(inputPng);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;

  const { data, info } = await sharp(inputPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const numPixels = width * height;
  const alphaBuffer = new Uint8Array(numPixels);

  // 1. For every pixel with alpha < 250 and R, G, B all > 225, set alpha to 0
  let haloCount = 0;
  for (let i = 0; i < numPixels; i++) {
    const offset = i * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    let a = data[offset + 3];

    if (a > 0 && a < 250 && r > 225 && g > 225 && b > 225) {
      a = 0;
      data[offset + 3] = 0;
      haloCount++;
    }
    alphaBuffer[i] = a;
  }
  console.log(`Eliminated ${haloCount} white halo/fringe pixels.`);

  // 2. Erode the alpha mask by 1px
  const erodedAlpha = new Uint8Array(alphaBuffer);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (alphaBuffer[idx] === 0) continue;

      // 4-neighborhood check
      let hasZeroNeighbor = false;
      if (x > 0 && alphaBuffer[idx - 1] === 0) hasZeroNeighbor = true;
      else if (x < width - 1 && alphaBuffer[idx + 1] === 0) hasZeroNeighbor = true;
      else if (y > 0 && alphaBuffer[idx - width] === 0) hasZeroNeighbor = true;
      else if (y < height - 1 && alphaBuffer[idx + width] === 0) hasZeroNeighbor = true;

      if (hasZeroNeighbor) {
        erodedAlpha[idx] = 0;
      }
    }
  }

  // Write eroded alpha back to raw buffer
  for (let i = 0; i < numPixels; i++) {
    data[i * 4 + 3] = erodedAlpha[i];
  }

  // 3. Trim transparent edges & constrain max-height: 1200
  let processed = sharp(data, {
    raw: {
      width,
      height,
      channels: 4,
    },
  }).trim();

  // If height > 1200, resize proportionally
  const trimmedMeta = await processed.toBuffer({ resolveWithObject: true });
  const trimmedSharp = sharp(trimmedMeta.data, {
    raw: {
      width: trimmedMeta.info.width,
      height: trimmedMeta.info.height,
      channels: 4,
    },
  });

  const finalHeight = trimmedMeta.info.height > 1200 ? 1200 : trimmedMeta.info.height;
  const resized = trimmedSharp.resize({ height: finalHeight, withoutEnlargement: true });

  // Get final buffer
  const finalPngBuffer = await resized.png().toBuffer();
  fs.writeFileSync(outCleanPng, finalPngBuffer);
  console.log('Saved:', outCleanPng, `(${Math.round(finalPngBuffer.length / 1024)} KB)`);

  const finalWebpBuffer = await sharp(finalPngBuffer).webp({ quality: 82 }).toBuffer();
  fs.writeFileSync(outCleanWebp, finalWebpBuffer);
  console.log('Saved:', outCleanWebp, `(${Math.round(finalWebpBuffer.length / 1024)} KB)`);

  const finalAvifBuffer = await sharp(finalPngBuffer).avif({ quality: 82 }).toBuffer();
  fs.writeFileSync(outCleanAvif, finalAvifBuffer);
  console.log('Saved:', outCleanAvif, `(${Math.round(finalAvifBuffer.length / 1024)} KB)`);

  const finalMeta = await sharp(finalPngBuffer).metadata();
  console.log(`Cleaned image dimensions: ${finalMeta.width} x ${finalMeta.height}`);
}

defringe().catch((err) => {
  console.error('Defringe failed:', err);
  process.exit(1);
});
