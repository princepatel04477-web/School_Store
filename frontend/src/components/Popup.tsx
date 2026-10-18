import { useEffect, useId, useRef, type ReactNode } from 'react';
import './popup.css';

export interface PopupProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
  /** Leave out (or pass null) for a popup with one button, such as the welcome note. */
  cancelLabel?: string | null;
  onConfirm?: () => void;
  onCancel?: () => void;
  /** Escape and a tap outside. Defaults to onCancel, then onClose. */
  onDismiss?: () => void;
  children?: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared small centred popup. Closes on Escape and on a tap outside, keeps
 * keyboard focus inside while open, and hands focus back to where it was.
 * Used by the welcome note and the stationery question.
 */
export function Popup({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  onConfirm,
  onCancel,
  onDismiss,
  children,
}: PopupProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  const cancel = onCancel ?? onClose;
  const dismiss = onDismiss ?? cancel;
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (!isOpen) return;
    const returnTo = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissRef.current();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    confirmRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnTo?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="popup-backdrop" onClick={dismiss}>
      <div
        ref={boxRef}
        className="popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : messageId}
        aria-describedby={title ? messageId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id={titleId} className="popup-title">
            {title}
          </h2>
        )}
        <p id={messageId} className={title ? 'popup-message' : 'popup-message popup-message--lead'}>
          {message}
        </p>

        {children}

        <div className="popup-actions">
          {cancelLabel && (
            <button type="button" className="popup-btn popup-btn--secondary" onClick={cancel}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className="popup-btn popup-btn--primary"
            onClick={onConfirm ?? onClose}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Popup;
