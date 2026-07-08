import fastQrWasmUrl from '@raptorqr/wasm/fast-qr/wasm/qrstream_fast_qr_wasm_bg.wasm?url';
import raptorqWasmUrl from '@raptorqr/wasm/raptorq/wasm/qrstream_raptorq_wasm_bg.wasm?url';
import {
  zxingReaderWasmUrl,
  zxingWriterWasmUrl,
} from '@raptorqr/core/qr/zxing_assets';
import decodeWorkerUrl from '@/workers/decode.worker.ts?worker&url';
import encodeWorkerUrl from '@/workers/encode.worker.ts?worker&url';
import gifWorkerUrl from '@/workers/gif.worker.ts?worker&url';
import qrRenderWorkerUrl from '@/workers/qr_render.worker.ts?worker&url';

export const APP_CACHE_NAME = 'raptorqr-v1';

export interface PreloadProgress {
  completed: number;
  total: number;
  currentLabel: string;
}

interface RuntimeAsset {
  label: string;
  url: string;
}

const WASM_ASSETS: RuntimeAsset[] = [
  { label: 'fast_qr renderer', url: fastQrWasmUrl },
  { label: 'RaptorQ codec', url: raptorqWasmUrl },
  { label: 'ZXing reader', url: zxingReaderWasmUrl },
  { label: 'ZXing writer', url: zxingWriterWasmUrl },
];

const WORKER_ASSETS: RuntimeAsset[] = [
  { label: 'encode worker', url: encodeWorkerUrl },
  { label: 'decode worker', url: decodeWorkerUrl },
  { label: 'QR render worker', url: qrRenderWorkerUrl },
  { label: 'GIF worker', url: gifWorkerUrl },
];

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export async function preloadRuntimeAssets(
  onProgress: (progress: PreloadProgress) => void,
): Promise<void> {
  const assets = collectRuntimeAssets();
  let completed = 0;

  onProgress({
    completed,
    total: assets.length,
    currentLabel: assets[0]?.label ?? 'runtime',
  });

  for (const asset of assets) {
    onProgress({ completed, total: assets.length, currentLabel: asset.label });
    await cacheRuntimeAsset(asset);
    completed++;
    onProgress({ completed, total: assets.length, currentLabel: asset.label });
  }
}

function collectRuntimeAssets(): RuntimeAsset[] {
  const assets: RuntimeAsset[] = [
    { label: 'app shell', url: new URL('./', window.location.href).toString() },
    { label: 'index document', url: new URL('./index.html', window.location.href).toString() },
    ...collectLinkedDocumentAssets(),
    ...WORKER_ASSETS,
    ...WASM_ASSETS,
  ];

  const seen = new Set<string>();
  return assets.filter((asset) => {
    const absoluteUrl = new URL(asset.url, window.location.href).toString();
    if (seen.has(absoluteUrl)) return false;
    seen.add(absoluteUrl);
    asset.url = absoluteUrl;
    return true;
  });
}

function collectLinkedDocumentAssets(): RuntimeAsset[] {
  const assets: RuntimeAsset[] = [];

  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((script) => {
    assets.push({ label: 'app script', url: script.src });
  });

  document
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href], link[rel="manifest"][href], link[rel="icon"][href]')
    .forEach((link) => {
      assets.push({ label: documentAssetLabel(link), url: link.href });
    });

  return assets;
}

function documentAssetLabel(link: HTMLLinkElement): string {
  if (link.rel === 'manifest') return 'web manifest';
  if (link.rel === 'icon') return 'app icon';
  return 'stylesheet';
}

async function cacheRuntimeAsset(asset: RuntimeAsset): Promise<void> {
  const request = new Request(asset.url, {
    cache: 'reload',
    credentials: 'same-origin',
  });

  if ('caches' in window) {
    const cache = await caches.open(APP_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached?.ok) return;

    const response = await fetch(request);
    if (!response.ok) {
      throw new Error(`Failed to preload ${asset.label}: HTTP ${response.status}`);
    }

    await cache.put(request, response.clone());
    return;
  }

  const response = await fetch(asset.url, {
    cache: 'force-cache',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Failed to preload ${asset.label}: HTTP ${response.status}`);
  }
}
