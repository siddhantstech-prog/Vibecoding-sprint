import React, { useState, useEffect } from 'react';

/**
 * Modal for Stock In and Stock Out operations.
 * Handles Insufficient Stock errors gracefully without silent failures.
 */
export default function StockMovementModal({ isOpen, product, mode = 'IN', onClose, onSubmit }) {
  const [movementType, setMovementType] = useState(mode);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setMovementType(mode);
    setQuantity(1);
    setError(null);
  }, [mode, product, isOpen]);

  if (!isOpen || !product) return null;

  const isStockIn = movementType === 'IN';
  const currentQuantity = product.quantity ?? 0;
  const numQuantity = Number(quantity) || 0;
  const projectedQuantity = isStockIn
    ? currentQuantity + numQuantity
    : Math.max(0, currentQuantity - numQuantity);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (numQuantity <= 0) {
      setError('Quantity must be an integer greater than 0');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSubmit(product.id, movementType, numQuantity);
      onClose();
    } catch (err) {
      // Direct backend error display (e.g. "Insufficient stock: requested 15, available 10")
      setError(err.message || 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const setPreset = (amount) => {
    setQuantity(amount);
    setError(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>{isStockIn ? '📥' : '📤'}</span>
            <h3 className="modal-title">
              {isStockIn ? 'Stock In (Receive Inventory)' : 'Stock Out (Dispatch Inventory)'}
            </h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Mode Selector Tabs */}
            <div className="alerts-filter-tabs" style={{ width: '100%', display: 'flex' }}>
              <button
                type="button"
                className={`filter-tab ${isStockIn ? 'active' : ''}`}
                style={{ flex: 1, padding: '8px', fontSize: '13px' }}
                onClick={() => { setMovementType('IN'); setError(null); }}
              >
                📥 Stock In (+ Increase)
              </button>
              <button
                type="button"
                className={`filter-tab ${!isStockIn ? 'active' : ''}`}
                style={{ flex: 1, padding: '8px', fontSize: '13px' }}
                onClick={() => { setMovementType('OUT'); setError(null); }}
              >
                📤 Stock Out (- Decrease)
              </button>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="modal-error-banner" id="stock-error-banner">
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Product Snapshot */}
            <div className="stock-movement-card">
              <div className="stock-movement-row">
                <span style={{ color: 'var(--text-secondary)' }}>Product:</span>
                <span style={{ fontWeight: 700, color: '#ffffff' }}>{product.name}</span>
              </div>
              <div className="stock-movement-row">
                <span style={{ color: 'var(--text-secondary)' }}>Current Stock:</span>
                <span className="stock-value">{currentQuantity} units</span>
              </div>
              <div className="stock-movement-row">
                <span style={{ color: 'var(--text-secondary)' }}>Reorder Threshold:</span>
                <span className="reorder-value">{product.reorder_level} units</span>
              </div>
              <div className="stock-movement-row" style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '8px', marginTop: '2px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Projected New Stock:</span>
                <span className="stock-preview-badge" style={{ color: isStockIn ? '#34d399' : (projectedQuantity === 0 ? '#f87171' : projectedQuantity <= product.reorder_level ? '#fbbf24' : '#a5b4fc') }}>
                  {isStockIn ? `${currentQuantity} + ${numQuantity} = ${currentQuantity + numQuantity}` : `${currentQuantity} - ${numQuantity} = ${currentQuantity - numQuantity}`} units
                </span>
              </div>
            </div>

            {/* Quantity Input */}
            <div className="form-group">
              <label className="form-label">
                Quantity to {isStockIn ? 'Receive' : 'Dispatch'} <span className="required">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                className="form-input"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1));
                  setError(null);
                }}
                required
                autoFocus
                id="input-stock-movement-qty"
              />

              <div className="quick-increments">
                <button type="button" className="quick-inc-btn" onClick={() => setPreset(1)}>1</button>
                <button type="button" className="quick-inc-btn" onClick={() => setPreset(2)}>2</button>
                <button type="button" className="quick-inc-btn" onClick={() => setPreset(3)}>3</button>
                <button type="button" className="quick-inc-btn" onClick={() => setPreset(5)}>5</button>
                <button type="button" className="quick-inc-btn" onClick={() => setPreset(10)}>10</button>
                {!isStockIn && currentQuantity > 0 && (
                  <button type="button" className="quick-inc-btn" onClick={() => setPreset(currentQuantity)}>All ({currentQuantity})</button>
                )}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${isStockIn ? 'btn-stock-in' : 'btn-stock-out'}`}
              disabled={isSubmitting}
              id="btn-confirm-stock-movement"
              style={{ padding: '10px 20px', fontWeight: 700 }}
            >
              {isSubmitting
                ? 'Updating...'
                : isStockIn
                ? `Confirm Stock In (+${numQuantity})`
                : `Confirm Stock Out (-${numQuantity})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
