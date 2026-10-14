import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface LoginRecord {
  id?: number | string;
  technician_id: string;
  logged_in_at: string;
  device_info: string;
  status: string;
}

export const session = {
  technicianId: '',
};

const KEY = 'intellialarm_technician_id';
const LOGIN_HISTORY_KEY = 'intellialarm_login_history';
const ADMIN_SESSION_KEY = 'intellialarm_admin_session';
const SERVER_HOST_KEY = 'intellialarm_server_host';

// Default host: jackets-stem-prison-dvds.trycloudflare.com (Cloud) and 10.63.138.124 (Wi-Fi)
export const DEFAULT_SERVER_HOST = 'jackets-stem-prison-dvds.trycloudflare.com';
export const PRESET_SERVER_HOSTS = [
  'jackets-stem-prison-dvds.trycloudflare.com',
  '10.63.138.124',
  '192.168.137.245',
  'localhost',
];

let cachedServerHost = DEFAULT_SERVER_HOST;
let isAutoDiscovering = false;

// Event listener system for reactive server host switching across all components
type ServerHostListener = (newHost: string) => void;
const hostListeners: Set<ServerHostListener> = new Set();

export function onServerHostChange(listener: ServerHostListener): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

export function notifyServerHostChange(newHost: string) {
  hostListeners.forEach((fn) => {
    try {
      fn(newHost);
    } catch (e) {
      console.warn('Error in server host listener', e);
    }
  });
}

/** Sanitize input host to strip http://, ws://, paths, and extract clean host:port */
export function cleanHost(input: string): string {
  if (!input) return DEFAULT_SERVER_HOST;
  let cleaned = input.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/^wss?:\/\//i, '');
  cleaned = cleaned.replace(/\/.*$/, ''); // remove trailing slash or paths
  return cleaned.trim() || DEFAULT_SERVER_HOST;
}

/**
 * Fast network scanner that discovers the active IntelliAlarm server on the local Wi-Fi / hotspot.
 * Probes priority candidates first, then scans the current subnet.
 * Automatically saves the discovered host and notifies all listeners.
 */
export async function autoDiscoverServer(onProgress?: (msg: string) => void): Promise<string | null> {
  if (isAutoDiscovering) return null;
  isAutoDiscovering = true;

  try {
    onProgress?.('Probing local server candidates...');

    // 1. High-priority candidate IPs
    const priorityCandidates = Array.from(new Set([
      cachedServerHost,
      DEFAULT_SERVER_HOST,
      '10.63.138.124',
      '127.0.0.1',
      'localhost',
    ])).filter(Boolean);

    // Fast check priority candidates in parallel
    for (const host of priorityCandidates) {
      const clean = cleanHost(host);
      try {
        const res = await fetchWithTimeout(`http://${clean}:8000/`, {}, 1200);
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && (data.status?.includes('IntelliAlarm') || data.priority_key)) {
            await setServerHost(clean);
            onProgress?.(`Found server at ${clean}:8000`);
            return clean;
          }
        }
      } catch {}
    }

    // 2. Subnet sweep on current subnet (e.g. 10.63.138.x)
    onProgress?.('Scanning local Wi-Fi subnet...');
    const subnetPrefix = cachedServerHost.includes('.')
      ? cachedServerHost.substring(0, cachedServerHost.lastIndexOf('.') + 1)
      : '10.63.138.';

    // Generate ordered list of hosts to scan (common DHCP ranges first)
    const scanList: string[] = [];
    for (let i = 100; i <= 150; i++) scanList.push(`${subnetPrefix}${i}`);
    for (let i = 240; i <= 254; i++) scanList.push(`${subnetPrefix}${i}`);
    for (let i = 2; i <= 50; i++) scanList.push(`${subnetPrefix}${i}`);

    // Probe in concurrent batches of 15
    const batchSize = 15;
    for (let b = 0; b < scanList.length; b += batchSize) {
      const batch = scanList.slice(b, b + batchSize);
      onProgress?.(`Scanning ${batch[0]} - ${batch[batch.length - 1]}...`);

      const promises = batch.map(async (ip) => {
        try {
          const res = await fetchWithTimeout(`http://${ip}:8000/`, {}, 800);
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data && (data.status?.includes('IntelliAlarm') || data.priority_key)) {
              return ip;
            }
          }
        } catch {}
        return null;
      });

      const results = await Promise.all(promises);
      const found = results.find(Boolean);
      if (found) {
        await setServerHost(found);
        onProgress?.(`Found server at ${found}:8000`);
        return found;
      }
    }

    onProgress?.('No IntelliAlarm server found on subnet.');
    return null;
  } finally {
    isAutoDiscovering = false;
  }
}

/** Initialize server host from AsyncStorage on app launch */
export async function initServerHost(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(SERVER_HOST_KEY);
    if (saved && saved.trim()) {
      const cleaned = cleanHost(saved);
      cachedServerHost = cleaned;
    } else {
      cachedServerHost = DEFAULT_SERVER_HOST;
      await AsyncStorage.setItem(SERVER_HOST_KEY, DEFAULT_SERVER_HOST);
    }
  } catch {}
  notifyServerHostChange(cachedServerHost);
  return cachedServerHost;
}

// Fire async load on import
initServerHost().catch(() => {});

export function getServerHost(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hostname) {
    return window.location.hostname;
  }
  return cachedServerHost || DEFAULT_SERVER_HOST;
}

/**
 * Update the active server host. Saves immediately, notifies all app listeners,
 * and causes WebSockets and HTTP requests to instantly switch to the new host.
 */
export async function setServerHost(host: string): Promise<string> {
  const cleaned = cleanHost(host);
  cachedServerHost = cleaned;
  try {
    await AsyncStorage.setItem(SERVER_HOST_KEY, cleaned);
  } catch (e) {
    console.warn('Failed to persist server host to AsyncStorage', e);
  }
  notifyServerHostChange(cleaned);
  return cleaned;
}

export function isSecureHost(host: string): boolean {
  return (
    host.includes('trycloudflare.com') ||
    host.includes('ngrok') ||
    host.includes('.railway.app') ||
    host.includes('.onrender.com') ||
    host.includes('.fly.dev') ||
    host.includes('https')
  );
}

export function getBackendUrl(): string {
  const host = getServerHost();
  const secure = isSecureHost(host);
  const proto = secure ? 'https' : 'http';

  if (host.includes(':')) {
    return `${proto}://${host}`;
  }
  if (secure) {
    return `${proto}://${host}`;
  }
  return `${proto}://${host}:8000`;
}

export function getWsUrl(): string {
  const host = getServerHost();
  const secure = isSecureHost(host);
  const proto = secure ? 'wss' : 'ws';

  if (host.includes(':')) {
    return `${proto}://${host}/ws`;
  }
  if (secure) {
    return `${proto}://${host}/ws`;
  }
  return `${proto}://${host}:8000/ws`;
}

/** Test if a given host is reachable and return latency in ms, or null if unreachable */
export async function testServerConnection(host: string): Promise<{ ok: boolean; latencyMs: number; statusText: string }> {
  const cleaned = cleanHost(host);
  const secure = isSecureHost(cleaned);
  const proto = secure ? 'https' : 'http';
  const targetUrl = cleaned.includes(':')
    ? `${proto}://${cleaned}/`
    : secure
    ? `${proto}://${cleaned}/`
    : `${proto}://${cleaned}:8000/`;
  const startTime = Date.now();
  try {
    const res = await fetchWithTimeout(targetUrl, {}, 4000);
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      return { ok: true, latencyMs, statusText: `Online (${latencyMs}ms)` };
    }
    return { ok: false, latencyMs, statusText: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, latencyMs: 0, statusText: 'Unreachable / Timeout' };
  }
}

/** Fetch with a strict timeout to prevent hanging UI on mobile */
export async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function getDeviceInfo(): string {
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || '';
      const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
      const browser = ua.includes('Chrome')
        ? 'Chrome'
        : ua.includes('Firefox')
        ? 'Firefox'
        : ua.includes('Safari')
        ? 'Safari'
        : 'Browser';
      return `${isMobile ? 'Mobile' : 'Desktop'} ${browser}`;
    }
    return 'Web Client';
  }
  return `${Platform.OS.toUpperCase()} App`;
}

export async function loadTechnicianId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(KEY);
    if (id) session.technicianId = id;
    return id;
  } catch {
    return null;
  }
}

export async function saveTechnicianId(id: string) {
  session.technicianId = id;
  await AsyncStorage.setItem(KEY, id);
}

/**
 * Non-blocking login recorder: Saves immediately to local state and triggers background audit.
 * Guarantees zero UI freezing.
 */
export async function recordLogin(id: string): Promise<void> {
  session.technicianId = id;
  await AsyncStorage.setItem(KEY, id);

  const now = new Date().toISOString();
  const deviceInfo = getDeviceInfo();

  const newRecord: LoginRecord = {
    technician_id: id,
    logged_in_at: now,
    device_info: deviceInfo,
    status: 'active',
  };

  // 1. Save to local storage synchronously for immediate UI availability
  try {
    const raw = await AsyncStorage.getItem(LOGIN_HISTORY_KEY);
    const list: LoginRecord[] = raw ? JSON.parse(raw) : [];
    list.unshift(newRecord);
    await AsyncStorage.setItem(LOGIN_HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
  } catch (e) {
    console.warn('Failed to save local login history', e);
  }

  // 2. Post to backend asynchronously in background with a 2.5s timeout (NEVER BLOCKING)
  fetchWithTimeout(`${getBackendUrl()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      technician_id: id,
      device_info: deviceInfo,
    }),
  }, 2500).catch(() => {
    // Network offline or slow; local audit log is already recorded
  });
}

/** Requires admin_key — must be called with the admin passcode */
export async function getLoginHistory(adminKey: string): Promise<LoginRecord[]> {
  try {
    const res = await fetchWithTimeout(
      `${getBackendUrl()}/login-history?admin_key=${encodeURIComponent(adminKey)}`,
      {},
      3000
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        await AsyncStorage.setItem(LOGIN_HISTORY_KEY, JSON.stringify(data));
        return data;
      }
    }
  } catch (e) {}

  // Fallback: local storage (only if admin has previously recorded/fetched)
  try {
    const raw = await AsyncStorage.getItem(LOGIN_HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to read local login history', e);
  }

  return [];
}

/** Requires admin_key */
export async function clearLoginHistory(adminKey: string): Promise<void> {
  await AsyncStorage.removeItem(LOGIN_HISTORY_KEY);
  try {
    await fetchWithTimeout(`${getBackendUrl()}/login-history?admin_key=${encodeURIComponent(adminKey)}`, {
      method: 'DELETE',
    }, 2500);
  } catch (e) {}
}

// ── Admin Session ────────────────────────────────────────────────

export async function verifyAdmin(passcode: string): Promise<boolean> {
  const cleaned = (passcode || '').trim();
  if (!cleaned) return false;

  // Immediate instant authorization for default admin key 'admin123'
  if (cleaned === 'admin123') {
    await AsyncStorage.setItem(ADMIN_SESSION_KEY, cleaned);
    // Background audit sync
    fetchWithTimeout(`${getBackendUrl()}/verify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: cleaned }),
    }, 2000).catch(() => {});
    return true;
  }

  // Check remote backend if custom passcode was configured
  try {
    const res = await fetchWithTimeout(`${getBackendUrl()}/verify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: cleaned }),
    }, 3000);
    if (res.ok) {
      const data = await res.json();
      if (data.authorized) {
        await AsyncStorage.setItem(ADMIN_SESSION_KEY, cleaned);
        return true;
      }
    }
  } catch (e) {}
  return false;
}

export async function getAdminKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ADMIN_SESSION_KEY);
  } catch {
    return null;
  }
}

export async function clearAdminSession(): Promise<void> {
  await AsyncStorage.removeItem(ADMIN_SESSION_KEY);
}

// ── Technician ───────────────────────────────────────────────────

export async function clearTechnicianId() {
  session.technicianId = '';
  await AsyncStorage.removeItem(KEY);
}

export default function SessionNull() {
  return null;
}