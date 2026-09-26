import React, { useState } from 'react';

/**
 * Modal to create a new product.
 */
export default function AddProductModal({ isOpen, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    name: '',
    category: 'Beverages',
    quantity: 10,
    reorder_level: 3,
    price: 4.5,
    supplier: 'Acme Supplies',
  });
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

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
      setError('Product name is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSubmit({
        name: formData.name.trim(),
        category: formData.category.trim() || undefined,
        quantity: Number(formData.quantity) || 0,
        reorder_level: Number(formData.reorder_level) || 0,
        price: Number(formData.price) || 0,
        supplier: formData.supplier.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create product');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Add New Product</h3>
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

            <div className="form-group">
              <label className="form-label">
                Product Name <span className="required">*</span>
              </label>
              <input
                type="text"
                name="name"
                className="form-input"
                placeholder="e.g. Coffee Beans"
                value={formData.name}
                onChange={handleChange}
                required
                autoFocus
                id="input-product-name"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Category</label>
              <input
                type="text"
                name="category"
                className="form-input"
                placeholder="e.g. Beverages, Bakery, Pantry"
                value={formData.category}
                onChange={handleChange}
                id="input-product-category"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Opening Quantity</label>
                <input
                  type="number"
                  name="quantity"
                  min="0"
                  className="form-input"
                  value={formData.quantity}
                  onChange={handleChange}
                  id="input-product-quantity"
                />
                <span className="form-helper">Initial units in stock</span>
              </div>

              <div className="form-group">
                <label className="form-label">Reorder Level</label>
                <input
                  type="number"
                  name="reorder_level"
                  min="0"
                  className="form-input"
                  value={formData.reorder_level}
                  onChange={handleChange}
                  id="input-product-reorder-level"
                />
                <span className="form-helper">Low-stock alert threshold</span>
              </div>
            </div>

            <div className="form-row">
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
                  id="input-product-price"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Supplier</label>
                <input
                  type="text"
                  name="supplier"
                  className="form-input"
                  placeholder="e.g. Acme Supplies"
                  value={formData.supplier}
                  onChange={handleChange}
                  id="input-product-supplier"
                />
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
              className="btn btn-primary"
              disabled={isSubmitting}
              id="btn-submit-add-product"
            >
              {isSubmitting ? 'Adding...' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
