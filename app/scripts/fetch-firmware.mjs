// Stages the prebuilt firmware for the app's "Install firmware" dialog:
//   public/firmware/t3k_pedal-<tag>.bin   t3k_pedal.bin from the GitHub release
//   public/firmware/<bootloader>.bin      the Daisy bootloader from the libDaisy submodule
//   public/firmware/firmware.json         manifest: version, file names, sizes, SHA-256
//
// The app has to serve these itself: GitHub's release downloads redirect to a
// host that sends no CORS headers, so a browser cannot fetch them directly.
//
// Usage: npm run firmware            (latest release)
//        FIRMWARE_TAG=v1.2.0 npm run firmware
// Env:   GH_TOKEN / GITHUB_TOKEN     optional, lifts the anonymous API rate limit
//        GITHUB_REPOSITORY           owner/repo, defaults to tone-3000/t3k-diy-pedal
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(APP, 'public', 'firmware');
const LIBDAISY_CORE = join(APP, '..', 'libDaisy', 'core');

const REPO = process.env.GITHUB_REPOSITORY || 'tone-3000/t3k-diy-pedal';
const TAG = process.env.FIRMWARE_TAG;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const ASSET = 't3k_pedal.bin';

// Where each image is linked to run. Must match FIRMWARE_ADDR / BOOTLOADER_ADDR
// / MODEL_BANK_ADDR in src/lib. The reset vector (second word of the image) is
// checked against these so a build for the wrong target is never shipped.
const FIRMWARE = { addr: 0x90040000, end: 0x90600000 }; // BOOT_QSPI app, up to the preset bank
const BOOTLOADER = { addr: 0x08000000, end: 0x08020000 }; // first 128 KB sector of internal flash

const fail = (msg) => {
  console.error(`fetch-firmware: ${msg}`);
  process.exit(1);
};
const hex = (n) => `0x${n.toString(16)}`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function checkImage(name, buf, { addr, end }) {
  if (buf.length < 8) fail(`${name} is only ${buf.length} bytes`);
  if (buf.length > end - addr) fail(`${name} is ${buf.length} bytes, more than the ${end - addr} at ${hex(addr)}`);
  const reset = buf.readUInt32LE(4);
  if (reset < addr || reset >= end) {
    fail(`${name} has reset vector ${hex(reset)}, not in ${hex(addr)}..${hex(end)}: not built for this address`);
  }
}

async function github(url, accept) {
  const res = await fetch(url, {
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) fail(`${url} -> ${res.status} ${res.statusText}`);
  return res;
}

// ── firmware: the release asset ─────────────────────────────────────────────
const api = `https://api.github.com/repos/${REPO}/releases/${TAG ? `tags/${TAG}` : 'latest'}`;
const release = await (await github(api, 'application/vnd.github+json')).json();
const asset = release.assets?.find((a) => a.name === ASSET);
if (!asset) fail(`release ${release.tag_name} of ${REPO} has no ${ASSET} attached`);

const firmware = Buffer.from(await (await github(asset.url, 'application/octet-stream')).arrayBuffer());
if (firmware.length !== asset.size) fail(`${ASSET}: downloaded ${firmware.length} bytes, release says ${asset.size}`);
if (asset.digest && asset.digest !== `sha256:${sha256(firmware)}`) fail(`${ASSET}: digest differs from the release's ${asset.digest}`);
checkImage(ASSET, firmware, FIRMWARE);

// ── bootloader: the one `make program-boot` installs ────────────────────────
const coreMakefile = join(LIBDAISY_CORE, 'Makefile');
if (!existsSync(coreMakefile)) fail('libDaisy submodule not checked out: run `git submodule update --init libDaisy`');
const bootName = /^BOOT_BIN\s*\?=\s*\$\(SYSTEM_FILES_DIR\)\/(\S+)/m.exec(readFileSync(coreMakefile, 'utf8'))?.[1];
if (!bootName) fail(`no BOOT_BIN default in ${coreMakefile}`);
const bootloader = readFileSync(join(LIBDAISY_CORE, bootName));
checkImage(bootName, bootloader, BOOTLOADER);

// ── write ───────────────────────────────────────────────────────────────────
// The tag is in the file name so a cached image is never paired with a newer manifest.
const firmwareName = `t3k_pedal-${release.tag_name}.bin`;
const entry = (file, buf) => ({ file, size: buf.length, sha256: sha256(buf) });
const manifest = {
  version: release.tag_name,
  releaseUrl: release.html_url,
  firmware: entry(firmwareName, firmware),
  bootloader: entry(bootName, bootloader),
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, firmwareName), firmware);
writeFileSync(join(OUT, bootName), bootloader);
writeFileSync(join(OUT, 'firmware.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`firmware   ${manifest.version}  ${firmwareName}  ${firmware.length} bytes  sha256 ${manifest.firmware.sha256}`);
console.log(`bootloader ${bootName}  ${bootloader.length} bytes  sha256 ${manifest.bootloader.sha256}`);
