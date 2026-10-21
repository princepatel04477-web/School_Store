import { useEffect, useRef, useState } from 'react';
import { useLang, type MessageKey } from '../i18n';
import { speak, stopSpeaking } from '../i18n/speech';
import { DETECT_INTERVAL_MS, FRAME_TARGET, HOLD_MS, MANUAL_MIN_FRAMES, MIN_FRAMES } from './config';
import { checkPose, measurable, type Guidance, type Missing } from './measureChecks';
import {
  bestFrames,
  measureFrames,
  type Landmark,
  type Mask,
  type MeasureFrame,
  type MeasureResult,
} from './measureBody';
import './measure.css';

interface MeasureCaptureProps {
  heightCm: number;
  /** Shoulder calibration factor (see config.ts). */
  factor: number;
  /** null when no reading could be worked out: the flow asks to retake. */
  onResult: (result: MeasureResult | null) => void;
  onCancel: () => void;
  /** No camera, or the parent said no: the flow offers typing the numbers instead. */
  onCameraError: () => void;
}

const GUIDE_KEY: Record<Guidance, MessageKey> = {
  moveBack: 'measure.g.moveBack',
  moveCloser: 'measure.g.moveCloser',
  standInside: 'measure.g.standInside',
  showFullBody: 'measure.g.showFullBody',
  standStraight: 'measure.g.standStraight',
  holdStill: 'measure.g.holdStill',
  ready: 'measure.g.ready',
};

const MISSING_KEY: Record<Missing, MessageKey> = {
  head: 'measure.miss.head',
  shoulders: 'measure.miss.shoulders',
  feet: 'measure.miss.feet',
};

interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

interface PoseMask {
  width: number;
  height: number;
  getAsUint8Array: () => Uint8Array;
  close?: () => void;
}

interface PoseResult {
  landmarks?: PosePoint[][];
  segmentationMasks?: PoseMask[];
}

type ScoredFrame = MeasureFrame & { quality: number };

/** Frames kept for a manual capture: the last couple of seconds. */
const RECENT_FRAMES = 20;

function copyMask(mask: PoseMask): Mask {
  return { width: mask.width, height: mask.height, data: new Uint8Array(mask.getAsUint8Array()) };
}

/**
 * Asks for the camera's own 4:3 shape (landscape in sensor terms). Asking for a
 * tall 720x1280 picture made phones crop the sensor, which looked zoomed in and
 * cut off the child's feet. Zoom is left at the phone's own 1x: forcing the
 * widest zoom switched phones with several lenses to the 0.5x ultra-wide lens,
 * which bends the picture near its edges and makes the child small.
 */
const CAMERA: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 960 },
  aspectRatio: { ideal: 4 / 3 },
};

/**
 * Rear camera with a dotted child outline over the whole camera picture. MediaPipe Pose runs on
 * the phone about 10 times a second and the screen shows one instruction at a
 * time. When the child fits for 2 seconds the reading is taken by itself; the
 * parent can also tap Capture. The video is only looked at here: no frame is
 * kept after the numbers are worked out, and the camera stops at once.
 */
export function MeasureCapture({ heightCm, factor, onResult, onCancel, onCameraError }: MeasureCaptureProps) {
  const { t, lang } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [guidance, setGuidance] = useState<Guidance>('showFullBody');
  const [holdShare, setHoldShare] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  // Width / height of the camera picture, so the whole picture is shown with the outline on top of it.
  const [aspect, setAspect] = useState(3 / 4);
  const spoken = useRef<Guidance | null>(null);
  const captureNow = useRef<() => void>(() => undefined);
  const callbacks = useRef({ onResult, onCancel, onCameraError });
  callbacks.current = { onResult, onCancel, onCameraError };

  useEffect(() => {
    if (spoken.current === guidance) return;
    spoken.current = guidance;
    speak(t(GUIDE_KEY[guidance]), lang);
  }, [guidance, lang, t]);

  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    let finished = false;
    let timer = 0;
    let lastRun = 0;
    let landmarker: { close: () => void; detectForVideo: (source: HTMLVideoElement, time: number) => PoseResult } | null =
      null;
    let stream: MediaStream | null = null;
    let recent: ScoredFrame[] = [];
    let held: ScoredFrame[] = [];
    let readySince = 0;
    let previous: Landmark[] | null = null;
    // The part of the child Capture would need; null while no child is seen at all.
    let missing: Missing | null = null;

    const stop = () => {
      window.cancelAnimationFrame(timer);
      landmarker?.close();
      landmarker = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (video) video.srcObject = null;
    };

    const finish = (frames: ScoredFrame[], minFrames = MIN_FRAMES) => {
      if (finished) return;
      if (frames.length < minFrames) {
        // Say which part of the child the camera can't see.
        setNotice(t(missing ? MISSING_KEY[missing] : 'measure.g.showFullBody'));
        return;
      }
      finished = true;
      const measured = measureFrames(bestFrames(frames, FRAME_TARGET), heightCm, factor);
      // Done with the camera: stop it before anything else happens.
      stop();
      recent = [];
      held = [];
      callbacks.current.onResult(measured);
    };
    captureNow.current = () => finish(held.length >= MIN_FRAMES ? held : recent, MANUAL_MIN_FRAMES);

    const loop = (now: number) => {
      timer = window.requestAnimationFrame(loop);
      if (cancelled || finished || !landmarker || video.readyState < 2 || now - lastRun < DETECT_INTERVAL_MS) return;
      lastRun = now;
      const result = landmarker.detectForVideo(video, now);
      const raw = result.landmarks?.[0];
      const poseMask = result.segmentationMasks?.[0];
      if (!raw || video.videoWidth === 0) {
        poseMask?.close?.();
        missing = null;
        recent = [];
        setGuidance('showFullBody');
        readySince = 0;
        held = [];
        setHoldShare(0);
        return;
      }
      const landmarks = raw.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
        visibility: point.visibility ?? point.presence,
      }));
      const pose = checkPose(landmarks, video.videoWidth, video.videoHeight, previous);
      previous = landmarks;
      setGuidance(pose.guidance);
      const inView = measurable(landmarks);
      missing = inView.missing;
      if (inView.ok) setNotice('');

      // Every frame a reading can come from is kept for Capture; the strict
      // checks only decide when the picture is taken by itself.
      if (inView.ok) {
        const frame: ScoredFrame = {
          landmarks,
          mask: poseMask ? copyMask(poseMask) : undefined,
          imageWidth: video.videoWidth,
          imageHeight: video.videoHeight,
          quality: pose.quality,
        };
        recent = [...recent.slice(-(RECENT_FRAMES - 1)), frame];
        if (pose.ready) {
          if (readySince === 0) readySince = now;
          held = [...held.slice(-(RECENT_FRAMES - 1)), frame];
        }
      }
      poseMask?.close?.();

      if (!pose.ready) {
        readySince = 0;
        held = [];
        setHoldShare(0);
        return;
      }
      const share = Math.min(1, (now - readySince) / HOLD_MS);
      setHoldShare(share);
      if (share >= 1) finish(held);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      callbacks.current.onCameraError();
      return undefined;
    }

    navigator.mediaDevices
      .getUserMedia({ video: CAMERA, audio: false })
      .then(async (opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        video.srcObject = opened;
        await video.play();
        if (video.videoWidth > 0 && video.videoHeight > 0) setAspect(video.videoWidth / video.videoHeight);
        const vision = await import('@mediapipe/tasks-vision');
        const files = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        const base = { modelAssetPath: '/mediapipe/pose_landmarker_lite.task' };
        const shared = { runningMode: 'VIDEO' as const, numPoses: 1, outputSegmentationMasks: true };
        try {
          landmarker = await vision.PoseLandmarker.createFromOptions(files, {
            ...shared,
            baseOptions: { ...base, delegate: 'GPU' },
          });
        } catch {
          landmarker = await vision.PoseLandmarker.createFromOptions(files, {
            ...shared,
            baseOptions: { ...base, delegate: 'CPU' },
          });
        }
        if (cancelled) {
          stop();
          return;
        }
        setLoading(false);
        timer = window.requestAnimationFrame(loop);
      })
      .catch(() => {
        if (!cancelled) {
          stop();
          callbacks.current.onCameraError();
        }
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [heightCm, factor, t]);

  const ready = guidance === 'ready';

  return (
    <div className="measure-screen" role="dialog" aria-modal="true" aria-label={t('measure.cameraTitle')}>
      <div className="measure-stage">
        <div className="measure-frame" style={{ ['--measure-aspect' as string]: aspect }}>
          <video
            ref={videoRef}
            className="measure-video"
            playsInline
            muted
            autoPlay
            onLoadedMetadata={(e) => {
              const { videoWidth, videoHeight } = e.currentTarget;
              if (videoWidth > 0 && videoHeight > 0) setAspect(videoWidth / videoHeight);
            }}
          />
          <ChildOutline ready={ready} />
        </div>
      </div>
      <div className="measure-panel">
        <p className="measure-guide" aria-live="polite">
          {loading ? t('measure.loadingCamera') : notice && !ready ? notice : t(GUIDE_KEY[guidance])}
        </p>
        <div className="measure-hold" aria-hidden="true">
          <span style={{ transform: `scaleX(${holdShare})` }} />
        </div>
        <p className="measure-note">{t('measure.photoStays')}</p>
        <div className="measure-actions">
          <button type="button" className="measure-capture" disabled={loading} onClick={() => captureNow.current()}>
            {t('measure.capture')}
          </button>
          <button type="button" className="measure-skip" onClick={onCancel}>
            {t('measure.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Head-to-feet outline of a standing child, arms a little away from the body. */
function ChildOutline({ ready }: { ready: boolean }) {
  return (
    <svg className={`measure-outline ${ready ? 'is-ready' : ''}`} viewBox="0 0 120 260" aria-hidden="true">
      <path
        d="M60 8 c-10 0 -16 8 -16 18 c0 11 7 19 16 19 c9 0 16 -8 16 -19 c0 -10 -6 -18 -16 -18 z
           M50 46 c0 4 -1 6 -3 7 l-15 5 c-5 2 -7 6 -8 11 l-8 48 c-1 4 1 7 4 7 c3 0 5 -2 6 -5 l9 -40 l2 0
           l-2 52 l0 4 l2 98 c0 6 3 9 8 9 c5 0 7 -3 7 -8 l2 -86 l2 0 l2 86 c0 5 2 8 7 8 c5 0 8 -3 8 -9
           l2 -98 l0 -4 l-2 -52 l2 0 l9 40 c1 3 3 5 6 5 c3 0 5 -3 4 -7 l-8 -48 c-1 -5 -3 -9 -8 -11
           l-15 -5 c-2 -1 -3 -3 -3 -7"
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="4 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="22" y1="252" x2="98" y2="252" strokeWidth="1.5" strokeDasharray="4 4" />
    </svg>
  );
}
