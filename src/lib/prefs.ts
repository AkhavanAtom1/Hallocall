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
  /** Live captions of your own speech (needs a browser with speech recognition). */
  captions: boolean;
  captionLang: string;
  /** Offer to share the tab/system sound together with the screen. */
  shareAudio: boolean;
  /** Show other people's emoji reactions above their avatars. */
  showReactions: boolean;
  /** Animated emoji (turn off to save data/battery: plain system emoji are used instead). */
  animatedEmoji: boolean;
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
  captions: false,
  captionLang: "fa-IR",
  shareAudio: true,
  showReactions: true,
  animatedEmoji: true,
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
    captions: bool(source.captions, DEFAULT_PREFS.captions),
    captionLang: typeof source.captionLang === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(source.captionLang) ? source.captionLang : DEFAULT_PREFS.captionLang,
    shareAudio: bool(source.shareAudio, DEFAULT_PREFS.shareAudio),
    showReactions: bool(source.showReactions, DEFAULT_PREFS.showReactions),
    animatedEmoji: bool(source.animatedEmoji, DEFAULT_PREFS.animatedEmoji),
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
