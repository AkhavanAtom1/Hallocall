import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api } from "../lib/api";
import { getIceServers, audioBitrateForQuality } from "../lib/webrtc";
import { CallMesh } from "../lib/mesh";
import type { SignalPayload } from "../lib/mesh";
import { avatarOf } from "../lib/avatars";
import type { CallInfo, Participant, PollView, RoomInfo, User } from "../lib/types";
import { MAX_CALL_PARTICIPANTS } from "../lib/call";
import { BoardStore } from "../lib/board";
import type { Stroke, StrokeFragment } from "../lib/board";
import { listDevices } from "../lib/devices";
import type { DeviceLists } from "../lib/devices";
import { loadPrefs, micConstraints, savePrefs } from "../lib/prefs";
import type { Prefs } from "../lib/prefs";
import { worstLevel, QUALITY_LABELS } from "../lib/quality";
import type { PeerQuality } from "../lib/quality";
import { CallRecorder, recordingFileName, recordingSupported } from "../lib/recorder";
import { playSound } from "../lib/sounds";
import { Captioner, captionsSupported } from "../lib/captions";
import { buildTranscript, transcriptFileName } from "../lib/transcript";
import type { TranscriptEntry } from "../lib/transcript";
import { AppAvatar } from "./AppAvatar";
import { AvatarImage } from "./AvatarImage";
import { CaptionsOverlay, PollCard, PollSheet, TimerChip, TimerSheet } from "./CallExtras";
import type { CaptionLine } from "./CallExtras";
import { GlowButton } from "./GlowButton";
import { Icon } from "./Icon";
import { InviteSheet } from "./InviteSheet";
import { Lobby } from "./Lobby";
import type { JoinChoice } from "./Lobby";
import { PeoplePanel, SignalBars } from "./PeoplePanel";
import { Scene } from "./Scene";
import { SettingsSheet } from "./SettingsSheet";
import { ThemeControls } from "./ThemeControls";
import { Whiteboard } from "./Whiteboard";
import type { ColorThemeId } from "../lib/theme";

const QUICK_EMOJIS = ["😂", "❤️", "👍", "🔥", "🎉", "😮", "👏", "🙌", "💯", "✨", "🥳", "👀"];
const QUALITY_PRESETS = [
  { label: "کم", value: 20, hint: "اینترنت ضعیف" },
  { label: "متعادل", value: 50, hint: "پیشنهادی" },
  { label: "شفاف", value: 85, hint: "مصرف بیشتر" },
] as const;

/** Heartbeat: the browser pings, the Durable Object auto-answers "pong". */
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 40_000;
/** A full re-join (new session id) is a last resort; never do it more often than this. */
const FULL_RESET_COOLDOWN_MS = 45_000;
const MIC_RECOVERY_ATTEMPTS = 5;

type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  text: string;
  createdAt: number;
};

type Reaction = { id: string; emoji: string; x: number };
type ConnectionState = "connecting" | "connected" | "reconnecting";
type Panel = "chat" | "people" | null;
type Popover = "emoji" | "quality" | "more" | null;
type RoomSocketMessage = {
  type?: string;
  participants?: Participant[];
  room?: RoomInfo;
  messages?: ChatMessage[];
  from?: string;
  payload?: SignalPayload;
  message?: ChatMessage;
  emoji?: string;
  by?: string;
  action?: string;
  strokes?: Stroke[];
  id?: string;
  uid?: string;
  tool?: StrokeFragment["tool"];
  color?: string;
  size?: number;
  pts?: number[];
  end?: boolean;
  poll?: PollView | null;
  name?: string;
  text?: string;
  final?: boolean;
  reason?: string;
};

const EMPTY_ROOM: RoomInfo = { hostId: "", locked: false, board: { open: false, drawers: "all" }, shareMode: "all", timer: null };
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}

  try {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    return ok;
  } catch {
    return false;
  }
}

function chatTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function newSessionId() {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (!navigator.mediaDevices?.getUserMedia) return "برای استفاده از میکروفون، صفحه باید با HTTPS باز شود و مرورگر از تماس صوتی پشتیبانی کند.";
  if (name === "NotAllowedError" || name === "SecurityError") return "اجازهٔ میکروفون داده نشد. دسترسی Microphone را در تنظیمات مرورگر فعال و دوباره تلاش کن.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "میکروفونی پیدا نشد. یک ورودی صوتی وصل کن و دوباره امتحان کن.";
  if (name === "NotReadableError" || name === "TrackStartError") return "میکروفون در برنامهٔ دیگری استفاده می‌شود یا فعلاً در دسترس نیست.";
  return "دسترسی به میکروفون ممکن نشد. اتصال و مجوزهای مرورگر را بررسی کن.";
}

function screenShareSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Turns http(s) links in chat text into safe, clickable links (nothing else is interpreted). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!/^https?:\/\//.test(part)) return part;
        const trimmed = part.replace(/[.,!?;:)\]}،؛]+$/u, "");
        const rest = part.slice(trimmed.length);
        return <span key={index}><a href={trimmed} target="_blank" rel="noopener noreferrer" dir="ltr">{trimmed}</a>{rest}</span>;
      })}
    </>
  );
}

/** Self-contained clock so the whole call page does not re-render every second. */
function Elapsed({ since, prefix = "" }: { since: number; prefix?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span dir="ltr">{prefix}{formatClock((now - since) / 1000)}</span>;
}

export function CallPage({
  user, code, go, dark, setDark, colorTheme, onColorThemeChange,
}: {
  user: User;
  code: string;
  go: (path: string) => void;
  dark: boolean;
  setDark: (value: boolean) => void;
  colorTheme: ColorThemeId;
  onColorThemeChange: (theme: ColorThemeId) => void;
}) {
  const [call, setCall] = useState<CallInfo | null>(null);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  const [entered, setEntered] = useState(() => loadPrefs().skipLobby);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [leaving, setLeaving] = useState(false);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [quality, setQuality] = useState(50);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [callNotice, setCallNotice] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo>(EMPTY_ROOM);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [recording, setRecording] = useState<{ since: number } | null>(null);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});
  const [qualityById, setQualityById] = useState<Record<string, PeerQuality>>({});
  const [localMuted, setLocalMuted] = useState<Record<string, boolean>>({});
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], speakers: [] });
  const [enteredAt, setEnteredAt] = useState(0);
  const [poll, setPoll] = useState<PollView | null>(null);
  const [pollHidden, setPollHidden] = useState("");
  const [captionLines, setCaptionLines] = useState<CaptionLine[]>([]);
  const [timerSheet, setTimerSheet] = useState(false);
  const [pollSheet, setPollSheet] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const active = joined && entered;

  const wsRef = useRef<WebSocket | null>(null);
  const meshRef = useRef<CallMesh | null>(null);
  const sidRef = useRef("");
  const participantsRef = useRef<Participant[]>([]);
  const roomRef = useRef<RoomInfo>(EMPTY_ROOM);
  const local = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const sharingRef = useRef(false);
  const handUpRef = useRef(false);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const remoteStreams = useRef(new Map<string, MediaStream>());
  const screenAudioEls = useRef(new Map<string, HTMLAudioElement>());
  const screenAudioStreams = useRef(new Map<string, MediaStream>());
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const recorderRef = useRef<CallRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserCleanup = useRef(new Map<string, () => void>());
  const speakingState = useRef(new Map<string, boolean>());
  const qualityRef = useRef(quality);
  const mutedRef = useRef(false);
  const microphoneReadyRef = useRef(false);
  const localMutedRef = useRef(localMuted);
  const prefsRef = useRef(prefs);
  const panelRef = useRef<Panel>(null);
  const joinChoiceRef = useRef<JoinChoice | null>(null);
  const micApiRef = useRef<{ reacquire: (options?: { attempts?: number; notice?: string | null }) => Promise<boolean> } | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAllowed = useRef(false);
  const copyTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const reactionTimers = useRef(new Set<number>());
  const firstReadyDone = useRef(false);
  const boardStore = useRef(new BoardStore());
  const userRef = useRef(user);
  userRef.current = user;
  microphoneReadyRef.current = microphoneReady;
  localMutedRef.current = localMuted;
  prefsRef.current = prefs;
  panelRef.current = panel;
  roomRef.current = roomInfo;
  handUpRef.current = handUp;

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    savePrefs(next);
    setPrefsState(next);
  }, []);

  const send = useCallback((payload: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  const notify = useCallback((message: string) => {
    setCallNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setCallNotice(""), 5200);
  }, []);

  const cue = useCallback((kind: Parameters<typeof playSound>[0], volume = 0.15) => {
    playSound(kind, volume, prefsRef.current.speakerId || undefined);
  }, []);

  const updateParticipants = useCallback((update: (current: Participant[]) => Participant[]) => {
    setParticipants((current) => {
      const next = update(current);
      if (next !== current) participantsRef.current = next;
      return next;
    });
  }, []);

  /** One AudioContext for the whole call: browsers cap how many can exist, and
   *  one-per-participant silently broke speaking indicators in bigger rooms. */
  const getAudioContext = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state !== "closed") return audioContextRef.current;
    const Ctor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioContextRef.current = new Ctor();
      return audioContextRef.current;
    } catch {
      return null;
    }
  }, []);

  /** Volume, local mute and speaker choice for one remote voice. */
  const tuneAudio = useCallback((id: string, audio: HTMLAudioElement) => {
    audio.volume = Math.min(1, Math.max(0, prefsRef.current.volumes[id] ?? 1));
    audio.muted = !!localMutedRef.current[id];
    const sink = prefsRef.current.speakerId;
    const withSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sink && typeof withSink.setSinkId === "function") void withSink.setSinkId(sink).catch(() => {});
  }, []);

  /** Drop everything that belongs to one remote participant (audio, meter, screen). */
  const cleanupRemote = useCallback((id: string) => {
    const audio = audioEls.current.get(id);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      audioEls.current.delete(id);
    }
    remoteStreams.current.delete(id);
    recorderRef.current?.removeStream(id);
    const screenAudio = screenAudioEls.current.get(id);
    if (screenAudio) {
      screenAudio.pause();
      screenAudio.srcObject = null;
      screenAudio.remove();
      screenAudioEls.current.delete(id);
    }
    screenAudioStreams.current.delete(id);
    recorderRef.current?.removeStream(`screen:${id}`);
    analyserCleanup.current.get(id)?.();
    analyserCleanup.current.delete(id);
    speakingState.current.delete(id);
  }, []);

  /** One caption line per speaker (the newest wins); finished sentences also go to the transcript. */
  const pushCaption = useCallback((uid: string, name: string, text: string, final: boolean, self: boolean) => {
    const at = Date.now();
    setCaptionLines((current) => [...current.filter((line) => line.uid !== uid), { uid, name, text, final, at, self }].slice(-6));
    if (final) {
      transcriptRef.current.push({ at, name, text, kind: "speech" });
      if (transcriptRef.current.length > 3000) transcriptRef.current.splice(0, transcriptRef.current.length - 3000);
    }
  }, []);

  const syncParticipants = useCallback((list: Participant[], silent = false) => {
    const previous = new Map(participantsRef.current.map((participant) => [participant.id, participant]));
    /* Never show the same person twice, whatever the server sends. */
    const unique = new Map<string, Participant>();
    for (const participant of list) {
      if (participant && typeof participant.id === "string") unique.set(participant.id, participant);
    }
    const next = Array.from(unique.values()).map((participant) => {
      const old = previous.get(participant.id);
      return {
        ...participant,
        connected: old?.connected ?? participant.id === userRef.current.id,
        speaking: participant.muted ? false : old?.speaking ?? false,
      };
    });
    for (const participant of next) {
      if (participant.muted) speakingState.current.set(participant.id, false);
    }
    for (const id of Array.from(audioEls.current.keys())) {
      if (!unique.has(id)) cleanupRemote(id);
    }

    if (!silent) {
      const me = userRef.current.id;
      const arrived = next.filter((participant) => participant.id !== me && !previous.has(participant.id));
      const gone = Array.from(previous.keys()).filter((id) => id !== me && !unique.has(id));
      if (prefsRef.current.soundJoinLeave) {
        if (arrived.length) cue("join", 0.13);
        else if (gone.length) cue("leave", 0.13);
      }
      const iAmHost = !!roomRef.current.hostId && roomRef.current.hostId === me;
      for (const participant of next) {
        if (participant.id === me) continue;
        const before = previous.get(participant.id);
        if (iAmHost && (participant.hand ?? 0) > 0 && !(before?.hand ?? 0)) {
          cue("hand", 0.15);
          notify(`${participant.username} دستش را بالا برد ✋`);
        }
        if (participant.rec && !before?.rec) {
          cue("rec", 0.14);
          notify(`${participant.username} شروع به ضبط تماس کرد.`);
        }
      }
    }

    participantsRef.current = next;
    setParticipants(next);
    setRemoteScreens((current) => {
      const stale = Object.keys(current).filter((id) => !unique.has(id));
      if (!stale.length) return current;
      const copy = { ...current };
      for (const id of stale) delete copy[id];
      return copy;
    });
    setQualityById((current) => {
      const stale = Object.keys(current).filter((id) => !unique.has(id));
      if (!stale.length) return current;
      const copy = { ...current };
      for (const id of stale) delete copy[id];
      return copy;
    });
  }, [cleanupRemote, cue, notify]);

  const setupAnalyser = useCallback((stream: MediaStream, id: string, isLocal = false) => {
    analyserCleanup.current.get(id)?.();
    analyserCleanup.current.delete(id);
    try {
      const context = getAudioContext();
      if (!context) return;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      /* Speaking detection only needs ~8 samples a second. A 120 ms timer does
         that without a per-frame loop per participant, which keeps the call
         cheap while the user plays something heavy in another window. */
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const average = data.reduce((total, value) => total + value, 0) / Math.max(data.length, 1);
        const wasSpeaking = speakingState.current.get(id) ?? false;
        const canSpeak = isLocal
          ? !mutedRef.current && !!local.current?.getAudioTracks().some((track) => track.enabled)
          : participantsRef.current.find((participant) => participant.id === id)?.muted !== true;
        const speaking = canSpeak && (wasSpeaking ? average > 9 : average > 15);
        if (speaking !== wasSpeaking) {
          speakingState.current.set(id, speaking);
          updateParticipants((current) => {
            const participant = current.find((entry) => entry.id === id);
            if (!participant || participant.speaking === speaking) return current;
            return current.map((entry) => entry.id === id ? { ...entry, speaking } : entry);
          });
        }
      };

      const timer = window.setInterval(tick, 120);
      if (context.state === "suspended") void context.resume().catch(() => {});
      analyserCleanup.current.set(id, () => {
        window.clearInterval(timer);
        try { source.disconnect(); } catch {}
        try { analyser.disconnect(); } catch {}
      });
    } catch {
      // Speaking animation is optional; audio transport continues without it.
    }
  }, [getAudioContext, updateParticipants]);

  const showReaction = useCallback((emoji: string) => {
    const id = newSessionId();
    setReactions((current) => [...current, { id, emoji, x: 35 + Math.random() * 30 }].slice(-18));
    const timer = window.setTimeout(() => {
      setReactions((current) => current.filter((reaction) => reaction.id !== id));
      reactionTimers.current.delete(timer);
    }, 2200);
    reactionTimers.current.add(timer);
  }, []);

  /** Mute/unmute the microphone and tell everyone. */
  const applyMute = useCallback((muted: boolean) => {
    const track = local.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !muted;
    mutedRef.current = muted;
    speakingState.current.set(userRef.current.id, false);
    updateParticipants((current) => current.map((participant) => participant.id === userRef.current.id
      ? { ...participant, muted, speaking: false }
      : participant));
    send({ type: "mute", muted });
  }, [send, updateParticipants]);

  /** Stops our own screen capture and tells the room. */
  const stopScreenShare = useCallback((announce = true) => {
    const stream = screenRef.current;
    screenRef.current = null;
    meshRef.current?.stopScreen();
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        try { track.stop(); } catch {}
      }
    }
    const wasSharing = sharingRef.current;
    sharingRef.current = false;
    setSharing(false);
    if (announce && wasSharing) send({ type: "screen", active: false });
  }, [send]);

  /** Finish the local recording and (optionally) save the file. */
  const finishRecording = useCallback(async (save: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecording(null);
    send({ type: "rec", on: false });
    try {
      const { blob, mimeType } = await recorder.stop();
      recorder.dispose();
      if (save && blob.size > 0) {
        downloadBlob(blob, recordingFileName(code, new Date(), mimeType));
        notify("ضبط تماس ذخیره شد.");
      }
    } catch {
      recorder.dispose();
    }
  }, [code, notify, send]);

  const endSession = useCallback((message: string) => {
    reconnectAllowed.current = false;
    setError(message);
    void finishRecording(true).finally(() => setJoined(false));
  }, [finishRecording]);

  useEffect(() => {
    let alive = true;
    setCall(null);
    setError("");
    setJoined(false);
    setMessages([]);
    setParticipants([]);
    participantsRef.current = [];

    void (async () => {
      try {
        const result = await api.getCall(code);
        if (!alive) return;
        setCall(result.call);
        await api.join(code);
        if (alive) setJoined(true);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "ورود به کال ممکن نشد.");
      }
    })();

    return () => { alive = false; };
  }, [code]);

  useEffect(() => {
    if (!joined) return;
    let alive = true;
    const poll = async () => {
      try {
        const result = await api.getCall(code);
        if (alive) setCall(result.call);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        if (alive && /دیگر فعال|فعال نیست|پیدا نشد|پایان رسیده/.test(message)) {
          endSession("این تماس به پایان رسیده یا دیگر در دسترس نیست.");
        }
      }
    };
    poll();
    const interval = window.setInterval(poll, 6000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [joined, code, endSession]);

  /* ───────────── the call itself: microphone, signaling socket, WebRTC mesh ───────────── */
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let heartbeat: number | null = null;
    let lastPong = Date.now();
    let lastReset = 0;
    let micBusy = false;
    reconnectAllowed.current = true;
    reconnectAttempt.current = 0;
    firstReadyDone.current = false;
    sidRef.current = newSessionId();
    setEnteredAt(Date.now());

    const mesh = new CallMesh({
      selfId: user.id,
      sid: sidRef.current,
      getIceServers,
      sendSignal: (to, payload) => send({ type: "signal", to, payload }),
      onPeerState: (id, connected) => {
        updateParticipants((current) => {
          const participant = current.find((entry) => entry.id === id);
          if (!participant || participant.connected === connected) return current;
          return current.map((entry) => entry.id === id ? { ...entry, connected } : entry);
        });
      },
      onPeerQuality: (id, peerQuality) => {
        setQualityById((current) => ({ ...current, [id]: peerQuality }));
      },
      onRemoteAudio: (id, stream) => {
        let audio = audioEls.current.get(id);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audio.setAttribute("playsinline", "");
          audio.setAttribute("aria-hidden", "true");
          audio.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none";
          document.body.appendChild(audio);
          audioEls.current.set(id, audio);
        }
        audio.srcObject = stream;
        tuneAudio(id, audio);
        void audio.play().catch(() => setPlaybackBlocked(true));
        remoteStreams.current.set(id, stream);
        recorderRef.current?.addStream(id, stream);
        setupAnalyser(stream, id);
      },
      onRemoteScreen: (id, stream) => {
        setRemoteScreens((current) => {
          if (stream) return current[id] === stream ? current : { ...current, [id]: stream };
          if (!(id in current)) return current;
          const copy = { ...current };
          delete copy[id];
          return copy;
        });
      },
      onRemoteScreenAudio: (id, stream) => {
        const existing = screenAudioEls.current.get(id);
        if (!stream) {
          if (existing) {
            existing.pause();
            existing.srcObject = null;
            existing.remove();
            screenAudioEls.current.delete(id);
          }
          screenAudioStreams.current.delete(id);
          recorderRef.current?.removeStream(`screen:${id}`);
          return;
        }
        let audio = existing;
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audio.setAttribute("playsinline", "");
          audio.setAttribute("aria-hidden", "true");
          audio.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none";
          document.body.appendChild(audio);
          screenAudioEls.current.set(id, audio);
        }
        audio.srcObject = stream;
        tuneAudio(id, audio);
        void audio.play().catch(() => setPlaybackBlocked(true));
        screenAudioStreams.current.set(id, stream);
        recorderRef.current?.addStream(`screen:${id}`, stream);
      },
      onPeerClosed: (id) => {
        cleanupRemote(id);
        setQualityById((current) => {
          if (!(id in current)) return current;
          const copy = { ...current };
          delete copy[id];
          return copy;
        });
      },
      onFatal: () => fullReset(),
    });
    meshRef.current = mesh;
    mesh.setQuality(qualityRef.current);

    const stopHeartbeat = () => {
      if (heartbeat !== null) window.clearInterval(heartbeat);
      heartbeat = null;
    };

    const scheduleReconnect = () => {
      if (disposed || !reconnectAllowed.current || reconnectTimer.current !== null) return;
      const delay = Math.min(15_000, 900 * (2 ** Math.min(reconnectAttempt.current, 4)));
      reconnectAttempt.current += 1;
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        connectSocket();
      }, delay);
    };

    /** The socket is gone (closed, errored or silent): reconnect. Safe to call twice. */
    const dropSocket = (socket: WebSocket) => {
      if (wsRef.current !== socket) return;
      wsRef.current = null;
      stopHeartbeat();
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch {}
      if (disposed || !reconnectAllowed.current) return;
      setConnection("reconnecting");
      scheduleReconnect();
    };

    /** Last resort after repeated media failures: re-join with a fresh session id. */
    function fullReset() {
      if (disposed || !reconnectAllowed.current) return;
      const now = Date.now();
      if (now - lastReset < FULL_RESET_COOLDOWN_MS) return;
      lastReset = now;
      sidRef.current = newSessionId();
      mesh.setSid(sidRef.current);
      mesh.closeAll();
      const socket = wsRef.current;
      if (socket) {
        wsRef.current = null;
        stopHeartbeat();
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(1000, "Reset"); } catch {}
      }
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      setConnection("reconnecting");
      connectSocket();
    }

    const handleSocketMessage = async (event: MessageEvent) => {
      lastPong = Date.now();
      if (event.data === "pong") return;
      let message: RoomSocketMessage;
      try { message = JSON.parse(String(event.data)) as RoomSocketMessage; }
      catch { return; }

      if (message.type === "ready" || message.type === "presence") {
        const list = Array.isArray(message.participants) ? message.participants : [];
        if (message.room) {
          roomRef.current = message.room;
          setRoomInfo(message.room);
        }
        const silent = message.type === "ready" && !firstReadyDone.current;
        syncParticipants(list, silent);
        mesh.syncPeers(list.map((participant) => ({ id: participant.id, sid: participant.sid })));
        if (message.type === "ready") {
          firstReadyDone.current = true;
          if (Array.isArray(message.messages)) setMessages(message.messages.slice(-100));
          /* A reconnect gives us a fresh server-side record: restate our own status. */
          if (mutedRef.current) send({ type: "mute", muted: true });
          if (sharingRef.current) send({ type: "screen", active: true });
          if (handUpRef.current) send({ type: "hand", up: true });
          if (recorderRef.current?.recording) send({ type: "rec", on: true });
        }
        return;
      }

      if (message.type === "signal" && message.from && message.payload) {
        mesh.handleSignal(message.from, message.payload);
        return;
      }

      if (message.type === "replaced") {
        endSession("این حساب روی دستگاه یا تب دیگری وارد همین تماس شد؛ این نشست بسته شد.");
        return;
      }

      if (message.type === "kicked") {
        endSession(message.by ? `${message.by} تو را از این تماس حذف کرد.` : "میزبان تو را از این تماس حذف کرد.");
        return;
      }

      if (message.type === "denied") {
        notify(message.action === "screen" ? "میزبان اشتراک صفحه را فقط برای خودش باز گذاشته است." : "این کار فقط برای میزبان مجاز است.");
        return;
      }

      if (message.type === "screen-stopped") {
        stopScreenShare(false);
        notify("میزبان اشتراک صفحه را فقط برای خودش باز گذاشته است؛ اشتراک تو متوقف شد.");
        return;
      }

      if (message.type === "poll") {
        setPoll(message.poll ?? null);
        return;
      }

      if (message.type === "caption" && message.uid && typeof message.text === "string") {
        /* Only people who turned captions on get to see them. */
        if (prefsRef.current.captions) pushCaption(message.uid, message.name ?? "", message.text, !!message.final, false);
        return;
      }

      if (message.type === "hand-lowered") {
        handUpRef.current = false;
        setHandUp(false);
        notify(message.by ? `${message.by} دستت را پایین آورد.` : "میزبان دستت را پایین آورد.");
        return;
      }

      if (message.type === "mute-request") {
        if (!mutedRef.current) {
          applyMute(true);
          notify(message.by ? `${message.by} میکروفون تو را بی‌صدا کرد. هر وقت خواستی دوباره روشنش کن.` : "میزبان میکروفون تو را بی‌صدا کرد.");
        }
        return;
      }

      if (message.type === "screen-denied") {
        stopScreenShare(false);
        notify(message.by ? `${message.by} همین حالا در حال اشتراک‌گذاری صفحه است؛ هم‌زمان فقط یک نفر می‌تواند صفحه نشان بدهد.` : "هم‌زمان فقط یک نفر می‌تواند صفحه نشان بدهد.");
        return;
      }

      if (message.type === "ended") {
        endSession("میزبان این کال را تمام کرد.");
        wsRef.current?.close(1000, "Call ended");
        return;
      }

      if (message.type === "chat" && message.message) {
        const incoming = message.message;
        setMessages((current) => current.some((item) => item.id === incoming.id)
          ? current
          : [...current, incoming].slice(-100));
        if (incoming.userId !== userRef.current.id) {
          if (panelRef.current !== "chat") setUnread((count) => count + 1);
          if (prefsRef.current.soundMessage) cue("message", 0.1);
        }
        return;
      }

      if (message.type === "reaction" && message.emoji) { showReaction(message.emoji); return; }

      /* ── whiteboard ── */
      if (message.type === "board-sync" && Array.isArray(message.strokes)) { boardStore.current.sync(message.strokes); return; }
      if (message.type === "board-stroke" && message.id && message.uid && Array.isArray(message.pts)) {
        boardStore.current.applyFragment({
          id: message.id, uid: message.uid, tool: message.tool ?? "pen", color: message.color ?? "#111827", size: message.size ?? 4, pts: message.pts, end: !!message.end,
        });
        return;
      }
      if (message.type === "board-remove" && message.id) { boardStore.current.remove(message.id); return; }
      if (message.type === "board-clear") { boardStore.current.clear(); }
    };

    function connectSocket() {
      if (disposed || !reconnectAllowed.current) return;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      let socket: WebSocket;
      try {
        socket = new WebSocket(`${scheme}://${location.host}/ws/call/${encodeURIComponent(code)}?sid=${encodeURIComponent(sidRef.current)}`);
      } catch {
        setConnection("reconnecting");
        scheduleReconnect();
        return;
      }
      wsRef.current = socket;
      socket.onopen = () => {
        if (disposed) { socket.close(); return; }
        reconnectAttempt.current = 0;
        lastPong = Date.now();
        setConnection("connected");
        if (mutedRef.current) send({ type: "mute", muted: true });
        stopHeartbeat();
        heartbeat = window.setInterval(() => {
          if (wsRef.current !== socket) return;
          if (Date.now() - lastPong > HEARTBEAT_TIMEOUT_MS) { dropSocket(socket); return; }
          try { if (socket.readyState === WebSocket.OPEN) socket.send("ping"); } catch {}
        }, HEARTBEAT_INTERVAL_MS);
      };
      socket.onmessage = (event) => { if (wsRef.current === socket) void handleSocketMessage(event); };
      socket.onerror = () => { dropSocket(socket); };
      socket.onclose = () => { dropSocket(socket); };
    }

    const dropSocketNow = (socket: WebSocket) => {
      if (wsRef.current !== socket) return;
      wsRef.current = null;
      stopHeartbeat();
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch {}
    };

    /** Come back immediately when the network or the tab returns. */
    const nudge = () => {
      if (disposed || !reconnectAllowed.current) return;
      const socket = wsRef.current;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      reconnectAttempt.current = 0;
      if (socket) dropSocketNow(socket);
      connectSocket();
    };

    /* ── microphone: acquire, watch for loss, recover, switch devices ── */
    const acquireMicrophone = async () => {
      const current = prefsRef.current;
      try {
        return await navigator.mediaDevices.getUserMedia(micConstraints(current));
      } catch (error) {
        /* A remembered device that was unplugged must not break the call. */
        if (current.micId && error instanceof DOMException && (error.name === "OverconstrainedError" || error.name === "NotFoundError")) {
          updatePrefs({ micId: "" });
          return navigator.mediaDevices.getUserMedia(micConstraints(current, true));
        }
        throw error;
      }
    };

    const watchMicrophone = (stream: MediaStream) => {
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (disposed || local.current !== stream) return;
          setMicrophoneReady(false);
          void reacquire({ attempts: MIC_RECOVERY_ATTEMPTS, notice: "میکروفون دوباره وصل شد." });
        };
      }
    };

    const markSelfMuted = (muted: boolean) => {
      mutedRef.current = muted;
      updateParticipants((current) => current.map((participant) => participant.id === userRef.current.id
        ? { ...participant, muted, speaking: false }
        : participant));
      send({ type: "mute", muted });
    };

    const reacquire = async (options: { attempts?: number; notice?: string | null } = {}) => {
      const attempts = options.attempts ?? 1;
      if (micBusy || disposed) return false;
      micBusy = true;
      try {
        for (let attempt = 0; attempt < attempts && !disposed; attempt++) {
          try {
            const stream = await acquireMicrophone();
            if (disposed) { stream.getTracks().forEach((track) => track.stop()); return false; }
            const track = stream.getAudioTracks()[0];
            if (!track) { stream.getTracks().forEach((item) => item.stop()); continue; }
            const wasListenOnly = !local.current?.getAudioTracks().length;
            if (wasListenOnly) markSelfMuted(prefsRef.current.pushToTalk);
            track.enabled = !mutedRef.current;
            const previous = local.current;
            local.current = stream;
            mesh.setLocalAudio(stream);
            await mesh.replaceAudioTrack(track);
            previous?.getTracks().forEach((old) => { old.onended = null; try { old.stop(); } catch {} });
            setupAnalyser(stream, userRef.current.id, true);
            watchMicrophone(stream);
            recorderRef.current?.addStream("local", stream);
            setMicrophoneReady(true);
            if (options.notice !== null) notify(options.notice ?? "میکروفون وصل شد.");
            void listDevices().then(setDevices);
            return true;
          } catch (cause) {
            if (attempts === 1) { notify(microphoneError(cause)); return false; }
            await sleep(1200 * (attempt + 1));
          }
        }
        if (!disposed) notify("اتصال میکروفون قطع شد و دوباره وصل نشد. میکروفون را بررسی کن و روی دکمهٔ میکروفون بزن.");
        return false;
      } finally {
        micBusy = false;
      }
    };
    micApiRef.current = { reacquire };

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || disposed) return;
      nudge();
      const track = local.current?.getAudioTracks()[0];
      if (track && track.readyState === "ended") { setMicrophoneReady(false); void reacquire({ attempts: MIC_RECOVERY_ATTEMPTS, notice: "میکروفون دوباره وصل شد." }); }
      const context = audioContextRef.current;
      if (context?.state === "suspended") void context.resume().catch(() => {});
    };
    window.addEventListener("online", nudge);
    document.addEventListener("visibilitychange", onVisibility);

    void (async () => {
      const choice = joinChoiceRef.current;
      joinChoiceRef.current = null;
      let stream: MediaStream | null = choice ? choice.stream : null;
      let startMuted = choice ? choice.muted : (prefsRef.current.joinMuted || prefsRef.current.pushToTalk);
      let micProblem = "";
      if (!choice) {
        try {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error("UNSUPPORTED_MEDIA");
          stream = await acquireMicrophone();
        } catch (cause) {
          stream = null;
          micProblem = microphoneError(cause);
        }
      }
      if (disposed) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      if (stream && stream.getAudioTracks().length) {
        local.current = stream;
        mesh.setLocalAudio(stream);
        stream.getAudioTracks().forEach((track) => { track.enabled = !startMuted; });
        mutedRef.current = startMuted;
        setMicrophoneReady(true);
        setupAnalyser(stream, user.id, true);
        watchMicrophone(stream);
        void listDevices().then(setDevices);
      } else {
        /* No microphone: join as a listener (the call still works for everyone). */
        startMuted = true;
        mutedRef.current = true;
        setMicrophoneReady(false);
        void listDevices().then(setDevices);
        if (micProblem) notify(`${micProblem} با حالت «فقط شنونده» وارد شدی؛ بعداً با دکمهٔ میکروفون دوباره امتحان کن.`);
      }
      updateParticipants((current) => current.some((participant) => participant.id === user.id)
        ? current
        : [...current, { id: user.id, username: user.username, avatar: user.avatar, muted: startMuted, speaking: false, connected: true }]);
      connectSocket();
    })();

    const onDeviceChange = () => { void listDevices().then(setDevices); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      disposed = true;
      reconnectAllowed.current = false;
      micApiRef.current = null;
      window.removeEventListener("online", nudge);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      stopHeartbeat();
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        try { socket.close(); } catch {}
      }
      stopScreenShare(false);
      recorderRef.current?.dispose();
      recorderRef.current = null;
      mesh.destroy();
      meshRef.current = null;
      local.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      local.current = null;
      setMicrophoneReady(false);
      setRemoteScreens({});
      setQualityById({});
      for (const id of Array.from(audioEls.current.keys())) cleanupRemote(id);
      remoteStreams.current.clear();
      for (const cleanup of analyserCleanup.current.values()) cleanup();
      analyserCleanup.current.clear();
      speakingState.current.clear();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") void context.close().catch(() => {});
      reactionTimers.current.forEach((timer) => window.clearTimeout(timer));
      reactionTimers.current.clear();
    };
    // The call must only restart when the room or the account changes. Everything
    // else is read through refs so a re-render can never tear a live call down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, code, user.id]);

  /* ───────────── small effects ───────────── */

  /* Chat pinned to the newest message unless the reader scrolled up. */
  useEffect(() => {
    const list = chatListRef.current;
    if (panel !== "chat" || !list) return;
    const last = messages[messages.length - 1];
    if (stickToBottom.current || last?.userId === user.id) list.scrollTop = list.scrollHeight;
  }, [messages, panel, user.id]);

  useEffect(() => {
    if (panel === "chat") {
      stickToBottom.current = true;
      setUnread(0);
      const list = chatListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    }
  }, [panel]);

  /* The host can open the shared board for everybody. */
  const boardSharedOpen = roomInfo.board.open;
  useEffect(() => { if (active) setBoardOpen(boardSharedOpen); }, [boardSharedOpen, active]);

  /* Per-person volume, local mute and speaker choice apply to live audio. */
  useEffect(() => {
    for (const [id, audio] of audioEls.current) tuneAudio(id, audio);
    for (const [id, audio] of screenAudioEls.current) tuneAudio(id, audio);
  }, [prefs.volumes, prefs.speakerId, localMuted, tuneAudio]);

  /* Push-to-talk: switching it on closes the mic until Space is held; switching it
     off opens it again. (Joining muted is decided at join time, not here.) */
  const lastPushToTalk = useRef(prefs.pushToTalk);
  useEffect(() => {
    if (!active || !microphoneReady) return;
    if (lastPushToTalk.current === prefs.pushToTalk) return;
    lastPushToTalk.current = prefs.pushToTalk;
    applyMute(prefs.pushToTalk);
  }, [prefs.pushToTalk, microphoneReady, active, applyMute]);

  useEffect(() => {
    if (!active) return;
    const previous = document.title;
    return () => { document.title = previous; };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    document.title = `${unread ? `(${unread}) ` : ""}🎙 ${call?.name ?? "HalloCall"}`;
  }, [active, unread, call?.name]);

  /* Keep the screen awake during a call (phones dim and lock otherwise). */
  useEffect(() => {
    if (!active) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let stopped = false;
    const request = async () => {
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wakeLock || document.visibilityState !== "visible" || stopped) return;
        sentinel = await wakeLock.request("screen");
      } catch { /* not allowed (battery saver, etc.) */ }
    };
    void request();
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);

  const sharerNow = participants.find((participant) => participant.sharing);
  const someoneElseSharing = !!sharerNow && sharerNow.id !== user.id;
  const captionsOn = prefs.captions;
  const iAmMuted = !!participants.find((participant) => participant.id === user.id)?.muted;
  const hostId = roomInfo.hostId || call?.hostId || "";
  const isHost = !!hostId && hostId === user.id;
  const shareBlocked = roomInfo.shareMode === "host" && !isHost;
  const recorders = participants.filter((participant) => participant.rec);
  const peerLevels = participants.filter((participant) => participant.id !== user.id).map((participant) => qualityById[participant.id]?.level ?? (participant.connected === false ? 0 : 3));
  const networkLevel = worstLevel(peerLevels as Array<0 | 1 | 2 | 3>);

  /* Live captions: recognise my own speech while captions are on, my mic is open and the browser can do it. */
  useEffect(() => {
    if (!active || !captionsOn || !captionsSupported() || !microphoneReady || iAmMuted) return;
    let lastSent = 0;
    let pending: string | null = null;
    let timer: number | null = null;
    const flushInterim = () => {
      timer = null;
      if (pending) { send({ type: "caption", text: pending, final: false }); lastSent = Date.now(); pending = null; }
    };
    const captioner = new Captioner(
      prefs.captionLang,
      (text, final) => {
        pushCaption(userRef.current.id, userRef.current.username, text, final, true);
        if (final) {
          if (timer !== null) { window.clearTimeout(timer); timer = null; }
          pending = null;
          send({ type: "caption", text, final: true });
          return;
        }
        pending = text;
        const wait = 400 - (Date.now() - lastSent);
        if (wait <= 0) flushInterim();
        else if (timer === null) timer = window.setTimeout(flushInterim, wait);
      },
      (state) => {
        if (state === "blocked") {
          notify("اجازهٔ تشخیص گفتار داده نشد؛ زیرنویس زنده خاموش شد.");
          updatePrefs({ captions: false });
        }
      },
    );
    captioner.start();
    return () => {
      captioner.stop();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, captionsOn, prefs.captionLang, microphoneReady, iAmMuted, send, pushCaption, notify, updatePrefs]);

  const noticedNoRecognition = useRef(false);
  useEffect(() => {
    if (!active || !captionsOn || captionsSupported() || noticedNoRecognition.current) return;
    noticedNoRecognition.current = true;
    notify("این مرورگر نمی‌تواند گفتار تو را به متن تبدیل کند؛ فقط زیرنویس دیگران را می‌بینی. برای زیرنویس گفتار خودت Chrome یا Edge را امتحان کن.");
  }, [active, captionsOn, notify]);

  /* Old caption lines disappear on their own. */
  useEffect(() => {
    if (!captionLines.length) return;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 9000;
      setCaptionLines((current) => {
        const next = current.filter((line) => line.at > cutoff);
        return next.length === current.length ? current : next;
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [captionLines.length]);

  /* Turning captions off clears what is on screen. */
  useEffect(() => { if (!captionsOn) setCaptionLines([]); }, [captionsOn]);

  /* ───────────── actions ───────────── */

  const toggleMute = () => {
    if (!local.current?.getAudioTracks().length) {
      void micApiRef.current?.reacquire({ attempts: 1, notice: "میکروفون وصل شد؛ حالا می‌توانی صحبت کنی." });
      return;
    }
    applyMute(!mutedRef.current);
  };

  const toggleHand = () => {
    const next = !handUpRef.current;
    handUpRef.current = next;
    setHandUp(next);
    send({ type: "hand", up: next });
  };

  const startScreenShare = async () => {
    if (sharingRef.current) return;
    if (!screenShareSupported()) {
      notify("مرورگر این دستگاه اشتراک‌گذاری صفحه را پشتیبانی نمی‌کند. روی لپ‌تاپ یا کامپیوتر (Chrome، Edge، Firefox یا Safari) امتحان کن؛ در بیشتر مرورگرهای موبایل این قابلیت وجود ندارد.");
      return;
    }
    if (shareBlocked) {
      notify("میزبان اشتراک صفحه را فقط برای خودش باز گذاشته است.");
      return;
    }
    if (someoneElseSharing) {
      notify(`${sharerNow?.username ?? "یک نفر"} همین حالا صفحه‌اش را نشان می‌دهد؛ هم‌زمان فقط یک نفر می‌تواند.`);
      return;
    }
    if (!meshRef.current || connection !== "connected") {
      notify("اتصال به تماس هنوز برقرار نیست؛ چند ثانیه بعد دوباره امتحان کن.");
      return;
    }
    let stream: MediaStream;
    const wantAudio = prefsRef.current.shareAudio;
    const video = { frameRate: { ideal: 15, max: 30 } };
    try {
      try {
        /* Ask for the tab/system sound too; the picker shows a "share audio" checkbox where the browser supports it. */
        stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: wantAudio ? ({ suppressLocalAudioPlayback: true } as MediaTrackConstraints) : false });
      } catch (cause) {
        if (wantAudio && cause instanceof TypeError) stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
        else throw cause;
      }
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") notify("شروع اشتراک‌گذاری صفحه ممکن نشد. دوباره امتحان کن.");
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track || !meshRef.current) {
      stream.getTracks().forEach((item) => item.stop());
      return;
    }
    try { (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail"; } catch {}
    /* The browser's own "Stop sharing" bar ends the track. */
    track.onended = () => stopScreenShare(true);
    screenRef.current = stream;
    sharingRef.current = true;
    setSharing(true);
    meshRef.current.startScreen(stream);
    if (stream.getAudioTracks().length) notify("صدای تب یا سیستم هم برای بقیه پخش می‌شود. اگر نمی‌خواهی، اشتراک را متوقف کن و بدون تیک «Share audio» دوباره شروع کن.");
    if (!send({ type: "screen", active: true })) {
      stopScreenShare(false);
      notify("اتصال قطع شد؛ اشتراک‌گذاری صفحه شروع نشد.");
    }
  };

  const toggleScreenShare = () => {
    if (sharingRef.current) stopScreenShare(true);
    else void startScreenShare();
  };

  const toggleShareMode = () => { send({ type: "share-mode", mode: roomInfo.shareMode === "host" ? "all" : "host" }); };

  const toggleCaptions = () => {
    const next = !prefsRef.current.captions;
    updatePrefs({ captions: next });
    if (next && !captionsSupported()) return; // the effect explains it
    notify(next ? "زیرنویس زنده روشن شد." : "زیرنویس زنده خاموش شد.");
  };

  const startTimer = (seconds: number, label: string) => { send({ type: "timer-start", seconds, label }); };
  const stopTimer = () => { send({ type: "timer-stop" }); };
  const createPoll = (question: string, options: string[]) => { send({ type: "poll-create", question, options }); };
  const votePoll = (option: number) => { if (poll) send({ type: "poll-vote", id: poll.id, option }); };

  const saveTranscript = () => {
    const entries: TranscriptEntry[] = [
      ...transcriptRef.current,
      ...messages.map((message) => ({ at: message.createdAt, name: message.userId === user.id ? user.username : message.username, text: message.text, kind: "chat" as const })),
    ];
    const text = buildTranscript({ callName: call?.name ?? "Call", code, entries });
    downloadBlob(new Blob(["\ufeff", text], { type: "text/plain;charset=utf-8" }), transcriptFileName(code, new Date()));
    notify(entries.length ? "گفتگو ذخیره شد." : "هنوز چیزی برای ذخیره نیست؛ فایل خالی ذخیره شد.");
  };

  const toggleRecording = async () => {
    if (recorderRef.current?.recording) {
      await finishRecording(true);
      return;
    }
    if (!recordingSupported()) {
      notify("مرورگر این دستگاه ضبط را پشتیبانی نمی‌کند.");
      return;
    }
    if (!window.confirm("همهٔ حاضران از شروع ضبط باخبر می‌شوند. فایل ضبط فقط روی دستگاه خودت ذخیره می‌شود. ادامه می‌دهی؟")) return;
    const context = getAudioContext();
    if (!context) {
      notify("ضبط روی این مرورگر ممکن نشد.");
      return;
    }
    try {
      if (context.state === "suspended") await context.resume().catch(() => {});
      const recorder = new CallRecorder(context);
      if (local.current) recorder.addStream("local", local.current);
      for (const [id, stream] of remoteStreams.current) recorder.addStream(id, stream);
      for (const [id, stream] of screenAudioStreams.current) recorder.addStream(`screen:${id}`, stream);
      recorder.start();
      recorderRef.current = recorder;
      setRecording({ since: Date.now() });
      send({ type: "rec", on: true });
      cue("rec", 0.14);
    } catch {
      notify("شروع ضبط ممکن نشد.");
    }
  };

  const changeMicrophone = (deviceId: string) => {
    updatePrefs({ micId: deviceId });
    void micApiRef.current?.reacquire({ attempts: 1, notice: "میکروفون عوض شد." });
  };

  const changeProcessing = (patch: Partial<Prefs>) => {
    updatePrefs(patch);
    if (microphoneReadyRef.current) void micApiRef.current?.reacquire({ attempts: 1, notice: null });
  };

  const changeQuality = (value: number) => {
    const next = Math.min(100, Math.max(0, value));
    qualityRef.current = next;
    setQuality(next);
    meshRef.current?.setQuality(next);
  };

  const enablePlayback = async () => {
    let failed = false;
    const context = audioContextRef.current;
    if (context?.state === "suspended") await context.resume().catch(() => {});
    await Promise.all([...Array.from(audioEls.current.entries()), ...Array.from(screenAudioEls.current.entries())].map(async ([id, audio]) => {
      audio.muted = !!localMutedRef.current[id];
      try { await audio.play(); } catch { failed = true; }
    }));
    setPlaybackBlocked(failed);
  };

  const setVolume = (id: string, value: number) => updatePrefs({ volumes: { ...prefsRef.current.volumes, [id]: value } });
  const toggleLocalMute = (id: string) => setLocalMuted((current) => ({ ...current, [id]: !current[id] }));

  const muteAll = () => { if (send({ type: "mute-request", all: true })) notify("از همه خواسته شد میکروفونشان را ببندند."); };
  const muteRequest = (id: string) => { send({ type: "mute-request", to: id }); };
  const lowerHand = (id: string) => { send({ type: "hand-lower", to: id }); };
  const kick = (id: string) => { send({ type: "kick", to: id }); };
  const toggleLock = () => { send({ type: "lock", locked: !roomInfo.locked }); };
  const transferHost = (id: string) => {
    api.transferHost(code, id)
      .then(() => notify("میزبانی واگذار شد."))
      .catch((cause) => notify(cause instanceof Error ? cause.message : "واگذاری میزبانی ممکن نشد."));
  };

  const sendBoardFragment = useCallback((fragment: StrokeFragment) => {
    send({ type: "board-stroke", id: fragment.id, tool: fragment.tool, color: fragment.color, size: fragment.size, pts: fragment.pts, end: !!fragment.end });
  }, [send]);

  const leave = async (options: { transfer?: boolean } = {}) => {
    if (leaving) return;
    setLeaving(true);
    setLeaveDialog(false);
    reconnectAllowed.current = false;
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    stopScreenShare(true);
    await finishRecording(true);
    try { await api.leave(code, !!options.transfer); } catch {}
    local.current?.getTracks().forEach((track) => track.stop());
    wsRef.current?.close(1000, "Left call");
    go("/calls");
  };

  const requestLeave = () => {
    if (isHost && participants.length > 1) setLeaveDialog(true);
    else void leave();
  };

  const sendChat = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!send({ type: "chat", text: text.slice(0, 500) })) {
      setChatNotice("پیام ارسال نشد؛ اتصال در حال بازگشت است.");
      return;
    }
    setDraft("");
    setChatNotice("");
  };

  const react = (emoji: string) => { send({ type: "reaction", emoji }); };

  /* Latest handlers for the long-lived keyboard / media-session listeners. */
  const actions = useRef({ toggleMute, toggleHand, toggleScreenShare, requestLeave, applyMute });
  actions.current = { toggleMute, toggleHand, toggleScreenShare, requestLeave, applyMute };

  useEffect(() => {
    if (!active) return;
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.code === "Space" && prefsRef.current.pushToTalk && microphoneReadyRef.current) {
        event.preventDefault();
        if (!event.repeat && mutedRef.current) actions.current.applyMute(false);
        return;
      }
      if (event.repeat) return;
      switch (event.code) {
        case "KeyM": actions.current.toggleMute(); break;
        case "KeyH": actions.current.toggleHand(); break;
        case "KeyS": actions.current.toggleScreenShare(); break;
        case "KeyC": setPanel((current) => current === "chat" ? null : "chat"); setPopover(null); break;
        case "KeyP": setPanel((current) => current === "people" ? null : "people"); setPopover(null); break;
        case "KeyB": setBoardOpen((current) => !current); break;
        default: break;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && prefsRef.current.pushToTalk && microphoneReadyRef.current && !typing(event.target)) {
        event.preventDefault();
        if (!mutedRef.current) actions.current.applyMute(true);
      }
    };
    /* Losing focus while Space is held must not leave the microphone open. */
    const onBlur = () => { if (prefsRef.current.pushToTalk && microphoneReadyRef.current && !mutedRef.current) actions.current.applyMute(true); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active]);

  /* Headset / OS media keys (Chrome): mute toggle and hang-up. */
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({ title: call?.name ?? "HalloCall", artist: "HalloCall" });
    } catch {}
    const handlers: Array<[string, () => void]> = [
      ["togglemicrophone", () => actions.current.toggleMute()],
      ["hangup", () => actions.current.requestLeave()],
    ];
    for (const [action, handler] of handlers) {
      try { session.setActionHandler(action as MediaSessionAction, handler); } catch { /* unsupported action */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { session.setActionHandler(action as MediaSessionAction, null); } catch {}
      }
    };
  }, [active, call?.name]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPopover(null);
      setPanel(null);
      setSettingsOpen(false);
      setLeaveDialog(false);
      setTimerSheet(false);
      setPollSheet(false);
      setInviteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  const showCopyNotice = (message: string) => {
    setCopyNotice(message);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyNotice(""), 2600);
  };

  /** Direct invite URL: anyone opening it (after login) lands in this exact call. */
  const inviteLink = `${location.origin}/call/${encodeURIComponent(code)}`;

  const copyCode = async () => {
    const copied = await copyText(code);
    showCopyNotice(copied ? "کد ورود کپی شد" : `کد ورود: ${code}`);
  };

  const copyInviteLink = async () => {
    const copied = await copyText(inviteLink);
    showCopyNotice(copied ? "لینک مستقیم کپی شد — هرکس بازش کند وارد همین تماس می‌شود" : inviteLink);
  };

  const me = participants.find((participant) => participant.id === user.id);
  const qualityBitrate = Math.round(audioBitrateForQuality(quality) / 1000);
  const qualityLabel = quality < 34 ? "مصرف کم · مناسب اینترنت ضعیف" : quality < 72 ? "متعادل · پیشنهاد برای بیشتر تماس‌ها" : "حداکثر شفافیت · مصرف بیشتر";
  const viewedScreen = sharerNow && sharerNow.id !== user.id ? remoteScreens[sharerNow.id] : undefined;
  const handOrder = new Map(participants.filter((participant) => (participant.hand ?? 0) > 0).sort((a, b) => (a.hand ?? 0) - (b.hand ?? 0)).map((participant, index) => [participant.id, index + 1]));
  const raisedCount = handOrder.size;
  const micLabel = !microphoneReady ? "فعال‌سازی میکروفون" : me?.muted ? (prefs.pushToTalk ? "نگه‌دار Space" : "روشن‌کردن میکروفون") : "بی‌صدا کردن";

  if (error) return (
    <main className="app-bg call-error">
      <Scene variant="call" />
      <div className="error-card glass" role="alert">
        <AppAvatar size={54} />
        <h2>ورود به کال ممکن نشد</h2>
        <p>{error}</p>
        <GlowButton tone="primary" icon="arrow" onClick={() => go("/calls")}>بازگشت به کال‌ها</GlowButton>
      </div>
    </main>
  );

  if (joined && !entered) return (
    <Lobby
      call={call}
      code={code}
      user={user}
      prefs={prefs}
      onPrefs={updatePrefs}
      onCancel={() => go("/calls")}
      onJoin={(choice) => { joinChoiceRef.current = choice; setEntered(true); }}
    />
  );

  return (
    <main className="app-bg call-page">
      <Scene variant="call" />
      <header className="call-header">
        <div className="call-header-left">
          <div className="call-brand">
            <AppAvatar size={38} className="brand-avatar" />
            <div><b>{call?.name ?? "Friend Call"}</b><span dir="ltr">#{code}</span></div>
          </div>
          <button className="call-code-chip" onClick={copyCode} title="کپی کد ورود">
            <span>کد ورود</span><strong dir="ltr">{code}</strong><Icon name={copyNotice ? "check" : "copy"} size={15} />
          </button>
          {copyNotice && <span className="share-feedback" role="status">{copyNotice}</span>}
        </div>
        <div className="call-center-status" aria-live="polite">
          <span className={connection === "connected" ? "live-dot" : "live-dot warn"} />
          {connection === "connected" ? "سیگنالینگ متصل" : connection === "connecting" ? "در حال اتصال…" : "تلاش برای اتصال دوباره…"}
          <small>•</small><span className="mic-status"><Icon name={microphoneReady ? "mic" : "micOff"} size={12}/>{microphoneReady ? "میکروفون آماده" : "فقط شنونده"}</span>
          <small>•</small><span>{participants.length} نفر</span>
          {enteredAt > 0 && <><small>•</small><Elapsed since={enteredAt} /></>}
          {networkLevel !== null && participants.length > 1 && <><small>•</small><span className="net-pill" title={`کیفیت اتصال: ${QUALITY_LABELS[networkLevel]}`}><SignalBars level={networkLevel} /></span></>}
        </div>
        <div className="call-head-actions">
          {roomInfo.timer && <TimerChip timer={roomInfo.timer} onFinish={() => cue("timer", 0.2)} />}
          {roomInfo.locked && <span className="lock-chip" title="ورود تازه‌واردها بسته است"><Icon name="lock" size={13} /> قفل</span>}
          {recording && <span className="rec-chip" title="در حال ضبط روی دستگاه تو"><i /> ضبط <Elapsed since={recording.since} /></span>}
          <ThemeControls colorTheme={colorTheme} onColorThemeChange={onColorThemeChange} dark={dark} setDark={setDark} compact/>
          <button className="leave-top" onClick={requestLeave} disabled={leaving}><Icon name="phoneOff" size={16} /> {leaving ? "در حال خروج…" : "خروج"}</button>
        </div>
      </header>

      {recorders.filter((participant) => participant.id !== user.id).length > 0 && (
        <div className="rec-banner" role="status">
          <i /> {recorders.filter((participant) => participant.id !== user.id).map((participant) => participant.username).join("، ")} در حال ضبط این تماس {recorders.filter((participant) => participant.id !== user.id).length > 1 ? "هستند" : "است"}.
        </div>
      )}

      {poll && pollHidden !== poll.id && (
        <PollCard
          poll={poll}
          isHost={isHost}
          onVote={votePoll}
          onClose={() => send({ type: "poll-close" })}
          onDismiss={() => send({ type: "poll-dismiss" })}
          onHide={() => setPollHidden(poll.id)}
        />
      )}

      <div className="invite-bar glass" role="region" aria-label="لینک مستقیم ورود به تماس">
        <span className="invite-link-icon" aria-hidden="true"><Icon name="link" size={16} /></span>
        <div className="invite-link-copy">
          <b>لینک مستقیم ورود به این تماس</b>
          <small>این لینک را کپی کن و به هر کسی بده؛ با کلیک روی آن مستقیم وارد همین تماس می‌شود.</small>
        </div>
        <input
          className="invite-link-input"
          readOnly
          value={inviteLink}
          dir="ltr"
          aria-label="لینک مستقیم ورود به تماس"
          onFocus={(event) => event.target.select()}
          onClick={(event) => event.currentTarget.select()}
        />
        <button className="invite-link-btn" onClick={copyInviteLink} title="کپی لینک مستقیم">
          <Icon name={copyNotice ? "check" : "copy"} size={15} /> کپی لینک
        </button>
      </div>

      <section className={sharerNow ? "call-stage has-screen" : "call-stage"} aria-label="شرکت‌کنندگان تماس">
        {sharerNow && (
          sharerNow.id === user.id
            ? (
              <div className="screen-banner glass" role="status">
                <span className="screen-banner-dot" aria-hidden="true" />
                <div><b>صفحهٔ شما برای بقیه نمایش داده می‌شود</b><small>برای توقف، دکمهٔ «توقف اشتراک» را بزن یا از نوار مرورگر استفاده کن.</small></div>
                <button type="button" className="screen-banner-stop" onClick={() => stopScreenShare(true)}><Icon name="screenOff" size={16} /> توقف اشتراک</button>
              </div>
            )
            : <ScreenView stream={viewedScreen} sharer={sharerNow.username} />
        )}
        <div className={`participant-stage count-${Math.min(participants.length, MAX_CALL_PARTICIPANTS)}`}>
          {participants.map((participant) => (
            <ParticipantTile
              key={participant.id}
              participant={participant}
              self={participant.id === user.id}
              hostId={hostId}
              handOrder={handOrder.get(participant.id)}
              level={participant.id === user.id ? undefined : qualityById[participant.id]?.level}
              locallyMuted={!!localMuted[participant.id]}
            />
          ))}
        </div>
        {reactions.map((reaction) => <span key={reaction.id} className="reaction-float" style={{ left: `${reaction.x}%` }} aria-hidden="true">{reaction.emoji}</span>)}
        {!participants.length && <div className="joining" role="status"><span className="spinner" /><p>در حال ورود به کال و آماده‌سازی میکروفون…</p></div>}
        {playbackBlocked && <button className="audio-unlock glass" onClick={enablePlayback}><Icon name="volume" size={17} /> فعال‌کردن صدای دریافتی</button>}
        {callNotice && <div className="call-notice glass" role="status" aria-live="polite"><Icon name="info" size={16} /><span>{callNotice}</span></div>}
        {captionsOn && <CaptionsOverlay lines={captionLines} />}
      </section>

      <div className="call-toolbar-wrap">
        <div className="call-toolbar glass" role="toolbar" aria-label="کنترل‌های تماس">
          {popover === "quality" && (
            <div className="popover quality-pop" role="region" aria-labelledby="quality-title">
              <div className="popover-head">
                <div><b id="quality-title">تنظیم کیفیت صدای خروجی</b><span>{qualityLabel}</span></div>
                <div className="quality-value"><strong className="quality-number">{qualityBitrate}</strong><small>kbps</small></div>
              </div>
              <div className="quality-presets" aria-label="تنظیمات آماده کیفیت صدا">
                {QUALITY_PRESETS.map((preset) => <button key={preset.value} type="button" className={quality === preset.value ? "quality-preset active" : "quality-preset"} aria-pressed={quality === preset.value} onClick={() => changeQuality(preset.value)}><b>{preset.label}</b><small>{preset.hint}</small></button>)}
              </div>
              <label className="quality-slider"><span>سقف بیت‌ریت ارسال</span><strong>{qualityBitrate} kbps</strong><input type="range" min="0" max="100" step="1" value={quality} aria-label="کیفیت صدای ارسالی" aria-valuetext={`${qualityBitrate} کیلوبیت بر ثانیه`} onChange={(event) => changeQuality(Number(event.target.value))} /></label>
              <div className="range-labels"><span>۱۲ kbps</span><span>۹۶ kbps</span></div>
              <p className="quality-help">این مقدار سقف بیت‌ریت صدای ارسالی شماست؛ کیفیت واقعی با توجه به شبکه و پشتیبانی مرورگر تغییر می‌کند.</p>
            </div>
          )}
          {popover === "emoji" && <div className="popover emoji-pop" role="group" aria-label="واکنش‌های سریع">{QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" aria-label={`ارسال واکنش ${emoji}`} onClick={() => { react(emoji); setPopover(null); }}>{emoji}</button>)}</div>}
          {popover === "more" && (
            <div className="popover more-pop" role="menu" aria-label="گزینه‌های بیشتر">
              <button type="button" role="menuitem" onClick={() => setPopover("emoji")}><Icon name="smile" size={18} /><span>واکنش‌ها</span></button>
              <button type="button" role="menuitem" onClick={() => { setBoardOpen((current) => !current); setPopover(null); }}><Icon name="board" size={18} /><span>{boardOpen ? "بستن تخته" : "تخته سفید"}</span></button>
              <button type="button" role="menuitem" className={recording ? "on rec" : ""} onClick={() => { setPopover(null); void toggleRecording(); }}><Icon name="record" size={18} /><span>{recording ? "توقف ضبط" : "ضبط تماس"}</span></button>
              <button type="button" role="menuitem" onClick={() => setPopover("quality")}><Icon name="signal" size={18} /><span>کیفیت صدا</span></button>
              <button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setPopover(null); }}><Icon name="settings" size={18} /><span>تنظیمات</span></button>
              <button type="button" role="menuitem" className={captionsOn ? "on" : ""} onClick={() => { setPopover(null); toggleCaptions(); }}><Icon name="captions" size={18} /><span>{captionsOn ? "خاموش‌کردن زیرنویس" : "زیرنویس زنده"}</span></button>
              {isHost && <button type="button" role="menuitem" onClick={() => { setPopover(null); setTimerSheet(true); }}><Icon name="clock" size={18} /><span>تایمر</span></button>}
              {(isHost || poll) && <button type="button" role="menuitem" onClick={() => { setPopover(null); if (isHost) setPollSheet(true); else setPollHidden(""); }}><Icon name="poll" size={18} /><span>{isHost ? "نظرسنجی" : "نمایش نظرسنجی"}</span></button>}
              <button type="button" role="menuitem" onClick={() => { setPopover(null); setInviteOpen(true); }}><Icon name="userPlus" size={18} /><span>دعوت دوستان</span></button>
              <button type="button" role="menuitem" onClick={() => { setPopover(null); saveTranscript(); }}><Icon name="fileText" size={18} /><span>ذخیرهٔ گفتگو</span></button>
              <button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setPopover(null); }}><Icon name="keyboard" size={18} /><span>میانبرها</span></button>
            </div>
          )}
          <ToolButton label={micLabel} danger={!!me?.muted && microphoneReady} active={microphoneReady && !me?.muted} onClick={toggleMute} icon={microphoneReady && !me?.muted ? "mic" : "micOff"} />
          <ToolButton label={handUp ? "پایین آوردن دست" : "بالا بردن دست"} active={handUp} aria-pressed={handUp} onClick={toggleHand} icon="hand" badge={isHost && raisedCount ? raisedCount : undefined} />
          <ToolButton label={sharing ? "توقف اشتراک" : shareBlocked ? "فقط میزبان" : "اشتراک صفحه"} active={sharing} disabled={(someoneElseSharing || shareBlocked) && !sharing} onClick={toggleScreenShare} icon={sharing ? "screenOff" : "screen"} />
          <ToolButton label="گفت‌وگو" active={panel === "chat"} aria-expanded={panel === "chat"} onClick={() => { setPanel(panel === "chat" ? null : "chat"); setPopover(null); }} icon="message" badge={unread || undefined} />
          <ToolButton label="افراد" active={panel === "people"} aria-expanded={panel === "people"} onClick={() => { setPanel(panel === "people" ? null : "people"); setPopover(null); }} icon="users" badge={participants.length > 1 ? participants.length : undefined} quiet />
          <ToolButton label="بیشتر" active={popover === "more" || popover === "emoji" || popover === "quality" || boardOpen || !!recording} aria-expanded={popover === "more"} onClick={() => setPopover(popover ? null : "more")} icon="more" />
          <div className="toolbar-divider" />
          <button className="leave-btn" onClick={requestLeave} disabled={leaving} title="خروج از تماس" aria-label="خروج از تماس"><Icon name="phoneOff" /></button>
        </div>
      </div>

      {panel === "chat" && (
        <aside className="chat-drawer glass" aria-labelledby="call-chat-title">
          <div className="chat-head">
            <div><b id="call-chat-title">گفت‌وگوی این تماس</b><span>{messages.length} پیام · پیام‌ها برای همین اتاق ذخیره می‌شوند</span></div>
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="بستن گفت‌وگو"><Icon name="x" /></button>
          </div>
          <div
            ref={chatListRef}
            className="chat-list"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="پیام‌های تماس"
            onScroll={(event) => {
              const list = event.currentTarget;
              stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
            }}
          >
            {messages.map((message) => (
              <div key={message.id} className={message.userId === user.id ? "chat-msg mine" : "chat-msg"}>
                <div className="chat-avatar" style={{ background: avatarOf(message.avatar).gradient }}><AvatarImage avatar={message.avatar} /></div>
                <div className="chat-message-content">
                  <div className="chat-message-meta"><span>{message.userId === user.id ? "شما" : message.username}</span><time dateTime={new Date(message.createdAt).toISOString()}>{chatTime(message.createdAt)}</time></div>
                  <p><Linkified text={message.text} /></p>
                </div>
              </div>
            ))}
            {!messages.length && <div className="chat-empty"><Icon name="message" size={28} /><p>هنوز پیامی نیست. شروع‌کنندهٔ گفت‌وگو باش.</p></div>}
          </div>
          <form className="chat-compose" onSubmit={sendChat}>
            <div className="chat-input-wrap"><input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} placeholder="پیامت را بنویس…" maxLength={500} dir="auto" aria-label="متن پیام" autoComplete="off"/><small>{draft.length}/500</small></div>
            <button type="submit" disabled={!draft.trim() || connection !== "connected"} aria-label="ارسال پیام" title="ارسال پیام"><Icon name="arrow" size={16} /></button>
          </form>
          {chatNotice && <p className="chat-notice" role="status">{chatNotice}</p>}
        </aside>
      )}

      {panel === "people" && (
        <PeoplePanel
          participants={participants}
          selfId={user.id}
          hostId={hostId}
          isHost={isHost}
          locked={roomInfo.locked}
          quality={qualityById}
          volumes={prefs.volumes}
          localMuted={localMuted}
          onVolume={setVolume}
          onLocalMute={toggleLocalMute}
          onLowerHand={lowerHand}
          onMuteRequest={muteRequest}
          onMuteAll={muteAll}
          onKick={kick}
          onTransfer={transferHost}
          onToggleLock={toggleLock}
          shareMode={roomInfo.shareMode}
          onToggleShareMode={toggleShareMode}
          onInvite={() => setInviteOpen(true)}
          onClose={() => setPanel(null)}
        />
      )}

      {boardOpen && (
        <Whiteboard
          store={boardStore.current}
          selfId={user.id}
          isHost={isHost}
          canDraw={roomInfo.board.drawers === "all" || isHost}
          drawers={roomInfo.board.drawers}
          sharedOpen={roomInfo.board.open}
          onFragment={sendBoardFragment}
          onUndo={() => { send({ type: "board-undo" }); }}
          onClear={() => { send({ type: "board-clear" }); }}
          onClose={() => { setBoardOpen(false); if (isHost && roomInfo.board.open) send({ type: "board-open", open: false }); }}
          onShareOpen={(open) => { send({ type: "board-open", open, drawers: roomInfo.board.drawers }); }}
          onDrawers={(drawers) => { send({ type: "board-open", open: roomInfo.board.open, drawers }); }}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          prefs={prefs}
          onPrefs={updatePrefs}
          devices={devices}
          currentMicId={prefs.micId}
          onMic={changeMicrophone}
          onSpeaker={(deviceId) => updatePrefs({ speakerId: deviceId })}
          onProcessing={changeProcessing}
          microphoneReady={microphoneReady}
          onEnableMic={() => { void micApiRef.current?.reacquire({ attempts: 1, notice: "میکروفون وصل شد؛ حالا می‌توانی صحبت کنی." }); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {timerSheet && <TimerSheet active={!!roomInfo.timer} onStart={startTimer} onStop={stopTimer} onClose={() => setTimerSheet(false)} />}
      {pollSheet && <PollSheet onCreate={createPoll} onClose={() => setPollSheet(false)} />}
      {inviteOpen && <InviteSheet code={code} presentIds={participants.map((participant) => participant.id)} onNotify={notify} onClose={() => setInviteOpen(false)} />}

      {leaveDialog && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLeaveDialog(false); }}>
          <section className="leave-dialog glass" role="dialog" aria-modal="true" aria-labelledby="leave-title">
            <h2 id="leave-title">تو میزبان این تماس هستی</h2>
            <p>می‌خواهی تماس برای همه تمام شود، یا فقط خودت بیرون بروی و میزبانی به کسی که بیشتر از همه در تماس بوده برسد؟</p>
            <div className="leave-actions">
              <button type="button" className="leave-choice" onClick={() => void leave({ transfer: true })}><Icon name="crown" size={18} /><span><b>خروج و واگذاری میزبانی</b><small>تماس برای بقیه ادامه پیدا می‌کند</small></span></button>
              <button type="button" className="leave-choice danger" onClick={() => void leave()}><Icon name="phoneOff" size={18} /><span><b>پایان تماس برای همه</b><small>همه از تماس خارج می‌شوند</small></span></button>
              <button type="button" className="leave-cancel" onClick={() => setLeaveDialog(false)}>ماندن در تماس</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

/** The presenter's screen, shown to everyone else. */
function ScreenView({ stream, sharer }: { stream?: MediaStream; sharer: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    if (stream) void video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);

  const fullscreen = () => {
    const frame = frameRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (frame?.requestFullscreen) void frame.requestFullscreen();
      else if (frame?.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      else video?.webkitEnterFullscreen?.();
    } catch {}
  };

  return (
    <div className="screen-view glass" ref={frameRef}>
      <div className="screen-view-bar">
        <span className="screen-view-title"><Icon name="screen" size={15} /> صفحهٔ {sharer}</span>
        <div className="screen-view-actions">
          <button type="button" onClick={() => setFit(!fit)} title={fit ? "نمایش در اندازهٔ واقعی" : "جا دادن در کادر"} aria-pressed={!fit}>{fit ? "۱:۱" : "جا شدن"}</button>
          <button type="button" onClick={fullscreen} title="تمام‌صفحه" aria-label="تمام‌صفحه"><Icon name="expand" size={15} /></button>
        </div>
      </div>
      <div className={fit ? "screen-video-wrap fit" : "screen-video-wrap actual"}>
        <video ref={videoRef} autoPlay playsInline muted aria-label={`صفحهٔ اشتراکی ${sharer}`} />
        {!stream && <div className="screen-waiting" role="status"><span className="spinner" /><p>در حال دریافت صفحه…</p></div>}
      </div>
    </div>
  );
}

function ParticipantTile({
  participant, self, hostId, handOrder, level, locallyMuted,
}: {
  participant: Participant;
  self: boolean;
  hostId?: string;
  handOrder?: number;
  level?: 0 | 1 | 2 | 3;
  locallyMuted: boolean;
}) {
  const avatar = avatarOf(participant.avatar);
  const state = participant.muted ? "muted" : participant.speaking ? "speaking" : "idle";
  return (
    <div className={self ? "participant-card self" : "participant-card"}>
      <div className={`avatar-stage ${state}`} style={{ "--accent": avatar.accent } as CSSProperties}>
        <div className="avatar-face" style={{ background: avatar.gradient }}><AvatarImage avatar={avatar} priority /></div>
        {participant.muted && <span className="mute-badge" title="میکروفون بی‌صداست"><Icon name="micOff" size={13} /></span>}
        {participant.speaking && !participant.muted && <span className="speaking-dot" aria-label="در حال صحبت" />}
        {participant.sharing && <span className="share-badge" title="در حال اشتراک صفحه"><Icon name="screen" size={13} /></span>}
        {handOrder ? <span className="hand-badge" title={`دست بالا — نوبت ${handOrder}`}>✋<b>{handOrder}</b></span> : null}
      </div>
      <div className="participant-name"><b>{participant.username}</b>{self && <span>شما</span>}{participant.id === hostId && <span className="host-badge">میزبان</span>}{participant.rec && <span className="rec-badge"><i />ضبط</span>}{participant.muted && <em>بی‌صدا</em>}{locallyMuted && <em>برای تو بی‌صدا</em>}{!self && participant.connected===false && <span className="audio-status">در حال اتصال صدا</span>}{!self && level !== undefined && level < 3 && participant.connected !== false && <SignalBars level={level} />}</div>
    </div>
  );
}

function ToolButton({
  label, icon, onClick, active, danger, disabled, badge, quiet, ...attributes
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  quiet?: boolean;
  "aria-expanded"?: boolean;
  "aria-pressed"?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={label} aria-label={label} className={danger ? "tool danger" : "tool"} {...attributes}>
      <span className={active ? "tool-circle active" : "tool-circle"}>
        <Icon name={icon} />
      </span>
      {badge ? <span className={quiet ? "tool-badge quiet" : "tool-badge"}>{badge > 99 ? "99+" : badge}</span> : null}
      <small>{label}</small>
    </button>
  );
}
