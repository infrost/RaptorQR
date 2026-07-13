# RaptorQR

**The world's fastest** files and texts transfer between devices by displaying high-throughput animated QR codes and reading them with a camera.

Everything runs locally in the browser or terminal: no upload server, no Bluetooth, no cable.

RaptorQR started from an earlier open-source QR streaming prototype and has since become a substantial rewrite of the core transfer pipeline and user experience: FEC, QR rendering, worker scheduling, scanner integration, sender/receiver UI, CLI packaging, and the repo layout have all been rebuilt around a higher-throughput, production-ready architecture.

<img width="221" height="480" alt="raptorQR" src="https://github.com/user-attachments/assets/e4a5f6f5-5fe8-4953-931a-a86a509b52e5" />

Live demo: https://qr.linkto.host/

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Finfrost%2Fraptorqr)

## Table of Contents

* [Performance](#performance)
* [Packages](#packages)
* [Features](#features)
* [FAQ](#faq)
* [Development](#development)
* [CLI](#cli)
* [WASM Artifacts](#wasm-artifacts)
* [Implementation Notes](#implementation-notes)
* [Links & Acknowledgements](#links--acknowledgements)


## Performance

RaptorQR uses the Rust [`cberner/raptorq`](https://github.com/cberner/raptorq) implementation of RaptorQ (RFC 6330), compiled to WASM, as its primary fountain-code codec. This project also compiles [`erwanvivien/fast_qr`](https://github.com/erwanvivien/fast_qr) to WASM for high-speed QR rendering, with a more feature-complete wrapper than the upstream WASM package, and uses ZXing WASM for scanning.

The result is a massive performance improvement over the original JavaScript-only transfer path. In measured tests, the new pipeline reaches at least **50x+ higher throughput** in practical transfer scenarios.

Measured examples:

| Scenario                                  |                         Result |
| ----------------------------------------- | -----------------------------: |
| V20 QR, 4-code parallel playback, 30 FPS  | up to 300 decoded QR symbols/s |
| V30 QR, 4-code parallel playback, 30 FPS  |      100+ decoded QR symbols/s |
| 95.2 KB file transfer (V30-L x 4QR@30fps) |       375 ms, about 254.0 KB/s |
| 6.5 MB file transfer (V30-L x 4QR@30fps)  |         36 s, about 183.6 KB/s |

<img width="295" height="203" alt="clipboard_2026-07-08_17-21" src="https://github.com/user-attachments/assets/a5d5fced-8042-447a-ba58-00c42ee107f6" />

The 95.2 KB and 6.5 MB file tests were measured on **iPhone 16 / Safari as QR scanner** as 'lab results'. Actual speed depends on device camera quality, browser performance, lighting, QR size, QR version, playback rate, and scan settings.

The current RaptorQ WASM path is intended to be production-ready for local offline transfer workflows.

## Packages

| Package | Install | Usage |
| --- | --- | --- |
| `@raptorqr/core` | `pnpm add @raptorqr/core` | [Packetize, schedule, render, and decode](packages/raptorqr-core/README.md#send-with-raptorq) |
| `@raptorqr/cli` | `pnpm add --global @raptorqr/cli` | [Terminal sender and local web server](packages/raptorqr-cli/README.md#usage) |
| `@raptorqr/fast-qr-wasm` | `pnpm add @raptorqr/fast-qr-wasm` | [Render QR codes as RGBA or matrices](packages/raptorqr-fast-qr-wasm/README.md#render-rgba) |
| `@raptorqr/raptorq-wasm` | `pnpm add @raptorqr/raptorq-wasm` | [Low-level RaptorQ encode and decode](packages/raptorqr-raptorq-wasm/README.md#encode-and-decode) |

Most applications should install `@raptorqr/core`; it already uses the two
WASM packages internally. Install the WASM packages directly only for
low-level codec or renderer integration. The non-published Preact/Vite web app
lives in `apps/web`.

## Features

* Browser sender/receiver for text and file transfer
* Improved sender/receiver UI for live playback, scanning, tuning, and transfer status
* Terminal sender via the `raptorqr` CLI
* Primary RaptorQ WASM fountain codec
* JS RLNC compatible codec (Deprecated)
* fast_qr WASM QR rendering, (ZXing WASM QR writer as optional)
* ZXing WASM QR scanning with configurable decoder settings
* Parallel QR playback, live Canvas rendering, and optional GIF export
* Adjustable QR version, ECC level, playback FPS, scan FPS, and repair overhead

## FAQ

### Can I use RaptorQR offline?

Yes. The web app includes `sw.js` and is already PWA-ready. After the first load, you can open the same link again even without an internet connection.

### Does RaptorQR upload my files anywhere?

No. Transfers run locally in the browser or terminal. Files and text are encoded into animated QR codes on the sender side and decoded from the camera feed on the receiver side.


## Development

Install dependencies:

```bash
pnpm install
```

Run the web app in development:

```bash
pnpm dev:web
```

Then open the Vite URL printed in the terminal, usually:

```text
http://localhost:5173
```

If you need camera access from another device on the same LAN, serve it over an allowed HTTPS/dev host as required by your browser's camera security policy.

Build everything:

```bash
pnpm build
```

### Deploy Web App On Vercel

This repo includes a root `vercel.json`, so Vercel can deploy the web app from the monorepo without changing the project root in the dashboard.

Vercel will run:

```bash
pnpm --filter @raptorqr/web build
```

and serve:

```text
apps/web/dist
```

Run tests:

```bash
pnpm test
```

Run the CLI locally. This builds the Node bundle, then starts it:

```bash
pnpm --filter @raptorqr/cli cli
```

Smoke-test the built CLI:

```bash
node packages/raptorqr-cli/dist/raptorqr.js --help
```

## CLI

```bash
raptorqr document.pdf
echo "Hello, world!" | raptorqr
raptorqr --serve --port 8080
```

`raptorqr document.pdf` reads the local file, preserves the filename and MIME
metadata, and displays a looping RaptorQ QR stream in the terminal. It does not
upload the file, create a URL, or write a new output file; scan the QR stream
with the RaptorQR receiver to reconstruct `document.pdf` on the receiving
device.

`echo "Hello, world!" | raptorqr` reads text from stdin and displays it as the
same looping terminal QR stream.

`raptorqr --serve --port 8080` starts a local static server for the built web
app. Run `pnpm build` first, then open `http://localhost:8080`.

Press `q` or `Ctrl-C` to stop the terminal QR sender.

The CLI bundle is built at:

```text
packages/raptorqr-cli/dist/raptorqr.js
```

The CLI copies its required WASM sidecars into the same `dist/` directory.

## WASM Artifacts

The generated artifacts live under:

```text
packages/raptorqr-fast-qr-wasm/src/wasm
packages/raptorqr-raptorq-wasm/src/wasm
```

The build scripts are:

```text
packages/raptorqr-fast-qr-wasm/src/build_fast_qr_wasm_colab.py
packages/raptorqr-raptorq-wasm/src/build_raptorq_wasm_colab.py
```

You can paste the scripts into a Colab notebook to build the WASM artifacts. The scripts will download and build the upstream Rust dependencies, then compile them to WASM.

## Implementation Notes

The protocol keeps the existing fixed 8-byte transport header. RaptorQ packets use the reserved symbol index sentinel, while JS RLNC packets use the legacy symbol index range.

`wasm-raptorq` is the default FEC codec. `js-rlnc` is still exported and test-covered, but it is deprecated and is never used as an automatic fallback.

For a deeper protocol and package overview, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Links & Acknowledgements

RaptorQR stands on the shoulders of excellent open-source projects and developer communities.

### Open-source projects used

* [hermitm0nk/qr-stream](https://github.com/hermitm0nk/qr-stream) — The Project orginally being inspired
* [cberner/raptorq](https://github.com/cberner/raptorq) — RaptorQ / RFC 6330 fountain-code implementation used by the WASM FEC codec.
* [erwanvivien/fast_qr](https://github.com/erwanvivien/fast_qr) — high-speed QR code rendering library compiled to WASM.
* [Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) — ZXing-C++ WebAssembly build used for QR/barcode scanning.
* [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp) — C++ port of ZXing, the underlying barcode image processing library.
* [ZXing](https://github.com/zxing/zxing) — the original open-source multi-format barcode scanning project.
* [Preact](https://preactjs.com/) — lightweight UI framework used by the web app.
* [Vite](https://vite.dev/) — frontend build tool and development server.
* [pnpm](https://pnpm.io/) — package manager used for the monorepo workspace.

### Community (Where this project is being discussed)

* [LINUX DO](https://linux.do/t/topic/2549646)
* [Appinn](https://meta.appinn.net/t/topic/87996/6)
