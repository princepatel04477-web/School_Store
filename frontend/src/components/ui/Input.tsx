import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import './ui.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, id, className = '', ...props },
  ref
) {
  const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={`input-field-group ${error ? 'has-error' : ''} ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}
      <div className="input-box-wrapper">
        {leadingIcon && <span className="input-leading-icon">{leadingIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={!!error}
          className={`input-control ${leadingIcon ? 'has-leading' : ''}`}
          {...props}
        />
      </div>
      {hint && !error && (
        <span id={hintId} className="input-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="input-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});
