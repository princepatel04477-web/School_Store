import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { speak, stopSpeaking } from '../i18n/speech';
import { FRAME_TARGET, MIN_FRAMES, SHOULDER_OFFSET_CM, STILL_MS } from './config';
import { checkPose, type Guidance } from './measureChecks';
import {
  measureFrames,
  type Landmark,
  type Mask,
  type MeasureFrame,
  type MeasureResult,
} from './measureBody';
import './measure.css';

interface MeasureCaptureProps {
  heightCm: number;
  onResult: (result: MeasureResult) => void;
  onSkip: () => void;
}

const GUIDE_KEY: Record<Guidance, 'measure.stepBack' | 'measure.facePhone' | 'measure.holdStill' | 'measure.ready'> = {
  stepBack: 'measure.stepBack',
  facePhone: 'measure.facePhone',
  holdStill: 'measure.holdStill',
  ready: 'measure.ready',
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
}

interface PoseResult {
  landmarks?: PosePoint[][];
  segmentationMasks?: PoseMask[];
}

function maskFromPose(mask: PoseMask): Mask {
  return { width: mask.width, height: mask.height, data: mask.getAsUint8Array() };
}

export function MeasureCapture({ heightCm, onResult, onSkip }: MeasureCaptureProps) {
  const { t, lang } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [guidance, setGuidance] = useState<Guidance>('stepBack');
  const [error, setError] = useState('');
  const spoken = useRef<Guidance | null>(null);
  const finished = useRef(false);
  const onResultRef = useRef(onResult);
  const onSkipRef = useRef(onSkip);
  onResultRef.current = onResult;
  onSkipRef.current = onSkip;

  useEffect(() => {
    if (spoken.current === guidance) return;
    spoken.current = guidance;
    speak(`${t(GUIDE_KEY[guidance])}. ${t('measure.shirt')}`, lang);
  }, [guidance, lang, t]);

  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    let timer = 0;
    let landmarker: { close: () => void; detectForVideo: (source: HTMLVideoElement, time: number) => PoseResult } | null =
      null;
    let stream: MediaStream | null = null;
    const frames: MeasureFrame[] = [];
    let stillSince = 0;
    let previous: Landmark[] | null = null;

    const stop = () => {
      window.cancelAnimationFrame(timer);
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
    };

    const loop = () => {
      if (cancelled || finished.current || !landmarker || video.readyState < 2) {
        timer = window.requestAnimationFrame(loop);
        return;
      }
      const result = landmarker.detectForVideo(video, performance.now());
      const raw = result.landmarks?.[0];
      const poseMask = result.segmentationMasks?.[0];
      if (raw && poseMask && video.videoWidth > 0) {
        const landmarks = raw.map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z,
          visibility: point.visibility ?? point.presence,
        }));
        const pose = checkPose(landmarks, video.videoWidth, video.videoHeight, previous);
        previous = landmarks;
        setGuidance(pose.guidance);
        if (!pose.ready) {
          frames.length = 0;
          stillSince = 0;
        } else {
          if (stillSince === 0) stillSince = performance.now();
          if (frames.length < FRAME_TARGET) {
            frames.push({
              landmarks,
              mask: maskFromPose(poseMask),
              imageWidth: video.videoWidth,
              imageHeight: video.videoHeight,
            });
          }
          if (performance.now() - stillSince >= STILL_MS && frames.length >= MIN_FRAMES) {
            finished.current = true;
            const measured = measureFrames(frames, heightCm, SHOULDER_OFFSET_CM);
            stop();
            if (measured) onResultRef.current(measured);
            else onSkipRef.current();
            return;
          }
        }
      }
      timer = window.requestAnimationFrame(loop);
    };

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      })
      .then(async (opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        video.srcObject = opened;
        await video.play();
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
        if (!cancelled) timer = window.requestAnimationFrame(loop);
      })
      .catch(() => {
        if (!cancelled) setError(t('measure.cameraError'));
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [heightCm, t]);

  return (
    <div className="measure-screen">
      <video ref={videoRef} className="measure-video" playsInline muted autoPlay />
      <div className="measure-shade" />
      <svg className="measure-outline" viewBox="0 0 120 220" aria-hidden="true">
        <path
          d="M60 18 a12 12 0 1 1 0 0.1 M60 32 v18 M38 58 h44 M60 50 v70 M60 120 l-16 70 M60 120 l16 70"
          fill="none"
          strokeWidth="1"
          className={guidance === 'ready' ? 'is-ready' : ''}
        />
        <line x1="28" y1="196" x2="92" y2="196" strokeWidth="1" className={guidance === 'ready' ? 'is-ready' : ''} />
      </svg>
      <div className="measure-panel">
        <p>{error || t(GUIDE_KEY[guidance])}</p>
        <p>{t('measure.shirt')}</p>
        <p className="measure-note">{t('measure.hold')}</p>
        <button type="button" className="measure-skip" onClick={onSkip}>
          {t('measure.skip')}
        </button>
      </div>
    </div>
  );
}
