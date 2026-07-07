/**
 * Sender page — text/file input, live QR playback, and GIF export.
 */
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import type { EccLevel } from '@/core/qr/qr_encode';
import {
  DEFAULT_QR_ENCODER,
  QR_ENCODERS,
  formatQREncoder,
  normalizeQREncoder,
  type QREncoder,
} from '@/core/qr/qr_encoder_browser';
import {
  DEFAULT_QR_ECC_LEVEL,
  DEFAULT_QR_VERSION,
  ECC_LEVEL_OPTIONS,
  QR_VERSION_OPTIONS,
  createQRTransferProfile,
  type QRTransferProfile,
  type QRVersionOption,
} from '@/core/protocol/profiles';
import {
  stripedFrameCount,
  stripedPacketIndex,
  type ParallelQRCount,
} from '@/core/sender/parallel_striping';
import {
  DEFAULT_FEC_CODEC,
  DEFAULT_RAPTORQ_REPAIR_PERCENT,
  MAX_RAPTORQ_REPAIR_PERCENT,
  MIN_RAPTORQ_REPAIR_PERCENT,
  formatFecCodec,
  normalizeFecCodec,
  normalizeRaptorQRepairPercent,
  type FecCodec,
} from '@/core/fec/codec';

// ─── Types ───────────────────────────────────────────────────────────────────

type InputMode = 'text' | 'file';

interface GifResult {
  gifData: ArrayBuffer;
  width: number;
  height: number;
  frameCount: number;
  frameRateFps: number;
  frameDelayMs: number;
  parallelCount: ParallelQRCount;
}

interface LiveTransfer {
  packets: Uint8Array[];
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  version: number;
  eccLevel: EccLevel;
  qrEncoder: QREncoder;
  symbolSize: number;
  scale: number;
  displayFrameCount: number;
  parallelCount: ParallelQRCount;
}

interface RenderedTile {
  source: CanvasImageSource;
  close?: () => void;
}

interface FrameCache {
  frames: Map<number, RenderedTile>;
  maxEntries: number;
}

type RenderWorkerMessage =
  | { type: 'tile'; requestId: number; packetIndex: number; imageData: ImageData }
  | { type: 'done'; requestId: number }
  | { type: 'error'; requestId: number; packetIndex?: number; message: string };

// ─── Styles ───────────────────────────────────────────────────────────────────

type CSSProps = Record<string, string | number>;

const MIN_FRAME_RATE_FPS = 2;
const MAX_FRAME_RATE_FPS = 60;
const DEFAULT_FRAME_RATE_FPS = 30;
const DEFAULT_PARALLEL_QR_COUNT: ParallelQRCount = 1;
const PARALLEL_QR_COUNTS: ParallelQRCount[] = [1, 2, 4];
const FEC_CODEC_OPTIONS: FecCodec[] = ['wasm-raptorq', 'js-rlnc'];
const LIVE_TARGET_PX = 360;
const QR_QUIET_ZONE_MODULES = 4;
const FRAME_CACHE_LIMIT = 240;
const PREFETCH_DISPLAY_FRAMES = 120;
const QR_RENDER_BATCH_LIMIT = 96;

const S = {
  section: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  } as CSSProps,
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#8b949e',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  row: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  btn: {
    background: '#238636',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 24px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  } as CSSProps,
  btnSecondary: {
    background: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '10px 24px',
    fontSize: 15,
    cursor: 'pointer',
  } as CSSProps,
  textarea: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#0d1117',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    fontFamily: 'monospace',
    resize: 'vertical' as const,
    minHeight: 120,
  },
  preview: {
    background: '#fff',
    borderRadius: 8,
    imageRendering: 'pixelated' as const,
    maxWidth: '100%',
    display: 'block',
  } as CSSProps,
  qrStage: (fullscreen: boolean): CSSProps => ({
    background: '#fff',
    borderRadius: fullscreen ? 0 : 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: fullscreen ? 0 : '12px 0',
    width: fullscreen ? '100vw' : 'fit-content',
    height: fullscreen ? '100vh' : 'auto',
    maxWidth: '100%',
  }),
  fullscreenPreview: {
    width: '100vw',
    height: '100vh',
    borderRadius: 0,
    objectFit: 'contain',
  } as CSSProps,
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    fontSize: 13,
  } as CSSProps,
  infoLabel: { color: '#8b949e' },
  infoValue: { color: '#f0f6fc', fontFamily: 'monospace' },
  slider: {
    width: '100%',
    accentColor: '#58a6ff',
  } as CSSProps,
  sliderLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#8b949e',
    fontSize: 12,
    marginTop: 4,
  } as CSSProps,
  select: {
    width: '100%',
    background: '#0d1117',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '9px 10px',
    fontSize: 14,
  } as CSSProps,
  warn: {
    background: '#3d2600',
    border: '1px solid #bb8009',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#d29922',
    fontSize: 13,
    marginTop: 8,
  },
  toggleGroup: {
    display: 'flex',
    gap: 4,
    background: '#0d1117',
    borderRadius: 6,
    padding: 2,
  } as CSSProps,
  toggleBtn: (active: boolean): CSSProps => ({
    padding: '6px 14px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    background: active ? '#1f2937' : 'transparent',
    color: active ? '#f0f6fc' : '#8b949e',
    transition: 'all 0.15s',
  }),
  spinner: {
    width: 20,
    height: 20,
    border: '2px solid #30363d',
    borderTopColor: '#58a6ff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    display: 'inline-block',
    verticalAlign: 'middle',
    marginRight: 8,
  } as CSSProps,
};

// ─── Component ───────────────────────────────────────────────────────────────────

export function SenderPage() {
  const [mode, setMode] = useState<InputMode>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [encodingLive, setEncodingLive] = useState(false);
  const [preparingGif, setPreparingGif] = useState(false);
  const [status, setStatus] = useState('');
  const [qrVersion, setQrVersion] = useState<QRVersionOption>(DEFAULT_QR_VERSION);
  const [eccLevel, setEccLevel] = useState<EccLevel>(DEFAULT_QR_ECC_LEVEL);
  const [qrEncoder, setQrEncoder] = useState<QREncoder>(DEFAULT_QR_ENCODER);
  const [fecCodec, setFecCodec] = useState<FecCodec>(DEFAULT_FEC_CODEC);
  const [raptorqRepairPercent, setRaptorqRepairPercent] = useState(DEFAULT_RAPTORQ_REPAIR_PERCENT);
  const [frameRateFps, setFrameRateFps] = useState(DEFAULT_FRAME_RATE_FPS);
  const [parallelQRCount, setParallelQRCount] = useState<ParallelQRCount>(DEFAULT_PARALLEL_QR_COUNT);
  const [liveTransfer, setLiveTransfer] = useState<LiveTransfer | null>(null);
  const [gifResult, setGifResult] = useState<GifResult | null>(null);
  const [stats, setStats] = useState<{
    originalSize: number;
    preprocessedSize: number;
    frameCount: number;
    totalGenerations: number;
    qrEncoder: QREncoder;
    fecCodec: FecCodec;
    raptorqRepairPercent: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [fullscreenActive, setFullscreenActive] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrStageRef = useRef<HTMLDivElement | null>(null);
  const liveTransferRef = useRef<LiveTransfer | null>(null);
  const encodeWorkerRef = useRef<Worker | null>(null);
  const gifWorkerRef = useRef<Worker | null>(null);
  const qrRenderWorkerRef = useRef<Worker | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const liveFrameIndexRef = useRef(0);
  const frameRateFpsRef = useRef(DEFAULT_FRAME_RATE_FPS);
  const frameCacheRef = useRef<FrameCache>(createFrameCache());
  const requestedPacketImagesRef = useRef<Set<number>>(new Set());
  const playbackStartedRef = useRef(false);
  const runIdRef = useRef(0);
  const qrRenderRequestIdRef = useRef(0);
  const qrProfile = createQRTransferProfile(qrVersion, eccLevel, qrEncoder);
  const frameDelayMs = frameRateToDelayMs(frameRateFps);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const terminateEncodeWorker = useCallback(() => {
    encodeWorkerRef.current?.terminate();
    encodeWorkerRef.current = null;
  }, []);

  const terminateGifWorker = useCallback(() => {
    gifWorkerRef.current?.terminate();
    gifWorkerRef.current = null;
  }, []);

  const terminateQRRenderWorker = useCallback(() => {
    qrRenderRequestIdRef.current++;
    qrRenderWorkerRef.current?.terminate();
    qrRenderWorkerRef.current = null;
  }, []);

  const requestRenderWindow = useCallback((
    transfer: LiveTransfer,
    startFrameIndex: number,
  ) => {
    const worker = qrRenderWorkerRef.current;
    if (!worker) return;

    const missingPacketIndexes: number[] = [];
    const endFrameIndex = startFrameIndex + PREFETCH_DISPLAY_FRAMES;

    for (let frameIndex = startFrameIndex; frameIndex < endFrameIndex; frameIndex++) {
      const normalizedFrameIndex = frameIndex % transfer.displayFrameCount;
      for (let tileIndex = 0; tileIndex < transfer.parallelCount; tileIndex++) {
        const packetIndex = getPacketIndexForDisplayFrame(
          transfer,
          normalizedFrameIndex,
          tileIndex,
        );
        if (packetIndex === null) continue;
        if (frameCacheRef.current.frames.has(packetIndex)) continue;
        if (requestedPacketImagesRef.current.has(packetIndex)) continue;

        requestedPacketImagesRef.current.add(packetIndex);
        missingPacketIndexes.push(packetIndex);
        if (missingPacketIndexes.length >= QR_RENDER_BATCH_LIMIT) {
          break;
        }
      }
      if (missingPacketIndexes.length >= QR_RENDER_BATCH_LIMIT) {
        break;
      }
    }

    if (missingPacketIndexes.length === 0) return;

    const requestId = qrRenderRequestIdRef.current;
    worker.postMessage({
      type: 'renderTiles',
      requestId,
      qrVersion: transfer.version,
      eccLevel: transfer.eccLevel,
      qrEncoder: transfer.qrEncoder,
      tiles: missingPacketIndexes.map((packetIndex) => ({
        packetIndex,
        packet: transfer.packets[packetIndex]!,
      })),
    });
  }, []);

  const scheduleNextLiveFrame = useCallback(() => {
    clearPlaybackTimer();
    const delayMs = frameRateToDelayMs(frameRateFpsRef.current);

    playbackTimerRef.current = window.setTimeout(() => {
      const transfer = liveTransferRef.current;
      const canvas = canvasRef.current;
      if (!transfer || !canvas) return;

      try {
        const frameIndex = liveFrameIndexRef.current % transfer.displayFrameCount;
        requestRenderWindow(transfer, frameIndex);
        if (!isDisplayFrameReady(transfer, frameIndex, frameCacheRef.current)) {
          scheduleNextLiveFrame();
          return;
        }

        drawLiveFrame(canvas, transfer, frameIndex, frameCacheRef.current);
        requestRenderWindow(transfer, frameIndex + 1);
        liveFrameIndexRef.current = (frameIndex + 1) % transfer.displayFrameCount;
        scheduleNextLiveFrame();
      } catch (err: any) {
        clearPlaybackTimer();
        setError(err.message ?? String(err));
      }
    }, delayMs);
  }, [clearPlaybackTimer, requestRenderWindow]);

  const startLivePlayback = useCallback((resetIndex: boolean) => {
    clearPlaybackTimer();

    const transfer = liveTransferRef.current;
    const canvas = canvasRef.current;
    if (!transfer || !canvas) return;

    if (resetIndex) {
      liveFrameIndexRef.current = 0;
    }

    const frameIndex = liveFrameIndexRef.current % transfer.displayFrameCount;
    requestRenderWindow(transfer, frameIndex);
    if (!isDisplayFrameReady(transfer, frameIndex, frameCacheRef.current)) {
      scheduleNextLiveFrame();
      return;
    }

    drawLiveFrame(canvas, transfer, frameIndex, frameCacheRef.current);
    requestRenderWindow(transfer, frameIndex + 1);
    liveFrameIndexRef.current = (frameIndex + 1) % transfer.displayFrameCount;
    scheduleNextLiveFrame();
  }, [clearPlaybackTimer, requestRenderWindow, scheduleNextLiveFrame]);

  useEffect(() => {
    frameRateFpsRef.current = frameRateFps;
  }, [frameRateFps]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenActive(document.fullscreenElement === qrStageRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    liveTransferRef.current = liveTransfer;
    clearFrameCache(frameCacheRef.current);
    requestedPacketImagesRef.current.clear();
    playbackStartedRef.current = false;
    clearPlaybackTimer();
    terminateQRRenderWorker();

    if (!liveTransfer) {
      return clearPlaybackTimer;
    }

    const requestId = ++qrRenderRequestIdRef.current;
    const worker = new Worker(
      new URL('@/workers/qr_render.worker.ts', import.meta.url),
      { type: 'module' },
    );
    qrRenderWorkerRef.current = worker;
    setStatus('Rendering first QR frame…');

    worker.onmessage = (e: MessageEvent<RenderWorkerMessage>) => {
      const msg = e.data;
      if (msg.requestId !== qrRenderRequestIdRef.current) return;

      if (msg.type === 'tile') {
        void (async () => {
          try {
            const renderedTile = await prepareRenderedTile(msg.imageData);
            if (msg.requestId !== qrRenderRequestIdRef.current) {
              closeRenderedTile(renderedTile);
              return;
            }

            requestedPacketImagesRef.current.delete(msg.packetIndex);
            cacheRenderedTile(frameCacheRef.current, msg.packetIndex, renderedTile);
            trimFrameCache(frameCacheRef.current);

            if (!playbackStartedRef.current && isDisplayFrameReady(liveTransfer, 0, frameCacheRef.current)) {
              playbackStartedRef.current = true;
              setStatus(
                `Live QR running (${liveTransfer.packets.length} packets, ` +
                `${liveTransfer.parallelCount} per tick).`,
              );
              startLivePlayback(true);
            }
          } catch (err: any) {
            requestedPacketImagesRef.current.delete(msg.packetIndex);
            setError(err.message ?? String(err));
          }
        })();
        return;
      }

      if (msg.type === 'error') {
        requestedPacketImagesRef.current.delete(msg.packetIndex ?? -1);
        setError(msg.message);
      }
    };

    worker.onerror = (err) => {
      setError(err.message || 'QR render worker failed.');
    };

    requestRenderWindow(liveTransfer, 0);

    return () => {
      qrRenderRequestIdRef.current++;
      clearPlaybackTimer();
      if (qrRenderWorkerRef.current === worker) {
        qrRenderWorkerRef.current = null;
      }
      worker.terminate();
      requestedPacketImagesRef.current.clear();
      playbackStartedRef.current = false;
      clearFrameCache(frameCacheRef.current);
    };
  }, [
    liveTransfer,
    clearPlaybackTimer,
    requestRenderWindow,
    startLivePlayback,
    terminateQRRenderWorker,
  ]);

  /** Wipe all output state and stop any live playback loop. */
  const resetOutput = useCallback(() => {
    runIdRef.current++;
    terminateEncodeWorker();
    terminateGifWorker();
    terminateQRRenderWorker();
    clearPlaybackTimer();
    liveTransferRef.current = null;
    liveFrameIndexRef.current = 0;
    clearFrameCache(frameCacheRef.current);
    requestedPacketImagesRef.current.clear();
    playbackStartedRef.current = false;
    setLiveTransfer(null);
    setGifResult(null);
    setStats(null);
    setEncodingLive(false);
    setPreparingGif(false);
    setError('');
    setStatus('');
  }, [clearPlaybackTimer, terminateEncodeWorker, terminateGifWorker, terminateQRRenderWorker]);

  const handleStopTransfer = useCallback(() => {
    resetOutput();
    setStatus('Stopped.');
  }, [resetOutput]);

  const handleModeChange = useCallback((newMode: InputMode) => {
    setMode(newMode);
    resetOutput();
  }, [resetOutput]);

  const handleTextChange = useCallback((value: string) => {
    setText(value);
    if (liveTransfer || gifResult || stats || encodingLive || preparingGif) {
      resetOutput();
    }
  }, [resetOutput, liveTransfer, gifResult, stats, encodingLive, preparingGif]);

  const handleFile = useCallback((e: Event) => {
    const input = e.target as HTMLInputElement;
    const newFile = input.files?.[0] ?? null;
    setFile(newFile);
    resetOutput();
  }, [resetOutput]);

  const handleQRVersionChange = useCallback((value: string) => {
    setQrVersion(parseQRVersionOption(value));
    resetOutput();
  }, [resetOutput]);

  const handleEccLevelChange = useCallback((value: string) => {
    setEccLevel(normalizeEccLevel(value));
    resetOutput();
  }, [resetOutput]);

  const handleQREncoderChange = useCallback((value: string) => {
    setQrEncoder(normalizeQREncoder(value));
    resetOutput();
  }, [resetOutput]);

  const handleFecCodecChange = useCallback((value: string) => {
    setFecCodec(normalizeFecCodec(value));
    resetOutput();
  }, [resetOutput]);

  const handleRaptorQRepairPercentChange = useCallback((value: string) => {
    setRaptorqRepairPercent(normalizeRaptorQRepairPercent(value));
    resetOutput();
  }, [resetOutput]);

  const handleFrameRateChange = useCallback((value: string) => {
    const nextFrameRate = clampFrameRate(Number(value));
    frameRateFpsRef.current = nextFrameRate;
    setFrameRateFps(nextFrameRate);
    if (liveTransferRef.current) {
      startLivePlayback(false);
    }
  }, [startLivePlayback]);

  const handleParallelQRCountChange = useCallback((value: string) => {
    setParallelQRCount(normalizeParallelQRCount(Number(value)));
    resetOutput();
  }, [resetOutput]);

  const handleStartLiveTransfer = useCallback(async () => {
    resetOutput();
    const runId = runIdRef.current;

    let data: ArrayBuffer;
    let isText: boolean;

    if (mode === 'text') {
      const trimmed = text.trim();
      if (!trimmed) { setError('Please enter some text.'); return; }
      data = new TextEncoder().encode(trimmed).buffer;
      isText = true;
    } else {
      if (!file) { setError('Please select a file.'); return; }
      if (file.size > 8 * 1024 * 1024) { setError('File too large. Maximum size is 8 MB.'); return; }
      data = await file.arrayBuffer();
      isText = false;
    }

    const compress = data.byteLength > 64;
    const selectedQRProfile = createQRTransferProfile(qrVersion, eccLevel, qrEncoder);

    setEncodingLive(true);
    setStatus('Encoding live QR…');

    let encodeWorker: Worker | null = null;

    try {
      encodeWorker = new Worker(
        new URL('@/workers/encode.worker.ts', import.meta.url),
        { type: 'module' },
      );
      encodeWorkerRef.current = encodeWorker;

      const encoded = await new Promise<{
        packets: Uint8Array[];
        totalGenerations: number;
        stats: { originalSize: number; preprocessedSize: number; frameCount: number };
      }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Encode worker timed out')), 120_000);
        encodeWorker.onmessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          if (e.data.type === 'encoded') {
            resolve(e.data);
          } else if (e.data.type === 'error') {
            reject(new Error(e.data.message));
          }
        };
        encodeWorker.onerror = (err) => { clearTimeout(timeout); reject(err); };
        encodeWorker.postMessage(
          {
            type: 'encode',
            data,
            isText,
            compress,
            symbolSize: selectedQRProfile.maxPayloadSize,
            fecCodec,
            raptorqRepairPercent,
            filename: mode === 'file' ? file?.name : undefined,
            mimeType: mode === 'file' ? file?.type : undefined,
          },
          [data],
        );
      });

      if (runId !== runIdRef.current) return;

      setStats({
        originalSize: encoded.stats.originalSize,
        preprocessedSize: encoded.stats.preprocessedSize,
        frameCount: encoded.stats.frameCount,
        totalGenerations: encoded.totalGenerations,
        qrEncoder,
        fecCodec,
        raptorqRepairPercent,
      });
      const nextLiveTransfer = createLiveTransfer(
        encoded.packets,
        selectedQRProfile,
        qrEncoder,
        parallelQRCount,
      );
      setLiveTransfer(nextLiveTransfer);
      setStatus(
        `Encoded ${encoded.stats.frameCount} packets. Rendering first QR frame…`,
      );
    } catch (err: any) {
      if (runId === runIdRef.current) {
        setError(err.message ?? String(err));
      }
    } finally {
      if (encodeWorker) {
        encodeWorker.terminate();
      }
      if (encodeWorkerRef.current === encodeWorker) {
        encodeWorkerRef.current = null;
      }
      if (runId === runIdRef.current) {
        setEncodingLive(false);
      }
    }
  }, [mode, text, file, resetOutput, qrVersion, eccLevel, qrEncoder, fecCodec, raptorqRepairPercent, parallelQRCount]);

  const handlePrepareGif = useCallback(async () => {
    const transfer = liveTransferRef.current;
    if (!transfer) {
      setError('Start a live QR transfer before preparing a GIF.');
      return;
    }

    const runId = runIdRef.current;
    setPreparingGif(true);
    setGifResult(null);
    setError('');
    setStatus('Preparing GIF export…');

    let gifWorker: Worker | null = null;

    try {
      const outputFrameRateFps = frameRateFpsRef.current;
      const outputFrameDelayMs = Math.round(frameRateToDelayMs(outputFrameRateFps));
      gifWorker = new Worker(
        new URL('@/workers/gif.worker.ts', import.meta.url),
        { type: 'module' },
      );
      gifWorkerRef.current = gifWorker;

      const gif = await new Promise<GifResult>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('GIF worker timed out')), 120_000);
        gifWorker.onmessage = (e: MessageEvent) => {
          clearTimeout(timeout);
          if (e.data.type === 'gifReady') {
            resolve({
              gifData: e.data.gifData,
              width: e.data.width,
              height: e.data.height,
              frameCount: e.data.frameCount,
              frameRateFps: outputFrameRateFps,
              frameDelayMs: outputFrameDelayMs,
              parallelCount: transfer.parallelCount,
            });
          } else if (e.data.type === 'error') {
            reject(new Error(e.data.message));
          }
        };
        gifWorker.onerror = (err) => { clearTimeout(timeout); reject(err); };
        gifWorker.postMessage(
          {
            type: 'generate',
            packets: transfer.packets,
            frameDelayMs: outputFrameDelayMs,
            qrVersion: transfer.version,
            eccLevel: transfer.eccLevel,
            qrEncoder: transfer.qrEncoder,
            parallelCount: transfer.parallelCount,
          },
        );
      });

      if (runId !== runIdRef.current) return;

      setGifResult(gif);
      setStatus('GIF ready.');
    } catch (err: any) {
      if (runId === runIdRef.current) {
        setError(err.message ?? String(err));
      }
    } finally {
      if (gifWorker) {
        gifWorker.terminate();
      }
      if (gifWorkerRef.current === gifWorker) {
        gifWorkerRef.current = null;
      }
      if (runId === runIdRef.current) {
        setPreparingGif(false);
      }
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!gifResult) return;
    const blob = new Blob([gifResult.gifData], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-transfer-${stats?.totalGenerations ?? 0}g.gif`;
    a.click();
    URL.revokeObjectURL(url);
  }, [gifResult, stats]);

  const handleFullscreenPlayback = useCallback(async () => {
    const stage = qrStageRef.current;
    if (!stage) return;

    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
        return;
      }

      if (!stage.requestFullscreen) {
        setError('Fullscreen is not supported in this browser.');
        return;
      }

      await stage.requestFullscreen();
    } catch (err: any) {
      setError(`Fullscreen error: ${err.message ?? String(err)}`);
    }
  }, []);

  return (
    <div>
      <style>{`
        .qr-live-canvas {
          image-rendering: -moz-crisp-edges;
          image-rendering: pixelated;
        }
      `}</style>
      {/* ── Input mode toggle ───────────────────────────────────────────────── */}
      <div style={S.section}>
        <div style={S.row}>
          <span style={S.label}>Input mode</span>
          <div style={S.toggleGroup}>
            <button style={S.toggleBtn(mode === 'text')} onClick={() => handleModeChange('text')}>Text</button>
            <button style={S.toggleBtn(mode === 'file')} onClick={() => handleModeChange('file')}>File</button>
          </div>
        </div>

        {mode === 'text' ? (
          <textarea
            style={{ ...S.textarea, marginTop: 10 }}
            placeholder="Type or paste text to transfer…"
            value={text}
            onInput={(e) => handleTextChange((e.target as HTMLTextAreaElement).value)}
          />
        ) : (
          <div style={{ marginTop: 10 }}>
            <input type="file" onChange={handleFile} />
          </div>
        )}
      </div>

      {/* ── Generate ────────────────────────────────────────────────────── */}
      <div style={S.section}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>QR size</span>
            <span style={S.infoValue}>{qrProfile.maxPayloadSize} B/frame</span>
          </div>
          <select
            value={qrVersion}
            style={S.select}
            disabled={encodingLive}
            onChange={(e) => handleQRVersionChange((e.target as HTMLSelectElement).value)}
          >
            {QR_VERSION_OPTIONS.map((version) => {
              const profile = createQRTransferProfile(version, eccLevel, qrEncoder);
              return (
                <option key={version} value={version}>
                  V{version} · {profile.maxPayloadSize} B/frame
                </option>
              );
            })}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>QR ECC</span>
            <span style={S.infoValue}>{eccLevel}</span>
          </div>
          <select
            value={eccLevel}
            style={S.select}
            disabled={encodingLive}
            onChange={(e) => handleEccLevelChange((e.target as HTMLSelectElement).value)}
          >
            {ECC_LEVEL_OPTIONS.map((level) => {
              const profile = createQRTransferProfile(qrVersion, level, qrEncoder);
              return (
                <option key={level} value={level}>
                  {formatEccLevel(level)} · {profile.maxPayloadSize} B/frame
                </option>
              );
            })}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>QR encoder</span>
            <span style={S.infoValue}>{formatQREncoder(qrEncoder)}</span>
          </div>
          <select
            value={qrEncoder}
            style={S.select}
            disabled={encodingLive}
            onChange={(e) => handleQREncoderChange((e.target as HTMLSelectElement).value)}
          >
            {QR_ENCODERS.map((encoder) => (
              <option key={encoder} value={encoder}>
                {formatQREncoder(encoder)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>FEC codec</span>
            <span style={S.infoValue}>{formatFecCodec(fecCodec)}</span>
          </div>
          <select
            value={fecCodec}
            style={S.select}
            disabled={encodingLive}
            onChange={(e) => handleFecCodecChange((e.target as HTMLSelectElement).value)}
          >
            {FEC_CODEC_OPTIONS.map((codec) => (
              <option key={codec} value={codec}>
                {formatFecCodec(codec)}
              </option>
            ))}
          </select>
        </div>
        {fecCodec === 'wasm-raptorq' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={S.label}>RaptorQ repair</span>
              <span style={S.infoValue}>{raptorqRepairPercent}%</span>
            </div>
            <input
              type="range"
              min={MIN_RAPTORQ_REPAIR_PERCENT}
              max={MAX_RAPTORQ_REPAIR_PERCENT}
              step={1}
              value={raptorqRepairPercent}
              style={S.slider}
              disabled={encodingLive}
              onInput={(e) => handleRaptorQRepairPercentChange((e.target as HTMLInputElement).value)}
            />
            <div style={S.sliderLabels}>
              <span>Less QR</span>
              <span>More repair</span>
            </div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>QR speed</span>
            <span style={S.infoValue}>{frameRateFps} fps · {formatDelayMs(frameDelayMs)} ms/frame</span>
          </div>
          <input
            type="range"
            min={MIN_FRAME_RATE_FPS}
            max={MAX_FRAME_RATE_FPS}
            step={1}
            value={frameRateFps}
            style={S.slider}
            onInput={(e) => handleFrameRateChange((e.target as HTMLInputElement).value)}
          />
          <div style={S.sliderLabels}>
            <span>Stable</span>
            <span>Fast</span>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>Parallel QR</span>
            <span style={S.infoValue}>{parallelQRCount} per tick</span>
          </div>
          <select
            value={parallelQRCount}
            style={S.select}
            disabled={encodingLive}
            onChange={(e) => handleParallelQRCountChange((e.target as HTMLSelectElement).value)}
          >
            {PARALLEL_QR_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count} QR{count === 1 ? '' : 's'} per tick
              </option>
            ))}
          </select>
        </div>
        <div style={S.row}>
          <button
            style={encodingLive ? { ...S.btn, opacity: 0.6, cursor: 'not-allowed' } : S.btn}
            disabled={encodingLive}
            onClick={handleStartLiveTransfer}
          >
            {encodingLive ? (
              <>
                <span style={S.spinner} />
                Encoding live QR…
              </>
            ) : (
              'Start Live QR'
            )}
          </button>
          {(liveTransfer || preparingGif) && (
            <button style={S.btnSecondary} onClick={handleStopTransfer}>
              Stop
            </button>
          )}
        </div>
        {status && <div style={{ ...S.infoValue, marginTop: 10 }}>{status}</div>}
        {error && <div style={S.warn}>⚠ {error}</div>}
      </div>

      {/* ── Preview ──────────────────────────────────────────────────────────── */}
      {liveTransfer && (
        <div style={S.section}>
          <div style={S.label}>Live QR Transfer</div>
          <div ref={qrStageRef} style={S.qrStage(fullscreenActive)}>
            <canvas
              className="qr-live-canvas"
              ref={canvasRef}
              width={liveTransfer.width}
              height={liveTransfer.height}
              aria-label="Live QR transfer frames"
              style={fullscreenActive ? { ...S.preview, ...S.fullscreenPreview } : S.preview}
            />
          </div>
          <div style={{ ...S.row, marginTop: 8 }}>
            <button style={S.btnSecondary} onClick={handleFullscreenPlayback}>
              Fullscreen QR
            </button>
            <button style={S.btnSecondary} onClick={handleStopTransfer}>
              Stop
            </button>
            <button
              style={preparingGif ? { ...S.btnSecondary, opacity: 0.6, cursor: 'not-allowed' } : S.btnSecondary}
              disabled={preparingGif}
              onClick={handlePrepareGif}
            >
              {preparingGif ? (
                <>
                  <span style={S.spinner} />
                  Preparing GIF…
                </>
              ) : (
                'Prepare GIF'
              )}
            </button>
            {gifResult && (
              <button style={S.btn} onClick={handleDownload}>
                Download GIF ({Math.round(gifResult.gifData.byteLength / 1024)} KB)
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Stats ────────────────────────────────────────────────────────────── */}
      {stats && (
        <div style={S.section}>
          <div style={S.label}>Transfer Info</div>
          <div style={S.infoGrid}>
            <span style={S.infoLabel}>Original size</span>
            <span style={S.infoValue}>{formatBytes(stats.originalSize)}</span>
            <span style={S.infoLabel}>Preprocessed size</span>
            <span style={S.infoValue}>{formatBytes(stats.preprocessedSize)}</span>
            <span style={S.infoLabel}>QR size</span>
            <span style={S.infoValue}>{liveTransfer ? `V${liveTransfer.version}-${liveTransfer.eccLevel}` : qrProfile.label}</span>
            <span style={S.infoLabel}>QR encoder</span>
            <span style={S.infoValue}>{formatQREncoder(stats.qrEncoder)}</span>
            <span style={S.infoLabel}>Symbol payload</span>
            <span style={S.infoValue}>{liveTransfer ? `${liveTransfer.symbolSize} B/frame` : `${qrProfile.maxPayloadSize} B/frame`}</span>
            <span style={S.infoLabel}>FEC codec</span>
            <span style={S.infoValue}>
              {stats.fecCodec === 'wasm-raptorq'
                ? `${formatFecCodec(stats.fecCodec)} · ${stats.raptorqRepairPercent}% repair`
                : formatFecCodec(stats.fecCodec)}
            </span>
            <span style={S.infoLabel}>QR packets</span>
            <span style={S.infoValue}>{stats.frameCount}</span>
            <span style={S.infoLabel}>Parallel QR</span>
            <span style={S.infoValue}>{liveTransfer ? `${liveTransfer.parallelCount} per tick` : `${parallelQRCount} per tick`}</span>
            <span style={S.infoLabel}>Live speed</span>
            <span style={S.infoValue}>{frameRateFps} fps ({formatDelayMs(frameDelayMs)} ms)</span>
            <span style={S.infoLabel}>GIF export speed</span>
            <span style={S.infoValue}>{gifResult ? `${gifResult.frameRateFps} fps (${formatDelayMs(gifResult.frameDelayMs)} ms)` : preparingGif ? 'Preparing…' : 'Not prepared'}</span>
            <span style={S.infoLabel}>{stats.fecCodec === 'wasm-raptorq' ? 'RaptorQ packets' : 'Generations'}</span>
            <span style={S.infoValue}>{stats.totalGenerations}</span>
            <span style={S.infoLabel}>GIF size</span>
            <span style={S.infoValue}>{gifResult ? formatBytes(gifResult.gifData.byteLength) : preparingGif ? '…' : 'Not prepared'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function clampFrameRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FRAME_RATE_FPS;
  return Math.min(MAX_FRAME_RATE_FPS, Math.max(MIN_FRAME_RATE_FPS, Math.round(value)));
}

function normalizeParallelQRCount(value: number): ParallelQRCount {
  return PARALLEL_QR_COUNTS.includes(value as ParallelQRCount)
    ? value as ParallelQRCount
    : DEFAULT_PARALLEL_QR_COUNT;
}

function parseQRVersionOption(value: string): QRVersionOption {
  const parsed = Number(value);
  return QR_VERSION_OPTIONS.includes(parsed as QRVersionOption)
    ? parsed as QRVersionOption
    : DEFAULT_QR_VERSION;
}

function normalizeEccLevel(value: string): EccLevel {
  return ECC_LEVEL_OPTIONS.includes(value as EccLevel)
    ? value as EccLevel
    : DEFAULT_QR_ECC_LEVEL;
}

function formatEccLevel(level: EccLevel): string {
  switch (level) {
    case 'L':
      return 'L - low';
    case 'M':
      return 'M - medium';
    case 'Q':
      return 'Q - quartile';
    case 'H':
      return 'H - high';
  }
}

function frameRateToDelayMs(fps: number): number {
  return 1000 / clampFrameRate(fps);
}

function formatDelayMs(ms: number): string {
  return Number.isInteger(ms) ? String(ms) : ms.toFixed(1);
}

function createFrameCache(): FrameCache {
  return { frames: new Map(), maxEntries: FRAME_CACHE_LIMIT };
}

async function prepareRenderedTile(imageData: ImageData): Promise<RenderedTile> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(imageData);
    return {
      source: bitmap,
      close: () => bitmap.close(),
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable for QR tile cache.');
  }
  ctx.putImageData(imageData, 0, 0);
  return { source: canvas };
}

function cacheRenderedTile(
  cache: FrameCache,
  packetIndex: number,
  tile: RenderedTile,
): void {
  const previous = cache.frames.get(packetIndex);
  if (previous) closeRenderedTile(previous);
  cache.frames.set(packetIndex, tile);
}

function closeRenderedTile(tile: RenderedTile): void {
  tile.close?.();
}

function clearFrameCache(cache: FrameCache): void {
  for (const tile of cache.frames.values()) {
    closeRenderedTile(tile);
  }
  cache.frames.clear();
}

function createLiveTransfer(
  packets: Uint8Array[],
  profile: QRTransferProfile,
  qrEncoder: QREncoder,
  parallelCount: ParallelQRCount,
): LiveTransfer {
  if (packets.length === 0) {
    throw new Error('No QR packets were generated.');
  }

  const moduleCount = profile.version * 4 + 17;
  const totalModules = moduleCount + QR_QUIET_ZONE_MODULES * 2;
  const scale = Math.max(2, Math.round(LIVE_TARGET_PX / totalModules));
  const tileSize = totalModules * scale;
  const layout = getParallelLayout(parallelCount);

  return {
    packets,
    width: tileSize * layout.columns,
    height: tileSize * layout.rows,
    tileWidth: tileSize,
    tileHeight: tileSize,
    columns: layout.columns,
    rows: layout.rows,
    version: profile.version,
    eccLevel: profile.eccLevel,
    qrEncoder,
    symbolSize: profile.maxPayloadSize,
    scale,
    displayFrameCount: stripedFrameCount(packets.length, parallelCount),
    parallelCount,
  };
}

function drawLiveFrame(
  canvas: HTMLCanvasElement,
  transfer: LiveTransfer,
  frameIndex: number,
  cache: FrameCache,
): void {
  if (canvas.width !== transfer.width) canvas.width = transfer.width;
  if (canvas.height !== transfer.height) canvas.height = transfer.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, transfer.width, transfer.height);

  for (let tileIndex = 0; tileIndex < transfer.parallelCount; tileIndex++) {
    const packetIndex = getPacketIndexForDisplayFrame(transfer, frameIndex, tileIndex);
    if (packetIndex === null) continue;
    const image = cache.frames.get(packetIndex);
    if (!image) continue;
    const x = (tileIndex % transfer.columns) * transfer.tileWidth;
    const y = Math.floor(tileIndex / transfer.columns) * transfer.tileHeight;
    ctx.drawImage(image.source, x, y, transfer.tileWidth, transfer.tileHeight);
  }
}

function isDisplayFrameReady(
  transfer: LiveTransfer,
  frameIndex: number,
  cache: FrameCache,
): boolean {
  for (let tileIndex = 0; tileIndex < transfer.parallelCount; tileIndex++) {
    const packetIndex = getPacketIndexForDisplayFrame(transfer, frameIndex, tileIndex);
    if (packetIndex !== null && !cache.frames.has(packetIndex)) {
      return false;
    }
  }
  return true;
}

function trimFrameCache(cache: FrameCache): void {
  while (cache.frames.size > cache.maxEntries) {
    const oldestKey = cache.frames.keys().next().value;
    if (oldestKey === undefined) return;
    const oldestTile = cache.frames.get(oldestKey);
    if (oldestTile) closeRenderedTile(oldestTile);
    cache.frames.delete(oldestKey);
  }
}

function getParallelLayout(parallelCount: ParallelQRCount): { columns: number; rows: number } {
  if (parallelCount === 1) return { columns: 1, rows: 1 };
  if (parallelCount === 2) return { columns: 2, rows: 1 };
  return { columns: 2, rows: 2 };
}

function getPacketIndexForDisplayFrame(
  transfer: LiveTransfer,
  frameIndex: number,
  tileIndex: number,
): number | null {
  return stripedPacketIndex(
    transfer.packets.length,
    transfer.parallelCount,
    frameIndex,
    tileIndex,
  );
}
