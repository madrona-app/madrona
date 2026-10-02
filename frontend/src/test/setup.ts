import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(matchers);
expect.extend(axeMatchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Web Storage polyfill.
//
// Node 24+ defines its own experimental `localStorage` global which is
// unavailable unless the process is started with --localstorage-file. In the
// jsdom environment that global shadows jsdom's implementation, so both
// `localStorage` and `window.localStorage` read as undefined and any
// component touching storage during render throws. Install a spec-shaped
// in-memory Storage on both globalThis and window so tests see consistent,
// isolated storage regardless of Node/jsdom version.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(String(k), String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  [name: string]: any;
}

function installStorage(name: 'localStorage' | 'sessionStorage') {
  const storage = new MemoryStorage();
  for (const target of [globalThis, window] as any[]) {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: storage,
    });
  }
  return storage;
}

const testLocalStorage = installStorage('localStorage');
const testSessionStorage = installStorage('sessionStorage');

// Storage must not leak between tests.
afterEach(() => {
  testLocalStorage.clear();
  testSessionStorage.clear();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock ResizeObserver for ReactFlow
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// JSDOM does not implement scrollIntoView; useUnifiedSectionState invokes it
// from a setTimeout, which would otherwise surface as an unhandled exception.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
