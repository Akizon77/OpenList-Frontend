import { convertURL } from "./str"

export interface ExternalPlayerMedia {
  rawURL: string
  directURL: string
  name: string
  subtitleURL?: string
  positionSeconds?: number
}

const encodePotPlayerValue = (value: string) =>
  encodeURI(value).replaceAll('"', "%22")

const formatSeek = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  return [hours, minutes, remaining]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":")
}

export const buildExternalPlayerURL = (
  player: { name: string; scheme: string },
  media: ExternalPlayerMedia,
) => {
  const directURL = media.directURL || media.rawURL
  if (player.name === "PotPlayer") {
    const options = ["/current"]
    if (media.subtitleURL) {
      options.push(`/sub="${encodePotPlayerValue(media.subtitleURL)}"`)
    }
    if ((media.positionSeconds ?? 0) > 0) {
      options.push(`/seek=${formatSeek(media.positionSeconds!)}`)
    }
    if (media.name) {
      options.push(`/title="${encodePotPlayerValue(media.name)}"`)
    }
    return `potplayer://${encodePotPlayerValue(directURL)} ${options.join(" ")}`
  }

  return convertURL(player.scheme, {
    raw_url: media.rawURL || directURL,
    name: media.name,
    d_url: directURL,
  })
}
