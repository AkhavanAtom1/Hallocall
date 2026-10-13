import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api } from "../lib/api";
import { getIceServers, audioBitrateForQuality } from "../lib/webrtc";
import { CallMesh } from "../lib/mesh";
import type { SignalPayload } from "../lib/mesh";
import { avatarOf } from "../lib/avatars";
import type { CallInfo, Participant, User } from "../lib/types";
import { MAX_CALL_PARTICIPANTS } from "../lib/call";
import { AppAvatar } from "./AppAvatar";
import { AvatarImage } from "./AvatarImage";
import { GlowButton } from "./GlowButton";
import { Icon } from "./Icon";
import { Scene } from "./Scene";
import { ThemeControls } from "./ThemeControls";
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
type RoomSocketMessage = {
  type?: string;
  participants?: Participant[];
  messages?: ChatMessage[];
  from?: string;
  payload?: SignalPayload;
  message?: ChatMessage;
  emoji?: string;
  by?: string;
};

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
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "میکروفونی پیدا نشد. یک ورودی صوتی وصل کن و دوباره وارد شو.";
  if (name === "NotReadableError" || name === "TrackStartError") return "میکروفون در برنامهٔ دیگری استفاده می‌شود یا فعلاً در دسترس نیست.";
  return "دسترسی به میکروفون ممکن نشد. اتصال و مجوزهای مرورگر را بررسی کن.";
}

function screenShareSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
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
  const [leaving, setLeaving] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [quality, setQuality] = useState(50);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [callNotice, setCallNotice] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const meshRef = useRef<CallMesh | null>(null);
  const sidRef = useRef("");
  const participantsRef = useRef<Participant[]>([]);
  const local = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const sharingRef = useRef(false);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserCleanup = useRef(new Map<string, () => void>());
  const speakingState = useRef(new Map<string, boolean>());
  const qualityRef = useRef(quality);
  const mutedRef = useRef(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAllowed = useRef(false);
  const copyTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const reactionTimers = useRef(new Set<number>());
  const userRef = useRef(user);
  userRef.current = user;

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

  /** Drop everything that belongs to one remote participant (audio, meter, screen). */
  const cleanupRemote = useCallback((id: string) => {
    const audio = audioEls.current.get(id);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      audioEls.current.delete(id);
    }
    analyserCleanup.current.get(id)?.();
    analyserCleanup.current.delete(id);
    speakingState.current.delete(id);
  }, []);

  const syncParticipants = useCallback((list: Participant[]) => {
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
    participantsRef.current = next;
    setParticipants(next);
    setRemoteScreens((current) => {
      const stale = Object.keys(current).filter((id) => !unique.has(id));
      if (!stale.length) return current;
      const copy = { ...current };
      for (const id of stale) delete copy[id];
      return copy;
    });
  }, [cleanupRemote]);

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

  useEffect(() => {
    let active = true;
    setCall(null);
    setError("");
    setJoined(false);
    setMessages([]);
    setParticipants([]);
    participantsRef.current = [];

    void (async () => {
      try {
        const result = await api.getCall(code);
        if (!active) return;
        setCall(result.call);
        await api.join(code);
        if (active) setJoined(true);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "ورود به کال ممکن نشد.");
      }
    })();

    return () => { active = false; };
  }, [code]);

  useEffect(() => {
    if (!joined) return;
    let active = true;
    const poll = async () => {
      try {
        const result = await api.getCall(code);
        if (active) setCall(result.call);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        if (active && /دیگر فعال|فعال نیست|پیدا نشد|پایان رسیده/.test(message)) {
          reconnectAllowed.current = false;
          setError("این تماس به پایان رسیده یا دیگر در دسترس نیست.");
          setJoined(false);
        }
      }
    };
    poll();
    const interval = window.setInterval(poll, 6000);
    return () => { active = false; window.clearInterval(interval); };
  }, [joined, code]);

  /* ───────────── the call itself: microphone, signaling socket, WebRTC mesh ───────────── */
  useEffect(() => {
    if (!joined) return;
    let disposed = false;
    let heartbeat: number | null = null;
    let lastPong = Date.now();
    let lastReset = 0;
    let micRecovering = false;
    reconnectAllowed.current = true;
    reconnectAttempt.current = 0;
    sidRef.current = newSessionId();

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
        void audio.play().catch(() => setPlaybackBlocked(true));
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
      onPeerClosed: (id) => { cleanupRemote(id); },
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
        syncParticipants(list);
        mesh.syncPeers(list.map((participant) => ({ id: participant.id, sid: participant.sid })));
        if (message.type === "ready") {
          if (Array.isArray(message.messages)) setMessages(message.messages.slice(-100));
          if (mutedRef.current) send({ type: "mute", muted: true });
          if (sharingRef.current) send({ type: "screen", active: true });
        }
        return;
      }

      if (message.type === "signal" && message.from && message.payload) {
        mesh.handleSignal(message.from, message.payload);
        return;
      }

      if (message.type === "replaced") {
        reconnectAllowed.current = false;
        setError("این حساب روی دستگاه یا تب دیگری وارد همین تماس شد؛ این نشست بسته شد.");
        setJoined(false);
        return;
      }

      if (message.type === "screen-denied") {
        stopScreenShare(false);
        notify(message.by ? `${message.by} همین حالا در حال اشتراک‌گذاری صفحه است؛ هم‌زمان فقط یک نفر می‌تواند صفحه نشان بدهد.` : "هم‌زمان فقط یک نفر می‌تواند صفحه نشان بدهد.");
        return;
      }

      if (message.type === "ended") {
        reconnectAllowed.current = false;
        setError("میزبان این کال را تمام کرد.");
        setJoined(false);
        wsRef.current?.close(1000, "Call ended");
        return;
      }

      if (message.type === "chat" && message.message) {
        setMessages((current) => current.some((item) => item.id === message.message!.id)
          ? current
          : [...current, message.message!].slice(-100));
        return;
      }

      if (message.type === "reaction" && message.emoji) showReaction(message.emoji);
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
    const dropSocketNow = (socket: WebSocket) => {
      if (wsRef.current !== socket) return;
      wsRef.current = null;
      stopHeartbeat();
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch {}
    };

    /* ── microphone: acquire, watch for loss, recover ── */
    const acquireMicrophone = () => navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });

    const watchMicrophone = (stream: MediaStream) => {
      for (const track of stream.getAudioTracks()) {
        track.onended = () => { if (!disposed) void recoverMicrophone(); };
      }
    };

    const recoverMicrophone = async () => {
      if (micRecovering || disposed) return;
      micRecovering = true;
      setMicrophoneReady(false);
      try {
        for (let attempt = 0; attempt < MIC_RECOVERY_ATTEMPTS && !disposed; attempt++) {
          try {
            const stream = await acquireMicrophone();
            if (disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
            const track = stream.getAudioTracks()[0];
            if (!track) { stream.getTracks().forEach((item) => item.stop()); continue; }
            track.enabled = !mutedRef.current;
            const previous = local.current;
            local.current = stream;
            mesh.setLocalAudio(stream);
            await mesh.replaceAudioTrack(track);
            previous?.getTracks().forEach((old) => { old.onended = null; try { old.stop(); } catch {} });
            setupAnalyser(stream, userRef.current.id, true);
            watchMicrophone(stream);
            setMicrophoneReady(true);
            notify("میکروفون دوباره وصل شد.");
            return;
          } catch {
            await new Promise((resolve) => window.setTimeout(resolve, 1200 * (attempt + 1)));
          }
        }
        if (!disposed) notify("اتصال میکروفون قطع شد و دوباره وصل نشد. میکروفون را بررسی کن و صفحه را تازه کن.");
      } finally {
        micRecovering = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || disposed) return;
      nudge();
      const track = local.current?.getAudioTracks()[0];
      if (!track || track.readyState === "ended") void recoverMicrophone();
      const context = audioContextRef.current;
      if (context?.state === "suspended") void context.resume().catch(() => {});
    };
    window.addEventListener("online", nudge);
    document.addEventListener("visibilitychange", onVisibility);

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("UNSUPPORTED_MEDIA");
        const stream = await acquireMicrophone();
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        local.current = stream;
        mutedRef.current = false;
        mesh.setLocalAudio(stream);
        setMicrophoneReady(true);
        updateParticipants((current) => current.some((participant) => participant.id === user.id)
          ? current
          : [...current, { id: user.id, username: user.username, avatar: user.avatar, muted: false, speaking: false, connected: true }]);
        setupAnalyser(stream, user.id, true);
        watchMicrophone(stream);
        connectSocket();
      } catch (cause) {
        if (!disposed) {
          reconnectAllowed.current = false;
          setError(microphoneError(cause));
          setJoined(false);
        }
      }
    })();

    return () => {
      disposed = true;
      reconnectAllowed.current = false;
      window.removeEventListener("online", nudge);
      document.removeEventListener("visibilitychange", onVisibility);
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
      mesh.destroy();
      meshRef.current = null;
      local.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      local.current = null;
      setMicrophoneReady(false);
      setRemoteScreens({});
      for (const id of Array.from(audioEls.current.keys())) cleanupRemote(id);
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
  }, [joined, code, user.id]);

  /* Keep the chat pinned to the newest message unless the reader scrolled up. */
  useEffect(() => {
    const list = chatListRef.current;
    if (!chatOpen || !list) return;
    const last = messages[messages.length - 1];
    if (stickToBottom.current || last?.userId === user.id) list.scrollTop = list.scrollHeight;
  }, [messages, chatOpen, user.id]);

  useEffect(() => {
    if (chatOpen) {
      stickToBottom.current = true;
      const list = chatListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    }
  }, [chatOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEmojiOpen(false);
      setQualityOpen(false);
      setChatOpen(false);
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

  const toggleMute = () => {
    const track = local.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const muted = !track.enabled;
    mutedRef.current = muted;
    speakingState.current.set(user.id, false);
    updateParticipants((current) => current.map((participant) => participant.id === user.id
      ? { ...participant, muted, speaking: false }
      : participant));
    send({ type: "mute", muted });
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
    await Promise.all(Array.from(audioEls.current.values()).map(async (audio) => {
      audio.muted = false;
      try { await audio.play(); } catch { failed = true; }
    }));
    setPlaybackBlocked(failed);
  };

  const sharerNow = participants.find((participant) => participant.sharing);
  const someoneElseSharing = !!sharerNow && sharerNow.id !== user.id;

  const startScreenShare = async () => {
    if (sharingRef.current) return;
    if (!screenShareSupported()) {
      notify("مرورگر این دستگاه اشتراک‌گذاری صفحه را پشتیبانی نمی‌کند. روی لپ‌تاپ یا کامپیوتر (Chrome، Edge، Firefox یا Safari) امتحان کن؛ در بیشتر مرورگرهای موبایل این قابلیت وجود ندارد.");
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
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
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
    if (!send({ type: "screen", active: true })) {
      stopScreenShare(false);
      notify("اتصال قطع شد؛ اشتراک‌گذاری صفحه شروع نشد.");
    }
  };

  const toggleScreenShare = () => {
    if (sharingRef.current) stopScreenShare(true);
    else void startScreenShare();
  };

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    reconnectAllowed.current = false;
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    stopScreenShare(true);
    try { await api.leave(code); } catch {}
    local.current?.getTracks().forEach((track) => track.stop());
    wsRef.current?.close(1000, "Left call");
    go("/calls");
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
  const me = participants.find((participant) => participant.id === user.id);
  const qualityBitrate = Math.round(audioBitrateForQuality(quality) / 1000);
  const qualityLabel = quality < 34 ? "مصرف کم · مناسب اینترنت ضعیف" : quality < 72 ? "متعادل · پیشنهاد برای بیشتر تماس‌ها" : "حداکثر شفافیت · مصرف بیشتر";
  const viewedScreen = sharerNow && sharerNow.id !== user.id ? remoteScreens[sharerNow.id] : undefined;

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
          <small>•</small><span className="mic-status"><Icon name={microphoneReady ? "mic" : "micOff"} size={12}/>{microphoneReady ? "میکروفون آماده" : "در انتظار میکروفون"}</span>
          <small>•</small><span>{participants.length} نفر</span>
        </div>
        <div className="call-head-actions">
          <ThemeControls colorTheme={colorTheme} onColorThemeChange={onColorThemeChange} dark={dark} setDark={setDark} compact/>
          <button className="leave-top" onClick={leave} disabled={leaving}><Icon name="phoneOff" size={16} /> {leaving ? "در حال خروج…" : "خروج"}</button>
        </div>
      </header>

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
          {participants.map((participant) => <ParticipantTile key={participant.id} participant={participant} self={participant.id === user.id} hostId={call?.hostId} />)}
        </div>
        {reactions.map((reaction) => <span key={reaction.id} className="reaction-float" style={{ left: `${reaction.x}%` }} aria-hidden="true">{reaction.emoji}</span>)}
        {!participants.length && <div className="joining" role="status"><span className="spinner" /><p>در حال ورود به کال و آماده‌سازی میکروفون…</p></div>}
        {playbackBlocked && <button className="audio-unlock glass" onClick={enablePlayback}><Icon name="volume" size={17} /> فعال‌کردن صدای دریافتی</button>}
        {callNotice && <div className="call-notice glass" role="status" aria-live="polite"><Icon name="info" size={16} /><span>{callNotice}</span></div>}
      </section>

      <div className="call-toolbar-wrap">
        <div className="call-toolbar glass" role="toolbar" aria-label="کنترل‌های تماس">
          {qualityOpen && (
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
          {emojiOpen && <div className="popover emoji-pop" role="group" aria-label="واکنش‌های سریع">{QUICK_EMOJIS.map((emoji) => <button key={emoji} type="button" aria-label={`ارسال واکنش ${emoji}`} onClick={() => { react(emoji); setEmojiOpen(false); }}>{emoji}</button>)}</div>}
          <ToolButton label={me?.muted ? "روشن‌کردن میکروفون" : "بی‌صدا کردن"} danger={!!me?.muted} active={!me?.muted} disabled={!microphoneReady} onClick={toggleMute} icon={me?.muted ? "micOff" : "mic"} />
          <ToolButton label={sharing ? "توقف اشتراک" : "اشتراک صفحه"} active={sharing} disabled={someoneElseSharing && !sharing} onClick={toggleScreenShare} icon={sharing ? "screenOff" : "screen"} />
          <ToolButton label="واکنش" active={emojiOpen} aria-expanded={emojiOpen} onClick={() => { setEmojiOpen(!emojiOpen); setQualityOpen(false); }} icon="smile" />
          <ToolButton label="گفت‌وگو" active={chatOpen} aria-expanded={chatOpen} onClick={() => { setChatOpen(!chatOpen); setEmojiOpen(false); }} icon="message" />
          <ToolButton label="کیفیت صدا" active={qualityOpen} aria-expanded={qualityOpen} onClick={() => { setQualityOpen(!qualityOpen); setEmojiOpen(false); }} icon="signal" />
          <div className="toolbar-divider" />
          <button className="leave-btn" onClick={leave} disabled={leaving} title="خروج از تماس" aria-label="خروج از تماس"><Icon name="phoneOff" /></button>
        </div>
      </div>

      {chatOpen && (
        <aside className="chat-drawer glass" aria-labelledby="call-chat-title">
          <div className="chat-head">
            <div><b id="call-chat-title">گفت‌وگوی این تماس</b><span>{messages.length} پیام · پیام‌ها برای همین اتاق ذخیره می‌شوند</span></div>
            <button className="icon-btn" onClick={() => setChatOpen(false)} aria-label="بستن گفت‌وگو"><Icon name="x" /></button>
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
                  <p>{message.text}</p>
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

function ParticipantTile({ participant, self, hostId }: { participant: Participant; self: boolean; hostId?: string }) {
  const avatar = avatarOf(participant.avatar);
  const state = participant.muted ? "muted" : participant.speaking ? "speaking" : "idle";
  return (
    <div className={self ? "participant-card self" : "participant-card"}>
      <div className={`avatar-stage ${state}`} style={{ "--accent": avatar.accent } as CSSProperties}>
        <div className="avatar-face" style={{ background: avatar.gradient }}><AvatarImage avatar={avatar} priority /></div>
        {participant.muted && <span className="mute-badge" title="میکروفون بی‌صداست"><Icon name="micOff" size={13} /></span>}
        {participant.speaking && !participant.muted && <span className="speaking-dot" aria-label="در حال صحبت" />}
        {participant.sharing && <span className="share-badge" title="در حال اشتراک صفحه"><Icon name="screen" size={13} /></span>}
      </div>
      <div className="participant-name"><b>{participant.username}</b>{self && <span>شما</span>}{participant.id === hostId && <span className="host-badge">میزبان</span>}{participant.muted && <em>بی‌صدا</em>}{!self && participant.connected===false && <span className="audio-status">در حال اتصال صدا</span>}</div>
    </div>
  );
}

function ToolButton({
  label, icon, onClick, active, danger, disabled, ...attributes
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  "aria-expanded"?: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={label} className={danger ? "tool danger" : "tool"} {...attributes}><span className={active ? "tool-circle active" : "tool-circle"}><Icon name={icon} /></span><small>{label}</small></button>;
}
