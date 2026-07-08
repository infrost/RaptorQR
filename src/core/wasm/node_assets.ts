/**
 * Node-only WASM asset resolution.
 *
 * Browser builds let Vite rewrite `*.wasm?url` imports.  The CLI is bundled as
 * a plain Node ESM file, so WASM sidecars need an explicit filesystem lookup.
 * Keep this generic so future CLI ZXing/RaptorQ loaders can reuse the same
 * package-relative asset convention.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface NodeWasmAsset {
  /** File copied next to the bundled CLI entrypoint in `dist/`. */
  distFileName: string;
  /** Repo/package-relative source path kept for dev and npm source fallback. */
  sourceRelativePath: string;
  /** Optional absolute path override for local debugging. */
  envVar?: string;
}

export function readNodeWasmAsset(asset: NodeWasmAsset): Uint8Array {
  for (const candidate of nodeWasmAssetCandidates(asset)) {
    if (existsSync(candidate)) {
      return new Uint8Array(readFileSync(candidate));
    }
  }

  throw new Error(
    `WASM asset not found: ${asset.distFileName}. ` +
    `Expected it next to the CLI bundle or at ${asset.sourceRelativePath}.`,
  );
}

export function nodeWasmAssetCandidates(asset: NodeWasmAsset): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates: Array<string | undefined> = [
    asset.envVar ? process.env[asset.envVar] : undefined,
    resolve(here, asset.distFileName),
    resolve(process.cwd(), 'dist', asset.distFileName),
    resolve(process.cwd(), asset.sourceRelativePath),
    findUp(here, asset.sourceRelativePath),
  ];

  return dedupe(candidates.filter((value): value is string => Boolean(value)));
}

function findUp(startDir: string, relativePath: string): string | undefined {
  let dir = resolve(startDir);
  const root = parse(dir).root;

  while (true) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
