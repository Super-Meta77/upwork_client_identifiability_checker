// In-memory stand-ins for the chrome.* APIs the extension uses.

type Items = Record<string, unknown>;

export interface FakeStorageArea {
  get(keys?: string | string[] | null): Promise<Items>;
  set(items: Items): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  /** Test helper: a deep copy of everything stored. */
  dump(): Items;
}

function createArea(): FakeStorageArea {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Items = {};
      for (const k of list) if (data.has(k)) out[k] = clone(data.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, clone(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    async clear() {
      data.clear();
    },
    dump() {
      return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
    },
  };
}

export interface FakeChrome {
  storage: { local: FakeStorageArea; session: FakeStorageArea };
  sidePanel: { setPanelBehavior(behavior: unknown): Promise<void> };
  runtime: {
    onStartup: { addListener(fn: () => void): void };
    onInstalled: { addListener(fn: () => void): void };
  };
}

export function createFakeChrome(): FakeChrome {
  return {
    storage: { local: createArea(), session: createArea() },
    sidePanel: { async setPanelBehavior() {} },
    runtime: {
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
    },
  };
}

export function fakeChrome(): FakeChrome {
  return (globalThis as unknown as { chrome: FakeChrome }).chrome;
}
