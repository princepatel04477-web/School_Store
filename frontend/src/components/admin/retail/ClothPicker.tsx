import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './retail.css';

/** Part of the photo, each value a share (0 to 1) of its width or height. */
export interface ClothBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SHARE = 0.03;
const ARROW_STEP = 0.01;
const KEYBOARD_START: ClothBox = { x: 0.4, y: 0.6, width: 0.2, height: 0.2 };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

function SwatchPreview({ src, box }: { src: string; box: ClothBox }) {
  const ratio = Math.max(box.width / box.height, 0.01);
  return (
    <div className="retail-swatch-preview">
      <span className="retail-cloth-title">Selected fabric swatch</span>
      <div className="retail-swatch-image" style={{ aspectRatio: String(ratio) }}>
        <img
          src={src}
          alt="Selected fabric swatch preview"
          style={{
            width: `${100 / box.width}%`,
            maxWidth: 'none',
            transform: `translate(-${box.x * 100}%, -${box.y * 100}%)`,
          }}
        />
      </div>
      <span className="retail-hint">This exact area will repeat across the mock-up. Select only flat fabric with no clothing edges, seams, logos, folds or background.</span>
    </div>
  );
}

/** The retailer drags a box over the cloth in their photo. Arrow keys move the box. */
export function ClothPicker({ file, cloth, box, onChange }: { file: File; cloth: string; box: ClothBox | null; onChange: (box: ClothBox | null) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClothBox | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width, 1), y: clamp((e.clientY - rect.top) / rect.height, 1) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
    setDraft(null);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = point(e);
    setDraft({
      x: Math.min(start.current.x, p.x),
      y: Math.min(start.current.y, p.y),
      width: Math.abs(p.x - start.current.x),
      height: Math.abs(p.y - start.current.y),
    });
  };
  const up = () => {
    start.current = null;
    if (draft && draft.width >= MIN_SHARE && draft.height >= MIN_SHARE) onChange(draft);
    setDraft(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    const current = box ?? KEYBOARD_START;
    onChange({
      ...current,
      x: clamp(current.x + arrow[0] * ARROW_STEP, 1 - current.width),
      y: clamp(current.y + arrow[1] * ARROW_STEP, 1 - current.height),
    });
  };

  const shown = draft ?? box;
  return (
    <div className="retail-cloth">
      <span className="retail-cloth-title">Mark the {cloth}</span>
      <span className="retail-hint">Drag a box on one flat, evenly lit section of the import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './retail.css';

/** Part of the photo, each value a share (0 to 1) of its width or height. */
export interface ClothBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SHARE = 0.03;
const ARROW_STEP = 0.01;
const KEYBOARD_START: ClothBox = { x: 0.4, y: 0.6, width: 0.2, height: 0.2 };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

function SwatchPreview({ src, box }: { src: string; box: ClothBox }) {
  const ratio = Math.max(box.width / box.height, 0.01);
  return (
    <div className="retail-swatch-preview">
      <span className="retail-cloth-title">Selected fabric swatch</span>
      <div className="retail-swatch-image" style={{ aspectRatio: String(ratio) }}>
        <img
          src={src}
          alt="Selected fabric swatch preview"
          style={{
            width: `${100 / box.width}%`,
            maxWidth: 'none',
            transform: `translate(-${box.x * 100}%, -${box.y * 100}%)`,
          }}
        />
      </div>
      <span className="retail-hint">This exact area will repeat across the mock-up. Select only flat fabric with no clothing edges, seams, logos, folds or background.</span>
    </div>
  );
}

/** The retailer drags a box over the cloth in their photo. Arrow keys move the box. */
export function ClothPicker({ file, cloth, box, onChange }: { file: File; cloth: string; box: ClothBox | null; onChange: (box: ClothBox | null) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClothBox | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width, 1), y: clamp((e.clientY - rect.top) / rect.height, 1) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
    setDraft(null);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = point(e);
    setDraft({
      x: Math.min(start.current.x, p.x),
      y: Math.min(start.current.y, p.y),
      width: Math.abs(p.x - start.current.x),
      height: Math.abs(p.y - start.current.y),
    });
  };
  const up = () => {
    start.current = null;
    if (draft && draft.width >= MIN_SHARE && draft.height >= MIN_SHARE) onChange(draft);
    setDraft(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    const current = box ?? KEYBOARD_START;
    onChange({
      ...current,
      x: clamp(current.x + arrow[0] * ARROW_STEP, 1 - current.width),
      y: clamp(current.y + arrow[1] * ARROW_STEP, 1 - current.height),
    });
  };

  const shown = draft ?? box;
  return (
    <div className="retail-cloth">
      <span className="retail-cloth-title">Mark the {cloth}</span>
      <span className="retail-hint">Drag a box on a flat part of the cloth only. Keep out folds, pleats, belts, shirts and the background.</span>
      {src && (
        <div
          className="retail-cloth-photo"
          role="application"
          tabIndex={0}
          aria-label={`Mark the ${cloth} in your photo. Arrow keys move the box.`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
        >
          <img src={src} alt="Your uniform" draggable={false} />
          {shown && (
            <span
              className="retail-cloth-box"
              style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}
            />
          )}
        </div>
          {box && <SwatchPreview src={src} box={box} />}
        </>
      )}
    </div>
  );
}
 only. Do not select the whole uniform.</span>
      {src && (
        <> 
        <div
          className="retail-cloth-photo"
          role="application"
          tabIndex={0}
          aria-label={`Mark the ${cloth} in your photo. Arrow keys move the box.`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
        >
          <img src={src} alt="Your uniform" draggable={false} />
          {shown && (
            <span
              className="retail-cloth-box"
              style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
