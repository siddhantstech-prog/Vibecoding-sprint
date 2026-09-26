import React, { useState, useMemo } from 'react';

/**
 * Product Table Component.
 * Strict column order:
 * | Product | Category | Current Stock | Reorder Level | Status | Price | Actions |
 */
export default function ProductTable({
  products,
  onStockIn,
  onStockOut,
  onEdit,
  onDelete,
  onAddNew,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Extract unique categories for filter
  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [products]);

  // Filter products based on search and category
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.supplier?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCat =
        selectedCategory === 'ALL' || p.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [products, searchTerm, selectedCategory]);

  const renderStatusBadge = (status) => {
    // Backend is the single source of truth for status.
    switch (status) {
      case 'NORMAL':
        return (
          <span className="status-badge badge-normal">
            <span style={{ fontSize: '10px' }}>●</span> Normal
          </span>
        );
      case 'LOW_STOCK':
        return (
          <span className="status-badge badge-low">
            <span style={{ fontSize: '10px' }}>●</span> Low Stock
          </span>
        );
      case 'OUT_OF_STOCK':
        return (
          <span className="status-badge badge-out">
            <span style={{ fontSize: '10px' }}>●</span> Out of Stock
          </span>
        );
      default:
        return <span className="status-badge badge-normal">{status || 'NORMAL'}</span>;
    }
  };

  const formatPrice = (price) => {
    if (price === undefined || price === null) return '$0.00';
    return `$${Number(price).toFixed(2)}`;
  };

  return (
    <div className="products-section">
      <div className="section-header">
        <div className="section-title-wrapper">
          <span style={{ fontSize: '20px' }}>📋</span>
          <h2 className="section-title" style={{ margin: 0 }}>Product Inventory</h2>
          <span className="category-badge" style={{ marginLeft: '4px' }}>
            {filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="section-controls">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="search-input"
              placeholder="Search product, category, supplier..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="category-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="ALL">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAddNew}
            id="btn-add-product"
          >
            + Add Product
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="product-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Current Stock</th>
              <th>Reorder Level</th>
              <th>Status</th>
              <th>Price</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                  {products.length === 0 ? (
                    <div>
                      <p style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>No products in inventory yet</p>
                      <p style={{ fontSize: '13px', marginBottom: '14px' }}>Get started by adding your first product catalog item.</p>
                      <button type="button" className="btn btn-primary btn-sm" onClick={onAddNew}>
                        + Add First Product
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: '14px', marginBottom: '6px' }}>No products match your search filter</p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setSearchTerm(''); setSelectedCategory('ALL'); }}
                      >
                        Clear Filters
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filteredProducts.map((p) => (
                <tr key={p.id} id={`product-row-${p.id}`}>
                  {/* Column 1: Product */}
                  <td>
                    <div className="product-name-cell">
                      <span className="product-name">{p.name}</span>
                      {p.supplier && (
                        <span className="product-supplier">Supplier: {p.supplier}</span>
                      )}
                    </div>
                  </td>

                  {/* Column 2: Category */}
                  <td>
                    <span className="category-badge">{p.category || 'Uncategorized'}</span>
                  </td>

                  {/* Column 3: Current Stock */}
                  <td>
                    <span className="stock-value">{p.quantity}</span>
                  </td>

                  {/* Column 4: Reorder Level */}
                  <td>
                    <span className="reorder-value">{p.reorder_level}</span>
                  </td>

                  {/* Column 5: Status */}
                  <td>
                    {renderStatusBadge(p.status)}
                  </td>

                  {/* Column 6: Price */}
                  <td>
                    <span className="price-value">{formatPrice(p.price)}</span>
                  </td>

                  {/* Column 7: Actions */}
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-stock-in btn-sm"
                        onClick={() => onStockIn(p)}
                        title={`Stock In (+ inventory for ${p.name})`}
                        id={`btn-stock-in-${p.id}`}
                      >
                        + In
                      </button>

                      <button
                        type="button"
                        className="btn btn-stock-out btn-sm"
                        onClick={() => onStockOut(p)}
                        title={`Stock Out (- inventory for ${p.name})`}
                        id={`btn-stock-out-${p.id}`}
                      >
                        - Out
                      </button>

                      <button
                        type="button"
                        className="btn btn-edit btn-sm"
                        onClick={() => onEdit(p)}
                        title={`Edit ${p.name}`}
                        id={`btn-edit-${p.id}`}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="btn btn-delete btn-sm"
                        onClick={() => onDelete(p)}
                        title={`Delete ${p.name}`}
                        id={`btn-delete-${p.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
