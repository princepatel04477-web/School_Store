import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, fieldErrors, retail, type RetailStore, type UniformGender, type UniformSet } from '../../../api';
import { X } from '../../ui/icons';
import { ClothPicker, type ClothBox } from './ClothPicker';
import { cropCloth } from './mockupEngine';
import './retail.css';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const CLASSES: number[] = Array.from({ length: 12 }, (_, i) => i + 1);

interface FormState {
  school: string;
  gender: UniformGender | '';
  name: string;
  price: string;
}

function photoError(file: File | null, label: string): string | undefined {
  if (!file) return `Add a photo of the ${label}.`;
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'The photo must be 8 MB or smaller.';
  return undefined;
}

/** Checks the browser can do before sending; the server checks everything again. */
function checkForm(form: FormState, classes: number[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.school) errors.school = 'Choose the school.';
  if (!form.gender) errors.gender = 'Choose boys or girls.';
  if (!classes.length) errors.classes = 'Choose at least one class.';
  if (!form.name.trim()) errors.name = 'Name the set, for example "Summer uniform".';
  if (!/^\d+$/.test(form.price) || Number(form.price) <= 0) errors.price = 'Enter the price of the set in rupees.';
  return errors;
}

function PhotoPick({
  id,
  label,
  hint,
  file,
  error,
  onPick,
}: {
  id: string;
  label: string;
  hint: string;
  file: File | null;
  error?: string;
  onPick: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <label>
      <span>{label}</span>
      <span className="retail-logo-pick">
        {preview ? <img className="retail-logo" src={preview} alt={`Chosen ${label.toLowerCase()}`} /> : <span className="retail-logo retail-logo-empty">No photo</span>}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          aria-invalid={!!error}
          aria-describedby={`${id}-hint`}
        />
      </span>
      {error ? <span className="retail-field-error" id={`${id}-hint`}>{error}</span> : <span className="retail-hint" id={`${id}-hint`}>{hint}</span>}
    </label>
  );
}

/** Step 1: which school and classes the uniform is for. */
export function UniformForm({ store, onClose, onAdded }: { store: RetailStore; onClose: () => void; onAdded: (set: UniformSet) => void }) {
  const id = useId();
  const [form, setForm] = useState<FormState>({ school: store.schools.length === 1 ? store.schools[0].id : '', gender: '', name: '', price: '' });
  const [classes, setClasses] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      retail.addUniform({ school: form.school, gender: form.gender as UniformGender, classes, name: form.name.trim(), price: Number(form.price) }),
    onSuccess: onAdded,
    onError: (err: unknown) => {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Could not add the set. Check your connection and try again.');
    },
  });

  const clearError = (key: string) =>
    setErrors((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  const set = (key: keyof FormState) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
  };
  const toggleClass = (classNo: number) => {
    setClasses((current) => (current.includes(classNo) ? current.filter((c) => c !== classNo) : [...current, classNo].sort((a, b) => a - b)));
    clearError('classes');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = checkForm(form, classes);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length === 0) add.mutate();
  };
  const err = (key: string) => (errors[key] ? <span className="retail-field-error">{errors[key]}</span> : null);
  const allChosen = classes.length === CLASSES.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id={`${id}-title`}>Add uniform</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X width={18} height={18} />
          </button>
        </div>
        <form onSubmit={submit} className="form-card retail-form" noValidate>
          {message && Object.keys(errors).length === 0 && <div className="error" role="alert">{message}</div>}

          <label>
            <span>School</span>
            <select value={form.school} onChange={(e) => set('school')(e.target.value)} aria-invalid={!!errors.school}>
              <option value="">Choose</option>
              {store.schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {err('school')}
          </label>

          <fieldset className="retail-logo-choice" aria-invalid={!!errors.gender}>
            <legend className="muted">For</legend>
            {(['BOY', 'GIRL'] as const).map((g) => (
              <label key={g}>
                <input type="radio" name={`${id}-gender`} checked={form.gender === g} onChange={() => set('gender')(g)} />
                {g === 'BOY' ? 'Boys (shirt + pant)' : 'Girls (shirt + skirt)'}
              </label>
            ))}
          </fieldset>
          {err('gender')}

          <fieldset className="retail-logo-choice" aria-invalid={!!errors.classes}>
            <legend className="muted">Classes</legend>
            {CLASSES.map((c) => (
              <label key={c}>
                <input type="checkbox" checked={classes.includes(c)} onChange={() => toggleClass(c)} />
                Class {c}
              </label>
            ))}
            <button type="button" className="link-button" onClick={() => { setClasses(allChosen ? [] : CLASSES); clearError('classes'); }}>
              {allChosen ? 'Clear all' : 'Choose all'}
            </button>
          </fieldset>
          {err('classes')}

          <label>
            <span>Name of the set</span>
            <input value={form.name} onChange={(e) => set('name')(e.target.value)} maxLength={120} placeholder="Summer uniform" aria-invalid={!!errors.name} />
            {err('name')}
          </label>

          <label>
            <span>Price of the set (₹)</span>
            <input value={form.price} onChange={(e) => set('price')(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" aria-invalid={!!errors.price} />
            {err('price')}
          </label>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add uniform'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Step 2: the cloth photo, description and sizes the mock-ups are created from. */
export function MockupForm({ set, onCancel, onSaved }: { set: UniformSet; onCancel?: () => void; onSaved: (set: UniformSet) => void }) {
  const id = useId();
  const [photo, setPhoto] = useState<File | null>(null);
  const [box, setBox] = useState<ClothBox | null>(null);
  const [fabricConfirmed, setFabricConfirmed] = useState(false);
  const [description, setDescription] = useState(set.description);
  const [sizes, setSizes] = useState(set.sizes.join(', '));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const cloth = set.gender === 'GIRL' ? 'skirt cloth' : 'pant cloth';

  const save = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      body.append('photo', await cropCloth(photo as File, box as ClothBox), 'cloth.jpg');
      body.append('description', description.trim());
      body.append('sizes', sizes.trim());
      return retail.uniformDetails(set.id, body);
    },
    onSuccess: onSaved,
    onError: (err: unknown) => {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Could not save. Check your connection and try again.');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    const photoProblem = photoError(photo, cloth);
    if (photoProblem) found.photo = photoProblem;
    else if (!box) found.photo = `Drag a box over the ${cloth} in your photo.`;
    if (!description.trim()) found.description = 'Describe the uniform.';
    if (!sizes.split(',').some((s) => s.trim())) found.sizes = 'Enter the sizes you have, separated by commas.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length === 0) save.mutate();
  };

  return (
    <form onSubmit={submit} className="form-card retail-form" noValidate>
      {message && Object.keys(errors).length === 0 && <div className="error" role="alert">{message}</div>}
      <PhotoPick
        id={`${id}-photo`}
        label="Fabric photo"
        hint="Use a close-up of a flat trouser or skirt fabric section—not a full uniform photo. PNG, JPG or WebP, up to 8 MB."
        file={photo}
        error={errors.photo}
        onPick={(file) => {
          setPhoto(file);
          setBox(null);
          setFabricConfirmed(false);
          setErrors(({ photo: _gone, swatch: _swatchGone, ...rest }) => rest);
        }}
      />
      {photo && !photoError(photo, cloth) && (
        <ClothPicker
          file={photo}
          cloth={cloth}
          box={box}
          onChange={(next) => {
            setBox(next);
            setFabricConfirmed(false);
            setErrors(({ photo: _gone, swatch: _swatchGone, ...rest }) => rest);
          }}
        />
      )}
      {box && (
        <label className="retail-swatch-confirm">
          <input
            type="checkbox"
            checked={fabricConfirmed}
            onChange={(e) => {
              setFabricConfirmed(e.target.checked);
              if (e.target.checked) setErrors(({ swatch: _gone, ...rest }) => rest);
            }}
          />
          <span>I checked the preview: this selection contains only flat import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
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
, not the full uniform, seams, folds, logos or background.</span>
          {errors.swatch && <span className="retail-field-error">{errors.swatch}</span>}
        </label>
      )}
      <label>
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} aria-invalid={!!errors.description} />
        {errors.description && <span className="retail-field-error">{errors.description}</span>}
      </label>
      <label>
        <span>Size details</span>
        <input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="22, 24, 26, 28" aria-invalid={!!errors.sizes} />
        {errors.sizes ? <span className="retail-field-error">{errors.sizes}</span> : <span className="retail-hint">Separate sizes with commas.</span>}
      </label>
      <div className="retail-actions">
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Create mock-up'}
        </button>
      </div>
    </form>
  );
}
