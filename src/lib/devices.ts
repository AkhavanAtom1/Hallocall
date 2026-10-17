/** Audio device helpers (microphone / speaker pickers). */
export type DeviceLists = { mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };

export async function listDevices(): Promise<DeviceLists> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], speakers: [] };
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: devices.filter((device) => device.kind === "audioinput" && device.deviceId !== ""),
      speakers: devices.filter((device) => device.kind === "audiooutput" && device.deviceId !== ""),
    };
  } catch {
    return { mics: [], speakers: [] };
  }
}

/** Choosing the output device (speaker/headset) is only possible in Chromium-based browsers. */
export function supportsSinkId(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

export function deviceLabel(device: MediaDeviceInfo, index: number, kind: "mic" | "speaker") {
  if (device.label) return device.label;
  return kind === "mic" ? `میکروفون ${index + 1}` : `خروجی صدا ${index + 1}`;
}
