import React from 'react';

/**
 * Dashboard Stats Bar showing key inventory indicators.
 */
export default function StatsBar({ stats }) {
  return (
    <div className="stats-grid">
      {/* 1. Total Products */}
      <div className="stat-card stat-total">
        <div className="stat-header">
          <span className="stat-title">Total Products</span>
          <div className="stat-icon" style={{ color: '#818cf8' }}>📦</div>
        </div>
        <div className="stat-value">{stats.totalProducts}</div>
        <div className="stat-desc">Active items in catalog</div>
      </div>

      {/* 2. Total Inventory Quantity */}
      <div className="stat-card stat-quantity">
        <div className="stat-header">
          <span className="stat-title">Total Inventory</span>
          <div className="stat-icon" style={{ color: '#38bdf8' }}>📊</div>
        </div>
        <div className="stat-value">{stats.totalQuantity}</div>
        <div className="stat-desc">Total units in stock</div>
      </div>

      {/* 3. Low Stock Count */}
      <div className="stat-card stat-low">
        <div className="stat-header">
          <span className="stat-title">Low Stock</span>
          <div className="stat-icon" style={{ color: '#fbbf24' }}>⚠️</div>
        </div>
        <div className="stat-value" style={{ color: stats.lowStockCount > 0 ? '#fbbf24' : '#ffffff' }}>
          {stats.lowStockCount}
        </div>
        <div className="stat-desc">At or below reorder level</div>
      </div>

      {/* 4. Out of Stock Count */}
      <div className="stat-card stat-out">
        <div className="stat-header">
          <span className="stat-title">Out of Stock</span>
          <div className="stat-icon" style={{ color: '#f87171' }}>🚨</div>
        </div>
        <div className="stat-value" style={{ color: stats.outOfStockCount > 0 ? '#f87171' : '#ffffff' }}>
          {stats.outOfStockCount}
        </div>
        <div className="stat-desc">Zero units available</div>
      </div>

      {/* 5. Critical Alerts */}
      <div className="stat-card stat-alerts">
        <div className="stat-header">
          <span className="stat-title">Critical Alerts</span>
          <div className="stat-icon" style={{ color: '#f43f5e' }}>🔔</div>
        </div>
        <div className="stat-value" style={{ color: stats.criticalAlerts > 0 ? '#f43f5e' : '#ffffff' }}>
          {stats.criticalAlerts}
        </div>
        <div className="stat-desc">Unresolved inventory flags</div>
      </div>
    </div>
  );
}
