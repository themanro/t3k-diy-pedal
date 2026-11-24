// Prebuilt firmware install: release image (+ Daisy bootloader on a new Seed) -> DfuSe write.
//
// Nothing is built here. scripts/fetch-firmware.mjs (`npm run firmware`, run by
// the App workflow) stages the latest GitHub release's t3k_pedal.bin and
// libDaisy's bootloader in public/firmware/ with a firmware.json manifest, so
// both are served from the app's own origin.

import { DfuDevice } from './webdfu';
import type { MemorySegment } from './webdfu';

// The firmware is a BOOT_QSPI application: the Daisy bootloader lives in
// internal flash and runs the app from QSPI (QSPI_ADDRESS / INTERNAL_ADDRESS in
// libDaisy/core/Makefile). The preset bank at 0x90600000 is a separate region,
// so installing firmware leaves the presets alone.
export const FIRMWARE_ADDR = 0x90040000;
export const BOOTLOADER_ADDR = 0x08000000;

export interface FirmwareImage {
  file: string;
  size: number;
  sha256: string;
}

export interface FirmwareManifest {
  version: string; // release tag, e.g. "v1.0.0"
  releaseUrl: string;
  firmware: FirmwareImage;
  bootloader: FirmwareImage;
}

export interface FirmwareImages {
  firmware: Uint8Array<ArrayBuffer>;
  bootloader: Uint8Array<ArrayBuffer>;
}

const url = (file: string) => `${import.meta.env.BASE_URL}firmware/${file}`;

/** The firmware this build ships, or null when none was staged (a dev build without `npm run firmware`). */
export async function loadFirmwareManifest(): Promise<FirmwareManifest | null> {
  try {
    const res = await fetch(url('firmware.json'), { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.json()) as Partial<FirmwareManifest>;
    return m.version && m.firmware?.file && m.bootloader?.file ? (m as FirmwareManifest) : null;
  } catch {
    return null; // the dev server answers a missing file with index.html
  }
}

async function fetchImage(image: FirmwareImage): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url(image.file));
  if (!res.ok) throw new Error(`Download of ${image.file} failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (buf.byteLength !== image.size || sha256 !== image.sha256) {
    throw new Error(`${image.file} does not match its checksum. Reload the page and try again.`);
  }
  return new Uint8Array(buf);
}

/** Download both images and check them against the manifest. */
export async function loadFirmwareImages(manifest: FirmwareManifest): Promise<FirmwareImages> {
  const [firmware, bootloader] = await Promise.all([fetchImage(manifest.firmware), fetchImage(manifest.bootloader)]);
  return { firmware, bootloader };
}

// Both bootloaders enumerate as 0483:df11, so they are told apart by the memory
// they offer: the STM32's built-in one exposes internal flash (0x08000000), the
// Daisy bootloader exposes QSPI from the application address up.
export type Bootloader = 'system' | 'daisy';

export function identifyBootloader(segments: MemorySegment[]): Bootloader | null {
  const has = (addr: number) => segments.some((s) => addr >= s.addr && addr <= s.lastAddr);
  if (has(BOOTLOADER_ADDR)) return 'system';
  if (has(FIRMWARE_ADDR)) return 'daisy';
  return null;
}

export type InstallTarget = 'bootloader' | 'firmware';
export type InstallProgress = (target: InstallTarget, bytesWritten: number, totalBytes: number, phase: 'erase' | 'write') => void;

/**
 * Write whichever image the connected bootloader calls for, then restart into it:
 *   STM32 system bootloader (a Seed that has never had the Daisy bootloader) -> the Daisy bootloader
 *   Daisy bootloader -> the firmware
 * A new Seed therefore takes two calls. Caller puts the Seed in DFU mode first.
 */
export async function installNext(images: FirmwareImages, progress?: InstallProgress): Promise<InstallTarget> {
  const dfu = await DfuDevice.request();
  try {
    const bootloader = identifyBootloader(dfu.memorySegments);
    if (!bootloader) throw new Error('This DFU device is not a Daisy Seed bootloader.');
    const target: InstallTarget = bootloader === 'system' ? 'bootloader' : 'firmware';
    const addr = target === 'bootloader' ? BOOTLOADER_ADDR : FIRMWARE_ADDR;
    await dfu.flash(addr, images[target], (written, total, phase) => progress?.(target, written, total, phase));
    await dfu.leave(addr);
    return target;
  } catch (err) {
    await dfu.close();
    throw err;
  }
}
