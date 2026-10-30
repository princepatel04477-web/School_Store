import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, fieldErrors, retail, type RetailStore, type UniformGender, type UniformSet } from '../../../api';
import { X } from '../../ui/icons';
import './retail.css';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const CLASSES = Array.from({ length: 12 }, (_, i) => i + 1);

interface FormState {
  school: string;
  gender: UniformGender | '';
  class_from: string;
  class_to: string;
  name: string;
  price: string;
  sizes: string;
}

function photoError(file: File | null, label: string): string | undefined {
  if (!file) return `Add a photo of the ${label}.`;
  if (!PHOTO_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return 'The photo must be 8 MB or smaller.';
  return undefined;
}

/** Checks the browser can do before sending; the server checks everything again. */
function checkForm(form: FormState, top: File | null, bottom: File | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.school) errors.school = 'Choose the school.';
  if (!form.gender) errors.gender = 'Choose boys or girls.';
  if (!form.class_from) errors.class_from = 'Choose the first class.';
  if (!form.class_to) errors.class_to = 'Choose the last class.';
  else if (form.class_from && Number(form.class_to) < Number(form.class_from)) errors.class_to = 'The last class must be the same as or after the first.';
  if (!form.name.trim()) errors.name = 'Name the set, for example "Summer uniform".';
  if (!/^\d+$/.test(form.price) || Number(form.price) <= 0) errors.price = 'Enter the price of the set in rupees.';
  if (!form.sizes.split(',').some((s) => s.trim())) errors.sizes = 'Enter the sizes you have, separated by commas.';
  const topError = photoError(top, 'shirt');
  const bottomError = photoError(bottom, form.gender === 'GIRL' ? 'skirt' : 'pant');
  if (topError) errors.top_photo = topError;
  if (bottomError) errors.bottom_photo = bottomError;
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

export function UniformForm({ store, onClose, onAdded }: { store: RetailStore; onClose: () => void; onAdded: (set: UniformSet) => void }) {
  const id = useId();
  const [form, setForm] = useState<FormState>({
    school: store.schools.length === 1 ? store.schools[0].id : '',
    gender: '',
    class_from: '',
    class_to: '',
    name: '',
    price: '',
    sizes: '',
  });
  const [top, setTop] = useState<File | null>(null);
  const [bottom, setBottom] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => {
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) body.append(key, value.trim());
      body.append('top_photo', top as File);
      body.append('bottom_photo', bottom as File);
      return retail.addUniform(body);
    },
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = checkForm(form, top, bottom);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length === 0) add.mutate();
  };
  const err = (key: string) => (errors[key] ? <span className="retail-field-error">{errors[key]}</span> : null);
  const bottomLabel = form.gender === 'GIRL' ? 'Skirt photo' : form.gender === 'BOY' ? 'Pant photo' : 'Pant or skirt photo';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id={`${id}-title`}>Add uniform set</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X width={18} height={18} />
          </button>
        </div>
        <form onSubmit={submit} className="form-card retail-form" noValidate>
          <p className="retail-hint">
            A set is the shirt with the pant (boys) or skirt (girls). Photograph each one laid flat on a plain floor, from straight above, in good light.
          </p>
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

          <div className="retail-row">
            <label>
              <span>From class</span>
              <select value={form.class_from} onChange={(e) => set('class_from')(e.target.value)} aria-invalid={!!errors.class_from}>
                <option value="">Choose</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>Class {c}</option>
                ))}
              </select>
              {err('class_from')}
            </label>
            <label>
              <span>To class</span>
              <select value={form.class_to} onChange={(e) => set('class_to')(e.target.value)} aria-invalid={!!errors.class_to}>
                <option value="">Choose</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>Class {c}</option>
                ))}
              </select>
              {err('class_to')}
            </label>
          </div>

          <label>
            <span>Name of the set</span>
            <input value={form.name} onChange={(e) => set('name')(e.target.value)} maxLength={120} placeholder="Summer uniform" aria-invalid={!!errors.name} />
            {err('name')}
          </label>

          <div className="retail-row">
            <label>
              <span>Price of the set (₹)</span>
              <input value={form.price} onChange={(e) => set('price')(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" aria-invalid={!!errors.price} />
              {err('price')}
            </label>
            <label>
              <span>Sizes</span>
              <input value={form.sizes} onChange={(e) => set('sizes')(e.target.value)} placeholder="22, 24, 26, 28" aria-invalid={!!errors.sizes} />
              {err('sizes')}
            </label>
          </div>

          <PhotoPick
            id={`${id}-top`}
            label="Shirt photo"
            hint="The real shirt, laid flat. PNG, JPG or WebP, up to 8 MB."
            file={top}
            error={errors.top_photo}
            onPick={(f) => {
              setTop(f);
              clearError('top_photo');
            }}
          />
          <PhotoPick
            id={`${id}-bottom`}
            label={bottomLabel}
            hint="The real one that goes with the shirt, laid flat."
            file={bottom}
            error={errors.bottom_photo}
            onPick={(f) => {
              setBottom(f);
              clearError('bottom_photo');
            }}
          />

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add set'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
