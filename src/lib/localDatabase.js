const STORAGE_KEY = "hourlog_local_store_v1";
const SESSION_KEY = "hourlog_current_user_v1";
const memoryStorage = new Map();

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key) ?? memoryStorage.get(key) ?? null;
  } catch {
    return memoryStorage.get(key) ?? null;
  }
}

function storageSet(key, value) {
  memoryStorage.set(key, value);
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // In restricted browser contexts, the in-memory copy keeps this session usable.
  }
}

function storageRemove(key) {
  memoryStorage.delete(key);
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore restricted storage failures.
  }
}

export function createId(prefix) {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${prefix}-${Date.now()}`;
}

export function readDatabase() {
  const raw = storageGet(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  const data = { users: [], sessions: [] };
  writeDatabase(data);
  return data;
}

export function writeDatabase(data) {
  storageSet(STORAGE_KEY, JSON.stringify(data));
}

export function readCurrentUserId() {
  return storageGet(SESSION_KEY);
}

export function writeCurrentUserId(userId) {
  storageSet(SESSION_KEY, userId);
}

export function clearCurrentUserId() {
  storageRemove(SESSION_KEY);
}
