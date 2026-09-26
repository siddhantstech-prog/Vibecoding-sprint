/**
 * API client for Smart Inventory & Stock Alert Platform.
 * Single source of truth for backend API integration.
 */

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

/**
 * Generic request helper with robust error handling for hackathon MVP.
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  let res;
  try {
    res = await fetch(url, config);
  } catch (netErr) {
    throw new Error(`Network connection error: Could not reach backend at ${url}`);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    return null;
  }

  if (!res.ok) {
    const errorMsg = data?.error || `Request failed with status ${res.status}`;
    const err = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  /**
   * Fetch all products
   * Returns: Array of products
   */
  async getProducts() {
    const data = await request('/products');
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.products)) return data.products;
    return [];
  },

  /**
   * Fetch a single product by ID
   */
  async getProduct(id) {
    const data = await request(`/products/${id}`);
    return data?.product || data;
  },

  /**
   * Create a new product
   * Body: { name, category, quantity, reorder_level, price, supplier }
   */
  async createProduct(payload) {
    const data = await request('/products', {
      method: 'POST',
      body: payload,
    });
    return data?.product || data;
  },

  /**
   * Update an existing product (excluding quantity)
   * Body: { name, category, reorder_level, price, supplier }
   */
  async updateProduct(id, payload) {
    // Explicitly ensure quantity is never sent
    const { quantity, id: _ignoredId, status: _ignoredStatus, last_updated: _ignoredTs, ...cleanPayload } = payload;
    const data = await request(`/products/${id}`, {
      method: 'PUT',
      body: cleanPayload,
    });
    return data?.product || data;
  },

  /**
   * Delete a product by ID
   */
  async deleteProduct(id) {
    return await request(`/products/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Stock In: Increase product stock
   * Body: { quantity: number }
   */
  async stockIn(id, quantity) {
    const data = await request(`/products/${id}/stock-in`, {
      method: 'POST',
      body: { quantity: Number(quantity) },
    });
    return data?.product || data;
  },

  /**
   * Stock Out: Decrease product stock
   * Body: { quantity: number }
   * May return 400 Insufficient Stock
   */
  async stockOut(id, quantity) {
    const data = await request(`/products/${id}/stock-out`, {
      method: 'POST',
      body: { quantity: Number(quantity) },
    });
    return data?.product || data;
  },

  /**
   * Fetch alerts
   * status: 'unresolved' | 'resolved' | 'all'
   */
  async getAlerts(status = 'unresolved') {
    const data = await request(`/alerts?status=${encodeURIComponent(status)}`);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.alerts)) return data.alerts;
    return [];
  },

  /**
   * Fetch dashboard stats
   * Handles both naming conventions smoothly
   */
  async getDashboardStats() {
    const data = await request('/dashboard/stats');
    if (!data) {
      return {
        totalProducts: 0,
        totalQuantity: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        criticalAlerts: 0,
      };
    }

    const totalProducts = data.total_products ?? 0;
    const totalQuantity = data.total_quantity ?? data.total_inventory ?? 0;
    const lowStockCount = data.low_stock_count ?? data.low_stock ?? 0;
    const outOfStockCount = data.out_of_stock_count ?? data.out_of_stock ?? 0;
    const criticalAlerts = data.critical_alerts ?? (lowStockCount + outOfStockCount);

    return {
      totalProducts,
      totalQuantity,
      lowStockCount,
      outOfStockCount,
      criticalAlerts,
    };
  },

  /**
   * Health check
   */
  async getHealth() {
    return await request('/health');
  },
};
