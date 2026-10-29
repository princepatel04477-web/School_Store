import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, SCHOOL_BOARDS, fieldErrors, retail, type SchoolBoard } from '../../../api';
import { X } from '../../ui/icons';
import './retail.css';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface FormState {
  name: string;
  udise_code: string;
  address: string;
  city: string;
  board: SchoolBoard | '';
  pincode: string;
}

const EMPTY: FormState = { name: '', udise_code: '', address: '', city: '', board: '', pincode: '' };

/** Checks the browser can do before sending; the server checks everything again. */
function checkForm(form: FormState, logo: File | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Enter the school name.';
  if (!/^\d{11}$/.test(form.udise_code)) errors.udise_code = 'The UDISE code is 11 digits, numbers only.';
  if (!form.address.trim()) errors.address = 'Enter the school address.';
  if (!form.city) errors.city = 'Choose the city.';
  if (!form.board) errors.board = 'Choose the board.';
  if (!/^[1-9]\d{5}$/.test(form.pincode)) errors.pincode = 'Enter a 6-digit pincode.';
  if (!logo) errors.logo = 'Upload the school logo.';
  else if (!LOGO_TYPES.includes(logo.type)) errors.logo = 'Upload the logo as a PNG, JPG or WebP picture.';
  else if (logo.size > MAX_LOGO_BYTES) errors.logo = 'The logo must be 2 MB or smaller.';
  return errors;
}

export function SchoolRequestForm({
  defaultCity,
  onClose,
  onSent,
}: {
  defaultCity: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState<FormState>({ ...EMPTY, city: defaultCity });
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const cities = useQuery({ queryKey: ['retail-cities'], queryFn: retail.cities, staleTime: 10 * 60_000 });

  useEffect(() => {
    if (!logo) return setPreview(null);
    const url = URL.createObjectURL(logo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const send = useMutation({
    mutationFn: () => {
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) body.append(key, value.trim());
      body.append('logo', logo as File);
      return retail.sendRequest(body);
    },
    onSuccess: onSent,
    onError: (err: unknown) => {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Could not send the request. Check your connection and try again.');
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
    const found = checkForm(form, logo);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length === 0) send.mutate();
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <span className="retail-field-error" id={`${id}-${key}-error`}>
        {errors[key]}
      </span>
    ) : null;
  const describedBy = (key: string) => (errors[key] ? `${id}-${key}-error` : undefined);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id={`${id}-title`}>Request a school</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X width={18} height={18} />
          </button>
        </div>
        <form onSubmit={submit} className="form-card retail-form" noValidate>
          <p className="retail-hint">
            The store owner checks the UDISE code and approves the school. Then you can add its uniforms.
          </p>
          {message && Object.keys(errors).length === 0 && <div className="error" role="alert">{message}</div>}

          <label>
            <span>School name</span>
            <input value={form.name} onChange={(e) => set('name')(e.target.value)} maxLength={200} autoComplete="off" aria-invalid={!!errors.name} aria-describedby={describedBy('name')} />
            {fieldError('name')}
          </label>

          <label>
            <span>UDISE code</span>
            <input
              value={form.udise_code}
              onChange={(e) => set('udise_code')(e.target.value.replace(/\D/g, '').slice(0, 11))}
              inputMode="numeric"
              placeholder="11 digits"
              className="mono"
              aria-invalid={!!errors.udise_code}
              aria-describedby={describedBy('udise_code') ?? `${id}-udise-hint`}
            />
            {fieldError('udise_code') ?? (
              <span className="retail-hint" id={`${id}-udise-hint`}>
                Every school in India has one. Ask the school office, or find it on the UDISE+ website.
              </span>
            )}
          </label>

          <label>
            <span>Address</span>
            <textarea value={form.address} onChange={(e) => set('address')(e.target.value)} rows={3} aria-invalid={!!errors.address} aria-describedby={describedBy('address')} />
            {fieldError('address')}
          </label>

          <div className="retail-row">
            <label>
              <span>City</span>
              <select value={form.city} onChange={(e) => set('city')(e.target.value)} aria-invalid={!!errors.city} aria-describedby={describedBy('city')}>
                <option value="">{cities.isLoading ? 'Loading cities…' : 'Choose'}</option>
                {cities.data?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {fieldError('city') ?? (cities.isError ? <span className="retail-field-error">Could not load the cities.</span> : null)}
            </label>
            <label>
              <span>Pincode</span>
              <input
                value={form.pincode}
                onChange={(e) => set('pincode')(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="postal-code"
                aria-invalid={!!errors.pincode}
                aria-describedby={describedBy('pincode')}
              />
              {fieldError('pincode')}
            </label>
          </div>

          <label>
            <span>Board</span>
            <select value={form.board} onChange={(e) => set('board')(e.target.value)} aria-invalid={!!errors.board} aria-describedby={describedBy('board')}>
              <option value="">Choose</option>
              {SCHOOL_BOARDS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            {fieldError('board')}
          </label>

          <label>
            <span>School logo</span>
            <span className="retail-logo-pick">
              {preview ? (
                <img className="retail-logo" src={preview} alt="Chosen logo" />
              ) : (
                <span className="retail-logo retail-logo-empty">No logo</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  setLogo(e.target.files?.[0] ?? null);
                  clearError('logo');
                }}
                aria-invalid={!!errors.logo}
                aria-describedby={describedBy('logo') ?? `${id}-logo-hint`}
              />
            </span>
            {fieldError('logo') ?? (
              <span className="retail-hint" id={`${id}-logo-hint`}>PNG, JPG or WebP, up to 2 MB. A square picture looks best.</span>
            )}
          </label>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
