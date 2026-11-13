# TONE3000 DIY Pedal Loader

Companion web app for the TONE3000 × Daisy DIY Pedal (T3K Pedal). It loads NAM
captures and cab IRs from [TONE3000](https://www.tone3000.com) onto the pedal's
four presets over USB. It also installs the prebuilt firmware, so building a pedal
needs no toolchain.

## Flow

1. **Log in.** TONE3000 OAuth (PKCE) in a popup. The session is stored, so returning
   users go straight to the presets.
2. **Pick a preset.** Drag the on-screen rotary knob (or click an LED) to choose
   preset 1 to 4.
3. **Build the chain.** Each preset is one or two blocks: an A2-Lite NAM capture on
   block 1, and on block 2 either a second A2-Lite capture (e.g. a drive pedal into
   an amp) or a cab IR. Clicking an empty block opens the TONE3000 select flow:
   block 1 is filtered to A2 NAM tones, block 2 to NAM and IR tones of every gear
   except spaces, and the tone's files decide which it becomes. NAM models are
   validated against the pedal's fixed A2-Lite architecture (1871 weights). Click a filled
   block to step through the tone's models, swap the tone, or remove it. The play button
   under the chain previews the whole preset in the browser (`neural-amp-modeler-wasm`):
   block 1 into block 2, on the same A2-Lite submodel the pedal runs, over a selectable DI
   input.
4. **Flash.** The app converts each `.nam` to `.namb`, packs a 4-entry bank (format
   v2) in rotary order (empty presets are zero-size entries), and writes it to QSPI
   at `0x90600000` over WebUSB (ST DfuSe). The pedal loads whichever preset the
   rotary points at and lights the LED above it.

Preset state is kept in `localStorage`, so coming back in the same browser picks up
where you left off (the `.nam` files are re-downloaded and re-validated on return).
**Sync from pedal** rebuilds the presets from whatever is on a plugged-in pedal: the
bank stores each block's TONE3000 model id, and the app asks the firmware for the
bank directory over Web Serial (`'B'` command), then resolves each id back to its
tone (Get Model → Get Tone → List Models). Blocks that can't be linked (banks packed
from local files without ids, or tones no longer accessible) are left empty, with a
note in the banner. Older firmware without the `'B'` command times out with a message
to update.

## Requirements

- Chrome or Edge (WebUSB and Web Serial).
- Pedal running the T3K Pedal firmware with the Daisy bootloader: **Install firmware**
  in the app (below), or `make program-boot`, `make program-dfu` from source.
- A TONE3000 publishable key (`t3k_pub_...`) from Settings > API Keys with
  `http://localhost:3001` as a registered redirect URI.

## Setup

```bash
cd app
cp env.example .env   # fill in VITE_PUBLISHABLE_KEY
npm install
npm run firmware      # optional: stage the release firmware for "Install firmware"
npm run dev           # http://localhost:3001
```

`npm run firmware` (`scripts/fetch-firmware.mjs`) downloads `t3k_pedal.bin` from the
latest GitHub release (`FIRMWARE_TAG=v1.2.0` for another one), copies the Daisy
bootloader from the `libDaisy` submodule, and writes both with a `firmware.json`
manifest (version, sizes, SHA-256) to `public/firmware/`, which is not committed.
Without it the app runs but has no **Install firmware** button.

## Deploying

The app lives at <https://www.tone3000.com/diy-pedal/app>. It is a static build:
`.github/workflows/app.yml` builds `app/` on every push that touches it and publishes
`dist/` to this repo's GitHub Pages under `app/`, and the TONE3000 site
(`next.config.mjs` `rewrites()`) proxies `/diy-pedal/app/*` to that Pages origin. The
two deploy independently; changing the app never requires a site deploy.

Production builds use `base: '/diy-pedal/app/'` (see `vite.config.ts`, override with
`VITE_BASE`), and the OAuth redirect URI defaults to the page's own URL, so the build
needs only `VITE_PUBLISHABLE_KEY`. The workflow reads it from the `T3K_PUBLISHABLE_KEY`
secret in the repo's "Pages" environment; that key must have
`https://www.tone3000.com/diy-pedal/app` registered as a redirect URI. One-time setup:
repo Settings > Pages > Source: GitHub Actions.

The workflow runs `npm run firmware` before the build, so every deploy ships the latest
release's firmware under `firmware/` on the app's own origin (GitHub serves release
assets without CORS headers, so the browser cannot fetch them from the release). When
`.github/workflows/firmware.yml` attaches the binary to a new `v*` release it dispatches
this workflow, and the app offers the new version a few minutes later.

## Flashing

1. **Flash to pedal** builds the bank image.
2. **DFU mode:** with the pedal plugged in and running, **Send DFU trigger** and pick
   its serial port. The firmware gets a `'D'` byte, blinks the LEDs twice, and resets
   into the bootloader. Or hold BOOT and tap RESET on the Seed.
3. **Connect and flash:** pick the `DFU in FS Mode` device. The app erases and writes
   the bank region, then reboots the pedal.

## Installing firmware

**Install firmware** in the Pedal panel writes the release build the app ships (the
button carries its version) over the same WebUSB DfuSe driver. Presets live in their
own flash region and are kept.

1. **DFU mode.** A new Daisy Seed: hold BOOT, tap RESET, release BOOT. A pedal already
   running the firmware: **Send DFU trigger**, as for presets.
2. **Connect and install:** pick the device in the browser prompt. What gets written
   depends on which bootloader answers; both enumerate as `0483:df11` and are told apart
   by the memory layout they report:
   - the STM32's built-in bootloader (a new Seed, listed as `DFU in FS Mode`) exposes
     internal flash, and gets the Daisy bootloader at `0x08000000` (what
     `make program-boot` does). The Seed restarts into it, LED breathing, and the dialog
     asks you to connect once more;
   - the Daisy bootloader (listed as `Daisy Bootloader`) exposes QSPI, and gets the
     firmware at `0x90040000` (what `make program-dfu` does). The pedal then reboots
     into it.

Both images are checked against the manifest's SHA-256 before anything is written. The
app cannot read the version a pedal is running (the firmware has no command for it), so
it offers the install rather than an "update available" prompt.

## Code

- `src/App.tsx`: auth, preset chains, tone loading and model validation, sync and restore.
- `src/components/`: `Splash`, `Header`, `Chain` (NAM / NAM-or-IR tiles), `PresetPreview` (whole-chain
  play button + input select), `BlockDetail` (tone details + model selector), `Pedal` (faceplate, knob,
  LEDs, flash, sync and firmware buttons), `FlashDialog`, `FirmwareDialog`.
- `src/assets/pedal/`: knob and bezel/LED sprites rendered from the enclosure model plus
  `face.json` (face geometry in mm). Regenerate with
  `blender -b -P hardware/renders/src/app_face.py` after changing the model.
- `src/tone3000-client.ts`: PKCE select flow and authenticated API client.
- `src/lib/namb.ts`: port of nam-binary-loader `nam2namb`.
- `src/lib/bank.ts`: port of `pack_models.py` (bank layout, IR pipeline).
- `src/lib/webdfu.ts`: WebUSB port of `pydfu.py`.
- `src/lib/firmware.ts`: firmware manifest, image download and checksum, bootloader detection and install.
- `scripts/fetch-firmware.mjs`: stages the release firmware and the Daisy bootloader in `public/firmware/`.
- `src/lib/serial.ts`: Web Serial DFU trigger and bank directory reader.
- `src/lib/sync.ts`: pedal bank directory → presets (TONE3000 id resolution).
- `src/lib/store.ts`: `localStorage` persistence of the presets.

## Design

Black and greys with white pill buttons, as in the plugin. Pure red for the LEDs,
pure yellow only for small accents. Rounded cards and tiles, no hover effects.
Arial body, Roboto Mono labels. The faceplate is drawn flat from the drill template
geometry (black print, bare-aluminium LED track) with the knob and chrome bezels rendered
from the 3D model. Logos are
from the [TONE3000 API design requirements](https://www.tone3000.com/api#design-requirements).
Icons are [Lucide](https://lucide.dev). The WASM player ships its own AudioWorklet and wasm
and finds them via `import.meta.url`, so `vite.config.ts` excludes it from dependency
pre-bundling (which would move the module and break those paths in dev).
