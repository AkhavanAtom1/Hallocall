import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api } from "../lib/api";
import { getIceServers, applyAudioQuality, audioBitrateForQuality } from "../lib/webrtc";
import { avatarOf, DEFAULT_AVATAR } from "../lib/avatars";
import type { CallInfo, Participant, User } from "../lib/types";
import { MAX_CALL_PARTICIPANTS } from "../lib/call";
import { AppAvatar } from "./AppAvatar";
import { AvatarImage } from "./AvatarImage";
import { GlowButton } from "./GlowButton";
import { Icon } from "./Icon";
import { Scene } from "./Scene";

const QUICK_EMOJIS = ["😂", "❤️", "👍", "🔥", "🎉", "😮", "👏", "🙌", "💯", "✨", "🥳", "👀"];
const QUALITY_PRESETS = [
  { label: "کم", value: 20, hint: "اینترنت ضعیف" },
  { label: "متعادل", value: 50, hint: "پیشنهادی" },
  { label: "شفاف", value: 85, hint: "مصرف بیشتر" },
] as const;

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
  payload?: { kind?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  message?: ChatMessage;
  emoji?: string;
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

function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (!navigator.mediaDevices?.getUserMedia) return "برای استفاده از میکروفون، صفحه باید با HTTPS باز شود و مرورگر از تماس صوتی پشتیبانی کند.";
  if (name === "NotAllowedError" || name === "SecurityError") return "اجازهٔ میکروفون داده نشد. دسترسی Microphone را در تنظیمات مرورگر فعال و دوباره تلاش کن.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "میکروفونی پیدا نشد. یک ورودی صوتی وصل کن و دوباره وارد شو.";
  if (name === "NotReadableError" || name === "TrackStartError") return "میکروفون در برنامهٔ دیگری استفاده می‌شود یا فعلاً در دسترس نیست.";
  return "دسترسی به میکروفون ممکن نشد. اتصال و مجوزهای مرورگر را بررسی کن.";
}

export function CallPage({
  user, code, go, dark, setDark,
}: {
  user: User;
  code: string;
  go: (path: string) => void;
  dark: boolean;
  setDark: (value: boolean) => void;
}) {
  const [call, setCall] = useState<CallInfo | null>(null);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [quality, setQuality] = useState(50);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [microphoneReady, setMicrophoneReady] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const creatingPeers = useRef(new Set<string>());
  const local = useRef<MediaStream | null>(null);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const offerStarted = useRef(new Set<string>());
  const candidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const analyserCleanup = useRef(new Map<string, () => void>());
  const speakingState = useRef(new Map<string, boolean>());
  const qualityRef = useRef(quality);
  const mutedRef = useRef(false);
  const iceServersRef = useRef<Promise<RTCIceServer[]> | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAllowed = useRef(false);
  const shareTimer = useRef<number | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const reactionTimers = useRef(new Set<number>());

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

  const updateParticipants = useCallback((update: (current: Participant[]) => Participant[]) => {
    setParticipants((current) => {
      const next = update(current);
      if (next !== current) participantsRef.current = next;
      return next;
    });
  }, []);

  const closePeer = useCallback((id: string) => {
    creatingPeers.current.delete(id);
    pcs.current.get(id)?.close();
    pcs.current.delete(id);
    offerStarted.current.delete(id);
    candidates.current.delete(id);
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
    const next = list.map((participant) => {
      const old = previous.get(participant.id);
      return {
        ...participant,
        connected: old?.connected ?? participant.id === user.id,
        speaking: participant.muted ? false : old?.speaking ?? false,
      };
    });
    for (const participant of next) {
      if (participant.muted) speakingState.current.set(participant.id, false);
    }
    participantsRef.current = next;
    setParticipants(next);
    for (const id of Array.from(pcs.current.keys())) {
      if (!next.some((participant) => participant.id === id)) closePeer(id);
    }
  }, [closePeer, user.id]);

  const setupAnalyser = useCallback((stream: MediaStream, id: string, isLocal = false) => {
    analyserCleanup.current.get(id)?.();
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const context = new AudioContextConstructor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let animationFrame = 0;
      let lastSample = 0;

      const tick = (time: number) => {
        animationFrame = requestAnimationFrame(tick);
        if (time - lastSample < 120) return;
        lastSample = time;
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

      animationFrame = requestAnimationFrame(tick);
      if (context.state === "suspended") void context.resume().catch(() => {});
      analyserCleanup.current.set(id, () => {
        cancelAnimationFrame(animationFrame);
        source.disconnect();
        analyser.disconnect();
        void context.close().catch(() => {});
      });
    } catch {
      // Speaking animation is optional; audio transport continues without it.
    }
  }, [updateParticipants]);

  const makePeer = useCallback(async (participant: Participant) => {
    if (pcs.current.has(participant.id) || creatingPeers.current.has(participant.id)) {
      return pcs.current.get(participant.id) ?? null;
    }
    if (!participantsRef.current.some((entry) => entry.id === participant.id)) return null;

    creatingPeers.current.add(participant.id);
    try {
      iceServersRef.current ??= getIceServers();
      const iceServers = await iceServersRef.current;
      if (!participantsRef.current.some((entry) => entry.id === participant.id)) return null;

      const peer = new RTCPeerConnection({ iceServers });
      pcs.current.set(participant.id, peer);
      updateParticipants((current) => current.map((entry) => entry.id === participant.id ? { ...entry, connected: false } : entry));
      for (const track of local.current?.getTracks() ?? []) peer.addTrack(track, local.current!);
      await applyAudioQuality(peer, qualityRef.current);

      peer.onicecandidate = (event) => {
        if (event.candidate) send({ type: "signal", to: participant.id, payload: { kind: "ice", candidate: event.candidate.toJSON() } });
      };
      peer.onconnectionstatechange = () => {
        const connected = peer.connectionState === "connected";
        updateParticipants((current) => {
          const existing = current.find((entry) => entry.id === participant.id);
          if (!existing || existing.connected === connected) return current;
          return current.map((entry) => entry.id === participant.id ? { ...entry, connected } : entry);
        });
      };
      peer.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
        let audio = audioEls.current.get(participant.id);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audio.setAttribute("playsinline", "");
          audio.setAttribute("aria-hidden", "true");
          audio.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none";
          document.body.appendChild(audio);
          audioEls.current.set(participant.id, audio);
        }
        audio.srcObject = stream;
        void audio.play().catch(() => setPlaybackBlocked(true));
        setupAnalyser(stream, participant.id);
      };
      return peer;
    } catch {
      closePeer(participant.id);
      return null;
    } finally {
      creatingPeers.current.delete(participant.id);
    }
  }, [closePeer, send, setupAnalyser, updateParticipants]);

  const maybeOffer = useCallback(async (participant: Participant) => {
    if (user.id >= participant.id || offerStarted.current.has(participant.id)) return;
    const peer = pcs.current.get(participant.id);
    if (!peer) return;
    offerStarted.current.add(participant.id);
    try {
      await peer.setLocalDescription(await peer.createOffer());
      if (!send({ type: "signal", to: participant.id, payload: { kind: "offer", sdp: peer.localDescription } })) {
        offerStarted.current.delete(participant.id);
      }
    } catch {
      offerStarted.current.delete(participant.id);
    }
  }, [send, user.id]);

  const showReaction = useCallback((emoji: string) => {
    const id = crypto.randomUUID();
    setReactions((current) => [...current, { id, emoji, x: 35 + Math.random() * 30 }].slice(-18));
    const timer = window.setTimeout(() => {
      setReactions((current) => current.filter((reaction) => reaction.id !== id));
      reactionTimers.current.delete(timer);
    }, 2200);
    reactionTimers.current.add(timer);
  }, []);

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

  useEffect(() => {
    if (!joined) return;
    let disposed = false;
    reconnectAllowed.current = true;
    reconnectAttempt.current = 0;
    iceServersRef.current = null;

    const scheduleReconnect = () => {
      if (disposed || !reconnectAllowed.current || reconnectTimer.current !== null) return;
      const delay = Math.min(15_000, 900 * (2 ** Math.min(reconnectAttempt.current, 4)));
      reconnectAttempt.current += 1;
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        connectSocket();
      }, delay);
    };

    const handleSocketMessage = async (event: MessageEvent) => {
      let message: RoomSocketMessage;
      try { message = JSON.parse(String(event.data)) as RoomSocketMessage; }
      catch { return; }

      if (message.type === "ready" || message.type === "presence") {
        const list = Array.isArray(message.participants) ? message.participants : [];
        syncParticipants(list);
        if (message.type === "ready" && Array.isArray(message.messages)) setMessages(message.messages.slice(-100));
        if (message.type === "ready" && mutedRef.current) send({ type: "mute", muted: true });
        for (const participant of list) {
          if (participant.id === user.id) continue;
          void makePeer(participant).then((peer) => peer && maybeOffer(participant));
        }
        return;
      }

      if (message.type === "signal" && message.from && message.payload) {
        const from = message.from;
        let participant = participantsRef.current.find((entry) => entry.id === from);
        if (!participant) {
          participant = { id: from, username: "Friend", avatar: DEFAULT_AVATAR, muted: false, speaking: false };
          syncParticipants([...participantsRef.current, participant]);
        }
        const peer = pcs.current.get(from) ?? await makePeer(participant);
        if (!peer) return;
        const data = message.payload;
        try {
          if (data.kind === "offer" && data.sdp) {
            await peer.setRemoteDescription(data.sdp);
            for (const candidate of candidates.current.get(from) ?? []) await peer.addIceCandidate(candidate).catch(() => {});
            candidates.current.delete(from);
            if (peer.signalingState === "have-remote-offer") {
              await peer.setLocalDescription(await peer.createAnswer());
              send({ type: "signal", to: from, payload: { kind: "answer", sdp: peer.localDescription } });
            }
          } else if (data.kind === "answer" && data.sdp) {
            await peer.setRemoteDescription(data.sdp);
            for (const candidate of candidates.current.get(from) ?? []) await peer.addIceCandidate(candidate).catch(() => {});
            candidates.current.delete(from);
          } else if (data.kind === "ice" && data.candidate) {
            if (!peer.remoteDescription) {
              const queue = candidates.current.get(from) ?? [];
              queue.push(data.candidate);
              candidates.current.set(from, queue);
            } else {
              await peer.addIceCandidate(data.candidate).catch(() => {});
            }
          }
        } catch {
          // Ignore stale/out-of-order signaling packets; the peer can renegotiate.
        }
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
        socket = new WebSocket(`${scheme}://${location.host}/ws/call/${encodeURIComponent(code)}`);
      } catch {
        setConnection("reconnecting");
        scheduleReconnect();
        return;
      }
      wsRef.current = socket;
      socket.onopen = () => {
        if (disposed) { socket.close(); return; }
        reconnectAttempt.current = 0;
        setConnection("connected");
        if (mutedRef.current) send({ type: "mute", muted: true });
      };
      socket.onmessage = (event) => { void handleSocketMessage(event); };
      socket.onerror = () => { try { socket.close(); } catch {} };
      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        wsRef.current = null;
        if (disposed || !reconnectAllowed.current) return;
        setConnection("reconnecting");
        scheduleReconnect();
      };
    }

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("UNSUPPORTED_MEDIA");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          video: false,
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        local.current = stream;
        mutedRef.current = false;
        setMicrophoneReady(true);
        updateParticipants((current) => current.some((participant) => participant.id === user.id)
          ? current
          : [...current, { id: user.id, username: user.username, avatar: user.avatar, muted: false, speaking: false, connected: true }]);
        setupAnalyser(stream, user.id, true);
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
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      local.current?.getTracks().forEach((track) => track.stop());
      local.current = null;
      setMicrophoneReady(false);
      for (const id of Array.from(pcs.current.keys())) closePeer(id);
      for (const cleanup of analyserCleanup.current.values()) cleanup();
      analyserCleanup.current.clear();
      for (const audio of audioEls.current.values()) {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      }
      audioEls.current.clear();
      reactionTimers.current.forEach((timer) => window.clearTimeout(timer));
      reactionTimers.current.clear();
    };
  }, [joined, code, user.id, user.username, user.avatar, closePeer, makePeer, maybeOffer, send, setupAnalyser, showReaction, syncParticipants, updateParticipants]);

  useEffect(() => {
    if (chatOpen && chatListRef.current) chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [messages, chatOpen]);

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
    if (shareTimer.current !== null) window.clearTimeout(shareTimer.current);
  }, []);

  const showShareNotice = (message: string) => {
    setShareNotice(message);
    if (shareTimer.current !== null) window.clearTimeout(shareTimer.current);
    shareTimer.current = window.setTimeout(() => setShareNotice(""), 2600);
  };

  const shareCall = async () => {
    const link = `${location.origin}/call/${encodeURIComponent(code)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: call?.name ?? "HalloCall", text: "ورود به کال صوتی HalloCall", url: link });
        showShareNotice("لینک ارسال شد");
        return;
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
    }
    const copied = await copyText(link);
    showShareNotice(copied ? "لینک کپی شد" : `کد ورود: ${code}`);
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
    for (const peer of pcs.current.values()) void applyAudioQuality(peer, next);
  };

  const enablePlayback = async () => {
    let failed = false;
    await Promise.all(Array.from(audioEls.current.values()).map(async (audio) => {
      audio.muted = false;
      try { await audio.play(); } catch { failed = true; }
    }));
    setPlaybackBlocked(failed);
  };

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    reconnectAllowed.current = false;
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
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
  const maxParticipants = call?.maxParticipants ?? MAX_CALL_PARTICIPANTS;
  const qualityBitrate = Math.round(audioBitrateForQuality(quality) / 1000);
  const qualityLabel = quality < 34 ? "مصرف کم · مناسب اینترنت ضعیف" : quality < 72 ? "متعادل · پیشنهاد برای بیشتر تماس‌ها" : "حداکثر شفافیت · مصرف بیشتر";

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
          <button className="call-code-chip" onClick={shareCall} title="کپی یا اشتراک‌گذاری لینک کال">
            <span>کد ورود</span><strong dir="ltr">{code}</strong><Icon name={shareNotice ? "check" : "copy"} size={15} />
          </button>
          {shareNotice && <span className="share-feedback" role="status">{shareNotice}</span>}
        </div>
        <div className="call-center-status" aria-live="polite">
          <span className={connection === "connected" ? "live-dot" : "live-dot warn"} />
          {connection === "connected" ? "سیگنالینگ متصل" : connection === "connecting" ? "در حال اتصال…" : "تلاش برای اتصال دوباره…"}
          <small>•</small><span className="mic-status"><Icon name={microphoneReady ? "mic" : "micOff"} size={12}/>{microphoneReady ? "میکروفون آماده" : "در انتظار میکروفون"}</span>
          <small>•</small><span>{participants.length} / {maxParticipants} نفر</span>
        </div>
        <div className="call-head-actions">
          <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="تغییر تم" title="تغییر تم"><Icon name={dark ? "sun" : "moon"} /></button>
          <button className="leave-top" onClick={leave} disabled={leaving}><Icon name="phoneOff" size={16} /> {leaving ? "در حال خروج…" : "خروج"}</button>
        </div>
      </header>

      <section className="call-stage" aria-label="شرکت‌کنندگان تماس">
        <div className={`participant-stage count-${Math.min(participants.length, MAX_CALL_PARTICIPANTS)}`}>
          {participants.map((participant) => <ParticipantTile key={participant.id} participant={participant} self={participant.id === user.id} hostId={call?.hostId} />)}
        </div>
        {reactions.map((reaction) => <span key={reaction.id} className="reaction-float" style={{ left: `${reaction.x}%` }} aria-hidden="true">{reaction.emoji}</span>)}
        {!participants.length && <div className="joining" role="status"><span className="spinner" /><p>در حال ورود به کال و آماده‌سازی میکروفون…</p></div>}
        {playbackBlocked && <button className="audio-unlock glass" onClick={enablePlayback}><Icon name="volume" size={17} /> فعال‌کردن صدای دریافتی</button>}
        {participants.length > 0 && participants.length < maxParticipants && <div className="waiting-pill glass"><span className="waiting-dot" /> ظرفیت تماس {maxParticipants - participants.length} نفر دیگر دارد — کد بالا را برای دوستانت بفرست.</div>}
        {participants.length >= maxParticipants && <div className="waiting-pill glass"><span className="waiting-dot" /> این تماس به حداکثر ظرفیت {maxParticipants} نفر رسیده است.</div>}
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
          <div ref={chatListRef} className="chat-list" role="log" aria-live="polite" aria-relevant="additions text" aria-label="پیام‌های تماس">
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

function ParticipantTile({ participant, self, hostId }: { participant: Participant; self: boolean; hostId?: string }) {
  const avatar = avatarOf(participant.avatar);
  const state = participant.muted ? "muted" : participant.speaking ? "speaking" : "idle";
  return (
    <div className={self ? "participant-card self" : "participant-card"}>
      <div className={`avatar-stage ${state}`} style={{ "--accent": avatar.accent } as CSSProperties}>
        <div className="avatar-face" style={{ background: avatar.gradient }}><AvatarImage avatar={avatar} priority /></div>
        {participant.muted && <span className="mute-badge" title="میکروفون بی‌صداست"><Icon name="micOff" size={13} /></span>}
        {participant.speaking && !participant.muted && <span className="speaking-dot" aria-label="در حال صحبت" />}
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
