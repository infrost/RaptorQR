#!/usr/bin/env python3
"""Build cberner/raptorq as a wasm-bindgen module for QR Stream.

This script is intended for Google Colab so the main development machine does
not need a Rust toolchain. It can be pasted directly into a Colab cell. If a
QR Stream repo is present, artifacts are copied into src/raptorq/wasm; otherwise
they are written to /content/qrstream_raptorq_wasm_artifacts and zipped.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path


CRATE_VERSION = "2.0.1"
BUILD_DIR = Path("/content/qrstream_raptorq_wasm_build")
PACKAGE_NAME = "qrstream_raptorq_wasm"


WRAPPER_CARGO_TOML = f"""\
[package]
name = "{PACKAGE_NAME}"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
js-sys = "0.3"
wasm-bindgen = "0.2"
raptorq = {{ version = "{CRATE_VERSION}" }}

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = true

[package.metadata.wasm-pack.profile.release]
wasm-opt = false
"""


WRAPPER_LIB_RS = r"""
use js_sys::{Array, Uint8Array};
use raptorq::{Decoder, Encoder, EncodingPacket, ObjectTransmissionInformation};
use wasm_bindgen::prelude::*;

const PAYLOAD_ID_BYTES: u16 = 4;
const MAX_SOURCE_SYMBOLS_PER_BLOCK: u64 = 56_403;

#[wasm_bindgen]
pub fn encode_packets(
    data: &[u8],
    max_transport_payload_size: u16,
    repair_percent: u32,
) -> Result<Array, JsValue> {
    let config = raptorq_config(data.len(), max_transport_payload_size)?;
    let encoder = Encoder::new(data, config);
    let mut output = Array::new();

    for block in encoder.get_block_encoders().iter() {
        let source_packets = block.source_packets();
        let repair_packets = repair_packets_for_block(source_packets.len(), repair_percent)?;

        for packet in source_packets {
            push_packet(&mut output, packet);
        }
        for packet in block.repair_packets(0, repair_packets) {
            push_packet(&mut output, packet);
        }
    }

    Ok(output)
}

#[wasm_bindgen]
pub struct RaptorQDecoder {
    inner: Decoder,
}

#[wasm_bindgen]
impl RaptorQDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(data_len: u32, max_transport_payload_size: u16) -> Result<RaptorQDecoder, JsValue> {
        let config = raptorq_config(data_len as usize, max_transport_payload_size)?;
        Ok(RaptorQDecoder {
            inner: Decoder::new(config),
        })
    }

    pub fn push(&mut self, serialized_packet: &[u8]) -> Result<JsValue, JsValue> {
        if serialized_packet.len() < PAYLOAD_ID_BYTES as usize {
            return Err(JsValue::from_str("RaptorQ packet is too short"));
        }

        let packet = EncodingPacket::deserialize(serialized_packet);
        match self.inner.decode(packet) {
            Some(decoded) => Ok(Uint8Array::from(decoded.as_slice()).into()),
            None => Ok(JsValue::UNDEFINED),
        }
    }
}

fn raptorq_config(
    data_len: usize,
    max_transport_payload_size: u16,
) -> Result<ObjectTransmissionInformation, JsValue> {
    let symbol_size = raptorq_symbol_size(max_transport_payload_size)?;
    let transfer_length = data_len as u64;
    let total_symbols = ceil_div(transfer_length, symbol_size as u64).max(1);
    let source_blocks = ceil_div(total_symbols, MAX_SOURCE_SYMBOLS_PER_BLOCK).max(1);
    if source_blocks > u8::MAX as u64 {
        return Err(JsValue::from_str("RaptorQ object requires more than 255 source blocks"));
    }
    Ok(ObjectTransmissionInformation::new(
        transfer_length,
        symbol_size,
        source_blocks as u8,
        1,
        1,
    ))
}

fn raptorq_symbol_size(max_transport_payload_size: u16) -> Result<u16, JsValue> {
    if max_transport_payload_size <= PAYLOAD_ID_BYTES {
        return Err(JsValue::from_str(
            "max_transport_payload_size must be greater than the 4-byte RaptorQ payload id",
        ));
    }
    Ok(max_transport_payload_size - PAYLOAD_ID_BYTES)
}

fn ceil_div(value: u64, divisor: u64) -> u64 {
    if value == 0 {
        return 0;
    }
    (value - 1) / divisor + 1
}

fn repair_packets_for_block(source_packets: usize, repair_percent: u32) -> Result<u32, JsValue> {
    let source = source_packets as u128;
    let repair = (source * repair_percent as u128 + 99) / 100;
    if repair > u32::MAX as u128 {
        return Err(JsValue::from_str("repair packet count exceeds u32::MAX"));
    }
    Ok(repair as u32)
}

fn push_packet(output: &mut Array, packet: EncodingPacket) {
    let serialized = packet.serialize();
    output.push(&Uint8Array::from(serialized.as_slice()));
}
"""


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

    print(f"RaptorQ WASM artifacts written to {output_dir}")
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
        if candidate and (candidate / "src" / "raptorq").exists() and (candidate / "package.json").exists():
            return candidate.resolve()
    return None


def default_output_dir(repo_root: Path | None) -> Path:
    if repo_root is not None:
        return repo_root / "src" / "raptorq" / "wasm"
    return Path("/content/qrstream_raptorq_wasm_artifacts")


def ensure_rust_toolchain() -> None:
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
        if path.is_file():
            path.unlink()
    for path in pkg_dir.iterdir():
        if path.suffix in {".js", ".wasm", ".ts"} or path.name == "package.json":
            shutil.copy2(path, output_dir / path.name)


def write_manifest(output_dir: Path) -> None:
    manifest = {
        "package": PACKAGE_NAME,
        "raptorq": CRATE_VERSION,
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
    output: list[str] = []
    for line in process.stdout:
        output.append(line)
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
