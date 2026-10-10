import React, { useEffect, useRef, type ReactNode } from 'react';

export interface PopupProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  children?: ReactNode;
}

/**
 * Shared modal popup component for prompts and confirmations.
 * Adheres to accessibility requirements (esc key, focus management, aria attributes).
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
  children,
}: PopupProps) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onCancel) {
          onCancel();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Focus confirmation button when opened
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(t);
    };
  }, [isOpen, onClose, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 1200 }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(450px, 92vw)',
          padding: '28px 24px',
          textAlign: 'center',
          borderRadius: '16px',
          background: '#ffffff',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '10px' }}>📚</div>
        {title && (
          <h3
            style={{
              margin: '0 0 10px',
              fontSize: '18px',
              fontWeight: 700,
              color: '#1e293b',
            }}
          >
            {title}
          </h3>
        )}
        <p
          style={{
            fontSize: '15px',
            color: '#475569',
            margin: '0 0 24px',
            lineHeight: 1.55,
            fontWeight: 500,
          }}
        >
          {message}
        </p>

        {children}

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            className="secondary"
            style={{
              width: '130px',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '14px',
            }}
            onClick={() => {
              if (onCancel) {
                onCancel();
              } else {
                onClose();
              }
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className="primary"
            style={{
              width: '130px',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '14px',
            }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Popup;
