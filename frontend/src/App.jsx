import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import StatsBar from './components/StatsBar';
import AlertsPanel from './components/AlertsPanel';
import ProductTable from './components/ProductTable';
import AddProductModal from './components/AddProductModal';
import EditProductModal from './components/EditProductModal';
import StockMovementModal from './components/StockMovementModal';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import ToastContainer from './components/Toast';

export default function App() {
  // Core App State
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalQuantity: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
    criticalAlerts: 0,
  });

  const [alertFilter, setAlertFilter] = useState('unresolved');
  const [isLoading, setIsLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(true);
  const [toasts, setToasts] = useState([]);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [stockModalConfig, setStockModalConfig] = useState({
    isOpen: false,
    product: null,
    mode: 'IN',
  });
  const [deleteProduct, setDeleteProduct] = useState(null);

  // Toast Management
  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Fetch all dashboard data
  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const [productsData, alertsData, statsData] = await Promise.all([
        api.getProducts(),
        api.getAlerts(alertFilter),
        api.getDashboardStats(),
      ]);

      setProducts(productsData || []);
      setAlerts(alertsData || []);
      setStats(statsData);
      setApiConnected(true);
    } catch (err) {
      console.error('Failed to load inventory data:', err);
      setApiConnected(false);
      addToast(err.message || 'Could not connect to API server', 'error');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [alertFilter, addToast]);

  // Initial Load & Alert filter sync
  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Product Actions
  const handleCreateProduct = async (payload) => {
    const created = await api.createProduct(payload);
    await loadData(false);
    addToast(`Product "${created.name}" created successfully!`, 'success');
  };

  const handleUpdateProduct = async (id, payload) => {
    const updated = await api.updateProduct(id, payload);
    await loadData(false);
    addToast(`Product "${updated.name}" updated successfully!`, 'success');
  };

  const handleDeleteProduct = async (id) => {
    await api.deleteProduct(id);
    await loadData(false);
    addToast('Product removed successfully', 'info');
  };

  const handleStockMovement = async (id, type, quantity) => {
    try {
      let updated;
      if (type === 'IN') {
        updated = await api.stockIn(id, quantity);
        addToast(`Stock In +${quantity} for "${updated.name}" (Stock: ${updated.quantity})`, 'success');
      } else {
        updated = await api.stockOut(id, quantity);
        addToast(`Stock Out -${quantity} for "${updated.name}" (Stock: ${updated.quantity})`, 'info');
      }
      await loadData(false);
      return updated;
    } catch (err) {
      addToast(err.message || 'Stock movement rejected', 'error');
      throw err;
    }
  };

  const handleQuickStockIn = (productId) => {
    const found = products.find((p) => p.id === productId);
    if (found) {
      setStockModalConfig({
        isOpen: true,
        product: found,
        mode: 'IN',
      });
    }
  };

  return (
    <>
      <div className="technical-grid"></div>
      <div className="app-container">
        {/* Oravia Header */}
        <header className="app-header">
          <div className="brand-section">
            <div className="brand-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.1 2.182a10 10 0 0 1 3.8 0"></path>
                <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"></path>
                <path d="M21.817 10.1a10 10 0 0 1 0 3.8"></path>
                <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"></path>
                <path d="M13.9 21.817a10 10 0 0 1-3.8 0"></path>
                <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"></path>
                <path d="M2.182 13.9a10 10 0 0 1 0-3.8"></path>
                <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"></path>
              </svg>
            </div>
            <div>
              <h1 className="brand-title">
                ORAVIA <span className="brand-badge">Inventory</span>
              </h1>
              <span className="brand-subtitle">
                Automated threshold monitoring, replenishment alerts & stock telemetry
              </span>
            </div>
          </div>

          <div className="header-actions">
            <div className="connection-badge">
              <span className="pulse-dot" style={{ backgroundColor: apiConnected ? '#10B981' : '#EF4444' }}></span>
              <span>{apiConnected ? 'System Live' : 'API Disconnected'}</span>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadData(false)}
              title="Refresh inventory data"
              id="btn-refresh-data"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                <path d="M8 16H3v5"></path>
              </svg>
              Refresh
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setIsAddModalOpen(true)}
              id="btn-header-add-product"
            >
              + Add Product
            </button>
          </div>
        </header>

        {/* 1. Dashboard Stats Bar */}
        <StatsBar stats={stats} />

        {/* 2. Alerts Panel */}
        <AlertsPanel
          alerts={alerts}
          filterStatus={alertFilter}
          onFilterChange={setAlertFilter}
          onQuickStockIn={handleQuickStockIn}
        />

        {/* 3. Product Table */}
        <ProductTable
          products={products}
          onStockIn={(p) => setStockModalConfig({ isOpen: true, product: p, mode: 'IN' })}
          onStockOut={(p) => setStockModalConfig({ isOpen: true, product: p, mode: 'OUT' })}
          onEdit={(p) => setEditProduct(p)}
          onDelete={(p) => setDeleteProduct(p)}
          onAddNew={() => setIsAddModalOpen(true)}
        />

        {/* Modals */}
        <AddProductModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSubmit={handleCreateProduct}
        />

        <EditProductModal
          isOpen={!!editProduct}
          product={editProduct}
          onClose={() => setEditProduct(null)}
          onSubmit={handleUpdateProduct}
        />

        <StockMovementModal
          isOpen={stockModalConfig.isOpen}
          product={stockModalConfig.product}
          mode={stockModalConfig.mode}
          onClose={() => setStockModalConfig({ isOpen: false, product: null, mode: 'IN' })}
          onSubmit={handleStockMovement}
        />

        <DeleteConfirmModal
          isOpen={!!deleteProduct}
          product={deleteProduct}
          onClose={() => setDeleteProduct(null)}
          onConfirm={handleDeleteProduct}
        />

        {/* Toasts */}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </>
  );
}
