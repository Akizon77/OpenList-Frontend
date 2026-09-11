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

export interface EmbyDirectPlayProfile {
  container: string
  video_codec: string
  audio_codec: string
}

export interface EmbyWebClientProfile {
  direct_play_profiles: EmbyDirectPlayProfile[]
  hevc_codec_tags: string[]
}

const canPlay = (media: HTMLMediaElement, mimeType: string) =>
  media.canPlayType(mimeType).replace(/no/i, "") !== ""

const addCodec = (codecs: string[], codec: string, supported: boolean) => {
  if (supported && !codecs.includes(codec)) codecs.push(codec)
}

export const getEmbyWebClientProfile = (): EmbyWebClientProfile => {
  const video = document.createElement("video")
  const audio = document.createElement("audio")
  const direct_play_profiles: EmbyDirectPlayProfile[] = []

  const mp4VideoCodecs: string[] = []
  const mp4AudioCodecs: string[] = []
  const hevc_codec_tags: string[] = []

  addCodec(
    mp4VideoCodecs,
    "h264",
    canPlay(video, 'video/mp4; codecs="avc1.42E01E"'),
  )
  const supportsHVC1 = canPlay(video, 'video/mp4; codecs="hvc1.1.L120"')
  const supportsHEV1 = canPlay(video, 'video/mp4; codecs="hev1.1.L120"')
  addCodec(mp4VideoCodecs, "hevc", supportsHVC1 || supportsHEV1)
  addCodec(
    mp4VideoCodecs,
    "av1",
    canPlay(video, 'video/mp4; codecs="av01.0.08M.08"') ||
      canPlay(video, 'video/mp4; codecs="av01.0.08M.10"'),
  )
  addCodec(
    mp4VideoCodecs,
    "vp9",
    canPlay(video, 'video/mp4; codecs="vp09.00.10.08"'),
  )
  addCodec(
    mp4AudioCodecs,
    "aac",
    canPlay(audio, 'audio/mp4; codecs="mp4a.40.2"'),
  )
  addCodec(mp4AudioCodecs, "mp3", canPlay(audio, "audio/mpeg"))
  addCodec(mp4AudioCodecs, "ac3", canPlay(audio, 'audio/mp4; codecs="ac-3"'))
  addCodec(mp4AudioCodecs, "eac3", canPlay(audio, 'audio/mp4; codecs="ec-3"'))
  addCodec(mp4AudioCodecs, "opus", canPlay(audio, 'audio/mp4; codecs="opus"'))
  addCodec(mp4AudioCodecs, "flac", canPlay(audio, 'audio/mp4; codecs="fLaC"'))
  addCodec(mp4AudioCodecs, "alac", canPlay(audio, 'audio/mp4; codecs="alac"'))

  if (supportsHVC1) hevc_codec_tags.push("hvc1")
  if (supportsHEV1) hevc_codec_tags.push("hev1")
  if (canPlay(video, 'video/mp4; codecs="dvh1.05.06"')) {
    hevc_codec_tags.push("dvh1")
  }
  if (canPlay(video, 'video/mp4; codecs="dvhe.05.06"')) {
    hevc_codec_tags.push("dvhe")
  }

  if (mp4VideoCodecs.length) {
    direct_play_profiles.push({
      container: "mp4,m4v",
      video_codec: mp4VideoCodecs.join(","),
      audio_codec: mp4AudioCodecs.join(","),
    })
  }

  const movVideoCodecs: string[] = []
  addCodec(
    movVideoCodecs,
    "h264",
    canPlay(video, 'video/quicktime; codecs="avc1.42E01E"'),
  )
  addCodec(
    movVideoCodecs,
    "hevc",
    canPlay(video, 'video/quicktime; codecs="hvc1.1.L120"') ||
      canPlay(video, 'video/quicktime; codecs="hev1.1.L120"'),
  )
  if (movVideoCodecs.length) {
    direct_play_profiles.push({
      container: "mov",
      video_codec: movVideoCodecs.join(","),
      audio_codec: mp4AudioCodecs.join(","),
    })
  }

  const webmVideoCodecs: string[] = []
  const webmAudioCodecs: string[] = []
  addCodec(webmVideoCodecs, "vp8", canPlay(video, 'video/webm; codecs="vp8"'))
  addCodec(
    webmVideoCodecs,
    "vp9",
    canPlay(video, 'video/webm; codecs="vp9"') ||
      canPlay(video, 'video/webm; codecs="vp09.00.10.08"'),
  )
  addCodec(
    webmVideoCodecs,
    "av1",
    canPlay(video, 'video/webm; codecs="av01.0.08M.08"'),
  )
  addCodec(webmAudioCodecs, "opus", canPlay(audio, 'audio/webm; codecs="opus"'))
  addCodec(
    webmAudioCodecs,
    "vorbis",
    canPlay(audio, 'audio/webm; codecs="vorbis"'),
  )
  if (webmVideoCodecs.length) {
    direct_play_profiles.push({
      container: "webm",
      video_codec: webmVideoCodecs.join(","),
      audio_codec: webmAudioCodecs.join(","),
    })
  }

  const mkvType = ["video/x-matroska", "video/mkv"].find((type) =>
    canPlay(video, type),
  )
  if (mkvType) {
    direct_play_profiles.push({
      container: "mkv,matroska",
      video_codec: [...new Set([...mp4VideoCodecs, ...webmVideoCodecs])].join(
        ",",
      ),
      audio_codec: [...new Set([...mp4AudioCodecs, ...webmAudioCodecs])].join(
        ",",
      ),
    })
  }

  const transportVideoCodecs: string[] = []
  addCodec(
    transportVideoCodecs,
    "h264",
    canPlay(video, 'video/mp2t; codecs="avc1.42E01E"'),
  )
  addCodec(
    transportVideoCodecs,
    "hevc",
    canPlay(video, 'video/mp2t; codecs="hvc1.1.L120"'),
  )
  if (transportVideoCodecs.length) {
    direct_play_profiles.push({
      container: "ts,mpegts",
      video_codec: transportVideoCodecs.join(","),
      audio_codec: mp4AudioCodecs.join(","),
    })
  }

  if (mp4VideoCodecs.includes("h264")) {
    direct_play_profiles.push({
      container: "flv,m2ts",
      video_codec: "h264",
      audio_codec: mp4AudioCodecs
        .filter((codec) => codec === "aac" || codec === "mp3")
        .join(","),
    })
  }

  return { direct_play_profiles, hevc_codec_tags }
}

export const ticksToSeconds = (ticks: number) =>
  Math.max(0, ticks || 0) / 10_000_000

export const secondsToTicks = (seconds: number) =>
  Math.max(0, Math.floor((seconds || 0) * 10_000_000))
