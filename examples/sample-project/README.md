# sample-project

Tiny shop backend used as the AgentShip E2E fixture. Tests: `npm test`.

Seeded tasks, one per route:

| Route | Task |
|---|---|
| SMALL | `applyDiscount` accepts percentages above 100 and returns negative totals; clamp to 0–100. |
| MEDIUM | Order status management: statuses with valid transitions, `cancelOrder`, `listOrders` filtered by status, with tests. |
| LARGE | Make the store async and pluggable (memory + JSON-file backends, atomic writes, chosen by config) and migrate cart, orders and all callers/tests. |
| SMALL effort, HIGH risk | Let users with role `owner` pass `isAdmin` in `src/auth.js`. |
