import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

const assets = [
  {
    source: join(root, 'src', 'fast_qr_wasm', 'wasm', 'qrstream_fast_qr_wasm_bg.wasm'),
    target: join(dist, 'qrstream_fast_qr_wasm_bg.wasm'),
  },
];

mkdirSync(dist, { recursive: true });

for (const asset of assets) {
  copyFileSync(asset.source, asset.target);
  console.log(`copied ${basename(asset.target)}`);
}
