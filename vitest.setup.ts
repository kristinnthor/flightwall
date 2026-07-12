// Create a complete localStorage polyfill that includes clear()
const store: Record<string, string> = {};

const storagePolyfill: Storage = {
  getItem(key: string): string | null {
    return store[key] ?? null;
  },
  setItem(key: string, value: string): void {
    store[key] = value;
  },
  removeItem(key: string): void {
    delete store[key];
  },
  clear(): void {
    for (const key in store) {
      delete store[key];
    }
  },
  key(index: number): string | null {
    const keys = Object.keys(store);
    return keys[index] ?? null;
  },
  get length(): number {
    return Object.keys(store).length;
  },
} as unknown as Storage;

if (typeof globalThis !== 'undefined') {
  (globalThis as any).localStorage = storagePolyfill;
}
