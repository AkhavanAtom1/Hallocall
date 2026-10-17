import { useEffect, useRef, useState } from "react";

/**
 * Live channel to the signed-in user's Durable Object (`/ws/user`).
 *
 * The server only sends hints ("friends changed", "someone is calling you");
 * pages react by re-reading the normal API immediately. While the channel is up
 * the old fast polling is replaced by a slow safety-net poll, which cuts the
 * database load by ~10× and makes incoming calls ring instantly — even when the
 * tab is in the background (WebSocket messages are not throttled like timers).
 */
export type UserEventScope = "incoming" | "friends";

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 50_000;

const scopeListeners: Record<UserEventScope, Set<() => void>> = { incoming: new Set(), friends: new Set() };
const statusListeners = new Set<(connected: boolean) => void>();

let users = 0;
let socket: WebSocket | null = null;
let connected = false;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let lastMessageAt = 0;
let attempt = 0;
let detach: (() => void) | null = null;

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const listener of statusListeners) listener(value);
}

function fire(scope: UserEventScope) {
  for (const listener of scopeListeners[scope]) {
    try { listener(); } catch { /* a page's refresh must never break the channel */ }
  }
}

function clearTimers() {
  if (heartbeat !== null) window.clearInterval(heartbeat);
  heartbeat = null;
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function drop(target: WebSocket) {
  if (socket !== target) return;
  socket = null;
  target.onopen = target.onmessage = target.onerror = target.onclose = null;
  try { target.close(); } catch { /* already closed */ }
  if (heartbeat !== null) window.clearInterval(heartbeat);
  heartbeat = null;
  setConnected(false);
  if (users > 0) scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnectTimer !== null || users === 0) return;
  const delay = Math.min(20_000, 1000 * 2 ** Math.min(attempt, 4));
  attempt += 1;
  reconnectTimer = window.setTimeout(() => { reconnectTimer = null; open(); }, delay);
}

function open() {
  if (users === 0 || socket) return;
  let next: WebSocket;
  try {
    next = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/user`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = next;
  next.onopen = () => {
    attempt = 0;
    lastMessageAt = Date.now();
    heartbeat = window.setInterval(() => {
      if (socket !== next) return;
      if (Date.now() - lastMessageAt > HEARTBEAT_TIMEOUT_MS) { drop(next); return; }
      try { if (next.readyState === WebSocket.OPEN) next.send("ping"); } catch { /* the timeout above handles it */ }
    }, HEARTBEAT_MS);
  };
  next.onmessage = (event) => {
    lastMessageAt = Date.now();
    if (event.data === "pong") return;
    let message: { type?: string; event?: string };
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type === "hello") {
      setConnected(true);
      /* Catch up on anything that happened while we were disconnected. */
      fire("incoming");
      fire("friends");
    } else if (message.type === "event" && (message.event === "incoming" || message.event === "friends")) {
      fire(message.event);
    }
  };
  next.onerror = () => drop(next);
  next.onclose = () => drop(next);
}

function reconnectNow() {
  if (users === 0 || socket) return;
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  attempt = 0;
  open();
}

/** Keep the channel open while at least one caller wants it. Returns the release function. */
export function startUserChannel(): () => void {
  users += 1;
  if (users === 1) {
    const onVisible = () => { if (document.visibilityState === "visible") reconnectNow(); };
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", onVisible);
    detach = () => {
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", onVisible);
    };
    open();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0) {
      detach?.();
      detach = null;
      clearTimers();
      const current = socket;
      socket = null;
      if (current) {
        current.onopen = current.onmessage = current.onerror = current.onclose = null;
        try { current.close(1000, "Signed out"); } catch { /* ignore */ }
      }
      setConnected(false);
    }
  };
}

export function onUserEvent(scope: UserEventScope, callback: () => void): () => void {
  scopeListeners[scope].add(callback);
  return () => { scopeListeners[scope].delete(callback); };
}

export function isUserChannelConnected() { return connected; }

export function useUserChannelConnected(): boolean {
  const [value, setValue] = useState(connected);
  useEffect(() => {
    setValue(connected);
    statusListeners.add(setValue);
    return () => { statusListeners.delete(setValue); };
  }, []);
  return value;
}

/**
 * Run `load` now, on every server hint for `scope`, when the tab becomes visible
 * again, and on a timer: fast while the live channel is down, slow while it is up.
 */
export function useLiveRefresh(
  load: () => unknown,
  scope: UserEventScope,
  options: { fastMs?: number; slowMs?: number; enabled?: boolean } = {},
) {
  const { fastMs = 1500, slowMs = 12_000, enabled = true } = options;
  const live = useUserChannelConnected();
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      try { void Promise.resolve(loadRef.current()).catch(() => {}); } catch { /* ignore */ }
    };
    run();
    const timer = window.setInterval(run, live ? slowMs : fastMs);
    const off = onUserEvent(scope, run);
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, scope, enabled, fastMs, slowMs]);
}
