// Download release images -> DFU mode -> WebUSB install (bootloader first on a new Seed).
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { FirmwareImages, FirmwareManifest, InstallTarget } from '../lib/firmware';
import { installNext, loadFirmwareImages } from '../lib/firmware';
import { triggerDfuOverSerial, isWebSerialSupported } from '../lib/serial';
import { isWebUsbSupported } from '../lib/webdfu';
import { Spinner } from './Spinner';

type Phase =
  | { step: 'loading' }
  | { step: 'ready'; images: FirmwareImages; triggering: boolean }
  | { step: 'installing'; target: InstallTarget; percent: number; phase: 'erase' | 'write' }
  | { step: 'done' }
  | { step: 'error'; message: string; images: FirmwareImages | null };

const isDismiss = (err: unknown) => (err as DOMException)?.name === 'NotFoundError';
const message = (err: unknown) => String((err as Error)?.message ?? err);

interface Props {
  manifest: FirmwareManifest;
  onClose: () => void;
}

export function FirmwareDialog({ manifest, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ step: 'loading' });
  // A new Seed takes two passes: the Daisy bootloader, then the firmware.
  const [bootloaderDone, setBootloaderDone] = useState(false);

  useEffect(() => {
    let canceled = false;
    loadFirmwareImages(manifest)
      .then((images) => !canceled && setPhase({ step: 'ready', images, triggering: false }))
      .catch((err) => !canceled && setPhase({ step: 'error', message: message(err), images: null }));
    return () => {
      canceled = true;
    };
  }, [manifest]);

  const trigger = async (images: FirmwareImages) => {
    setPhase({ step: 'ready', images, triggering: true });
    try {
      await triggerDfuOverSerial();
      await new Promise((r) => setTimeout(r, 4000)); // re-enumerate as DFU
      setPhase({ step: 'ready', images, triggering: false });
    } catch (err) {
      if (isDismiss(err)) setPhase({ step: 'ready', images, triggering: false });
      else setPhase({ step: 'error', message: `DFU trigger failed: ${message(err)}`, images });
    }
  };

  const install = async (images: FirmwareImages) => {
    try {
      const installed = await installNext(images, (target, written, total, p) =>
        setPhase({ step: 'installing', target, percent: Math.round((written / total) * 100), phase: p }),
      );
      if (installed === 'bootloader') {
        setBootloaderDone(true);
        setPhase({ step: 'ready', images, triggering: false });
      } else {
        setPhase({ step: 'done' });
      }
    } catch (err) {
      if (isDismiss(err)) setPhase({ step: 'ready', images, triggering: false });
      else setPhase({ step: 'error', message: message(err), images });
    }
  };

  const busy = phase.step === 'installing';
  const kb = (manifest.firmware.size / 1024).toFixed(1);

  return (
    <div className="backdrop" onClick={busy ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <span className="label">Install firmware</span>
        {!busy && phase.step !== 'done' && (
          <button className="btn-icon plain dialog-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        )}

        {phase.step === 'loading' && (
          <div className="status-row">
            <Spinner />
            <span className="muted">Downloading firmware {manifest.version}</span>
          </div>
        )}

        {phase.step === 'ready' && !bootloaderDone && (
          <>
            <p className="muted">
              Firmware {manifest.version}, {kb} KB. Presets on the pedal are kept.
              {!isWebUsbSupported() && ' WebUSB is not supported in this browser; use Chrome or Edge.'}
            </p>
            <div className="step">
              <span className="step-num">1</span>
              <div className="step-body">
                <strong>Put the pedal in DFU mode</strong>
                <p>
                  New Daisy Seed: hold BOOT, tap RESET, release BOOT. Pedal already running the firmware: send the
                  trigger over USB serial instead.
                </p>
                <button className="btn" disabled={!isWebSerialSupported() || phase.triggering} onClick={() => trigger(phase.images)}>
                  {phase.triggering ? 'Waiting for pedal' : 'Send DFU trigger'}
                </button>
              </div>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <div className="step-body">
                <strong>Connect and install</strong>
                <p>
                  Pick the device in the browser prompt: Daisy Bootloader on a pedal, DFU in FS Mode on a new Seed. A new
                  Seed gets the Daisy bootloader first, then asks you to connect once more for the firmware.
                </p>
                <button className="btn btn-primary" disabled={!isWebUsbSupported() || phase.triggering} onClick={() => install(phase.images)}>
                  Connect and install
                </button>
              </div>
            </div>
          </>
        )}

        {phase.step === 'ready' && bootloaderDone && (
          <>
            <p className="muted">Bootloader installed. The Seed has restarted into it and its LED is breathing.</p>
            <div className="step">
              <span className="step-num">3</span>
              <div className="step-body">
                <strong>Connect again for the firmware</strong>
                <p>
                  Pick the Daisy Bootloader device. If it is not listed, tap RESET on the Seed, then tap BOOT while the
                  LED breathes.
                </p>
                <button className="btn btn-primary" disabled={!isWebUsbSupported()} onClick={() => install(phase.images)}>
                  Connect and install firmware
                </button>
              </div>
            </div>
          </>
        )}

        {phase.step === 'installing' && (
          <div className="status">
            <span className="muted">
              {phase.phase === 'erase' ? 'Erasing' : 'Writing'} {phase.target === 'bootloader' ? 'bootloader' : `firmware ${manifest.version}`}{' '}
              {phase.percent}%
            </span>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${phase.percent}%` }} />
            </div>
            <span className="muted">Do not unplug the pedal.</span>
          </div>
        )}

        {phase.step === 'done' && (
          <div className="status">
            <p>
              Firmware {manifest.version} installed. The pedal is rebooting. Load its presets with Flash to pedal.
            </p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}

        {phase.step === 'error' && (
          <div className="status">
            <p className="error-text">{phase.message}</p>
            <div className="status-row">
              {phase.images && (
                <button className="btn" onClick={() => setPhase({ step: 'ready', images: phase.images!, triggering: false })}>
                  Try again
                </button>
              )}
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
