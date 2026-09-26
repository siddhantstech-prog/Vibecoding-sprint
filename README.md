# Smart Inventory & Stock Alert Platform

A real-time, automated inventory management and stock replenishment platform built for small businesses. Features instant threshold detection, automatic stock alert generation, and live dashboard analytics.

---

## 🌟 Features

- **Real-Time Dashboard**: Live tracking of Total Products, Total Inventory, Low Stock Count, Out of Stock Count, and Critical Alerts.
- **Automated Stock Status**: Dynamic categorization into `NORMAL`, `LOW_STOCK`, and `OUT_OF_STOCK` derived deterministically by the backend.
- **Smart Alert System**: Automatic generation and resolution of `LOW_STOCK` and `OUT_OF_STOCK` notifications with instant restock triggers.
- **Stock Movement Ledger**: Full audit trail for incoming (`Stock In`) and outgoing (`Stock Out`) inventory with zero-inventory guards and insufficient stock protection.
- **Product Catalog Management**: Quick creation, editing, category filtering, search, and cascading deletions.
- **Sleek Modern UI**: Dark slate & glassmorphism aesthetics, responsive layout, toast feedback, and high-contrast status badges.

---

## 🚀 Quick Start

### 1. Start the Backend API (Zero Dependencies)
```bash
cd backend
npm start
# API listening on http://localhost:4000 (routes mounted at / and /api)
```

### 2. Start the Frontend (Vite + React)
```bash
cd frontend
npm install
npm run dev
# Vite dev server running at http://localhost:5173
```

### 3. Run Automated Tests
```bash
# Run backend integration test suite (25 tests)
npm --prefix backend test

# Run end-to-end Primary Demo test runner
node test-e2e.mjs
```

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Vanilla CSS Design System, Native `fetch` API
- **Backend**: Node.js (`node:http`, `node:sqlite`), REST API, Zero external npm runtime dependencies
- **Database**: SQLite with foreign keys and check constraints

---

## 📡 API Contract Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health and product count |
| `GET` | `/products` | List all products with backend-computed `status` |
| `POST` | `/products` | Create a new product (`name`, `category`, `quantity`, `reorder_level`, `price`, `supplier`) |
| `GET` | `/products/:id` | Fetch product details |
| `PUT` | `/products/:id` | Update product details (excluding quantity) |
| `DELETE` | `/products/:id` | Delete product (cascades to movements & alerts) |
| `POST` | `/products/:id/stock-in` | Increase stock (`{ quantity }`) |
| `POST` | `/products/:id/stock-out` | Decrease stock (`{ quantity }`, prevents negative stock) |
| `GET` | `/alerts` | Get alerts (`?status=unresolved` or `?status=all`) |
| `GET` | `/dashboard/stats` | Retrieve aggregate inventory metrics |

---

## 🚢 Deployment Guide

### Deploying Frontend
1. Build static production bundle:
   ```bash
   cd frontend
   npm run build
   ```
2. The output in `frontend/dist` can be deployed directly to:
   - **Vercel / Netlify**: Configure root directory as `frontend`, build command `npm run build`, output directory `dist`. Configure environment variable `VITE_API_BASE` pointing to your backend URL.
   - **Render / Railway**: Run both backend and frontend or static hosting.
