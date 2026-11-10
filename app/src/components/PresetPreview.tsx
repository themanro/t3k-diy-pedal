// Preview of the whole preset in the browser: one play button that runs the DI
// input through block 1 then block 2, on the same A2-Lite submodel the pedal
// runs. The player is the mini (button-only) layout; the input select is ours.
import { useEffect, useMemo, useRef } from 'react';
import { T3kPlayer, DEFAULT_INPUTS, NO_IR, NO_MODEL } from 'neural-amp-modeler-wasm';
import type { Input, IR, Model as PlayerModel, NonEmptyArray, PlayerAssets, PlayerTone } from 'neural-amp-modeler-wasm';
import 'neural-amp-modeler-wasm/styles.css';
import type { Preset, NamBlock } from '../lib/flash';
import { t3kClient } from '../client';

// The pedal converts the smallest submodel (`convertNamToNamb` slim factor 0),
// so the preview runs the same one.
const PEDAL_SLIM_SIZE = 0;

/** Remount key: the chain's models, and whether their .nam files are in. */
export const previewKey = (preset: Preset, index: number) =>
  [index, preset.nam?.model.id ?? 0, preset.nam2?.model.id ?? 0, preset.ir?.model.id ?? 0, pending(preset) ? 'p' : 'r'].join(':');

export const hasBlocks = (p: Preset) => !!(p.nam || p.nam2 || p.ir);
/** A NAM block is still downloading or failed validation. */
const pending = (p: Preset) => [p.nam, p.nam2].some((b) => b && b.namJson == null);

const defaultInput = (DEFAULT_INPUTS.find((i) => i.default) ?? DEFAULT_INPUTS[0]).url;

interface Props {
  index: number;
  preset: Preset;
  checking: boolean;
  /** URL of the DI input to play, from DEFAULT_INPUTS. */
  input: string | null;
  onInput: (url: string) => void;
}

export function PresetPreview({ index, preset, checking, input, onInput }: Props) {
  const inputUrl = DEFAULT_INPUTS.some((i) => i.url === input) ? input! : defaultInput;

  // Blob URLs handed to the player; revoked when the chain changes (remount).
  // They're made inside the assets thunk, i.e. after mount, so StrictMode's
  // rehearsal cleanup in dev can't revoke them before the player fetches them.
  const blobs = useRef<string[]>([]);
  useEffect(() => () => blobs.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const isPending = pending(preset);

  // The chain, resolved once per tone. Shared by every input's tone so the IR
  // is fetched once per mount (the component remounts when the chain changes,
  // see previewKey).
  const chain = useRef<Promise<Omit<PlayerAssets, 'inputs'>> | null>(null);
  const resolveChain = () => {
    if (chain.current) return chain.current;
    const blob = (parts: BlobPart[], type: string) => {
      const url = URL.createObjectURL(new Blob(parts, { type }));
      blobs.current.push(url);
      return url;
    };
    // The validated .nam is already parsed on the block: no second download.
    const namModel = (b: NamBlock): PlayerModel => ({
      name: b.model.name,
      url: blob([JSON.stringify(b.namJson)], 'application/json'),
      default: true,
    });
    chain.current = (async () => {
      const { nam, nam2, ir } = preset;
      // Disabled while a .nam is still being checked: pass-through, nothing fetched.
      if (isPending) return { models: [NO_MODEL] as NonEmptyArray<PlayerModel>, irs: [NO_IR] as NonEmptyArray<IR> };
      let irs: NonEmptyArray<IR> = [NO_IR];
      if (ir) {
        const res = await t3kClient.fetchFile(ir.model.model_url);
        if (!res.ok) throw new Error(`IR download failed: ${res.status}`);
        irs = [{ name: ir.model.name, url: blob([await res.blob()], 'audio/wav'), mix: 1, default: true }];
      }
      // The player's chain is fixed as preModels → models → irs, so two
      // captures put block 1 in the pre slot.
      if (nam && nam2) return { preModels: [namModel(nam)] as NonEmptyArray<PlayerModel>, models: [namModel(nam2)] as NonEmptyArray<PlayerModel>, irs };
      const one = nam ?? nam2;
      return { models: [one ? namModel(one) : NO_MODEL] as NonEmptyArray<PlayerModel>, irs };
    })();
    return chain.current;
  };

  // A new tone per input: the mini player has no input control of its own, so
  // changing the select restarts the preview on the new track.
  const tones = useMemo<NonEmptyArray<PlayerTone>>(() => {
    const assets = async (): Promise<PlayerAssets> => ({
      ...(await resolveChain()),
      inputs: DEFAULT_INPUTS.map((i) => ({ ...i, default: i.url === inputUrl })) as NonEmptyArray<Input>,
    });
    return [{ id: `${previewKey(preset, index)}:${inputUrl}`, assets }];
  }, [inputUrl]);

  const status = isPending
    ? checking
      ? 'Checking models…'
      : 'A block failed validation; swap it to preview.'
    : 'Plays the whole chain';

  return (
    <div className="preview">
      <T3kPlayer
        key={inputUrl}
        id={`preset-${index}`}
        tones={tones}
        layout="mini"
        size={44}
        slimSize={PEDAL_SLIM_SIZE}
        disabled={isPending}
      />
      <div className="preview-text">
        <span className="label">Preview preset {index + 1}</span>
        <span className="preview-chain">{status}</span>
      </div>
      <label className="preview-input">
        <span className="label">Input</span>
        <select value={inputUrl} onChange={(e) => onInput(e.target.value)}>
          {DEFAULT_INPUTS.map((i) => (
            <option key={i.url} value={i.url}>{i.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
