// In-memory store shared by every module (LARGE task replaces this).
const data = new Map();

export const store = {
  get: (table, id) => data.get(table)?.get(id),
  set(table, id, value) {
    if (!data.has(table)) data.set(table, new Map());
    data.get(table).set(id, value);
  },
  all: (table) => [...(data.get(table)?.values() ?? [])],
  clear: () => data.clear(),
};
