import { Obj } from "~/types"
import { ext } from "./path"

export type RelatedMediaTrackKind = "subtitle" | "audio"

export type RelatedMediaTrack = {
  kind: RelatedMediaTrackKind
  name: string
  label: string
  codec: string
  obj: Obj
}

const subtitleExtensions = new Set(["ass", "ssa", "srt", "vtt"])
const audioExtensions = new Set([
  "aac",
  "ac3",
  "eac3",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
])

const filenameStem = (name: string) => {
  const extension = ext(name)
  return extension ? name.slice(0, -(extension.length + 1)) : name
}

export const getRelatedMediaTracks = (
  videoName: string,
  related: Obj[],
): RelatedMediaTrack[] => {
  const videoStem = filenameStem(videoName).toLowerCase()
  const prefix = `${videoStem}.`
  const tracks: RelatedMediaTrack[] = []

  for (const obj of related) {
    const extension = ext(obj.name).toLowerCase()
    const lowerStem = filenameStem(obj.name).toLowerCase()
    if (!lowerStem.startsWith(prefix)) continue

    const kind = subtitleExtensions.has(extension)
      ? "subtitle"
      : audioExtensions.has(extension)
        ? "audio"
        : undefined
    if (!kind) continue

    const label = filenameStem(obj.name).slice(videoStem.length + 1)
    if (!label) continue

    tracks.push({
      kind,
      name: obj.name,
      label,
      codec: extension,
      obj,
    })
  }

  return tracks
}
