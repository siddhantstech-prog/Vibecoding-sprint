import React from 'react';

/**
 * Toast notification component.
 */
export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => {
        const typeClass =
          toast.type === 'error'
            ? 'toast-error'
            : toast.type === 'info'
            ? 'toast-info'
            : 'toast-success';

        const icon =
          toast.type === 'error' ? '❌' : toast.type === 'info' ? 'ℹ️' : '✅';

        return (
          <div key={toast.id} className={`toast ${typeClass}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{icon}</span>
              <span>{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
