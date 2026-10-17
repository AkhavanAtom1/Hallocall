import { useState } from "react";
import type { CSSProperties } from "react";
import { avatarOf } from "../lib/avatars";
import { QUALITY_LABELS } from "../lib/quality";
import type { PeerQuality } from "../lib/quality";
import type { Participant } from "../lib/types";
import { AvatarImage } from "./AvatarImage";
import { Icon } from "./Icon";

export function SignalBars({ level, title }: { level: 0 | 1 | 2 | 3; title?: string }) {
  return (
    <span className={`signal-bars level-${level}`} role="img" aria-label={title ?? `کیفیت اتصال: ${QUALITY_LABELS[level]}`} title={title ?? QUALITY_LABELS[level]}>
      <i /><i /><i />
    </span>
  );
}

function qualityTitle(quality?: PeerQuality) {
  if (!quality) return "در حال اندازه‌گیری…";
  const parts = [QUALITY_LABELS[quality.level]];
  if (quality.rttMs !== null) parts.push(`تأخیر ${quality.rttMs} ms`);
  if (quality.lossPct !== null) parts.push(`افت بسته ${quality.lossPct}٪`);
  return parts.join(" · ");
}

type Props = {
  participants: Participant[];
  selfId: string;
  hostId: string;
  isHost: boolean;
  locked: boolean;
  quality: Record<string, PeerQuality>;
  volumes: Record<string, number>;
  localMuted: Record<string, boolean>;
  onVolume: (id: string, value: number) => void;
  onLocalMute: (id: string) => void;
  onLowerHand: (id: string) => void;
  onMuteRequest: (id: string) => void;
  onMuteAll: () => void;
  onKick: (id: string) => void;
  onTransfer: (id: string) => void;
  onToggleLock: () => void;
  onClose: () => void;
};

/** Everyone in the call: volume per person, hand queue, quality and host tools. */
export function PeoplePanel(props: Props) {
  const { participants, selfId, hostId, isHost, locked, quality } = props;
  const [open, setOpen] = useState<string | null>(null);
  const hands = participants.filter((participant) => (participant.hand ?? 0) > 0).sort((a, b) => (a.hand ?? 0) - (b.hand ?? 0));
  const handOrder = new Map(hands.map((participant, index) => [participant.id, index + 1]));
  const sorted = [...participants].sort((a, b) => {
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    const handA = handOrder.get(a.id) ?? 99;
    const handB = handOrder.get(b.id) ?? 99;
    if (handA !== handB) return handA - handB;
    return a.username.localeCompare(b.username);
  });

  return (
    <aside className="chat-drawer people-drawer glass" aria-labelledby="people-title">
      <div className="chat-head">
        <div><b id="people-title">افراد حاضر</b><span>{participants.length} نفر{hands.length ? ` · ${hands.length} دست بالا` : ""}</span></div>
        <button className="icon-btn" onClick={props.onClose} aria-label="بستن فهرست افراد"><Icon name="x" /></button>
      </div>

      {isHost && (
        <div className="host-tools" role="group" aria-label="ابزارهای میزبان">
          <button type="button" onClick={props.onMuteAll}><Icon name="micOff" size={15} /> بی‌صدا کردن همه</button>
          <button type="button" aria-pressed={locked} className={locked ? "on" : ""} onClick={props.onToggleLock}>
            <Icon name={locked ? "lock" : "unlock"} size={15} /> {locked ? "باز کردن ورود" : "قفل کردن تماس"}
          </button>
        </div>
      )}
      {!isHost && locked && <p className="people-note"><Icon name="lock" size={14} /> میزبان ورود تازه‌واردها را بسته است.</p>}

      <div className="people-list" role="list">
        {sorted.map((participant) => {
          const self = participant.id === selfId;
          const avatar = avatarOf(participant.avatar);
          const expanded = open === participant.id;
          const order = handOrder.get(participant.id);
          const level = quality[participant.id]?.level;
          const volume = props.volumes[participant.id] ?? 1;
          return (
            <div key={participant.id} role="listitem" className={expanded ? "person open" : "person"}>
              <button type="button" className="person-main" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : participant.id)}>
                <span className="person-avatar" style={{ background: avatar.gradient, "--accent": avatar.accent } as CSSProperties}><AvatarImage avatar={avatar} /></span>
                <span className="person-name">
                  <b>{participant.username}</b>
                  <small>
                    {self && "شما"}{participant.id === hostId && `${self ? " · " : ""}میزبان`}
                    {participant.connected === false && !self && "در حال اتصال…"}
                  </small>
                </span>
                <span className="person-badges">
                  {order && <span className="badge hand" title={`دست بالا — نوبت ${order}`}>✋ {order}</span>}
                  {participant.sharing && <span className="badge" title="در حال اشتراک صفحه"><Icon name="screen" size={13} /></span>}
                  {participant.rec && <span className="badge rec" title="در حال ضبط"><i /> REC</span>}
                  {participant.muted && <span className="badge muted" title="میکروفون خاموش"><Icon name="micOff" size={13} /></span>}
                  {!self && props.localMuted[participant.id] && <span className="badge" title="برای تو بی‌صدا شده"><Icon name="volume" size={13} /></span>}
                  {!self && <SignalBars level={level ?? (participant.connected === false ? 0 : 3)} title={qualityTitle(quality[participant.id])} />}
                </span>
              </button>

              {expanded && (
                <div className="person-detail">
                  {!self && (
                    <>
                      <label className="volume-row">
                        <span>صدای {participant.username} برای تو</span>
                        <input type="range" min="0" max="100" value={Math.round(volume * 100)} aria-label={`بلندی صدای ${participant.username}`} onChange={(event) => props.onVolume(participant.id, Number(event.target.value) / 100)} />
                        <strong>{Math.round(volume * 100)}٪</strong>
                      </label>
                      <button type="button" className={props.localMuted[participant.id] ? "mini on" : "mini"} onClick={() => props.onLocalMute(participant.id)}>
                        <Icon name={props.localMuted[participant.id] ? "volume" : "micOff"} size={14} /> {props.localMuted[participant.id] ? "برگرداندن صدا" : "بی‌صدا برای من"}
                      </button>
                    </>
                  )}
                  {isHost && !self && (
                    <div className="host-actions">
                      <button type="button" className="mini" onClick={() => props.onMuteRequest(participant.id)}><Icon name="micOff" size={14} /> درخواست بی‌صدا شدن</button>
                      {order && <button type="button" className="mini" onClick={() => props.onLowerHand(participant.id)}>✋ پایین آوردن دست</button>}
                      <button type="button" className="mini" onClick={() => { if (window.confirm(`میزبانی به ${participant.username} واگذار شود؟`)) props.onTransfer(participant.id); }}><Icon name="crown" size={14} /> واگذاری میزبانی</button>
                      <button type="button" className="mini danger" onClick={() => { if (window.confirm(`${participant.username} از این تماس حذف شود؟ دیگر نمی‌تواند برگردد.`)) props.onKick(participant.id); }}><Icon name="phoneOff" size={14} /> حذف از تماس</button>
                    </div>
                  )}
                  {self && <p className="person-self-note">اینجا می‌توانی کیفیت اتصال، دست و وضعیت دیگران را ببینی. برای تنظیم صدای خودت از «تنظیمات» استفاده کن.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
