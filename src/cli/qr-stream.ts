#!/usr/bin/env node
/**
 * QR Stream CLI
 *
 * Displays a sequence of QR codes in the terminal for text/file transfer.
 * Reads text from stdin or a file argument, encodes it using the same
 * protocol as the webapp, and loops through the QR sequence until
 * interrupted.
 *
 * Usage:
 *   qr-stream [file]              # read from file
 *   echo "text" | qr-stream       # read from stdin
 *   npx qr-stream [file]          # via npx
 *   bunx qr-stream [file]         # via bunx
 *   qr-stream --serve             # start web app preview server
 */

import { readFileSync, existsSync, openSync, closeSync } from 'fs';
import { ReadStream } from 'tty';
import { COMPATIBLE_QR_ENCODER, encodeQRCodeMatrix } from '../core/qr/qr_encoder';
import { packetize } from '../core/sender/packetizer';
import { scheduleFrames } from '../core/sender/scheduler';
import { QR_VERSION, ECC_LEVEL } from '../core/protocol/constants';
import {
  enterAltBuffer,
  exitAltBuffer,
  clearScreen,
  hideCursor,
  showCursor,
  renderToTerminal,
  moveCursorUp,
} from './terminal_raster';
import { startServer } from './static_server';

const FPS_MS = 100;

// ─────────────────────────────────────────────────────────────────────────────────
// Help text
// ─────────────────────────────────────────────────────────────────────────────────

const HELP_TEXT = `
QR Stream – encode text or a file into a looping QR-code sequence.

Usage:
  qr-stream [file]                read from file
  echo "text" | qr-stream         read from stdin
  npx qr-stream [file]            via npx
  bunx qr-stream [file]           via bunx
  qr-stream --serve               start web app preview server

Server flags (with --serve):
  --port <n>    TCP port (default: 3000, also: PORT env)
  --host <ip>   Bind address (default: 0.0.0.0)

Controls:
  q, Q         quit
  Ctrl-C       quit

The app uses the same V10-M QR protocol as the web transfer demo.
`;

function showHelp(): void {
  console.log(HELP_TEXT.trim());
}

// ─────────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────────

// ─── MIME type lookup ──────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
};

function mimeFromPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// ─────────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────────

interface InputResult {
  data: Uint8Array;
  isText: boolean;
  filename?: string;
  mimeType?: string;
}

function readInput(): InputResult {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    const filePath = args[0]!;
    if (!existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(1);
    }
    const basename = filePath.split('/').pop() ?? filePath;
    return {
      data: new Uint8Array(readFileSync(filePath)),
      isText: false,
      filename: basename,
      mimeType: mimeFromPath(filePath),
    };
  }

  // Read from stdin (fd 0) — treat as text input
  try {
    const buf = new Uint8Array(readFileSync(0));
    return { data: buf, isText: buf.length > 0 };
  } catch (err: any) {
    console.error(`Error reading stdin: ${err.message ?? String(err)}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Encode pipeline (reuse webapp protocol)
// ─────────────────────────────────────────────────────────────────────────────────

function buildFrames(
  data: Uint8Array,
  isText: boolean,
  filename?: string,
  mimeType?: string,
): Uint8Array[] {
  const result = packetize(data, isText, true, filename, mimeType);
  return scheduleFrames(result.packets, result.totalGenerations);
}

// ─────────────────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--serve') || args.includes('-s')) {
    // Parse --port <n> (default 3000)
    let port = 3000;
    const portIdx = args.indexOf('--port');
    if (portIdx !== -1 && portIdx + 1 < args.length) {
      port = Number(args[portIdx + 1]);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Error: --port must be a number between 1 and 65535');
        process.exit(1);
      }
    }
    // Also support PORT env var (overridable by --port)
    if (process.env.PORT && args.indexOf('--port') === -1) {
      port = Number(process.env.PORT);
    }

    // Parse --host <ip> (default 0.0.0.0)
    let host: string | undefined;
    const hostIdx = args.indexOf('--host');
    if (hostIdx !== -1 && hostIdx + 1 < args.length) {
      host = args[hostIdx + 1];
    }

    const server = startServer(port, host);

    function shutdown() {
      console.log('\nShutting down server...');
      server.close(() => process.exit(0));
      // Force exit after timeout if connections keep it open
      setTimeout(() => process.exit(0), 2000);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  let data: Uint8Array;
  let isText: boolean;
  let filename: string | undefined;
  let mimeType: string | undefined;
  try {
    const input = readInput();
    data = input.data;
    isText = input.isText;
    filename = input.filename;
    mimeType = input.mimeType;
  } catch (err: any) {
    console.error(`Error reading input: ${err.message ?? String(err)}`);
    process.exit(1);
  }

  if (data.length === 0) {
    console.error('Error: no input data. Provide a file path or pipe text to stdin.');
    process.exit(1);
  }

  const packets = buildFrames(data, isText, filename, mimeType);

  // Pre-render all QR matrices to terminal strings
  const frames: string[][] = [];
  for (const pkt of packets) {
    const matrix = await encodeQRCodeMatrix(
      pkt,
      QR_VERSION,
      ECC_LEVEL,
      COMPATIBLE_QR_ENCODER,
    );
    frames.push(renderToTerminal(matrix));
  }

  const qrHeight = frames[0]?.length ?? 0;

  let running = true;
  let frameIdx = 0;
  let firstDraw = true;

  function draw() {
    if (!running) return;

    const frame = frames[frameIdx]!;

    if (firstDraw) {
      firstDraw = false;
    } else {
      // Move cursor back to the first QR line so we overwrite in-place
      moveCursorUp(qrHeight);
    }

    // Write frame lines followed by a newline so the cursor lands at
    // column 0 of the next line, ready for the next moveCursorUp.
    process.stdout.write(frame.join('\n') + '\n');
    frameIdx = (frameIdx + 1) % frames.length;
  }

  function cleanup() {
    running = false;
    clearInterval(interval);
    exitAltBuffer();
    showCursor();
    if (ttyFd !== null) {
      try { closeSync(ttyFd); } catch {}
    }
    console.log('QR stream display stopped.');
    process.exit(0);
  }

  // Switch to alternate buffer and clear it before drawing
  enterAltBuffer();
  clearScreen();

  // Keyboard handling — try /dev/tty first so it works even when stdin is a pipe
  let ttyFd: number | null = null;
  try {
    ttyFd = openSync('/dev/tty', 'rs');
    const stream = new ReadStream(ttyFd);
    stream.setRawMode(true);
    stream.setEncoding('utf8');
    stream.on('data', (key: string) => {
      if (key === 'q' || key === 'Q' || key === '\u0003') {
        cleanup();
      }
    });
    stream.resume();
    hideCursor();
  } catch {
    ttyFd = null;
    if (process.stdin.isTTY) {
      hideCursor();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (key: string) => {
        if (key === 'q' || key === 'Q' || key === '\u0003') {
          cleanup();
        }
      });
    }
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Start loop
  draw();
  const interval = setInterval(draw, FPS_MS);
}

main().catch((err: any) => {
  console.error(`Error: ${err.message ?? String(err)}`);
  process.exit(1);
});
