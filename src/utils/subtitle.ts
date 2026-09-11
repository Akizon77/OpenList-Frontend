import { ext } from "./path"

const SUBTITLE_EXTENSIONS = new Set(["srt", "ass", "vtt"])

export const isSubtitleFile = (name: string) => {
  return SUBTITLE_EXTENSIONS.has(ext(name).toLowerCase())
}

export const buildPotPlayerURL = (videoURL: string, subtitleURL?: string) => {
  return `potplayer://${videoURL}${subtitleURL ? ` /sub=${subtitleURL}` : ""}`
}
