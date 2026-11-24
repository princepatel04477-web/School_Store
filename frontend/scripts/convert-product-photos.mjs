// Turns square product photos (PNG or JPG) into the two WebP sizes the store serves:
//   <name>.webp      1000 x 1000, quality 82   (product sheet)
//   <name>-400.webp   400 x 400,  quality 82   (cards and lists)
// The base file name is kept, so a photo named kv-coatie-grey.png becomes
// kv-coatie-grey.webp and kv-coatie-grey-400.webp. Originals are never written
// into public/, so they stay out of the deployed bundle.
//
// Usage (from frontend/):
//   node scripts/convert-product-photos.mjs <source-folder> [output-folder]
// The output folder defaults to public/products.

import { mkdir, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';

const FULL = 1000;
const THUMB = 400;
const QUALITY = 82;
const SOURCE_TYPES = new Set(['.png', '.jpg', '.jpeg']);
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg) {
  console.error('Usage: node scripts/convert-product-photos.mjs <source-folder> [output-folder]');
  process.exit(1);
}
const sourceDir = resolve(sourceArg);
const outputDir = resolve(outputArg ?? 'public/products');

const files = (await readdir(sourceDir))
  .filter((file) => SOURCE_TYPES.has(extname(file).toLowerCase()))
  .sort();
if (files.length === 0) {
  console.error(`No PNG or JPG photos in ${sourceDir}`);
  process.exit(1);
}
await mkdir(outputDir, { recursive: true });

let failed = false;
for (const file of files) {
  const name = basename(file, extname(file));
  if (!NAME_PATTERN.test(name)) {
    console.error(`skip ${file}: file names must be lowercase kebab-case`);
    failed = true;
    continue;
  }
  const source = join(sourceDir, file);
  const { width, height } = await sharp(source).metadata();
  if (width !== height) {
    console.error(`skip ${file}: photo is ${width}x${height}, expected a square`);
    failed = true;
    continue;
  }
  for (const [suffix, size] of [['', FULL], ['-400', THUMB]]) {
    const target = join(outputDir, `${name}${suffix}.webp`);
    const info = await sharp(source)
      .resize(size, size, { fit: 'cover' })
      .webp({ quality: QUALITY })
      .toFile(target);
    console.log(`${name}${suffix}.webp  ${size}x${size}  ${(info.size / 1024).toFixed(0)} KB`);
  }
}
if (failed) process.exit(1);
