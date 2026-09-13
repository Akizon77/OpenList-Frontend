import {
  TbChevronDown,
  TbMessage2,
  TbMessage2Off,
  TbPlayerPause,
  TbPlayerPlay,
  TbPlayerTrackNext,
  TbSun,
  TbVolume,
} from "solid-icons/tb"
import { createRoot } from "solid-js"

const icons = {
  chevron: TbChevronDown,
  danmaku: TbMessage2,
  danmakuOff: TbMessage2Off,
  play: TbPlayerPlay,
  pause: TbPlayerPause,
  seek: TbPlayerTrackNext,
  brightness: TbSun,
  volume: TbVolume,
}

const templates = new Map<keyof typeof icons, HTMLElement>()

export function playerIcon(name: keyof typeof icons) {
  if (!templates.has(name)) {
    const template = createRoot((dispose) => {
      const element = document.createElement("span")
      element.className = "openlist-player-icon"
      element.setAttribute("aria-hidden", "true")
      element.append(icons[name]({ size: 22 }) as SVGElement)
      const snapshot = element.cloneNode(true) as HTMLElement
      dispose()
      return snapshot
    })
    templates.set(name, template)
  }
  return templates.get(name)!.cloneNode(true) as HTMLElement
}
