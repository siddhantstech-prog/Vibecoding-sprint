# Smart Inventory & Stock Alert Platform — Backend

Zero-dependency Node.js API. Uses only built-in modules:

| Concern      | Implementation                       |
| ------------ | ------------------------------------ |
| HTTP server  | `node:http`                          |
| Database     | `node:sqlite` (built-in, Node >= 22.5) |
| Tests        | `node:test` + built-in `fetch`       |

There is **nothing to `npm install`** — it runs offline immediately.

## Quick start

```bash
cd backend
npm start           # http://localhost:4000
```

Other scripts:

```bash
npm run dev         # same, with --watch reload
npm test            # 25 API integration tests + 32 database layer tests
npm run seed        # insert demo products (no-op if data exists)
npm run db:check    # inspect the live schema + run SQLite integrity checks
```

Environment variables:

| Var      | Default                        | Purpose                        |
| -------- | ------------------------------ | ------------------------------ |
| `PORT`   | `4000`                         | HTTP port                      |
| `HOST`   | `0.0.0.0`                      | Bind address                   |
| `DB_PATH`| `backend/data/inventory.db`    | SQLite file (`:memory:` works) |

The database file and demo seed are created automatically on first boot.

## Data model

`products`

| Column          | Type    | Notes                                    |
| --------------- | ------- | ---------------------------------------- |
| `id`            | INTEGER | PK, autoincrement                        |
| `name`          | TEXT    | NOT NULL                                 |
| `category`      | TEXT    | defaults to `"Uncategorized"`            |
| `quantity`      | INTEGER | NOT NULL, `CHECK (quantity >= 0)`        |
| `reorder_level` | INTEGER | NOT NULL, `CHECK (reorder_level >= 0)`   |
| `price`         | REAL    | NOT NULL, `CHECK (price >= 0)`           |
| `supplier`      | TEXT    | nullable                                 |
| `last_updated`  | TEXT    | ISO-8601 UTC                             |

`stock_movements` — `id`, `product_id` (FK, `ON DELETE CASCADE`), `type`
(`IN`\|`OUT`), `quantity` (`CHECK > 0`), `timestamp`

`alerts` — `id`, `product_id` (FK, `ON DELETE CASCADE`), `type`
(`LOW_STOCK`\|`OUT_OF_STOCK`), `message`, `status`
(`UNRESOLVED`\|`RESOLVED`), `created_at`

Integrity is enforced in the schema, not just in code:

| Rule                                                    | Enforced by                                   |
| ------------------------------------------------------- | --------------------------------------------- |
| `quantity` / `reorder_level` / `price >= 0`             | `CHECK`                                       |
| stock quantities are whole units (no `1.5` in stock)    | `CHECK (typeof(col) = 'integer')`             |
| a movement's `quantity > 0`                             | `CHECK`                                       |
| movement `type` is `IN` or `OUT`                        | `CHECK`                                       |
| alert `type` / `status` values are valid                | `CHECK`                                       |
| movements/alerts belong to a real product               | `FOREIGN KEY ... REFERENCES products(id)`     |
| deleting a product removes its movements + alerts        | `ON DELETE CASCADE` (no orphaned rows)        |
| only one **active** alert per product + type            | partial `UNIQUE INDEX ... WHERE status='UNRESOLVED'` |

Resolved alerts never conflict with that unique index, so alert history is
unlimited and can be reopened once the current alert is resolved.

## Schema migrations

The schema is versioned with SQLite's `PRAGMA user_version`. `openDatabase()`
applies any pending migration in one transaction, so a database file written by
an older commit is upgraded in place — data and ids are preserved:

| Version | Change                                                                                  |
| ------- | --------------------------------------------------------------------------------------- |
| 1       | Initial schema (as shipped in commit `6eff27d`) — frozen, never edited                   |
| 2       | Whole-unit stock constraint, one-unresolved-alert-per-product/type index                |

Migration 2 rebuilds `products` using SQLite's documented table-rebuild
procedure, with `PRAGMA foreign_keys` switched off for the duration so dropping
the old table does not cascade into `stock_movements`/`alerts`. Before the
unique index is created, any legacy duplicate `UNRESOLVED` alerts are demoted to
`RESOLVED` (the oldest row stays active) rather than deleted, so no history is
lost.

`npm run db:check` prints the live schema, indexes, row counts, and the result
of `PRAGMA integrity_check` + `PRAGMA foreign_key_check`, exiting non-zero if the
database is not exactly what the backend expects.

## Database tests

`test/db.test.mjs` (32 tests) talks to SQLite directly, so the guarantees above
are asserted at the layer that actually enforces them:

- schema shape: tables, columns and all four indexes present
- every `CHECK` / `NOT NULL` / `UNIQUE` rule rejects bad data (fractional stock,
  zero/negative movement quantities, invalid enums, duplicate active alerts)
- foreign keys reject orphans; `DELETE` cascades; `PRAGMA foreign_key_check`
  reports nothing
- transactions roll back on error, commit on success, and nest safely
- seeding is idempotent and leaves no partial rows when it fails
- a legacy v1 database is migrated in place with every row and id preserved
- data persists across close/reopen and across a server restart
- the `NORMAL -> LOW_STOCK -> OUT_OF_STOCK -> NORMAL` alert cycle keeps exactly
  one active alert and never loses history

## Endpoints

Every route is available **both** at `/<path>` and `/api/<path>`, so the frontend
can use either. CORS is fully open (including preflight) for local dev.

| Method   | Path                        | Purpose                                    |
| -------- | --------------------------- | ------------------------------------------ |
| `GET`    | `/health`                   | Liveness + product count                   |
| `GET`    | `/products`                 | List all, each with computed `status`      |
| `POST`   | `/products`                 | Create                                      |
| `GET`    | `/products/:id`             | Fetch one                                   |
| `PUT`    | `/products/:id`             | Update (never `quantity`)                   |
| `DELETE` | `/products/:id`             | Delete (cascades)                           |
| `POST`   | `/products/:id/stock-in`    | `{ quantity }` — increase stock             |
| `POST`   | `/products/:id/stock-out`   | `{ quantity }` — decrease stock             |
| `GET`    | `/alerts`                   | `?status=unresolved` (default) \| `resolved` \| `all` |
| `GET`    | `/dashboard/stats`          | Aggregates                                  |

### Response shapes

```jsonc
// GET /products
{ "products": [ { "id": 1, "name": "Coffee", "category": "Beverages",
    "quantity": 10, "reorder_level": 3, "price": 12.5, "supplier": "Bean Co",
    "last_updated": "2026-09-26T14:01:33.090Z", "status": "NORMAL" } ],
  "count": 5 }

// POST /products, PUT /products/:id, stock-in, stock-out
{ "product": { /* same shape as above */ } }

// GET /alerts
{ "alerts": [ { "id": 5, "product_id": 1,
    "product": { "id": 1, "name": "Coffee" }, "product_name": "Coffee",
    "type": "OUT_OF_STOCK", "message": "Coffee is out of stock (0 in stock, reorder level 3)",
    "status": "UNRESOLVED", "created_at": "2026-09-26T14:01:33.321Z" } ],
  "count": 3, "filter": "UNRESOLVED" }

// DELETE /products/:id
{ "deleted": true, "id": 6, "message": "Product deleted" }
```

### Errors

Always the same shape, never leaking internals:

```json
{ "error": "Insufficient stock: requested 4, available 3" }
```

`400` invalid/missing data, non-positive quantity, insufficient stock, bad id
format, malformed JSON · `404` unknown route or product · `405` wrong method ·
`500` unexpected (logged server-side, generic message returned).

## Stock status logic

Computed **server-side only** in `src/stock.js` (`computeStatus`) — the client
can never set or spoof a status, and there is exactly one implementation used by
the list endpoint, the mutation endpoints and the dashboard.

```
OUT_OF_STOCK   quantity === 0
LOW_STOCK      0 < quantity <= reorder_level
NORMAL         quantity > reorder_level
```

Stock can never go negative. An `OUT` that would exceed the available quantity
is rejected with `400 Insufficient stock` **before** anything is written.

`PUT /products/:id` refuses to change `quantity` (400) — quantity moves only via
stock-in/stock-out so the `stock_movements` ledger stays authoritative.

## Alert logic

After every mutation that can change status (stock-in, stock-out, or a
`reorder_level` change via PUT) — plus once at seed time —
`syncAlertsForProduct()` runs:

1. Every `UNRESOLVED` alert whose `type` no longer matches the current status is
   flipped to `RESOLVED`. When the status is `NORMAL` this resolves everything,
   since no `NORMAL` alert type exists.
2. If the status is `LOW_STOCK`/`OUT_OF_STOCK`, an `UNRESOLVED` alert of that
   type is inserted **only if one doesn't already exist** (`INSERT ... WHERE NOT
   EXISTS`), so repeated mutations can never duplicate an alert.
3. Resolved alerts are never deleted — they remain as history and are visible
   via `?status=resolved` or `?status=all`.

`quantity → 3` (reorder 3) raises `LOW_STOCK`; `3 → 0` resolves it and raises
`OUT_OF_STOCK`; back above the threshold resolves that too.

## Dashboard stats — naming conflict

`docs/PRD.md` §14 and `PROJECT_SPEC` §12 specify **different key names** for
`GET /dashboard/stats`. No frontend existed in the repo when this was written, so
the response emits **both** — PRD names as the primary contract plus SPEC
aliases. This is a superset, so either frontend can read it unchanged:

```json
{
  "total_products": 5,
  "total_quantity": 37,
  "low_stock_count": 1,
  "out_of_stock_count": 2,
  "critical_alerts": 3,

  "total_inventory": 37,
  "low_stock": 1,
  "out_of_stock": 2
}
```

`critical_alerts` is the count of **all unresolved alerts** (low + out of stock).
The team should pick one naming set and drop the other before shipping.

## Demo data

Seeded automatically when `products` is empty:

| Product | Qty | Reorder | Status       |
| ------- | --- | ------- | ------------ |
| Coffee  | 10  | 3       | `NORMAL`     |
| Rice    | 25  | 5       | `NORMAL`     |
| Milk    | 4   | 6       | `LOW_STOCK`  |
| Sugar   | 0   | 2       | `OUT_OF_STOCK` |
| Tea     | 8   | 2       | `NORMAL`     |

**Coffee is the primary demo product**: stock-out 7 → LOW_STOCK, then stock-out
3 → OUT_OF_STOCK (and the LOW_STOCK alert auto-resolves).

Reset to a clean state: delete `backend/data/inventory.db` and restart.
