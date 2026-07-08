# RaptorQR

Transfer files and text between devices by displaying high-throughput animated QR codes and reading them with a camera.

Everything runs locally in the browser or terminal: no upload server, no Bluetooth, no cable.

RaptorQR is a project inspired by [hermitm0nk/qr-stream](https://github.com/hermitm0nk/qr-stream). The project has since become a substantial rewrite of the core transfer pipeline and user experience: FEC, QR rendering, worker scheduling, scanner integration, sender/receiver UI, CLI packaging, and the repo layout have all been rebuilt around a higher-throughput, production-ready architecture.

Live demo: https://qr.linkto.host/

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Finfrost%2Fraptorqr)

## Performance

RaptorQR uses the Rust [`cberner/raptorq`](https://github.com/cberner/raptorq) implementation of RaptorQ (RFC 6330), compiled to WASM, as its primary fountain-code codec. This project also compiles [`erwanvivien/fast_qr`](https://github.com/erwanvivien/fast_qr) to WASM for high-speed QR rendering, with a more feature-complete wrapper than the upstream WASM package, and uses ZXing WASM for scanning.

The result is a massive performance improvement over the original JavaScript-only transfer path. In measured tests, the new pipeline reaches at least **50x+ higher throughput** in practical transfer scenarios.

Measured examples:

| Scenario                                  |                         Result |
| ----------------------------------------- | -----------------------------: |
| V20 QR, 4-code parallel playback, 30 FPS  | up to 300 decoded QR symbols/s |
| V30 QR, 4-code parallel playback, 30 FPS  |      100+ decoded QR symbols/s |
| 95.2 KB file transfer (V30-L x 4QR@30fps) |       375 ms, about 254.0 KB/s |
| 3.0 MB file transfer (V30-L x 4QR@30fps)  |                 about 100 KB/s |

The 95.2 KB and 3.0 MB file tests were measured on **iPhone 16 / Safari as QR scanner**. Actual speed depends on device camera quality, browser performance, lighting, QR size, QR version, playback rate, and scan settings.

The current RaptorQ WASM path is intended to be production-ready for local offline transfer workflows.

## Packages

```text
packages/raptorqr-core   protocol, packetization, FEC, QR encode/decode APIs
packages/raptorqr-wasm   fast_qr and RaptorQ WASM artifacts plus Colab scripts
packages/raptorqr-cli    raptorqr terminal CLI
apps/web                 Preact/Vite web app
```

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

Run the CLI from source:

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

The CLI bundle is built at:

```text
packages/raptorqr-cli/dist/raptorqr.js
```

The CLI copies its required WASM sidecars into the same `dist/` directory.

## WASM Artifacts

The generated artifacts live under:

```text
packages/raptorqr-wasm/src/fast_qr/wasm
packages/raptorqr-wasm/src/raptorq/wasm
```

The build scripts are:

```text
packages/raptorqr-wasm/src/fast_qr/build_fast_qr_wasm_colab.py
packages/raptorqr-wasm/src/raptorq/build_raptorq_wasm_colab.py
```

You can paste the scripts into a Colab notebook to build the WASM artifacts. The scripts will download and build the upstream Rust dependencies, then compile them to WASM.

## Implementation Notes

The protocol keeps the existing fixed 8-byte transport header. RaptorQ packets use the reserved symbol index sentinel, while JS RLNC packets use the legacy symbol index range.

`wasm-raptorq` is the default FEC codec. `js-rlnc` is still exported and test-covered, but it is deprecated and is never used as an automatic fallback.

For a deeper protocol and package overview, see [ARCHITECTURE.md](ARCHITECTURE.md).
