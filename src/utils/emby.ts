const EMBY_DEVICE_ID_KEY = "openlist_emby_device_id"

export const isEmbyProvider = (provider: string) =>
  provider.trim().toLowerCase() === "emby"

export const getEmbyDeviceID = () => {
  let existing = localStorage.getItem(EMBY_DEVICE_ID_KEY)
  if (existing) return existing

  const random =
    globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
  const deviceID = "openlist-web-" + random
  localStorage.setItem(EMBY_DEVICE_ID_KEY, deviceID)
  return deviceID
}

export const ticksToSeconds = (ticks: number) =>
  Math.max(0, ticks || 0) / 10_000_000

export const secondsToTicks = (seconds: number) =>
  Math.max(0, Math.floor((seconds || 0) * 10_000_000))
