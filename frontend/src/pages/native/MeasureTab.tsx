import { useState } from 'react';
import { Camera, Ruler, ShieldCheck } from '../../components/ui/icons';
import { MeasureFlow } from '../../components/fit/MeasureFlow';
import './nativePages.css';

export function MeasureTab() {
  const [activeFlow, setActiveFlow] = useState<'none' | 'camera'>('none');
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  return (
    <div className="native-page-container">
      {activeFlow === 'camera' ? (
        <div className="native-measure-modal">
          <MeasureFlow
            onClose={() => setActiveFlow('none')}
            onSave={(fit) => {
              setActiveFlow('none');
              if (fit.shoulderCm) {
                setLastSaved(`Saved! Shoulder width: ${fit.shoulderCm.toFixed(1)} cm`);
              }
              return true;
            }}
          />
        </div>
      ) : (
        <>
          <div className="native-section-header">
            <div>
              <span className="native-eyebrow">SIZING & FIT</span>
              <h1>Smart Measurement</h1>
            </div>
          </div>

          {lastSaved && (
            <div className="native-notice success">
              <ShieldCheck width={20} height={20} />
              <span>{lastSaved}</span>
            </div>
          )}

          <div className="native-card hero-measure">
            <div className="hero-measure-icon">
              <Camera width={36} height={36} />
            </div>
            <h2>On-device AI Measurement</h2>
            <p>
              Take a full-body standing photo of your child to calculate precise shoulder width, chest,
              and length recommendations.
            </p>
            <button
              type="button"
              className="native-primary-btn"
              onClick={() => setActiveFlow('camera')}
            >
              Start Camera Sizing
            </button>
          </div>

          <div className="native-privacy-card">
            <div className="privacy-badge">
              <ShieldCheck width={18} height={18} />
              <strong>DPDP Compliant & 100% Private</strong>
            </div>
            <p>
              Child photos are processed in real-time in your device’s memory using MediaPipe.
              Photos are <em>never</em> uploaded to our servers or stored in the cloud.
            </p>
          </div>

          <div className="native-card">
            <div className="native-card-title-row">
              <Ruler width={22} height={22} />
              <h3>Tape Measurement Guide</h3>
            </div>
            <ul className="native-measure-tips">
              <li>
                <strong>Shoulder width:</strong> Measure across the back from the edge of the left shoulder bone to the right shoulder bone.
              </li>
              <li>
                <strong>Chest:</strong> Wrap the tape under arms at the fullest point of the chest.
              </li>
              <li>
                <strong>Height:</strong> Stand against a wall without shoes, heels flat.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
