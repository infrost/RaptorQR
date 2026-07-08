#!/usr/bin/env python3
"""Build erwanvivien/fast_qr as a wasm-bindgen module for QR Stream.

This script is intended for Google Colab so the main development machine does
not need a Rust toolchain.  It can be pasted directly into a Colab cell.  If a
QR Stream repo is present, artifacts are copied into src/fast_qr_wasm/wasm;
otherwise they are written to /content/qrstream_fast_qr_wasm_artifacts and zipped.

The crate exposes a single `QrRenderer` struct whose internal RGBA and matrix
buffers are allocated exactly once at construction time.  Callers invoke
`render_rgba()` for app/live/GIF rendering or `render_matrix()` for CLI/tests,
then read the result directly through JavaScript views into WASM linear memory.
The legacy `render()` method remains as an alias for `render_rgba()`.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path


FAST_QR_VERSION = "0.13"
BUILD_DIR = Path("/content/qrstream_fast_qr_wasm_build")
PACKAGE_NAME = "qrstream_fast_qr_wasm"

# ---------------------------------------------------------------------------
# Cargo.toml
# ---------------------------------------------------------------------------

WRAPPER_CARGO_TOML = f"""\
[package]
name = "{PACKAGE_NAME}"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
fast_qr = {{ version = "{FAST_QR_VERSION}" }}

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = true

[package.metadata.wasm-pack.profile.release]
wasm-opt = false
"""

# ---------------------------------------------------------------------------
# src/lib.rs
# ---------------------------------------------------------------------------
# Design:
#   - `QrRenderer` allocates two fixed buffers:
#       1. An RGBA buffer large enough to hold a version-40 QR at scale 8:
#       (177 modules + 4*2 quiet-zone) * 8 px = 1480 px per side
#       1480 * 1480 * 4 bytes ≈ 8.76 MB
#       2. A 177*177 byte matrix buffer for raw module data.
#   - `render_rgba()` writes RGBA directly into the RGBA buffer and returns the
#     side pixel count so JS knows how many bytes are valid.
#   - `render_matrix()` writes 0/1 bytes directly into the matrix buffer and
#     returns the side module count.
#   - `render()` is a backward-compatible alias for `render_rgba()`; it also
#     outputs RGBA into the same fixed RGBA buffer.
#   - `buf_ptr()` / `buf_len()` expose the RGBA buffer for compatibility with
#     the previous wrapper. `rgba_ptr()` / `rgba_len()` and
#     `matrix_ptr()` / `matrix_len()` are the explicit APIs.
#   - JS zero-copy path:
#       const sidePx = renderer.render_rgba(data, version, ecc, scale);
#       const view = new Uint8ClampedArray(wasm.memory.buffer, renderer.rgba_ptr(), sidePx*sidePx*4);
#       const imageData = new ImageData(view.slice(), sidePx, sidePx);
#       const sideMods = renderer.render_matrix(data, version, ecc);
#       const modules = new Uint8Array(wasm.memory.buffer, renderer.matrix_ptr(), sideMods*sideMods);

WRAPPER_LIB_RS = r"""
use fast_qr::{ECL, Version, QRBuilder};
use wasm_bindgen::prelude::*;

/// Quiet-zone modules added on each edge (spec minimum is 4).
const QZ: u32 = 4;

/// V40 at scale 8: (177 + 4*2) * 8 = 1480 px per side.
const MAX_SIDE_PX: u32 = (177 + QZ * 2) * 8;

/// Total bytes in the fixed RGBA buffer.
const MAX_BUF: usize = (MAX_SIDE_PX as usize) * (MAX_SIDE_PX as usize) * 4;

/// Maximum raw module count in a QR matrix (V40 = 177x177).
const MAX_MATRIX_SIDE: usize = 177;

/// Total bytes in the fixed matrix buffer.  Each module is 0=light, 1=dark.
const MAX_MATRIX_BUF: usize = MAX_MATRIX_SIDE * MAX_MATRIX_SIDE;

// ---------------------------------------------------------------------------
// ECC helpers
// ---------------------------------------------------------------------------

fn ecc_from_u8(ecc: u8) -> Result<ECL, JsValue> {
    match ecc {
        0 => Ok(ECL::L),
        1 => Ok(ECL::M),
        2 => Ok(ECL::Q),
        3 => Ok(ECL::H),
        _ => Err(JsValue::from_str(&format!("Invalid ECC level byte: {ecc} (expected 0-3)"))),
    }
}

// ---------------------------------------------------------------------------
// Version helpers
// fast_qr uses Version::V01 … Version::V40 (two-digit enum variants).
// ---------------------------------------------------------------------------

fn version_from_u8(v: u8) -> Result<Version, JsValue> {
    match v {
        1  => Ok(Version::V01),  2  => Ok(Version::V02),  3  => Ok(Version::V03),
        4  => Ok(Version::V04),  5  => Ok(Version::V05),  6  => Ok(Version::V06),
        7  => Ok(Version::V07),  8  => Ok(Version::V08),  9  => Ok(Version::V09),
        10 => Ok(Version::V10),  11 => Ok(Version::V11),  12 => Ok(Version::V12),
        13 => Ok(Version::V13),  14 => Ok(Version::V14),  15 => Ok(Version::V15),
        16 => Ok(Version::V16),  17 => Ok(Version::V17),  18 => Ok(Version::V18),
        19 => Ok(Version::V19),  20 => Ok(Version::V20),  21 => Ok(Version::V21),
        22 => Ok(Version::V22),  23 => Ok(Version::V23),  24 => Ok(Version::V24),
        25 => Ok(Version::V25),  26 => Ok(Version::V26),  27 => Ok(Version::V27),
        28 => Ok(Version::V28),  29 => Ok(Version::V29),  30 => Ok(Version::V30),
        31 => Ok(Version::V31),  32 => Ok(Version::V32),  33 => Ok(Version::V33),
        34 => Ok(Version::V34),  35 => Ok(Version::V35),  36 => Ok(Version::V36),
        37 => Ok(Version::V37),  38 => Ok(Version::V38),  39 => Ok(Version::V39),
        40 => Ok(Version::V40),
        _ => Err(JsValue::from_str(&format!("Invalid QR version: {v} (expected 1-40)"))),
    }
}

// ---------------------------------------------------------------------------
// QrRenderer
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct QrRenderer {
    /// Fixed-capacity RGBA buffer — one lifetime allocation.
    rgba_buf: Vec<u8>,

    /// Fixed-capacity raw QR module buffer.  Values are 0=light, 1=dark.
    matrix_buf: Vec<u8>,

    /// Side module count written by the latest `render_matrix()` call.
    matrix_size: u32,
}

#[wasm_bindgen]
impl QrRenderer {
    /// Allocate the renderer and its fixed buffers once.
    #[wasm_bindgen(constructor)]
    pub fn new() -> QrRenderer {
        // Pre-fill with white (255) so any untouched pixels are white.
        QrRenderer {
            rgba_buf: vec![0xffu8; MAX_BUF],
            matrix_buf: vec![0u8; MAX_MATRIX_BUF],
            matrix_size: 0,
        }
    }

    /// Generate a QR code in-place and write RGBA pixels to the fixed buffer.
    ///
    /// # Parameters
    /// - `data`    – raw packet bytes to encode
    /// - `version` – QR version 1-40
    /// - `ecc`     – error correction level (0=L, 1=M, 2=Q, 3=H)
    /// - `scale`   – pixels per module (1-8)
    ///
    /// # Returns
    /// Side pixel count (`sidePx`).  The valid pixel region is
    /// `[buf_ptr .. buf_ptr + sidePx*sidePx*4)`.
    ///
    /// Throws a `JsValue` error string on failure.
    pub fn render_rgba(
        &mut self,
        data: &[u8],
        version: u8,
        ecc: u8,
        scale: u8,
    ) -> Result<u32, JsValue> {
        if scale == 0 || scale > 8 {
            return Err(JsValue::from_str(&format!("Scale must be 1-8, got {scale}")));
        }

        let ecl = ecc_from_u8(ecc)?;
        let ver = version_from_u8(version)?;

        let qr = QRBuilder::new(data)
            .version(ver)
            .ecl(ecl)
            .build()
            .map_err(|e| JsValue::from_str(&format!("fast_qr build error: {e:?}")))?;

        let size = qr.size as u32;
        let scale_u = scale as u32;
        let side_mods = size + QZ * 2;
        let side_px = side_mods * scale_u;

        let required = (side_px as usize) * (side_px as usize) * 4;
        if required > self.rgba_buf.len() {
            return Err(JsValue::from_str(&format!(
                "Buffer too small: need {required} bytes for V{version} scale {scale}"
            )));
        }

        // Write RGBA directly into the fixed buffer.
        for py in 0..side_px {
            let row_mod = (py / scale_u) as i32 - QZ as i32;
            let row_in_bounds = row_mod >= 0 && row_mod < size as i32;

            for px in 0..side_px {
                let col_mod = (px / scale_u) as i32 - QZ as i32;
                let col_in_bounds = col_mod >= 0 && col_mod < size as i32;

                // qr.data is a flat [Module] array indexed row-major.
                // Module::value(): true = dark.
                let is_dark = row_in_bounds
                    && col_in_bounds
                    && qr.data[row_mod as usize * qr.size + col_mod as usize].value();

                let v = if is_dark { 0u8 } else { 0xffu8 };
                let idx = ((py * side_px + px) * 4) as usize;
                self.rgba_buf[idx]     = v;   // R
                self.rgba_buf[idx + 1] = v;   // G
                self.rgba_buf[idx + 2] = v;   // B
                self.rgba_buf[idx + 3] = 0xff; // A
            }
        }

        Ok(side_px)
    }

    /// Backward-compatible alias for the previous wrapper API.
    /// This is exactly `render_rgba()`: it outputs RGBA pixels into the fixed
    /// RGBA buffer and returns the side pixel count.
    pub fn render(&mut self, data: &[u8], version: u8, ecc: u8, scale: u8) -> Result<u32, JsValue> {
        self.render_rgba(data, version, ecc, scale)
    }

    /// Generate a QR code in-place and write its raw module matrix to the
    /// fixed matrix buffer.
    ///
    /// Matrix values are one byte per module: 0 = light, 1 = dark.  The matrix
    /// does not include quiet-zone modules.  The valid byte region is
    /// `[matrix_ptr .. matrix_ptr + sideMods*sideMods)`.
    pub fn render_matrix(&mut self, data: &[u8], version: u8, ecc: u8) -> Result<u32, JsValue> {
        let ecl = ecc_from_u8(ecc)?;
        let ver = version_from_u8(version)?;

        let qr = QRBuilder::new(data)
            .version(ver)
            .ecl(ecl)
            .build()
            .map_err(|e| JsValue::from_str(&format!("fast_qr build error: {e:?}")))?;

        let size = qr.size;
        let required = size * size;

        if required > self.matrix_buf.len() {
            return Err(JsValue::from_str(&format!(
                "Matrix buffer too small: need {required} bytes for V{version}"
            )));
        }

        for idx in 0..required {
            self.matrix_buf[idx] = if qr.data[idx].value() { 1 } else { 0 };
        }

        self.matrix_size = size as u32;
        Ok(self.matrix_size)
    }

    /// Raw pointer to the start of the RGBA buffer inside WASM linear memory.
    /// Valid for the lifetime of this `QrRenderer` instance.
    pub fn buf_ptr(&self) -> u32 {
        self.rgba_ptr()
    }

    /// Total capacity of the buffer in bytes (not the valid region — use
    /// `sidePx * sidePx * 4` after `render()` to get the valid byte count).
    pub fn buf_len(&self) -> u32 {
        self.rgba_len()
    }

    /// Explicit raw pointer to the start of the RGBA buffer.
    pub fn rgba_ptr(&self) -> u32 {
        self.rgba_buf.as_ptr() as u32
    }

    /// Total capacity of the RGBA buffer in bytes.
    pub fn rgba_len(&self) -> u32 {
        self.rgba_buf.len() as u32
    }

    /// Raw pointer to the start of the 0/1 module matrix buffer.
    pub fn matrix_ptr(&self) -> u32 {
        self.matrix_buf.as_ptr() as u32
    }

    /// Total capacity of the matrix buffer in bytes.
    pub fn matrix_len(&self) -> u32 {
        self.matrix_buf.len() as u32
    }

    /// Side module count from the latest `render_matrix()` call.
    pub fn last_matrix_size(&self) -> u32 {
        self.matrix_size
    }
}
"""


# ---------------------------------------------------------------------------
# Build driver
# ---------------------------------------------------------------------------

def main() -> None:
    repo_root = find_repo_root()
    output_dir = default_output_dir(repo_root)

    ensure_rust_toolchain()
    ensure_wasm_pack_available()

    recreate_wrapper_crate()
    run(["wasm-pack", "build", "--release", "--target", "web", "--out-dir", "pkg"], cwd=BUILD_DIR)
    copy_artifacts(BUILD_DIR / "pkg", output_dir)
    write_manifest(output_dir)
    archive_path = zip_artifacts(output_dir)

    print(f"fast_qr WASM artifacts written to {output_dir}")
    print(f"Downloadable archive written to {archive_path}")


def find_repo_root() -> Path | None:
    candidates = [Path.cwd()]
    script_path = globals().get("__file__")
    if script_path:
        resolved_script = Path(script_path).resolve()
        candidates.extend(resolved_script.parents)

    env_repo = os.environ.get("QRSTREAM_REPO")
    if env_repo:
        candidates.append(Path(env_repo).expanduser())

    for candidate in candidates:
        if candidate and (candidate / "src" / "fast_qr_wasm").exists() and (candidate / "package.json").exists():
            return candidate.resolve()
    return None


def default_output_dir(repo_root: Path | None) -> Path:
    if repo_root is not None:
        return repo_root / "src" / "fast_qr_wasm" / "wasm"
    return Path("/content/qrstream_fast_qr_wasm_artifacts")


def ensure_rust_toolchain() -> None:
    # Colab Ubuntu images typically ship without build-essential (cc / ld).
    # wasm-pack itself must compile proc-macro crates, which require a C linker.
    run_shell("apt-get install -y -q build-essential")

    if shutil.which("rustup"):
        cargo_bin = Path.home() / ".cargo" / "bin"
        os.environ["PATH"] = f"{cargo_bin}{os.pathsep}{os.environ['PATH']}"
    else:
        run_shell("curl https://sh.rustup.rs -sSf | sh -s -- -y")
        cargo_bin = Path.home() / ".cargo" / "bin"
        os.environ["PATH"] = f"{cargo_bin}{os.pathsep}{os.environ['PATH']}"

    run(["rustup", "toolchain", "install", "stable"])
    run(["rustup", "default", "stable"])
    run(["rustup", "target", "add", "wasm32-unknown-unknown"])


def ensure_wasm_pack_available() -> None:
    if shutil.which("wasm-pack"):
        return
    run(["cargo", "install", "wasm-pack", "--locked"])


def recreate_wrapper_crate() -> None:
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    (BUILD_DIR / "src").mkdir(parents=True)
    (BUILD_DIR / "Cargo.toml").write_text(WRAPPER_CARGO_TOML, encoding="utf-8")
    (BUILD_DIR / "src" / "lib.rs").write_text(WRAPPER_LIB_RS.lstrip(), encoding="utf-8")


def copy_artifacts(pkg_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for path in output_dir.iterdir():
        # Keep manifest.json (hand-written) and any existing .wasm from a prior build.
        if path.is_file() and path.name != "manifest.json":
            path.unlink()
    for path in pkg_dir.iterdir():
        if path.suffix in {".js", ".wasm", ".ts"} or path.name == "package.json":
            shutil.copy2(path, output_dir / path.name)


def write_manifest(output_dir: Path) -> None:
    manifest = {
        "package": PACKAGE_NAME,
        "fast_qr": FAST_QR_VERSION,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "target": "web",
        "outputs": sorted(path.name for path in output_dir.iterdir() if path.is_file()),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def zip_artifacts(output_dir: Path) -> Path:
    archive_path = output_dir.with_suffix(".zip")
    if archive_path.exists():
        archive_path.unlink()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(output_dir.iterdir()):
            if path.is_file():
                zf.write(path, arcname=path.name)
    return archive_path


def run(args: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(args), flush=True)
    process = subprocess.Popen(
        args,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
    return_code = process.wait()
    if return_code != 0:
        print("\n--- command failed ---", flush=True)
        print(f"exit code: {return_code}", flush=True)
        print("command:", " ".join(args), flush=True)
        raise SystemExit(return_code)


def run_shell(command: str) -> None:
    print("+", command, flush=True)
    process = subprocess.Popen(
        command,
        shell=True,
        executable="/bin/bash",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
    return_code = process.wait()
    if return_code != 0:
        print("\n--- command failed ---", flush=True)
        print(f"exit code: {return_code}", flush=True)
        print("command:", command, flush=True)
        raise SystemExit(return_code)


if __name__ == "__main__":
    main()
