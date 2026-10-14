import type { MonoRecord, MonoStore, StoredEntry } from "./store";

export function memoryStore(now = Date.now): MonoStore {
  const data = new Map<string, StoredEntry>();
  let revision = 0;
  return {
    async read(key) {
      const entry = data.get(key);
      return entry && entry.value.expiresAt > now()
        ? structuredClone(entry)
        : null;
    },
    async write(key: string, value: MonoRecord, version = null) {
      const old = data.get(key);
      const live = old && old.value.expiresAt > now() ? old : null;
      if (version ? live?.version !== version : !!live) return null;
      const next = String(++revision);
      data.set(key, { value: structuredClone(value), version: next });
      return next;
    },
  };
}
