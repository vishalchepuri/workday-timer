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

const seedUser = {
  id: "user-demo",
  name: "Demo User",
  email: "demo@hourlog.app",
  password: "password123",
};

const currentSeedDate = new Date();

function hoursAgo(days, startHour, durationHours) {
  const start = new Date(currentSeedDate);
  start.setDate(currentSeedDate.getDate() - days);
  start.setHours(startHour, 15, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

const seedSessions = [
  hoursAgo(0, 9, 4.25),
  hoursAgo(0, 14, 3.1),
  hoursAgo(1, 9, 8.1),
  hoursAgo(1, 18, 1.2),
  hoursAgo(2, 10, 7.35),
  hoursAgo(4, 9, 8.4),
  hoursAgo(7, 9, 7.85),
  hoursAgo(12, 10, 8.0),
  hoursAgo(18, 9, 8.25),
  hoursAgo(26, 9, 7.6),
  hoursAgo(39, 10, 8.2),
  hoursAgo(58, 9, 7.9),
  hoursAgo(73, 9, 8.15),
].map((session, index) => ({
  id: `seed-${index + 1}`,
  userId: seedUser.id,
  ...session,
}));

export function readDatabase() {
  const raw = storageGet(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  const data = { users: [seedUser], sessions: seedSessions };
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
