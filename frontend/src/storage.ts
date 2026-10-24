// The Leader Key lives in this browser only. Storage can be unavailable (private windows, blocked
// site data), so every access is guarded and the page works without it.
const KEY = 'bimgus_admin_key';

export function readStoredKey(): string {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function storeKey(value: string): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Not saved; the key still works until the page is closed
  }
}
