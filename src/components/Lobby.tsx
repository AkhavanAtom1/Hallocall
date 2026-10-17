import { useCallback, useEffect, useRef, useState } from "react";
import { avatarOf } from "../lib/avatars";
import { deviceLabel, listDevices, supportsSinkId } from "../lib/devices";
import type { DeviceLists } from "../lib/devices";
import { micConstraints } from "../lib/prefs";
import type { Prefs } from "../lib/prefs";
import { getSoundContext, playSound } from "../lib/sounds";
import type { CallInfo, User } from "../lib/types";
import { AppAvatar } from "./AppAvatar";
import { AvatarImage } from "./AvatarImage";
import { GlowButton } from "./GlowButton";
import { Icon } from "./Icon";
import { Scene } from "./Scene";

export type JoinChoice = {
  /** A running microphone stream (already permitted), or null for listen-only. */
  stream: MediaStream | null;
  muted: boolean;
};

type MicState = "asking" | "ready" | "denied" | "missing" | "busy";

function describeMicError(error: unknown): { state: MicState; message: string } {
  const name = error instanceof DOMException ? error.name : "";
  if (!navigator.mediaDevices?.getUserMedia) return { state: "missing", message: "این مرورگر یا این آدرس (بدون HTTPS) از میکروفون پشتیبانی نمی‌کند." };
  if (name === "NotAllowedError" || name === "SecurityError") return { state: "denied", message: "اجازهٔ میکروفون داده نشده. می‌توانی در تنظیمات مرورگر فعالش کنی یا فقط شنونده وارد شوی." };
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return { state: "missing", message: "میکروفونی پیدا نشد. یکی وصل کن یا فقط شنونده وارد شو." };
  if (name === "NotReadableError" || name === "TrackStartError") return { state: "busy", message: "میکروفون الان در برنامهٔ دیگری استفاده می‌شود." };
  return { state: "missing", message: "گرفتن میکروفون ممکن نشد. می‌توانی فقط شنونده وارد شوی." };
}

/**
 * The screen shown before entering a call: pick the microphone, see that it
 * works (live level), choose to enter muted — or enter as a listener when there
 * is no microphone. The user's click here is also what lets the browser play
 * call audio without any "tap to enable sound" step.
 */
export function Lobby({
  call, code, user, prefs, onPrefs, onJoin, onCancel,
}: {
  call: CallInfo | null;
  code: string;
  user: User;
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  onJoin: (choice: JoinChoice) => void;
  onCancel: () => void;
}) {
  const [micState, setMicState] = useState<MicState>("asking");
  const [message, setMessage] = useState("");
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], speakers: [] });
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const handedOver = useRef(false);
  /** Each microphone request gets a number; a slower, older request must never replace a newer one. */
  const acquireToken = useRef(0);
  const cleanupMeter = useRef<(() => void) | null>(null);
  const avatar = avatarOf(user.avatar);
  const sinkSupported = supportsSinkId();

  const stopMeter = () => { cleanupMeter.current?.(); cleanupMeter.current = null; };

  const startMeter = useCallback((stream: MediaStream) => {
    stopMeter();
    const context = getSoundContext();
    if (!context) return;
    try {
      if (context.state === "suspended") void context.resume().catch(() => {});
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const timer = window.setInterval(() => {
        analyser.getByteFrequencyData(data);
        const average = data.reduce((total, value) => total + value, 0) / Math.max(1, data.length);
        setLevel(Math.min(1, average / 60));
      }, 100);
      cleanupMeter.current = () => {
        window.clearInterval(timer);
        try { source.disconnect(); } catch {}
        try { analyser.disconnect(); } catch {}
        setLevel(0);
      };
    } catch { /* the meter is optional */ }
  }, []);

  const acquire = useCallback(async (deviceId: string | null) => {
    const token = ++acquireToken.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    stopMeter();
    setMicState("asking");
    setMessage("");
    try {
      const constraints = micConstraints({ ...prefs, micId: deviceId ?? prefs.micId }, deviceId === "");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        /* A remembered device that is gone must not block joining: retry with the default one. */
        if (error instanceof DOMException && (error.name === "OverconstrainedError" || error.name === "NotFoundError") && prefs.micId) {
          stream = await navigator.mediaDevices.getUserMedia(micConstraints(prefs, true));
          onPrefs({ micId: "" });
        } else throw error;
      }
      if (handedOver.current || token !== acquireToken.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      setMicState("ready");
      startMeter(stream);
      setDevices(await listDevices());
    } catch (error) {
      if (token !== acquireToken.current) return;
      const { state, message: text } = describeMicError(error);
      setMicState(state);
      setMessage(text);
      setDevices(await listDevices());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMeter]);

  useEffect(() => {
    void acquire(null);
    const onChange = () => { void listDevices().then(setDevices); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      acquireToken.current += 1; // anything still in flight is stale now
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
      stopMeter();
      if (!handedOver.current) streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = (listenOnly: boolean) => {
    handedOver.current = true;
    stopMeter();
    const stream = listenOnly ? null : streamRef.current;
    if (listenOnly) streamRef.current?.getTracks().forEach((track) => track.stop());
    getSoundContext(); // created inside this click so call sounds are allowed to play
    onJoin({ stream, muted: !!stream && (prefs.joinMuted || prefs.pushToTalk) });
  };

  const changeMic = (deviceId: string) => {
    onPrefs({ micId: deviceId });
    void acquire(deviceId);
  };

  const ready = micState === "ready";
  const selectedMic = prefs.micId && devices.mics.some((device) => device.deviceId === prefs.micId) ? prefs.micId : "";

  return (
    <main className="app-bg lobby-page">
      <Scene variant="call" />
      <section className="lobby-card glass" aria-labelledby="lobby-title">
        <div className="lobby-head">
          <AppAvatar size={44} className="brand-avatar" />
          <div>
            <h1 id="lobby-title">{call?.name ?? "Friend Call"}</h1>
            <span dir="ltr">#{code}</span>
          </div>
        </div>

        <div className="lobby-me">
          <div className="avatar-face" style={{ background: avatar.gradient }}><AvatarImage avatar={avatar} priority /></div>
          <div>
            <b>{user.username}</b>
            <small>{ready ? (prefs.joinMuted ? "با میکروفون خاموش وارد می‌شوی" : "میکروفون آماده است") : micState === "asking" ? "در حال بررسی میکروفون…" : "بدون میکروفون"}</small>
          </div>
        </div>

        <div className="lobby-field">
          <label htmlFor="lobby-mic">میکروفون</label>
          <select id="lobby-mic" value={selectedMic} disabled={!devices.mics.length} onChange={(event) => changeMic(event.target.value)}>
            <option value="">{devices.mics.length ? "پیش‌فرض سیستم" : "—"}</option>
            {devices.mics.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, "mic")}</option>)}
          </select>
          <div className="level-meter" role="meter" aria-label="سطح صدای میکروفون" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <small className="lobby-hint">{ready ? "چیزی بگو؛ اگر نوار تکان می‌خورد میکروفونت درست کار می‌کند." : message || "برای ادامه به مرورگر اجازهٔ میکروفون بده."}</small>
        </div>

        {sinkSupported && devices.speakers.length > 0 && (
          <div className="lobby-field">
            <label htmlFor="lobby-speaker">خروجی صدا</label>
            <div className="lobby-row">
              <select id="lobby-speaker" value={devices.speakers.some((d) => d.deviceId === prefs.speakerId) ? prefs.speakerId : ""} onChange={(event) => onPrefs({ speakerId: event.target.value })}>
                <option value="">پیش‌فرض سیستم</option>
                {devices.speakers.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, "speaker")}</option>)}
              </select>
              <button type="button" className="lobby-test" onClick={() => playSound("test", 0.2, prefs.speakerId || undefined)}><Icon name="volume" size={16} /> تست</button>
            </div>
          </div>
        )}

        <div className="lobby-toggles">
          <label className="switch-row"><input type="checkbox" checked={prefs.joinMuted} onChange={(event) => onPrefs({ joinMuted: event.target.checked })} /><span>ورود با میکروفون خاموش</span></label>
          <label className="switch-row"><input type="checkbox" checked={prefs.skipLobby} onChange={(event) => onPrefs({ skipLobby: event.target.checked })} /><span>دفعهٔ بعد مستقیم وارد شو (این صفحه را نشان نده)</span></label>
        </div>

        <div className="lobby-actions">
          <GlowButton tone="primary" size="lg" icon="call" className="wide" disabled={micState === "asking"} onClick={() => join(!ready)}>
            {ready ? "ورود به تماس" : "ورود به‌عنوان شنونده"}
          </GlowButton>
          {!ready && micState !== "asking" && (
            <GlowButton tone="ghost" size="md" className="wide" onClick={() => void acquire(null)}>دوباره امتحان میکروفون</GlowButton>
          )}
          <button type="button" className="lobby-cancel" onClick={onCancel}>بازگشت</button>
        </div>
      </section>
    </main>
  );
}
