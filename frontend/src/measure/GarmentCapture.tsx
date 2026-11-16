import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLang } from '../i18n';
import {
  REFERENCE_CM,
  computeHomography,
  defaultGarmentPins,
  defaultReferenceQuad,
  detectReferenceQuad,
  measureGarment,
  measureSegmentCm,
  orderQuadClockwise,
  type GarmentMeasureResult,
  type GarmentPins,
  type Point2D,
  type Quad,
  type ReferenceKind,
} from './flatGarment';
import './measure.css';

interface GarmentCaptureProps {
  referenceKind: ReferenceKind;
  onReferenceChange: (kind: ReferenceKind) => void;
  onResult: (result: GarmentMeasureResult) => void;
  onCancel: () => void;
}

type Stage = 'camera' | 'reference' | 'garment';
type LineKey = 'shoulder' | 'chest' | 'length';

interface ActiveDrag {
  target: { kind: 'quad'; index: 0 | 1 | 2 | 3 } | { kind: 'pin'; line: LineKey; end: 0 | 1 };
  pointerId: number;
  point: Point2D;
}

const CAMERA: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1440 },
  aspectRatio: { ideal: 4 / 3 },
};

const MAX_SNAP_SIDE = 1600;
const LOUPE_PX = 112;
const LOUPE_ZOOM = 3.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Flat-lay clothes measurement on the phone: snap a well-fitting shirt or trouser
 * laid flat with a standard PVC card (8.56 x 5.398 cm) or A4 sheet (29.7 x 21.0 cm)
 * on top, confirm the 4 corners, and drag the seam pins with a 3.2x zoom loupe.
 * The picture never leaves memory and is wiped as soon as the numbers are read.
 */
export function GarmentCapture({
  referenceKind,
  onReferenceChange,
  onResult,
  onCancel,
}: GarmentCaptureProps) {
  const { t } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [aspect, setAspect] = useState(3 / 4);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 960, h: 1280 });
  const [quad, setQuad] = useState<Quad>(() => defaultReferenceQuad(960, 1280, referenceKind));
  const [autoFound, setAutoFound] = useState(false);
  const [pins, setPins] = useState<GarmentPins>(() => defaultGarmentPins(960, 1280));
  const [activeLine, setActiveLine] = useState<LineKey>('shoulder');
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const [errorText, setErrorText] = useState('');

  // Start live rear camera while in camera stage; falls back to picking a local photo if unavailable.
  useEffect(() => {
    if (stage !== 'camera') return undefined;
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setCameraFailed(true);
      return undefined;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    setCameraReady(false);
    setCameraFailed(false);

    navigator.mediaDevices
      .getUserMedia({ video: CAMERA, audio: false })
      .then(async (opened) => {
        if (cancelled) {
          opened.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = opened;
        video.srcObject = opened;
        await video.play();
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setAspect(video.videoWidth / video.videoHeight);
        }
        if (!cancelled) setCameraReady(true);
      })
      .catch(() => {
        if (!cancelled) setCameraFailed(true);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((tr) => tr.stop());
      if (video) video.srcObject = null;
    };
  }, [stage]);

  // Wipe the offscreen image buffer when unmounting.
  useEffect(
    () => () => {
      if (sourceCanvasRef.current) {
        sourceCanvasRef.current.width = 0;
        sourceCanvasRef.current.height = 0;
        sourceCanvasRef.current = null;
      }
    },
    [],
  );

  // Paint the captured still frame into the visible canvas whenever stage or image changes.
  useEffect(() => {
    if (stage === 'camera') return;
    const src = sourceCanvasRef.current;
    const dst = photoCanvasRef.current;
    if (!src || !dst) return;
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext('2d');
    if (ctx) ctx.drawImage(src, 0, 0);
  }, [stage, imgSize]);

  // Paint the 3.2x zoom magnifier loupe while a corner or seam pin is being dragged.
  useEffect(() => {
    if (!drag) return;
    const src = sourceCanvasRef.current;
    const loupe = loupeCanvasRef.current;
    if (!src || !loupe) return;
    loupe.width = LOUPE_PX;
    loupe.height = LOUPE_PX;
    const ctx = loupe.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#15181e';
    ctx.fillRect(0, 0, LOUPE_PX, LOUPE_PX);
    const crop = LOUPE_PX / LOUPE_ZOOM;
    ctx.drawImage(
      src,
      drag.point.x - crop / 2,
      drag.point.y - crop / 2,
      crop,
      crop,
      0,
      0,
      LOUPE_PX,
      LOUPE_PX,
    );
    const mid = LOUPE_PX / 2;
    ctx.strokeStyle = '#15181e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mid - 14, mid);
    ctx.lineTo(mid + 14, mid);
    ctx.moveTo(mid, mid - 14);
    ctx.lineTo(mid, mid + 14);
    ctx.stroke();
    ctx.strokeStyle = '#f1f3f5';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(mid - 14, mid);
    ctx.lineTo(mid + 14, mid);
    ctx.moveTo(mid, mid - 14);
    ctx.lineTo(mid, mid + 14);
    ctx.stroke();
  }, [drag]);

  const loadFrame = (source: CanvasImageSource, rawW: number, rawH: number, kind: ReferenceKind) => {
    if (rawW < 40 || rawH < 40) return;
    const scale = Math.min(1, MAX_SNAP_SIDE / Math.max(rawW, rawH));
    const w = Math.round(rawW * scale);
    const h = Math.round(rawH * scale);
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, w, h);
    sourceCanvasRef.current = offscreen;
    setImgSize({ w, h });
    setAspect(w / h);
    const pixels = ctx.getImageData(0, 0, w, h);
    const detected = detectReferenceQuad(pixels.data, w, h, kind);
    setAutoFound(Boolean(detected));
    setQuad(detected ?? defaultReferenceQuad(w, h, kind));
    setPins(defaultGarmentPins(w, h));
    setErrorText('');
    setStage('reference');
  };

  const snapFromVideo = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    loadFrame(video, video.videoWidth, video.videoHeight, referenceKind);
  };

  const onPickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      loadFrame(bitmap, bitmap.width, bitmap.height, referenceKind);
      bitmap.close();
    } catch {
      setErrorText(t('garment.err.badPhoto'));
    }
  };

  const switchReference = (next: ReferenceKind) => {
    onReferenceChange(next);
    if (stage !== 'camera' && sourceCanvasRef.current) {
      const src = sourceCanvasRef.current;
      const ctx = src.getContext('2d');
      const detected = ctx ? detectReferenceQuad(ctx.getImageData(0, 0, src.width, src.height).data, src.width, src.height, next) : null;
      setAutoFound(Boolean(detected));
      setQuad(detected ?? defaultReferenceQuad(src.width, src.height, next));
    }
  };

  const orderedQuad = useMemo(() => orderQuadClockwise(quad), [quad]);
  const homography = useMemo(() => computeHomography(orderedQuad, referenceKind), [orderedQuad, referenceKind]);

  const liveLengths = useMemo(() => {
    if (!homography) return null;
    const shoulder = measureSegmentCm(homography, pins.shoulder[0], pins.shoulder[1]);
    const chestFlat = measureSegmentCm(homography, pins.chest[0], pins.chest[1]);
    const length = measureSegmentCm(homography, pins.length[0], pins.length[1]);
    return { shoulder, chestFlat, length };
  }, [homography, pins]);

  const toImagePoint = (e: ReactPointerEvent<SVGSVGElement>): Point2D => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * imgSize.w;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * imgSize.h;
    return { x: clamp(x, 2, imgSize.w - 2), y: clamp(y, 2, imgSize.h - 2) };
  };

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pxPerImgX = rect.width / Math.max(1, imgSize.w);
    const pxPerImgY = rect.height / Math.max(1, imgSize.h);
    const pt = toImagePoint(e);
    const screenDist = (p: Point2D) => Math.hypot((p.x - pt.x) * pxPerImgX, (p.y - pt.y) * pxPerImgY);
    const hitRadius = 44;

    if (stage === 'reference') {
      let bestIdx: 0 | 1 | 2 | 3 | null = null;
      let bestD = hitRadius;
      for (let i = 0; i < 4; i += 1) {
        const d = screenDist(quad[i]);
        if (d <= bestD) {
          bestD = d;
          bestIdx = i as 0 | 1 | 2 | 3;
        }
      }
      if (bestIdx === null) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ target: { kind: 'quad', index: bestIdx }, pointerId: e.pointerId, point: quad[bestIdx] });
      return;
    }

    if (stage === 'garment') {
      const order: LineKey[] = [activeLine, ...(['shoulder', 'chest', 'length'] as LineKey[]).filter((k) => k !== activeLine)];
      let picked: { line: LineKey; end: 0 | 1; pt: Point2D } | null = null;
      let bestD = hitRadius;
      for (const line of order) {
        for (const end of [0, 1] as const) {
          const candidate = pins[line][end];
          const d = screenDist(candidate);
          if (d <= bestD) {
            bestD = d;
            picked = { line, end, pt: candidate };
          }
        }
      }
      if (!picked) return;
      setActiveLine(picked.line);
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ target: { kind: 'pin', line: picked.line, end: picked.end }, pointerId: e.pointerId, point: picked.pt });
    }
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pt = toImagePoint(e);
    setDrag({ ...drag, point: pt });
    if (drag.target.kind === 'quad') {
      const idx = drag.target.index;
      setQuad((prev) => {
        const next = [...prev] as Quad;
        next[idx] = pt;
        return next;
      });
    } else {
      const { line, end } = drag.target;
      setPins((prev) => {
        const pair: [Point2D, Point2D] = [prev[line][0], prev[line][1]];
        pair[end] = pt;
        return { ...prev, [line]: pair };
      });
    }
  };

  const onSvgPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag && drag.pointerId === e.pointerId) {
      if (drag.target.kind === 'quad') {
        setQuad((prev) => orderQuadClockwise(prev));
      }
      setDrag(null);
    }
  };

  const confirmMeasurements = () => {
    const measured = measureGarment(orderedQuad, referenceKind, pins);
    if (!measured) {
      setErrorText(t('garment.err.badCorners'));
      return;
    }
    if (sourceCanvasRef.current) {
      sourceCanvasRef.current.width = 0;
      sourceCanvasRef.current.height = 0;
      sourceCanvasRef.current = null;
    }
    onResult(measured);
  };

  const refRatio = REFERENCE_CM[referenceKind].longCm / REFERENCE_CM[referenceKind].shortCm;
  const guideW = referenceKind === 'card' ? 28 : 36;
  const guideH = guideW / refRatio;
  const pinRadius = Math.max(8, Math.round(Math.min(imgSize.w, imgSize.h) * 0.018));
  const strokePx = Math.max(2, Math.round(Math.min(imgSize.w, imgSize.h) * 0.0035));
  const loupeRight = drag ? drag.point.x < imgSize.w * 0.5 : true;

  return (
    <div className="measure-screen" role="dialog" aria-modal="true" aria-label={t('garment.title')}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={(e) => void onPickPhoto(e)}
      />

      <div className="measure-stage">
        <div className="measure-frame" style={{ ['--measure-aspect' as string]: aspect }}>
          {stage === 'camera' ? (
            <>
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
              <svg className="measure-overlay garment-guide-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <rect
                  x="14"
                  y="10"
                  width="72"
                  height="80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.4"
                  strokeDasharray="2 2"
                />
                <rect
                  x={50 - guideW / 2}
                  y={52 - guideH / 2}
                  width={guideW}
                  height={guideH}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.7"
                />
              </svg>
            </>
          ) : (
            <>
              <canvas ref={photoCanvasRef} className="measure-video" />
              <svg
                className="measure-overlay garment-pin-svg"
                viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                onPointerDown={onSvgPointerDown}
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
                onPointerCancel={onSvgPointerUp}
              >
                <polygon
                  points={orderedQuad.map((p) => `${p.x},${p.y}`).join(' ')}
                  className={stage === 'reference' ? 'garment-quad-active' : 'garment-quad-locked'}
                  strokeWidth={strokePx}
                />

                {stage === 'reference' &&
                  quad.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={pinRadius + strokePx} className="garment-pin-rim" />
                      <circle cx={p.x} cy={p.y} r={pinRadius} className="garment-pin-dot" />
                    </g>
                  ))}

                {stage === 'garment' &&
                  (['shoulder', 'chest', 'length'] as LineKey[]).map((line) => {
                    const [a, b] = pins[line];
                    const isCurrent = activeLine === line;
                    return (
                      <g key={line} className={isCurrent ? 'garment-line-current' : 'garment-line-dim'}>
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#15181e" strokeWidth={strokePx * 2.2} />
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="garment-line-stroke" strokeWidth={strokePx * 1.2} />
                        {[a, b].map((pt, endIdx) => (
                          <g key={endIdx}>
                            <circle cx={pt.x} cy={pt.y} r={pinRadius + strokePx} className="garment-pin-rim" />
                            <circle cx={pt.x} cy={pt.y} r={isCurrent ? pinRadius : pinRadius * 0.78} className="garment-pin-dot" />
                          </g>
                        ))}
                      </g>
                    );
                  })}
              </svg>

              {drag && (
                <div className={`garment-loupe ${loupeRight ? 'is-right' : 'is-left'}`} aria-hidden="true">
                  <canvas ref={loupeCanvasRef} width={LOUPE_PX} height={LOUPE_PX} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="measure-panel">
        {stage === 'camera' && (
          <>
            <div className="garment-ref-tabs" role="group" aria-label={t('garment.refLabel')}>
              <button
                type="button"
                className={`garment-tab ${referenceKind === 'card' ? 'is-active' : ''}`}
                onClick={() => switchReference('card')}
              >
                {t('garment.ref.card')}
              </button>
              <button
                type="button"
                className={`garment-tab ${referenceKind === 'a4' ? 'is-active' : ''}`}
                onClick={() => switchReference('a4')}
              >
                {t('garment.ref.a4')}
              </button>
            </div>
            <p className="measure-guide">
              {cameraFailed
                ? t('garment.pickPrompt')
                : referenceKind === 'card'
                  ? t('garment.guide.card')
                  : t('garment.guide.a4')}
            </p>
            {errorText && <p className="garment-err">{errorText}</p>}
            <p className="measure-note">{t('measure.photoStays')}</p>
            <div className="measure-actions">
              {!cameraFailed && (
                <button type="button" className="measure-capture" disabled={!cameraReady} onClick={snapFromVideo}>
                  {t('measure.capture')}
                </button>
              )}
              <button type="button" className="measure-skip" onClick={() => fileInputRef.current?.click()}>
                {t('garment.pickPhoto')}
              </button>
              <button type="button" className="measure-skip" onClick={onCancel}>
                {t('measure.cancel')}
              </button>
            </div>
          </>
        )}

        {stage === 'reference' && (
          <>
            <div className="garment-ref-tabs" role="group" aria-label={t('garment.refLabel')}>
              <button
                type="button"
                className={`garment-tab ${referenceKind === 'card' ? 'is-active' : ''}`}
                onClick={() => switchReference('card')}
              >
                {t('garment.ref.card')}
              </button>
              <button
                type="button"
                className={`garment-tab ${referenceKind === 'a4' ? 'is-active' : ''}`}
                onClick={() => switchReference('a4')}
              >
                {t('garment.ref.a4')}
              </button>
            </div>
            <p className="measure-guide">
              {autoFound ? t('garment.corners.found') : t('garment.corners.drag')}
            </p>
            {!homography && <p className="garment-err">{t('garment.err.badCorners')}</p>}
            <div className="measure-actions">
              <button
                type="button"
                className="measure-capture"
                disabled={!homography}
                onClick={() => setStage('garment')}
              >
                {t('garment.nextSeams')}
              </button>
              <button type="button" className="measure-skip" onClick={() => setStage('camera')}>
                {t('mf.res.retake')}
              </button>
              <button type="button" className="measure-skip" onClick={onCancel}>
                {t('measure.cancel')}
              </button>
            </div>
          </>
        )}

        {stage === 'garment' && (
          <>
            <div className="garment-line-tabs" role="group" aria-label={t('garment.seamsLabel')}>
              <button
                type="button"
                className={`garment-tab ${activeLine === 'shoulder' ? 'is-active' : ''}`}
                onClick={() => setActiveLine('shoulder')}
              >
                <span>{t('mf.res.shoulder')}</span>
                <b>{liveLengths?.shoulder != null ? `${liveLengths.shoulder} cm` : '-'}</b>
              </button>
              <button
                type="button"
                className={`garment-tab ${activeLine === 'chest' ? 'is-active' : ''}`}
                onClick={() => setActiveLine('chest')}
              >
                <span>{t('garment.chestFlat')}</span>
                <b>{liveLengths?.chestFlat != null ? `${liveLengths.chestFlat} cm` : '-'}</b>
              </button>
              <button
                type="button"
                className={`garment-tab ${activeLine === 'length' ? 'is-active' : ''}`}
                onClick={() => setActiveLine('length')}
              >
                <span>{t('garment.length')}</span>
                <b>{liveLengths?.length != null ? `${liveLengths.length} cm` : '-'}</b>
              </button>
            </div>
            <p className="measure-guide">
              {activeLine === 'shoulder'
                ? t('garment.hint.shoulder')
                : activeLine === 'chest'
                  ? t('garment.hint.chest')
                  : t('garment.hint.length')}
            </p>
            {liveLengths?.chestFlat != null && (
              <p className="measure-note">
                {t('garment.chestAroundNote', { v: String(Math.round(liveLengths.chestFlat * 2 * 10) / 10) })}
              </p>
            )}
            {errorText && <p className="garment-err">{errorText}</p>}
            <div className="measure-actions">
              <button
                type="button"
                className="measure-capture"
                disabled={!liveLengths?.shoulder || !liveLengths?.chestFlat || !liveLengths?.length}
                onClick={confirmMeasurements}
              >
                {t('garment.useNumbers')}
              </button>
              <button type="button" className="measure-skip" onClick={() => setStage('reference')}>
                {t('mf.back')}
              </button>
              <button type="button" className="measure-skip" onClick={() => setStage('camera')}>
                {t('mf.res.retake')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
