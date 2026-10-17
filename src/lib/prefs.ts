/**
 * Per-device preferences (never sent to the server).
 * Everything is validated on load, so a corrupted or older value can never
 * crash the call page.
 */
export type Prefs = {
  /** Skip the pre-join screen and enter the call straight away. */
  skipLobby: boolean;
  joinMuted: boolean;
  micId: string;
  speakerId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  /** Hold Space to talk (works while the call tab is focused). */
  pushToTalk: boolean;
  soundJoinLeave: boolean;
  soundMessage: boolean;
  /** Volume (0..1) you chose for each person, keyed by user id. */
  volumes: Record<string, number>;
};

export const DEFAULT_PREFS: Prefs = {
  skipLobby: false,
  joinMuted: false,
  micId: "",
  speakerId: "",
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: true,
  pushToTalk: false,
  soundJoinLeave: true,
  soundMessage: true,
  volumes: {},
};

const KEY = "hallocall-prefs-v1";

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 300) : "");

export function sanitizePrefs(raw: unknown): Prefs {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const volumes: Record<string, number> = {};
  if (source.volumes && typeof source.volumes === "object") {
    for (const [id, value] of Object.entries(source.volumes as Record<string, unknown>).slice(0, 200)) {
      if (typeof value === "number" && Number.isFinite(value)) volumes[id] = Math.min(1, Math.max(0, value));
    }
  }
  return {
    skipLobby: bool(source.skipLobby, DEFAULT_PREFS.skipLobby),
    joinMuted: bool(source.joinMuted, DEFAULT_PREFS.joinMuted),
    micId: text(source.micId),
    speakerId: text(source.speakerId),
    noiseSuppression: bool(source.noiseSuppression, DEFAULT_PREFS.noiseSuppression),
    echoCancellation: bool(source.echoCancellation, DEFAULT_PREFS.echoCancellation),
    autoGain: bool(source.autoGain, DEFAULT_PREFS.autoGain),
    pushToTalk: bool(source.pushToTalk, DEFAULT_PREFS.pushToTalk),
    soundJoinLeave: bool(source.soundJoinLeave, DEFAULT_PREFS.soundJoinLeave),
    soundMessage: bool(source.soundMessage, DEFAULT_PREFS.soundMessage),
    volumes,
  };
}

export function loadPrefs(): Prefs {
  try {
    const stored = localStorage.getItem(KEY);
    return sanitizePrefs(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_PREFS, volumes: {} };
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota: preferences just will not persist */
  }
}

/** getUserMedia audio constraints built from the preferences. */
export function micConstraints(prefs: Pick<Prefs, "micId" | "noiseSuppression" | "echoCancellation" | "autoGain">, forceDefault = false): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGain,
    channelCount: 1,
  };
  if (prefs.micId && !forceDefault) audio.deviceId = { exact: prefs.micId };
  return { audio, video: false };
}
