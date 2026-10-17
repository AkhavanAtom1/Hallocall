import { deviceLabel, supportsSinkId } from "../lib/devices";
import type { DeviceLists } from "../lib/devices";
import type { Prefs } from "../lib/prefs";
import { playSound } from "../lib/sounds";
import { Icon } from "./Icon";

export const SHORTCUTS: Array<[string, string]> = [
  ["M", "روشن/خاموش کردن میکروفون"],
  ["Space", "فشار و نگه‌داشتن برای صحبت (وقتی «فشار برای صحبت» روشن است)"],
  ["H", "بالا/پایین بردن دست"],
  ["S", "شروع/توقف اشتراک صفحه"],
  ["C", "گفت‌وگو"],
  ["P", "فهرست افراد"],
  ["B", "تخته سفید"],
  ["Esc", "بستن پنجره‌ها"],
];

/** In-call settings: devices, audio processing, push-to-talk, sounds. */
export function SettingsSheet({
  prefs, onPrefs, devices, currentMicId, onMic, onSpeaker, onProcessing, microphoneReady, onEnableMic, onClose,
}: {
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  devices: DeviceLists;
  currentMicId: string;
  onMic: (deviceId: string) => void;
  onSpeaker: (deviceId: string) => void;
  /** Called after a processing toggle so the microphone is re-opened with the new constraints. */
  onProcessing: (patch: Partial<Prefs>) => void;
  microphoneReady: boolean;
  onEnableMic: () => void;
  onClose: () => void;
}) {
  const sink = supportsSinkId();
  const micValue = devices.mics.some((device) => device.deviceId === currentMicId) ? currentMicId : "";

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-sheet glass" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="sheet-head">
          <b id="settings-title">تنظیمات تماس</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن تنظیمات"><Icon name="x" /></button>
        </div>

        <div className="sheet-body">
          <h3>صدا</h3>
          {!microphoneReady && (
            <div className="sheet-note">
              <span>میکروفون وصل نیست و فقط شنونده‌ای.</span>
              <button type="button" onClick={onEnableMic}>فعال‌سازی میکروفون</button>
            </div>
          )}
          <div className="lobby-field">
            <label htmlFor="set-mic">میکروفون</label>
            <select id="set-mic" value={micValue} disabled={!devices.mics.length} onChange={(event) => onMic(event.target.value)}>
              <option value="">پیش‌فرض سیستم</option>
              {devices.mics.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, "mic")}</option>)}
            </select>
          </div>
          {sink ? (
            <div className="lobby-field">
              <label htmlFor="set-speaker">خروجی صدا (بلندگو / هدفون)</label>
              <div className="lobby-row">
                <select id="set-speaker" value={devices.speakers.some((device) => device.deviceId === prefs.speakerId) ? prefs.speakerId : ""} onChange={(event) => onSpeaker(event.target.value)}>
                  <option value="">پیش‌فرض سیستم</option>
                  {devices.speakers.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, "speaker")}</option>)}
                </select>
                <button type="button" className="lobby-test" onClick={() => playSound("test", 0.2, prefs.speakerId || undefined)}><Icon name="volume" size={16} /> تست</button>
              </div>
            </div>
          ) : (
            <p className="sheet-hint">انتخاب خروجی صدا فقط در مرورگرهای مبتنی بر Chromium (Chrome، Edge) پشتیبانی می‌شود.</p>
          )}

          <label className="switch-row"><input type="checkbox" checked={prefs.noiseSuppression} onChange={(event) => onProcessing({ noiseSuppression: event.target.checked })} /><span>حذف نویز محیط</span></label>
          <label className="switch-row"><input type="checkbox" checked={prefs.echoCancellation} onChange={(event) => onProcessing({ echoCancellation: event.target.checked })} /><span>حذف اکو</span></label>
          <label className="switch-row"><input type="checkbox" checked={prefs.autoGain} onChange={(event) => onProcessing({ autoGain: event.target.checked })} /><span>تنظیم خودکار بلندی صدا</span></label>
          <label className="switch-row"><input type="checkbox" checked={prefs.pushToTalk} onChange={(event) => onPrefs({ pushToTalk: event.target.checked })} /><span>فشار برای صحبت (نگه‌داشتن Space؛ میکروفون در حالت عادی خاموش است)</span></label>

          <h3>صداهای اعلان</h3>
          <label className="switch-row"><input type="checkbox" checked={prefs.soundJoinLeave} onChange={(event) => onPrefs({ soundJoinLeave: event.target.checked })} /><span>صدای ورود و خروج افراد</span></label>
          <label className="switch-row"><input type="checkbox" checked={prefs.soundMessage} onChange={(event) => onPrefs({ soundMessage: event.target.checked })} /><span>صدای پیام جدید</span></label>

          <h3>ورود به تماس</h3>
          <label className="switch-row"><input type="checkbox" checked={prefs.skipLobby} onChange={(event) => onPrefs({ skipLobby: event.target.checked })} /><span>صفحهٔ آماده‌سازی قبل از ورود را نشان نده</span></label>
          <label className="switch-row"><input type="checkbox" checked={prefs.joinMuted} onChange={(event) => onPrefs({ joinMuted: event.target.checked })} /><span>همیشه با میکروفون خاموش وارد شو</span></label>

          <h3>میانبرهای صفحه‌کلید</h3>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([key, text]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{text}</dd></div>)}
          </dl>
        </div>
      </section>
    </div>
  );
}
