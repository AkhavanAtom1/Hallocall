import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PollView, RoomInfo } from "../lib/types";
import { Icon } from "./Icon";

/* ───────────── live captions ───────────── */

export type CaptionLine = { uid: string; name: string; text: string; final: boolean; at: number; self: boolean };

const CAPTION_LINGER_MS = 6000;

/** Subtitles for what people say; the newest line of each speaker, fading after a few seconds. */
export function CaptionsOverlay({ lines }: { lines: CaptionLine[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lines.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lines.length]);
  const visible = lines.filter((line) => !line.final || now - line.at < CAPTION_LINGER_MS).slice(-3);
  if (!visible.length) return null;
  return (
    <div className="captions" role="log" aria-live="polite" aria-label="زیرنویس زنده">
      {visible.map((line) => (
        <p key={line.uid} className={line.final ? "caption-line" : "caption-line interim"} dir="auto">
          <b>{line.self ? "شما" : line.name}</b> {line.text}
        </p>
      ))}
    </div>
  );
}

/* ───────────── shared timer ───────────── */

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Countdown set by the host. It arrives as "time left" and runs on this device's own clock. */
export function TimerChip({ timer, onFinish }: { timer: NonNullable<RoomInfo["timer"]>; onFinish: () => void }) {
  const endsAt = useRef({ id: "", at: 0 });
  if (endsAt.current.id !== timer.id) endsAt.current = { id: timer.id, at: performance.now() + timer.remainingMs };
  const [now, setNow] = useState(() => performance.now());
  const finished = useRef("");
  useEffect(() => {
    const interval = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(interval);
  }, [timer.id]);
  const left = endsAt.current.at - now;
  useEffect(() => {
    if (left <= 0 && finished.current !== timer.id) {
      finished.current = timer.id;
      onFinish();
    }
  });
  const done = left <= 0;
  const urgent = !done && left <= 10_000;
  return (
    <span className={done ? "timer-chip done" : urgent ? "timer-chip urgent" : "timer-chip"} role="timer" aria-label={timer.label ? `تایمر ${timer.label}` : "تایمر"}>
      <Icon name="clock" size={13} />
      {timer.label && <em>{timer.label}</em>}
      <strong dir="ltr">{done ? "00:00" : clock(left)}</strong>
      {done && <small>تمام شد</small>}
    </span>
  );
}

const TIMER_PRESETS = [1, 3, 5, 10, 15, 30];

export function TimerSheet({
  active, onStart, onStop, onClose,
}: {
  active: boolean;
  onStart: (seconds: number, label: string) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState(5);
  const [label, setLabel] = useState("");
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-sheet glass" role="dialog" aria-modal="true" aria-labelledby="timer-title">
        <div className="sheet-head">
          <b id="timer-title">تایمر مشترک</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن"><Icon name="x" /></button>
        </div>
        <div className="sheet-body">
          <p className="sheet-hint">شمارش معکوس برای همهٔ حاضران نشان داده می‌شود (مثلاً استراحت، تمرین یا نوبت صحبت).</p>
          <div className="timer-presets" role="group" aria-label="مدت">
            {TIMER_PRESETS.map((value) => (
              <button key={value} type="button" className={minutes === value ? "mini on" : "mini"} aria-pressed={minutes === value} onClick={() => setMinutes(value)}>{value} دقیقه</button>
            ))}
          </div>
          <div className="lobby-field">
            <label htmlFor="timer-minutes">مدت دلخواه (دقیقه)</label>
            <input id="timer-minutes" className="text-input" type="number" min={1} max={360} value={minutes} onChange={(event) => setMinutes(Math.min(360, Math.max(1, Math.round(Number(event.target.value)) || 1)))} />
          </div>
          <div className="lobby-field">
            <label htmlFor="timer-label">عنوان (اختیاری)</label>
            <input id="timer-label" className="text-input" maxLength={40} value={label} placeholder="مثلاً استراحت" onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="sheet-actions">
            <button type="button" className="primary-btn" onClick={() => { onStart(minutes * 60, label); onClose(); }}>شروع تایمر</button>
            {active && <button type="button" className="mini danger" onClick={() => { onStop(); onClose(); }}>توقف تایمر فعلی</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ───────────── quick poll ───────────── */

export function PollCard({
  poll, isHost, onVote, onClose, onDismiss, onHide,
}: {
  poll: PollView;
  isHost: boolean;
  onVote: (option: number) => void;
  onClose: () => void;
  onDismiss: () => void;
  onHide: () => void;
}) {
  const top = Math.max(0, ...poll.options.map((option) => option.count));
  return (
    <section className="poll-card glass" aria-label="نظرسنجی">
      <div className="poll-head">
        <b dir="auto">{poll.question}</b>
        <button type="button" className="icon-btn" onClick={onHide} aria-label="پنهان کردن نظرسنجی برای خودم" title="پنهان کردن برای خودم"><Icon name="x" size={16} /></button>
      </div>
      <div className="poll-options" role="radiogroup" aria-label={poll.question}>
        {poll.options.map((option, index) => {
          const percent = poll.total ? Math.round((option.count / poll.total) * 100) : 0;
          const mine = poll.myVote === index;
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={mine}
              disabled={!poll.open}
              className={mine ? "poll-option mine" : option.count === top && top > 0 && !poll.open ? "poll-option lead" : "poll-option"}
              onClick={() => onVote(index)}
            >
              <span className="poll-bar" style={{ width: `${percent}%` }} aria-hidden="true" />
              <span className="poll-text" dir="auto">{option.text}</span>
              <span className="poll-count">{option.count}{poll.total ? ` · ${percent}٪` : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <small>{poll.total} رأی{poll.open ? "" : " · بسته شد"}</small>
        {isHost && (
          <span className="poll-host">
            {poll.open && <button type="button" className="mini" onClick={onClose}>بستن رأی‌گیری</button>}
            <button type="button" className="mini danger" onClick={onDismiss}>حذف برای همه</button>
          </span>
        )}
      </div>
    </section>
  );
}

export function PollSheet({ onCreate, onClose }: { onCreate: (question: string, options: string[]) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const filled = options.map((option) => option.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= 2;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onCreate(question.trim(), filled);
    onClose();
  };
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="settings-sheet glass" role="dialog" aria-modal="true" aria-labelledby="poll-title" onSubmit={submit}>
        <div className="sheet-head">
          <b id="poll-title">نظرسنجی سریع</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن"><Icon name="x" /></button>
        </div>
        <div className="sheet-body">
          <div className="lobby-field">
            <label htmlFor="poll-question">سؤال</label>
            <input id="poll-question" className="text-input" maxLength={140} value={question} placeholder="مثلاً برای بخش بعد آماده‌اید؟" onChange={(event) => setQuestion(event.target.value)} autoFocus />
          </div>
          <div className="lobby-field">
            <label>گزینه‌ها (۲ تا ۶)</label>
            {options.map((option, index) => (
              <div key={index} className="lobby-row">
                <input className="text-input" maxLength={60} value={option} aria-label={`گزینهٔ ${index + 1}`} placeholder={`گزینهٔ ${index + 1}`} onChange={(event) => setOptions((current) => current.map((item, at) => at === index ? event.target.value : item))} />
                {options.length > 2 && <button type="button" className="mini" aria-label={`حذف گزینهٔ ${index + 1}`} onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}><Icon name="x" size={14} /></button>}
              </div>
            ))}
            {options.length < 6 && <button type="button" className="mini" onClick={() => setOptions((current) => [...current, ""])}><Icon name="plus" size={14} /> افزودن گزینه</button>}
          </div>
          <div className="sheet-actions">
            <button type="submit" className="primary-btn" disabled={!ready}>شروع نظرسنجی</button>
          </div>
        </div>
      </form>
    </div>
  );
}
