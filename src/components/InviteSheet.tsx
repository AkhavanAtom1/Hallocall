import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { avatarOf } from "../lib/avatars";
import type { Friend } from "../lib/types";
import { AvatarImage } from "./AvatarImage";
import { Icon } from "./Icon";

/** Ring friends straight into the call that is running right now. */
export function InviteSheet({
  code, presentIds, onClose, onNotify,
}: {
  code: string;
  presentIds: string[];
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const notifyRef = useRef(onNotify);
  notifyRef.current = onNotify;

  const load = useCallback(() => {
    api.friends().then((data) => { setFriends(data.friends); setFailed(false); }).catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ring = async (friend: Friend) => {
    if (busy) return;
    setBusy(friend.id);
    try {
      await api.inviteToCall(code, friend.id);
      setSent((current) => ({ ...current, [friend.id]: Date.now() }));
      notifyRef.current(`برای ${friend.username} زنگ خورد.`);
    } catch (cause) {
      notifyRef.current(cause instanceof Error ? cause.message : "دعوت ارسال نشد.");
    } finally {
      setBusy(null);
    }
  };

  const ordered = [...(friends ?? [])].sort((a, b) => Number(!!b.online) - Number(!!a.online) || a.username.localeCompare(b.username));

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-sheet invite-sheet glass" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <div className="sheet-head">
          <b id="invite-title">دعوت دوستان به همین تماس</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن"><Icon name="x" /></button>
        </div>
        <div className="sheet-body">
          <p className="sheet-hint">برای دوستت زنگ می‌خورد و با یک کلیک وارد همین تماس می‌شود.</p>
          {friends === null && !failed && <p className="sheet-hint" role="status">در حال بارگذاری دوستان…</p>}
          {failed && friends === null && <p className="sheet-hint" role="alert">فهرست دوستان بارگذاری نشد.</p>}
          {friends !== null && !ordered.length && <p className="sheet-hint">هنوز دوستی نداری. از صفحهٔ «دوستان» اضافه کن.</p>}
          <div className="invite-list" role="list">
            {ordered.map((friend) => {
              const avatar = avatarOf(friend.avatar);
              const inCall = presentIds.includes(friend.id);
              const recently = sent[friend.id] && Date.now() - sent[friend.id] < 30_000;
              return (
                <div key={friend.id} role="listitem" className="invite-row">
                  <span className="person-avatar" style={{ background: avatar.gradient }}><AvatarImage avatar={avatar} /></span>
                  <span className="person-name">
                    <b>{friend.username}</b>
                    <small>{inCall ? "همین الان در تماس است" : friend.online ? "آنلاین" : "آفلاین"}</small>
                  </span>
                  <span className={friend.online ? "presence-dot online" : "presence-dot"} aria-hidden="true" />
                  <button type="button" className="mini" disabled={inCall || !!recently || busy === friend.id} onClick={() => void ring(friend)}>
                    <Icon name="call" size={14} /> {inCall ? "در تماس" : recently ? "زنگ خورد" : "زنگ بزن"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
