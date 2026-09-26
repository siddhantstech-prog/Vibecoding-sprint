import React, { useState, useEffect } from 'react';

/**
 * Modal to edit an existing product.
 * NOTE: Quantity is intentionally excluded from PUT requests per API specification.
 */
export default function EditProductModal({ isOpen, product, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    reorder_level: 0,
    price: 0,
    supplier: '',
  });
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name || '',
        category: product.category || '',
        reorder_level: product.reorder_level ?? 0,
        price: product.price ?? 0,
        supplier: product.supplier || '',
      });
      setError(null);
    }
  }, [product]);

  if (!isOpen || !product) return null;

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? '' : Number(value)) : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Product name cannot be empty');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSubmit(product.id, {
        name: formData.name.trim(),
        category: formData.category.trim() || undefined,
        reorder_level: Number(formData.reorder_level) || 0,
        price: Number(formData.price) || 0,
        supplier: formData.supplier.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update product');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Edit Product #{product.id}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="modal-error-banner">
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <div className="stock-movement-card" style={{ padding: '12px 14px' }}>
              <div className="stock-movement-row">
                <span style={{ color: 'var(--text-secondary)' }}>Current Stock Level:</span>
                <span className="stock-value">{product.quantity} units</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ℹ️ Quantity is managed exclusively through Stock In / Stock Out to maintain movement audit history.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">
                Product Name <span className="required">*</span>
              </label>
              <input
                type="text"
                name="name"
                className="form-input"
                value={formData.name}
                onChange={handleChange}
                required
                id="input-edit-product-name"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Category</label>
              <input
                type="text"
                name="category"
                className="form-input"
                value={formData.category}
                onChange={handleChange}
                id="input-edit-product-category"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Reorder Level</label>
                <input
                  type="number"
                  name="reorder_level"
                  min="0"
                  className="form-input"
                  value={formData.reorder_level}
                  onChange={handleChange}
                  id="input-edit-product-reorder-level"
                />
                <span className="form-helper">Threshold for low-stock alert</span>
              </div>

              <div className="form-group">
                <label className="form-label">Unit Price ($)</label>
                <input
                  type="number"
                  name="price"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={formData.price}
                  onChange={handleChange}
                  id="input-edit-product-price"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Supplier</label>
              <input
                type="text"
                name="supplier"
                className="form-input"
                value={formData.supplier}
                onChange={handleChange}
                id="input-edit-product-supplier"
              />
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
              className="btn btn-primary"
              disabled={isSubmitting}
              id="btn-submit-edit-product"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
