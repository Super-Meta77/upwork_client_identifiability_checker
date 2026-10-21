import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';
import { createFakeChrome } from './fakes/chrome';

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = createFakeChrome();
  globalThis.indexedDB = new IDBFactory();
});
