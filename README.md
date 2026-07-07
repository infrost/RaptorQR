# QR Stream

Transfer files and text between devices by displaying an animated sequence of QR codes and reading it with a camera.

No network, no Bluetooth, no cables. Everything runs locally in the browser or terminal.

**Live demo:** https://hermitm0nk.github.io/qr-stream/

---

## Features

* Works fully offline after loading the web app
* No server, no telemetry, no cloud upload
* Send and receive text or files in the browser
* Send files or stdin from the CLI
* Preserves filenames for file transfers
* Instantly displays received text
* Compresses data before transfer, typically saving 3x-10x bandwidth on text files
* Uses RaptorQ fountain coding for efficient recovery from dropped frames
* Uses CRC32 checksums for consistency checks
* Supports GIF export for sharing or embedding QR streams
* Live QR playback is rendered with Canvas, so transfer can start immediately without waiting for GIF generation
* Adjustable QR size, playback interval, scan sampling rate, QR ECC level, and encoding redundancy

---

## Performance

QR Stream has been significantly optimized compared with the original JavaScript-only implementation.

In measured tests, the new pipeline reaches **50x+ higher throughput** in practical transfer scenarios.

Measured examples:

| Scenario                                 |                         Result |
| ---------------------------------------- | -----------------------------: |
| V20 QR, 4-code parallel playback, 30 FPS | up to 300 decoded QR symbols/s |
| V30 QR                                   |      100+ decoded QR symbols/s |
| 95.2 KB file transfer                    |       375 ms, about 254.0 KB/s |
| 1.8 MB file transfer                     |                  about 40 KB/s |

The 95.2 KB test was measured on **iPhone 16 + Safari**. Actual speed depends on device camera quality, browser performance, lighting, QR size, QR version, playback rate, and scan settings.

The new version also supports larger file transfers more reliably, including fixes for the previous `GF(256) division by zero` issue and other algorithmic edge cases.

---

## Installation

### pnpm

```bash
pnpm add -g qr-stream
```

You can also run it directly without installing:

```bash
pnpm dlx qr-stream [file]
```

### npm

```bash
npm install -g qr-stream
npx qr-stream [file]
```

---

## CLI Usage

### Encode text or a file into a looping QR sequence

```bash
# Read from file
qr-stream document.pdf

# Read from stdin
echo "Hello, world!" | qr-stream

# Pipe file contents
base64 image.png | qr-stream
```

The terminal clears, enters an alternate screen buffer, and displays the QR frames in a loop.

Press **q** or **Ctrl-C** to quit.

### Start the web app preview server

```bash
qr-stream --serve                    # start web app preview server
qr-stream --serve --port 8080        # custom port
qr-stream --serve --host 127.0.0.1   # localhost only
```

Serves the built web UI.

The default port is `3000`, and the default host is `0.0.0.0`.

You can also set the port with the `PORT` environment variable:

```bash
PORT=8080 qr-stream --serve
```

The server resolves the `dist/` directory automatically, so it works from both the bundled CLI and a local checkout.

### CLI flags

| Flag            | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| `-h`, `--help`  | Show usage information                                            |
| `-s`, `--serve` | Start the web preview server                                      |
| `--port <n>`    | TCP port for `--serve`, default: `3000`, also supports `PORT` env |
| `--host <ip>`   | Bind address for `--serve`, default: `0.0.0.0`                    |

---

## Development Setup

### Prerequisites

* [Node.js](https://nodejs.org/) >= 18
* [pnpm](https://pnpm.io/)

### Install dependencies

```bash
pnpm install
```

### Start the dev server

```bash
pnpm dev
```

Starts Vite with hot reload on:

```text
http://localhost:5173
```

### Build

```bash
pnpm build
```

Produces:

* `dist/index.html` and `dist/assets/*` - the web app
* `dist/qr-stream.js` - the self-contained CLI bundle

### Preview the production build

```bash
pnpm preview
```

Serves the contents of `dist/` locally exactly as it will run in production.

### Run tests

```bash
pnpm test
```

Runs the full test suite via Vitest.

### Run the CLI from source

```bash
pnpm cli
```

### Build the CLI only

```bash
pnpm build:cli
```

---

## RaptorQ WASM

QR Stream now uses a standard RaptorQ fountain-code implementation based on the Rust `cberner/raptorq` implementation.

The Rust implementation is compiled to WASM and used by the web app and CLI for the high-performance encoding/decoding path.

The previous JavaScript fountain-code implementation is still kept as a compatibility fallback.

The RaptorQ source and build script live under:

```text
src/raptorq/
```

When changing the Rust implementation, rebuild the WASM package from that directory before rebuilding the main app.

---

## Implementation Notes

QR Stream is built around a camera-friendly, loss-tolerant transfer pipeline:

1. The sender compresses the input data.
2. The data is encoded with RaptorQ fountain coding.
3. Encoded packets are rendered as QR codes.
4. The live view draws QR frames directly to Canvas, so playback can begin immediately.
5. The receiver scans frames with ZXing WASM.
6. Decoded packets are collected until enough symbols are available.
7. The receiver reconstructs the original payload and verifies it with CRC32.

The scanner was migrated from `jsQR` to `ZXing WASM`, which improves scan throughput and reliability.

GIF generation is now separated from live QR playback. This means the live transfer path no longer needs to wait for GIF generation before starting, while GIF export remains available as a separate sharing/export feature.

---

## How It Works

1. **Sender** compresses your data, splits it into encoded packets, and wraps each packet in a QR code.
2. The QR codes are shown as an animated sequence in the terminal or browser.
3. **Receiver** scans the sequence with a camera or uploads a GIF.
4. The receiver decodes the frames and reassembles the original file or text.

The protocol uses RaptorQ fountain coding so the transfer can survive dropped frames, glare, and partial obstruction without requiring every single QR frame to be scanned.

For a deep dive into the packet format, algorithms, and design decisions, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## License

MIT - built for fun and utility.
