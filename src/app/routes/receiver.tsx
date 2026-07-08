/**
 * Receiver page — camera preview, QR decode, GIF file upload mode,
 * file download, and text display.
 */
import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { parseGif, renderGifFrame } from '@/core/gif/gif_parser';
import {
  BINARIZER_OPTIONS,
  DECODE_PRESETS,
  DEFAULT_DECODE_PRESET,
  DEFAULT_DECODE_SETTINGS,
  DOWNSCALE_FACTOR_OPTIONS,
  MAX_SYMBOL_OPTIONS,
  type DecodePresetId,
  type DownscaleFactor,
  type MaxSymbolsMode,
  type QrBinarizer,
  type QrDecodeSettings,
} from '@/core/qr/decode_settings';
import {
  DEFAULT_RECEIVER_FEC_CODEC,
  formatFecCodec,
  normalizeReceiverFecCodec,
  type ReceiverFecCodec,
} from '@/core/fec/codec';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReceivedFile {
  data: ArrayBuffer;
  filename: string;
  mime: string;
}

type InputMode = 'camera' | 'gif-file';

type CSSProps = Record<string, string | number>;
type DecodeRateSample = { time: number; count: number };

const MIN_SCAN_RATE_FPS = 2;
const MAX_SCAN_RATE_FPS = 60;
const DEFAULT_SCAN_RATE_FPS = 60;
const DECODE_RATE_WINDOW_MS = 1000;
const DECODE_PRESET_OPTIONS: DecodePresetId[] = ['fast', 'balance', 'robust', 'custom'];
const RECEIVER_FEC_CODEC_OPTIONS: ReceiverFecCodec[] = ['auto', 'js-rlnc', 'wasm-raptorq'];

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
  btnStop: {
    background: '#da3633',
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
    padding: '10px 16px',
    fontSize: 14,
    cursor: 'pointer',
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
  video: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 6,
    background: '#000',
    display: 'block',
    marginTop: 8,
  } as CSSProps,
  statsBar: {
    display: 'flex',
    gap: 16,
    alignItems: 'center',
    fontSize: 12,
    color: '#8b949e',
    marginTop: 6,
    flexWrap: 'wrap' as const,
  } as CSSProps,
  statValue: {
    color: '#c9d1d9',
    fontWeight: 600,
    fontFamily: 'monospace',
    fontSize: 13,
  } as CSSProps,
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
  warn: {
    background: '#3d2600',
    border: '1px solid #bb8009',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#d29922',
    fontSize: 13,
    marginTop: 8,
  },
  sp: {
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
  } as CSSProps,
  checkboxLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: '#c9d1d9',
    fontSize: 13,
  } as CSSProps,
};

// ─── Component ───────────────────────────────────────────────────────────────────

export function ReceiverPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const textResultRef = useRef<HTMLDivElement>(null);
  const fileResultRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const scanningRef = useRef(false);

  const [inputMode, setInputMode] = useState<InputMode>('camera');
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [totalFrames, setTotalFrames] = useState(0);
  const [framesWithQR, setFramesWithQR] = useState(0);
  const [uniquePackets, setUniquePackets] = useState(0);
  const [duplicatePackets, setDuplicatePackets] = useState(0);
  const [acceptedPackets, setAcceptedPackets] = useState(0);
  const [neededPackets, setNeededPackets] = useState(0);
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null);
  const [receivedText, setReceivedText] = useState('');
  const [error, setError] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hasZoomSupport, setHasZoomSupport] = useState(false);
  const [scanRateFps, setScanRateFps] = useState(DEFAULT_SCAN_RATE_FPS);
  const [fecCodec, setFecCodec] = useState<ReceiverFecCodec>(DEFAULT_RECEIVER_FEC_CODEC);
  const [decodePreset, setDecodePreset] = useState<DecodePresetId>(DEFAULT_DECODE_PRESET);
  const [decodeSettings, setDecodeSettings] = useState<QrDecodeSettings>(DEFAULT_DECODE_SETTINGS);
  const [advancedDecodeOpen, setAdvancedDecodeOpen] = useState(false);
  const [decodedQrPerSecond, setDecodedQrPerSecond] = useState(0);
  const [detectedFecCodec, setDetectedFecCodec] = useState('');
  const [detectedQrVersion, setDetectedQrVersion] = useState(0);
  const [detectedSymbolSize, setDetectedSymbolSize] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [throughputKbps, setThroughputKbps] = useState(0);
  const [solvedGens, setSolvedGens] = useState(0);
  const [sourceGens, setSourceGens] = useState(0);
  const scanStartRef = useRef<number>(0);
  const dataLengthRef = useRef<number>(0);
  const decodedQrCountRef = useRef(0);
  const decodedQrRateSamplesRef = useRef<DecodeRateSample[]>([]);
  const decodeSettingsRef = useRef<QrDecodeSettings>(DEFAULT_DECODE_SETTINGS);
  const fecCodecRef = useRef<ReceiverFecCodec>(DEFAULT_RECEIVER_FEC_CODEC);
  const scanIntervalMs = scanRateToIntervalMs(scanRateFps);
  const scanIntervalMsRef = useRef(scanIntervalMs);

  useEffect(() => {
    scanIntervalMsRef.current = scanIntervalMs;
  }, [scanIntervalMs]);

  useEffect(() => {
    decodeSettingsRef.current = decodeSettings;
    fecCodecRef.current = fecCodec;
    workerRef.current?.postMessage({ type: 'settings', settings: decodeSettings, fecCodec });
  }, [decodeSettings, fecCodec]);

  const updateDecodedQrRate = useCallback((decodedCount: number) => {
    const now = Date.now();
    decodedQrCountRef.current = decodedCount;
    const samples = decodedQrRateSamplesRef.current;
    samples.push({ time: now, count: decodedCount });

    while (samples.length > 1 && now - samples[0]!.time > DECODE_RATE_WINDOW_MS) {
      samples.shift();
    }

    const first = samples[0];
    if (!first) {
      setDecodedQrPerSecond(0);
      return;
    }

    const elapsedSeconds = (now - first.time) / 1000;
    if (elapsedSeconds <= 0) {
      setDecodedQrPerSecond(0);
      return;
    }

    setDecodedQrPerSecond((decodedCount - first.count) / elapsedSeconds);
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const id = window.setInterval(() => {
      updateDecodedQrRate(decodedQrCountRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [scanning, updateDecodedQrRate]);

  // ── Create decode worker ───────────────────────────────────────────────
  function createWorker(): Worker {
    const w = new Worker(
      new URL('@/workers/decode.worker.ts', import.meta.url),
      { type: 'module' },
    );

    w.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress': {
          setTotalFrames(msg.totalFrames ?? 0);
          const decodedQrCount = msg.framesWithQR ?? 0;
          setFramesWithQR(decodedQrCount);
          setUniquePackets(msg.uniquePackets ?? 0);
          setDuplicatePackets(msg.duplicatePackets ?? 0);
          updateDecodedQrRate(decodedQrCount);
          setAcceptedPackets(msg.acceptedPackets ?? 0);
          setNeededPackets(msg.neededPackets ?? 0);
          setSolvedGens(msg.solvedGenerations ?? 0);
          setSourceGens(msg.sourceGenerations ?? 0);
          setDetectedQrVersion(msg.qrVersion ?? 0);
          setDetectedSymbolSize(msg.symbolSize ?? 0);
          setDetectedFecCodec(msg.fecCodec ?? '');
          if (msg.dataLength) {
            dataLengthRef.current = msg.dataLength;
          }
          // Start timer on first detected frame
          if (scanStartRef.current === 0 && ((msg.totalFrames ?? 0) > 0 || (msg.framesWithQR ?? 0) > 0)) {
            scanStartRef.current = Date.now();
          }
          if (scanStartRef.current > 0) {
            const elapsed = Date.now() - scanStartRef.current;
            setElapsedMs(elapsed);
            const bytes = dataLengthRef.current;
            if (bytes > 0 && elapsed > 0) {
              setThroughputKbps((bytes / 1024) / (elapsed / 1000));
            }
          }
          setStatus(msg.status);
          break;
        }
        case 'complete': {
          if (msg.isText) {
            setReceivedText(msg.text);
            setReceivedFile(null);
          } else {
            setReceivedFile({
              data: msg.data as ArrayBuffer,
              filename: msg.filename ?? 'recovered',
              mime: msg.mime ?? 'application/octet-stream',
            });
            setReceivedText('');
          }
          const elapsed = scanStartRef.current > 0 ? Date.now() - scanStartRef.current : 0;
          setElapsedMs(elapsed);
          const bytes = dataLengthRef.current || (msg.data?.byteLength ?? msg.text?.length ?? 0);
          if (bytes > 0 && elapsed > 0) {
            setThroughputKbps((bytes / 1024) / (elapsed / 1000));
          }
          setStatus('Complete ✓');

          // Auto-stop scanning if requested by worker
          if (msg.autoStop) {
            stopScanning();
          }

          // Auto-scroll to result
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (msg.isText && textResultRef.current) {
                textResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else if (!msg.isText && fileResultRef.current) {
                fileResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100);
          });
          break;
        }
        case 'error': {
          setError(msg.message);
          break;
        }
      }
    };

    w.onerror = (err) => {
      setError(`Worker error: ${err.message}`);
    };

    return w;
  }

  // ── Try to set camera zoom via getUserMedia constraints ─────────────
  const applyCameraZoom = useCallback(async (level: number) => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const capabilities = track.getCapabilities() as any;
    if (capabilities?.zoom) {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: level }],
        } as any);
        setZoomLevel(level);
        setHasZoomSupport(true);
      } catch (e: any) {
        console.warn('Camera zoom failed:', e.message);
      }
    }
  }, []);

  const handleScanRateChange = useCallback((value: string) => {
    setScanRateFps(clampScanRate(Number(value)));
  }, []);

  const handleFecCodecChange = useCallback((value: string) => {
    setFecCodec(normalizeReceiverFecCodec(value));
  }, []);

  const handleDecodePresetChange = useCallback((value: string) => {
    const preset = normalizeDecodePreset(value);
    setDecodePreset(preset);
    if (preset === 'custom') return;

    setDecodeSettings((current) => ({
      ...current,
      ...DECODE_PRESETS[preset],
    }));
  }, []);

  const updateDecodePresetField = useCallback((
    key: 'binarizer' | 'tryHarder' | 'tryRotate' | 'tryInvert',
    value: QrBinarizer | boolean,
  ) => {
    setDecodePreset('custom');
    setDecodeSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const updateDecodeAdvancedField = useCallback((
    key: 'maxSymbols' | 'tryDownscale' | 'downscaleFactor',
    value: MaxSymbolsMode | boolean | DownscaleFactor,
  ) => {
    setDecodeSettings((current) => ({ ...current, [key]: value }));
  }, []);

  // ── Start camera scanning ───────────────────────────────────────────────
  const startCameraScanning = useCallback(async () => {
    setError('');
    setReceivedFile(null);
    setReceivedText('');
    setTotalFrames(0);
    setFramesWithQR(0);
    setUniquePackets(0);
    setDuplicatePackets(0);
    setAcceptedPackets(0);
    setNeededPackets(0);
    setDetectedQrVersion(0);
    setDetectedSymbolSize(0);
    setDetectedFecCodec('');
    setDecodedQrPerSecond(0);
    setElapsedMs(0);
    setThroughputKbps(0);
    setSolvedGens(0);
    setSourceGens(0);
    scanStartRef.current = 0;
    dataLengthRef.current = 0;
    decodedQrCountRef.current = 0;
    decodedQrRateSamplesRef.current = [];

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(getCameraUnavailableMessage());
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;

      // Check zoom capabilities
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = track.getCapabilities() as any;
        if (capabilities?.zoom) {
          setHasZoomSupport(true);
          setZoomLevel(1);
        } else {
          setHasZoomSupport(false);
          setZoomLevel(1);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const worker = createWorker();
      worker.postMessage({
        type: 'settings',
        settings: decodeSettingsRef.current,
        fecCodec: fecCodecRef.current,
      });
      workerRef.current = worker;

      setScanning(true);
      scanningRef.current = true;
      setStatus('Scanning…');

      let lastCapture = 0;
      const loop = (time: number) => {
        if (!scanningRef.current) return;
        if (time - lastCapture >= scanIntervalMsRef.current) {
          captureFrame();
          lastCapture = time;
        }
        animRef.current = requestAnimationFrame(loop);
      };
      animRef.current = requestAnimationFrame(loop);
    } catch (err: any) {
      setError(`Camera error: ${err.message ?? String(err)}`);
    }
  }, []);

  // ── Process GIF file ───────────────────────────────────────────────────
  const handleGifFile = useCallback(async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setError('');
    setReceivedFile(null);
    setReceivedText('');
    setTotalFrames(0);
    setFramesWithQR(0);
    setUniquePackets(0);
    setDuplicatePackets(0);
    setAcceptedPackets(0);
    setNeededPackets(0);
    setDetectedQrVersion(0);
    setDetectedSymbolSize(0);
    setDetectedFecCodec('');
    setDecodedQrPerSecond(0);
    setElapsedMs(0);
    setThroughputKbps(0);
    setSolvedGens(0);
    setSourceGens(0);
    scanStartRef.current = 0;
    dataLengthRef.current = 0;
    decodedQrCountRef.current = 0;
    decodedQrRateSamplesRef.current = [];

    const worker = createWorker();
    worker.postMessage({
      type: 'settings',
      settings: decodeSettingsRef.current,
      fecCodec: fecCodecRef.current,
    });
    workerRef.current = worker;

    setScanning(true);
    scanningRef.current = true;
    setStatus('Parsing GIF frames…');

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const gifData = parseGif(bytes);

      if (gifData.frames.length === 0) {
        setError('No frames found in GIF');
        return;
      }

      setStatus(`Processing ${gifData.frames.length} frames…`);

      for (let i = 0; i < gifData.frames.length; i++) {
        if (!scanningRef.current) break;
        const rgba = renderGifFrame(gifData, i);
        const pixelBuf = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
        worker.postMessage(
          { type: 'frame', pixels: pixelBuf, width: gifData.width, height: gifData.height },
          [pixelBuf],
        );
      }

      setStatus('GIF processed');
    } catch (err: any) {
      setError(`GIF error: ${err.message ?? String(err)}`);
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // ── Stop scanning ──────────────────────────────────────────────────────────
  const stopScanning = useCallback(() => {
    setScanning(false);
    scanningRef.current = false;
    cancelAnimationFrame(animRef.current);

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setStatus('Stopped');
    setHasZoomSupport(false);
    setZoomLevel(1);
  }, []);


  // ── Capture the full camera frame ─────────────────────────────────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!video || !canvas || !worker || video.readyState < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 640;

    // Output canvas size: cap at 640 for performance, but preserve aspect ratio
    const maxCanvas = 640;
    const aspect = vw / vh;
    let cw: number, ch: number;
    if (aspect >= 1) {
      cw = Math.min(vw, maxCanvas);
      ch = Math.round(cw / aspect);
    } else {
      ch = Math.min(vh, maxCanvas);
      cw = Math.round(ch * aspect);
    }
    canvas.width = cw;
    canvas.height = ch;

    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, cw, ch);
    const imageData = ctx.getImageData(0, 0, cw, ch);

    worker.postMessage({ type: 'frame', imageData, realtime: true });
  }, []);

  // ── Download recovered file ──────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!receivedFile) return;
    const blob = new Blob([receivedFile.data], { type: receivedFile.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivedFile.filename || 'recovered-file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [receivedFile]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Input mode toggle ─────────────────────────────────────────────────────── */}
      <div style={S.section}>
        <div style={S.label}>Input Mode</div>
        <div style={S.toggleGroup}>
          <button
            style={S.toggleBtn(inputMode === 'camera')}
            onClick={() => { stopScanning(); setInputMode('camera'); }}
          >
            📷 Camera
          </button>
          <button
            style={S.toggleBtn(inputMode === 'gif-file')}
            onClick={() => { stopScanning(); setInputMode('gif-file'); }}
          >
            🎞️ GIF File
          </button>
        </div>
      </div>

      <div style={S.section}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>FEC codec</span>
            <span style={S.statValue}>{formatFecCodec(fecCodec)}</span>
          </div>
          <select
            value={fecCodec}
            style={S.select}
            onChange={(e) => handleFecCodecChange((e.target as HTMLSelectElement).value)}
          >
            {RECEIVER_FEC_CODEC_OPTIONS.map((codec) => (
              <option key={codec} value={codec}>
                {formatFecCodec(codec)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={S.label}>Decode preset</span>
            <span style={S.statValue}>{formatDecodePreset(decodePreset)}</span>
          </div>
          <select
            value={decodePreset}
            style={S.select}
            onChange={(e) => handleDecodePresetChange((e.target as HTMLSelectElement).value)}
          >
            {DECODE_PRESET_OPTIONS.map((preset) => (
              <option key={preset} value={preset}>
                {formatDecodePreset(preset)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          style={S.btnSecondary}
          onClick={() => setAdvancedDecodeOpen((open) => !open)}
        >
          {advancedDecodeOpen ? 'Hide advanced settings' : 'Advanced settings'}
        </button>
        {advancedDecodeOpen && (
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <label>
              <span style={S.label}>Max symbols</span>
              <select
                value={String(decodeSettings.maxSymbols)}
                style={S.select}
                onChange={(e) => {
                  updateDecodeAdvancedField(
                    'maxSymbols',
                    parseMaxSymbolsMode((e.target as HTMLSelectElement).value),
                  );
                }}
              >
                {MAX_SYMBOL_OPTIONS.map((value) => (
                  <option key={String(value)} value={String(value)}>
                    {formatMaxSymbols(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={S.label}>Binarizer</span>
              <select
                value={decodeSettings.binarizer}
                style={S.select}
                onChange={(e) => {
                  updateDecodePresetField(
                    'binarizer',
                    normalizeBinarizer((e.target as HTMLSelectElement).value),
                  );
                }}
              >
                {BINARIZER_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <div style={S.row}>
              <label style={S.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={decodeSettings.tryHarder}
                  onChange={(e) => updateDecodePresetField('tryHarder', (e.target as HTMLInputElement).checked)}
                />
                tryHarder
              </label>
              <label style={S.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={decodeSettings.tryRotate}
                  onChange={(e) => updateDecodePresetField('tryRotate', (e.target as HTMLInputElement).checked)}
                />
                tryRotate
              </label>
              <label style={S.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={decodeSettings.tryInvert}
                  onChange={(e) => updateDecodePresetField('tryInvert', (e.target as HTMLInputElement).checked)}
                />
                tryInvert
              </label>
              <label style={S.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={decodeSettings.tryDownscale}
                  onChange={(e) => updateDecodeAdvancedField('tryDownscale', (e.target as HTMLInputElement).checked)}
                />
                tryDownscale
              </label>
            </div>
            <label>
              <span style={S.label}>Downscale factor</span>
              <select
                value={String(decodeSettings.downscaleFactor)}
                style={S.select}
                disabled={!decodeSettings.tryDownscale}
                onChange={(e) => {
                  updateDecodeAdvancedField(
                    'downscaleFactor',
                    parseDownscaleFactor((e.target as HTMLSelectElement).value),
                  );
                }}
              >
                {DOWNSCALE_FACTOR_OPTIONS.map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* ── Camera preview ────────────────────────────────────────────────── */}
      {inputMode === 'camera' && (
        <div style={S.section}>
          <div style={S.label}>Camera</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...S.row, justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={S.label}>Scan rate</span>
              <span style={S.statValue}>{scanRateFps} fps · {formatDelayMs(scanIntervalMs)} ms/sample</span>
            </div>
            <input
              type="range"
              min={MIN_SCAN_RATE_FPS}
              max={MAX_SCAN_RATE_FPS}
              step={1}
              value={scanRateFps}
              style={S.slider}
              onInput={(e) => handleScanRateChange((e.target as HTMLInputElement).value)}
            />
            <div style={S.sliderLabels}>
              <span>Stable</span>
              <span>Fast</span>
            </div>
          </div>
          <div
            ref={videoContainerRef}
            style={{ position: 'relative', display: 'inline-block', maxWidth: 480, width: '100%' }}
          >
            <video ref={videoRef} style={{ width: '100%', borderRadius: 6, background: '#000', display: 'block' }} playsInline muted />
            {/* Scan-region overlay */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                border: '2px dashed rgba(88, 166, 255, 0.7)',
                borderRadius: 8,
                pointerEvents: 'none',
              }}
            />
            {/* Corner markers */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: 16, height: 16, borderTop: '3px solid #58a6ff', borderLeft: '3px solid #58a6ff', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: 0, right: 0, width: 16, height: 16, borderTop: '3px solid #58a6ff', borderRight: '3px solid #58a6ff', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: 16, height: 16, borderBottom: '3px solid #58a6ff', borderLeft: '3px solid #58a6ff', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, borderBottom: '3px solid #58a6ff', borderRight: '3px solid #58a6ff', pointerEvents: 'none' }} />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Inline stats above controls */}
          {scanning && (
            <div style={S.statsBar}>
              <span>
                decoded{' '}
                <span style={S.statValue}>
                  {framesWithQR}
                </span>
              </span>
              <span>
                unique <span style={S.statValue}>{uniquePackets}</span>
              </span>
              <span>
                useful <span style={S.statValue}>{acceptedPackets}/{neededPackets || '?'}</span>
              </span>
              {duplicatePackets > 0 && (
                <span>
                  dupes <span style={S.statValue}>{duplicatePackets}</span>
                </span>
              )}
              <span>
                gens <span style={S.statValue}>{solvedGens}/{sourceGens}</span>
              </span>
              <span>
                QR <span style={S.statValue}>{formatDetectedQR(detectedQrVersion, detectedSymbolSize)}</span>
              </span>
              {detectedFecCodec && (
                <span>
                  FEC <span style={S.statValue}>{formatDetectedFecCodec(detectedFecCodec)}</span>
                </span>
              )}
              <span>
                decode <span style={S.statValue}>{decodedQrPerSecond.toFixed(1)} QR/s</span>
              </span>
              <span>
                time <span style={S.statValue}>{formatDuration(elapsedMs)}</span>
              </span>
              {throughputKbps > 0 && (
                <span>
                  speed <span style={S.statValue}>{throughputKbps.toFixed(1)} KB/s</span>
                </span>
              )}
              <span>·</span>
              <span>{status || 'Working…'}</span>
            </div>
          )}

          <div style={{ ...S.row, marginTop: 10 }}>
            {!scanning ? (
              <button style={S.btn} onClick={startCameraScanning}>
                ▶ Start Scan
              </button>
            ) : (
              <button style={S.btnStop} onClick={stopScanning}>
                ■ Stop Scan
              </button>
            )}
            {hasZoomSupport && scanning && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Zoom:</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.5}
                  value={zoomLevel}
                  onChange={(e) => applyCameraZoom(Number((e.target as HTMLInputElement).value))}
                  style={{ width: 120 }}
                />
                <span style={{ fontSize: 12, color: '#c9d1d9', minWidth: 30 }}>{zoomLevel}×</span>
              </div>
            )}
          </div>
          <p style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>
            {hasZoomSupport
              ? 'Full-frame scan is active. Use Zoom only if the QR codes are too small.'
              : 'Full-frame scan is active.'}
          </p>
          {error && <div style={S.warn}>⚠ {error}</div>}
        </div>
      )}

      {/* ── GIF file upload ────────────────────────────────────────────────────────────── */}
      {inputMode === 'gif-file' && (
        <div style={S.section}>
          <div style={S.label}>Upload GIF</div>
          <p style={{ fontSize: 13, color: '#8b949e', marginBottom: 8 }}>
            Upload a QR-over-GIF file generated by the Sender.
          </p>
          <input type="file" accept=".gif,image/gif" onChange={handleGifFile} />
          {scanning && (
            <div style={S.statsBar}>
              <span>
                decoded{' '}
                <span style={S.statValue}>
                  {framesWithQR}
                </span>
              </span>
              <span>
                unique <span style={S.statValue}>{uniquePackets}</span>
              </span>
              <span>
                useful <span style={S.statValue}>{acceptedPackets}/{neededPackets || '?'}</span>
              </span>
              {duplicatePackets > 0 && (
                <span>
                  dupes <span style={S.statValue}>{duplicatePackets}</span>
                </span>
              )}
              <span>
                gens <span style={S.statValue}>{solvedGens}/{sourceGens}</span>
              </span>
              <span>
                QR <span style={S.statValue}>{formatDetectedQR(detectedQrVersion, detectedSymbolSize)}</span>
              </span>
              {detectedFecCodec && (
                <span>
                  FEC <span style={S.statValue}>{formatDetectedFecCodec(detectedFecCodec)}</span>
                </span>
              )}
              <span>
                decode <span style={S.statValue}>{decodedQrPerSecond.toFixed(1)} QR/s</span>
              </span>
              <span>
                time <span style={S.statValue}>{formatDuration(elapsedMs)}</span>
              </span>
              {throughputKbps > 0 && (
                <span>
                  speed <span style={S.statValue}>{throughputKbps.toFixed(1)} KB/s</span>
                </span>
              )}
              <span>·</span>
              <span>{status || 'Working…'}</span>
            </div>
          )}
          {error && <div style={{ ...S.warn, marginTop: 8 }}>⚠ {error}</div>}
        </div>
      )}

      {/* ── Persistent transfer summary (visible even after scanning stops) ── */}
      {(elapsedMs > 0 || throughputKbps > 0) && !scanning && (
        <div style={{ ...S.section, padding: '10px 20px', fontSize: 13, color: '#8b949e' }}>
          Transfer complete —{' '}
          <span style={S.statValue}>{formatDuration(elapsedMs)}</span>
          {throughputKbps > 0 && (
            <span>
              {' '}·{' '}avg <span style={S.statValue}>{throughputKbps.toFixed(1)} KB/s</span>
            </span>
          )}
          <span>
            {' '}·{' '}data{' '}
            <span style={S.statValue}>
              {formatBytes(
                dataLengthRef.current ||
                (receivedFile?.data.byteLength ?? receivedText.length ?? 0)
              )}
            </span>
          </span>
        </div>
      )}

      {/* ── Received text ────────────────────────────────────────────────────────────────── */}
      {receivedText && (
        <div style={S.section} ref={textResultRef}>
          <div style={S.label}>Recovered Text</div>
          <textarea
            style={S.textarea}
            value={receivedText}
            readOnly
          />
        </div>
      )}

      {/* ── Download recovered file ────────────────────────────────────────────────── */}
      {receivedFile && (
        <div style={S.section} ref={fileResultRef}>
          <div style={S.label}>Recovered File</div>
          <p style={{ margin: '6px 0', fontSize: 14 }}>
            <strong>File:</strong> {receivedFile.filename || '(unnamed)'} &middot;{' '}
            {formatBytes(receivedFile.data.byteLength)} &middot;{' '}
            {receivedFile.mime}
          </p>
          <button style={S.btn} onClick={handleDownload}>
            ⸗ Download Recovered File
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m > 0) return `${m}m${remS.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function formatDetectedQR(version: number, symbolSize: number): string {
  if (version > 0 && symbolSize > 0) return `V${version} · ${symbolSize} B/frame`;
  if (version > 0) return `V${version}`;
  return 'auto';
}

function formatDetectedFecCodec(value: string): string {
  if (value === 'wasm-raptorq' || value === 'js-rlnc') {
    return formatFecCodec(value);
  }
  return value;
}

function clampScanRate(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCAN_RATE_FPS;
  return Math.min(MAX_SCAN_RATE_FPS, Math.max(MIN_SCAN_RATE_FPS, Math.round(value)));
}

function scanRateToIntervalMs(fps: number): number {
  return 1000 / clampScanRate(fps);
}

function formatDelayMs(ms: number): string {
  return Number.isInteger(ms) ? String(ms) : ms.toFixed(1);
}

function normalizeDecodePreset(value: string): DecodePresetId {
  return DECODE_PRESET_OPTIONS.includes(value as DecodePresetId)
    ? value as DecodePresetId
    : DEFAULT_DECODE_PRESET;
}

function formatDecodePreset(value: DecodePresetId): string {
  if (value === 'fast') return 'Fast';
  if (value === 'balance') return 'Balance';
  if (value === 'robust') return 'Robust';
  return 'Custom';
}

function parseMaxSymbolsMode(value: string): MaxSymbolsMode {
  if (value === 'auto') return 'auto';
  const parsed = Number(value);
  return parsed === 1 || parsed === 2 || parsed === 4 || parsed === 6 || parsed === 8
    ? parsed
    : DEFAULT_DECODE_SETTINGS.maxSymbols;
}

function formatMaxSymbols(value: MaxSymbolsMode): string {
  return value === 'auto' ? 'Auto (4)' : String(value);
}

function normalizeBinarizer(value: string): QrBinarizer {
  return BINARIZER_OPTIONS.includes(value as QrBinarizer)
    ? value as QrBinarizer
    : DEFAULT_DECODE_SETTINGS.binarizer;
}

function parseDownscaleFactor(value: string): DownscaleFactor {
  const parsed = Number(value);
  return parsed === 2 || parsed === 3 || parsed === 4 ? parsed : DEFAULT_DECODE_SETTINGS.downscaleFactor;
}

function getCameraUnavailableMessage(): string {
  if (!window.isSecureContext) {
    return 'Camera API is unavailable because this page is not in a secure context. Use HTTPS, localhost, or upload a GIF instead.';
  }
  return 'Camera API is unavailable in this browser. Try a recent Chrome/Safari/Edge browser, or upload a GIF instead.';
}
