import {
  EmbyPlaybackInfo,
  EmbyPlaybackMediaSource,
  EmbyPlaybackStream,
} from "~/types"

const EMBY_DEVICE_ID_KEY = "openlist_emby_device_id"

export const isEmbyProvider = (provider: string) =>
  provider.trim().toLowerCase() === "emby"

export const getEmbyDeviceID = () => {
  let existing = localStorage.getItem(EMBY_DEVICE_ID_KEY)
  if (existing) return existing

  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const deviceID = `openlist-web-${random}`
  localStorage.setItem(EMBY_DEVICE_ID_KEY, deviceID)
  return deviceID
}

export const getEmbyMediaSource = (
  info: EmbyPlaybackInfo | undefined,
  sourceID = info?.selected_media_source_id,
): EmbyPlaybackMediaSource | undefined =>
  info?.media_sources.find((source) => source.id === sourceID) ??
  info?.media_sources[0]

export const getEmbySubtitle = (
  info: EmbyPlaybackInfo | undefined,
  subtitleIndex = info?.selected_subtitle_stream_index,
) =>
  getEmbyMediaSource(info)?.subtitle_streams.find(
    (stream) => stream.index === subtitleIndex,
  )

export const embyStreamLabel = (stream: EmbyPlaybackStream) =>
  stream.display_title ||
  stream.title ||
  [stream.language, stream.codec].filter(Boolean).join(" ") ||
  `#${stream.index}`

export const embyMediaSourceLabel = (source: EmbyPlaybackMediaSource) =>
  source.name ||
  [source.container?.toUpperCase(), source.protocol]
    .filter(Boolean)
    .join(" ") ||
  source.id

export const embySubtitleExtension = (codec: string) => {
  switch (codec.trim().toLowerCase()) {
    case "subrip":
      return "srt"
    case "webvtt":
      return "vtt"
    default:
      return codec.trim().toLowerCase() || "srt"
  }
}

export const ticksToSeconds = (ticks: number) =>
  Math.max(0, ticks || 0) / 10_000_000

export const secondsToTicks = (seconds: number) =>
  Math.max(0, Math.floor((seconds || 0) * 10_000_000))
