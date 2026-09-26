import React, { useState } from 'react';

/**
 * Alerts Panel displaying unresolved or all stock alerts.
 */
export default function AlertsPanel({ alerts, filterStatus, onFilterChange, onQuickStockIn }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="alerts-section">
      <div className="alerts-header">
        <div className="alerts-title-wrapper">
          <span style={{ fontSize: '18px' }}>🔔</span>
          <h2 className="alerts-title" style={{ margin: 0, fontSize: '17px' }}>Inventory Alerts</h2>
          <span className="alerts-count-pill">
            {alerts.length} {filterStatus === 'unresolved' ? 'Active' : 'Total'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="alerts-filter-tabs">
            <button
              type="button"
              className={`filter-tab ${filterStatus === 'unresolved' ? 'active' : ''}`}
              onClick={() => onFilterChange('unresolved')}
            >
              Unresolved Only
            </button>
            <button
              type="button"
              className={`filter-tab ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => onFilterChange('all')}
            >
              All Alerts
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="alerts-list">
          {alerts.length === 0 ? (
            <div className="empty-alerts">
              <span>✅ All stock levels healthy — no {filterStatus === 'unresolved' ? 'unresolved' : ''} alerts found.</span>
            </div>
          ) : (
            alerts.map((alert) => {
              const isOut = alert.type === 'OUT_OF_STOCK';
              const isResolved = alert.status === 'RESOLVED';
              const alertClass = isResolved
                ? 'alert-resolved'
                : isOut
                ? 'alert-out'
                : 'alert-low';

              return (
                <div key={alert.id} className={`alert-item ${alertClass}`}>
                  <div className="alert-content-left">
                    <span
                      className={`alert-type-badge ${
                        isOut ? 'alert-type-out' : 'alert-type-low'
                      }`}
                    >
                      {alert.type === 'OUT_OF_STOCK' ? 'Out of Stock' : 'Low Stock'}
                    </span>

                    <span className="alert-message">{alert.message}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="alert-timestamp">
                      {formatTime(alert.created_at)}
                    </span>

                    {onQuickStockIn && !isResolved && (
                      <button
                        type="button"
                        className="btn btn-stock-in btn-sm"
                        onClick={() => onQuickStockIn(alert.product_id || alert.product?.id)}
                        title="Quick Restock"
                      >
                        + Restock
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
