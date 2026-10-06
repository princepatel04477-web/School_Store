import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './ui.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'text';
  size?: 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, children, className = '', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`btn btn-${variant} btn-${size} ${loading ? 'btn-loading' : ''} ${className}`.trim()}
      {...props}
    >
      {loading && (
        <span className="btn-spinner" aria-hidden="true" />
      )}
      <span className={loading ? 'btn-content-hidden' : 'btn-content'}>{children}</span>
    </button>
  );
});
