// Tone details and model selector for the active chain block. Listening
// happens one level up, in PresetPreview, which plays the whole chain.
import { ChevronLeft, ChevronRight, Download, Bookmark, Folder } from 'lucide-react';
import type { Model } from '../types';
import type { Block, BlockKind } from '../lib/flash';
import { isNamKind } from '../lib/flash';
import { CrossOriginImage } from './CrossOriginImage';

const GEAR: Record<string, string> = {
  amp: 'Amp', 'full-rig': 'Amp + Cab', 'amp-cab': 'Amp + Cab', pedal: 'Pedal', outboard: 'Outboard', cab: 'Cab', ir: 'Cab',
};

const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact' }).format(n);

interface Props {
  kind: BlockKind;
  block: Block;
  checking: boolean;
  onModel: (model: Model) => void;
}

export function BlockDetail({ kind, block, checking, onModel }: Props) {
  const { tone, models, model } = block;
  // By id: restored sessions hold separate copies of the same model.
  const index = models.findIndex((m) => m.id === model.id);

  return (
    <div className="detail">
      <div className="tone">
        {tone.images?.[0] ? (
          <CrossOriginImage src={tone.images[0]} alt="" className="tone-image" />
        ) : (
          <div className="tone-image" />
        )}
        <div className="tone-info">
          <h2 className="tone-title">{tone.title}</h2>
          <div className="tone-row">
            <span>{GEAR[tone.gear] ?? tone.gear}</span>
            <span className="badge">{isNamKind(kind) ? 'NAM A2-Lite' : 'IR'}</span>
          </div>
          <div className="tone-row">
            <span className="tone-stat"><Download /> {compact(tone.downloads_count)}</span>
            <span className="tone-stat"><Bookmark /> {compact(tone.favorites_count)}</span>
            <span className="tone-stat"><Folder /> {tone.models_count}</span>
          </div>
          <div className="tone-row">
            <span className="tone-creator">
              {tone.user.avatar_url && <CrossOriginImage src={tone.user.avatar_url} alt="" className="avatar" />}
              {tone.user.username}
            </span>
          </div>
          {tone.description && <p className="tone-desc">{tone.description}</p>}
        </div>
      </div>

      <div className="model-select">
        <div className={`model-select-bar${checking ? ' off' : ''}`}>
          <button className="btn-icon plain" disabled={checking || index <= 0} onClick={() => onModel(models[index - 1])} aria-label="Previous model">
            <ChevronLeft size={16} />
          </button>
          <select
            className="model-select-name"
            value={model.id}
            disabled={checking}
            onChange={(e) => {
              const next = models.find((m) => m.id === Number(e.target.value));
              if (next) onModel(next);
            }}
            aria-label="Model"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button className="btn-icon plain" disabled={checking || index >= models.length - 1} onClick={() => onModel(models[index + 1])} aria-label="Next model">
            <ChevronRight size={16} />
          </button>
          <span className="model-select-count">
            <Folder /> {index + 1}/{models.length}
          </span>
        </div>
      </div>
    </div>
  );
}
