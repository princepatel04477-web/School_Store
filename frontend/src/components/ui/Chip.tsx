import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import './ui.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
}

export function Chip({ selected = false, children, className = '', ...props }: ChipProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      className={`chip-root ${selected ? 'is-selected' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
