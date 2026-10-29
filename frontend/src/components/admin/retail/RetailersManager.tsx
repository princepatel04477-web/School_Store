import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, bossPanel, fieldErrors, retail, type NewRetailer } from '../../../api';
import { X } from '../../ui/icons';
import { RequestSkeleton, formatDate } from './RetailBits';
import './retail.css';

/** Boss: the retail shops and their logins. */
export function RetailersManager() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const retailers = useQuery({ queryKey: ['boss-retailers'], queryFn: retail.retailers });
  const rows = retailers.data?.results ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">RETAIL SHOPS</div>
          <h1>Retailers</h1>
          <p className="muted">Shops that sell school uniforms on the store. Each one gets a login and asks for the schools it supplies.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreating(true)}>Add retailer</button>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Shops</h2>
          {retailers.data && <span className="badge s-approved">{rows.length}</span>}
        </div>
        {retailers.isLoading ? (
          <RequestSkeleton rows={2} />
        ) : retailers.isError ? (
          <div className="pad">
            <div className="error" role="alert">
              Could not load the retailers.{' '}
              <button type="button" className="link-button" onClick={() => retailers.refetch()}>Try again</button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad"><div className="empty slim">No retailers yet.</div></div>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Shop</th><th>City</th><th>Contact</th><th>Schools</th><th>Added</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      <small className="muted">Login: {r.username}{r.gst_number ? ` · GST ${r.gst_number}` : ''}</small>
                    </td>
                    <td>{r.city_name}</td>
                    <td>
                      <div>{r.owner_name || '-'}</div>
                      <small className="muted">{r.phone}</small>
                    </td>
                    <td>{r.schools.length === 0 ? '-' : r.schools.map((s) => s.name).join(', ')}</td>
                    <td className="mono">{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CreateRetailerModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: ['boss-retailers'] });
          }}
        />
      )}
    </div>
  );
}

const EMPTY: NewRetailer = {
  username: '', password: '', first_name: '', last_name: '', email: '',
  store_name: '', address: '', phone: '', gst_number: '', city: '',
};

function CreateRetailerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const id = useId();
  const [form, setForm] = useState<NewRetailer>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const filters = useQuery({ queryKey: ['boss-filter-options'], queryFn: () => bossPanel.filters() });

  const create = useMutation({
    mutationFn: () => retail.createRetailer(form),
    onSuccess: onCreated,
    onError: (err: unknown) => {
      setErrors(fieldErrors(err));
      setMessage(err instanceof ApiError ? err.message : 'Could not add the retailer.');
    },
  });

  const set = (key: keyof NewRetailer) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    create.mutate();
  };

  const field = (key: keyof NewRetailer, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      <span>{label}</span>
      <input
        value={form[key] ?? ''}
        onChange={(e) => set(key)(e.target.value)}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${id}-${key}` : undefined}
        {...props}
      />
      {errors[key] && <span className="retail-field-error" id={`${id}-${key}`}>{errors[key]}</span>}
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id={`${id}-title`}>Add retailer</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X width={18} height={18} /></button>
        </div>
        <form onSubmit={submit} className="form-card retail-form">
          {message && Object.keys(errors).length === 0 && <div className="error" role="alert">{message}</div>}

          {field('store_name', 'Shop name', { required: true, maxLength: 200 })}
          <label>
            <span>Shop address</span>
            <textarea value={form.address} onChange={(e) => set('address')(e.target.value)} rows={2} required aria-invalid={!!errors.address} />
            {errors.address && <span className="retail-field-error">{errors.address}</span>}
          </label>
          <div className="retail-row">
            <label>
              <span>City</span>
              <select value={form.city} onChange={(e) => set('city')(e.target.value)} required aria-invalid={!!errors.city}>
                <option value="">{filters.isLoading ? 'Loading…' : 'Choose'}</option>
                {filters.data?.cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.city && <span className="retail-field-error">{errors.city}</span>}
            </label>
            {field('phone', 'Shop phone', { required: true, inputMode: 'tel', autoComplete: 'off' })}
          </div>
          {field('gst_number', 'GST number (optional)', { maxLength: 15, className: 'mono' })}
          <div className="retail-row">
            {field('first_name', 'Owner first name')}
            {field('last_name', 'Owner last name')}
          </div>
          {field('email', 'Email (optional)', { type: 'email' })}
          <div className="retail-row">
            {field('username', 'Login username', { required: true, autoComplete: 'off' })}
            {field('password', 'Temporary password', { required: true, type: 'password', minLength: 8, autoComplete: 'new-password' })}
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add retailer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
