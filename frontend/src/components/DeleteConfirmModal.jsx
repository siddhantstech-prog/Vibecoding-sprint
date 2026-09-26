import React, { useState } from 'react';

/**
 * Modal to confirm product deletion.
 */
export default function DeleteConfirmModal({ isOpen, product, onClose, onConfirm }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !product) return null;

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      setError(null);
      await onConfirm(product.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to delete product');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🗑️</span>
            <h3 className="modal-title">Delete Product</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="modal-error-banner">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <p style={{ color: 'var(--text-primary)', fontSize: '14.5px' }}>
            Are you sure you want to permanently delete{' '}
            <strong style={{ color: '#ffffff' }}>{product.name}</strong>?
          </p>

          <div className="stock-movement-card" style={{ padding: '12px 14px' }}>
            <div className="stock-movement-row">
              <span style={{ color: 'var(--text-secondary)' }}>Category:</span>
              <span>{product.category || 'Uncategorized'}</span>
            </div>
            <div className="stock-movement-row">
              <span style={{ color: 'var(--text-secondary)' }}>Current Stock:</span>
              <span className="stock-value">{product.quantity} units</span>
            </div>
            <div className="stock-movement-row">
              <span style={{ color: 'var(--text-secondary)' }}>Supplier:</span>
              <span>{product.supplier || 'None'}</span>
            </div>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            ⚠️ This will remove the product and its associated stock movements & alerts from the database.
          </p>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-delete"
            onClick={handleDelete}
            disabled={isDeleting}
            id="btn-confirm-delete-product"
          >
            {isDeleting ? 'Deleting...' : 'Delete Product'}
          </button>
        </div>
      </div>
    </div>
  );
}
