import { useEffect, useRef, useState } from 'react';
import { useLang, type MessageKey } from '../i18n';
import { speak, stopSpeaking } from '../i18n/speech';
import { DETECT_INTERVAL_MS, FRAME_TARGET, HOLD_MS, MANUAL_MIN_FRAMES, MIN_FRAMES } from './config';
import { checkPose, checkSide, measurable, measurableSide, type Guidance, type Missing } from './measureChecks';
import {
  bestFrames,
  measureFrames,
  measureSideFrames,
  shoulderCorners,
  type Landmark,
  type Mask,
  type MeasureFrame,
  type MeasureResult,
  type SideResult,
} from './measureBody';
import { drawOverlay, type OverlayColours } from './overlay';
import './measure.css';

interface MeasureCaptureProps {
  heightCm: number;
  /** Shoulder calibration factor (see config.ts). */
  factor: number;
  /**
   * "front" (default) reads the shoulder width; "side" reads how deep the body
   * is at the shoulders, for the curve of the back (test mode only for now).
   */
  view?: 'front' | 'side';
  /** null when no reading could be worked out: the flow asks to retake. */
  onResult: (result: MeasureResult | null) => void;
  /** The side photo's reading (view "side"). */
  onSideResult?: (result: SideResult | null) => void;
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
  turnSide: 'measure.g.turnSide',
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

/** The page's colour tokens as plain colours the canvas can use. */
function overlayColours(el: HTMLElement | null): OverlayColours {
  const resolve = (token: string, fallback: string) => {
    if (!el) return fallback;
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    el.appendChild(probe);
    const colour = getComputedStyle(probe).color || fallback;
    probe.remove();
    return colour;
  };
  return {
    rim: resolve('--ink', '#15181e'),
    line: resolve('--paper', '#f1f3f5'),
    ready: resolve('--brand-tint', '#e8f0ec'),
    marker: resolve('--brand-tint', '#e8f0ec'),
  };
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
 * Rear camera showing the whole picture, with a dotted outline drawn live around
 * the person and the two shoulder points the reading is taken from. MediaPipe Pose runs on
 * the phone about 10 times a second and the screen shows one instruction at a
 * time. When the child fits for 2 seconds the reading is taken by itself; the
 * parent can also tap Capture. The video is only looked at here: no frame is
 * kept after the numbers are worked out, and the camera stops at once.
 */
export function MeasureCapture({
  heightCm,
  factor,
  view = 'front',
  onResult,
  onSideResult,
  onCancel,
  onCameraError,
}: MeasureCaptureProps) {
  const { t, lang } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [guidance, setGuidance] = useState<Guidance>('showFullBody');
  const [holdShare, setHoldShare] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  // Width / height of the camera picture, so the whole picture is shown with the outline on top of it.
  const [aspect, setAspect] = useState(3 / 4);
  const spoken = useRef<Guidance | null>(null);
  const captureNow = useRef<() => void>(() => undefined);
  const callbacks = useRef({ onResult, onSideResult, onCancel, onCameraError });
  callbacks.current = { onResult, onSideResult, onCancel, onCameraError };

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
    const colours = overlayColours(canvasRef.current?.parentElement ?? null);

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
        const side = view === 'side' && missing === 'shoulders';
        setNotice(t(missing && !side ? MISSING_KEY[missing] : 'measure.g.showFullBody'));
        return;
      }
      finished = true;
      const best = bestFrames(frames, FRAME_TARGET);
      const measured = view === 'side' ? null : measureFrames(best, heightCm, factor);
      const sideMeasured = view === 'side' ? measureSideFrames(best, heightCm) : null;
      // Done with the camera: stop it before anything else happens.
      stop();
      recent = [];
      held = [];
      if (view === 'side') callbacks.current.onSideResult?.(sideMeasured);
      else callbacks.current.onResult(measured);
    };
    captureNow.current = () => finish(held.length >= MIN_FRAMES ? held : recent, MANUAL_MIN_FRAMES);

    const loop = (now: number) => {
      timer = window.requestAnimationFrame(loop);
      if (cancelled || finished || !landmarker || video.readyState < 2 || now - lastRun < DETECT_INTERVAL_MS) return;
      lastRun = now;
      const result = landmarker.detectForVideo(video, now);
      const raw = result.landmarks?.[0];
      const poseMask = result.segmentationMasks?.[0];
      const mask = poseMask ? copyMask(poseMask) : null;
      poseMask?.close?.();
      if (!raw || video.videoWidth === 0) {
        if (canvasRef.current) drawOverlay(canvasRef.current, null, null, false, colours);
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
      const pose =
        view === 'side'
          ? checkSide(landmarks, video.videoWidth, video.videoHeight, previous)
          : checkPose(landmarks, video.videoWidth, video.videoHeight, previous);
      previous = landmarks;
      setGuidance(pose.guidance);
      // The live outline around the person, and on the front photo the two shoulder points measured.
      if (canvasRef.current) {
        const corners =
          view === 'front' && mask
            ? shoulderCorners({ landmarks, mask, imageWidth: video.videoWidth, imageHeight: video.videoHeight })
            : null;
        drawOverlay(canvasRef.current, mask, corners, pose.ready, colours);
      }
      const inView = view === 'side' ? measurableSide(landmarks) : measurable(landmarks);
      missing = inView.missing;
      if (inView.ok) setNotice('');

      // Every frame a reading can come from is kept for Capture; the strict
      // checks only decide when the picture is taken by itself.
      if (inView.ok) {
        const frame: ScoredFrame = {
          landmarks,
          mask: mask ?? undefined,
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
  }, [heightCm, factor, view, t]);

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
          <canvas ref={canvasRef} className="measure-overlay" aria-hidden="true" />
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
