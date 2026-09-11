import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('public/icons', { recursive: true });
const svg = await readFile('public/icon.svg');
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  await sharp(svg).resize(size, size).png().toFile(`public/icons/${name}.png`);
}
await sharp(Buffer.from(svg.toString().replace('rx="128"', 'rx="0"'))).png().toFile('public/icons/maskable-512.png');
