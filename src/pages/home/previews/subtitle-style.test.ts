// @vitest-environment jsdom

import type Artplayer from "artplayer"
import type { Setting } from "artplayer"
import { describe, expect, it, vi } from "vitest"
import {
  normalizeSubtitleStyle,
  SUBTITLE_STYLE_KEY,
  SubtitleStylePlugin,
} from "./subtitle-style"

function setup(saved?: unknown) {
  const element = document.createElement("div")
  const subtitle = document.createElement("div")
  const assCanvas = document.createElement("canvas")
  element.append(subtitle, assCanvas)
  let settings: Setting[] = []
  const player = {
    option: { lang: "zh-cn" },
    template: { $player: element },
    subtitle: {
      style: vi.fn((style) => Object.assign(subtitle.style, style)),
    },
    storage: { get: vi.fn(() => saved), set: vi.fn() },
    setting: {
      add: vi.fn((item: Setting) => {
        settings = item.selector!
      }),
      find: (name: string) => settings.find((item) => item.name === name),
    },
  }
  SubtitleStylePlugin(player as unknown as Artplayer)
  const slide = (
    key: string,
    value: number,
    event: "onChange" | "onRange" = "onRange",
  ) => {
    const item = settings.find(
      (item) => item.name === `openlist-subtitle-${key}`,
    )!
    item.range![0] = value
    return (item[event] as Function)(item)
  }
  return { player, element, subtitle, assCanvas, settings, slide }
}

describe("subtitle style", () => {
  it("uses defaults and rejects malformed stored settings", () => {
    const defaults = { fontSize: 20, outline: 1, bottom: 15 }
    expect(normalizeSubtitleStyle(undefined)).toEqual(defaults)
    expect(normalizeSubtitleStyle("invalid")).toEqual(defaults)
    expect(
      normalizeSubtitleStyle({
        fontSize: "30",
        outline: NaN,
        bottom: Infinity,
      }),
    ).toEqual(defaults)
    expect(
      normalizeSubtitleStyle({ fontSize: 90, outline: -1, bottom: 240 }),
    ).toEqual({
      fontSize: 64,
      outline: 0,
      bottom: 200,
    })
    expect(normalizeSubtitleStyle({ outline: 1.26 }).outline).toBe(1.3)
  })

  it("restores all three settings without changing ASS or fixing the bottom position", () => {
    const { element, subtitle, assCanvas, settings } = setup({
      fontSize: 32,
      outline: 2,
      bottom: 60,
    })
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      "32px",
    )
    expect(element.style.getPropertyValue("--art-subtitle-bottom")).toBe("60px")
    expect(subtitle.style.textShadow).toContain("2px 0px 1px #000")
    expect(subtitle.style.bottom).toBe("")
    expect(assCanvas.style.cssText).toBe("")
    expect(settings.filter((item) => item.range)).toHaveLength(3)
  })

  it("previews while dragging and saves on release", () => {
    const { slide, player, element, subtitle } = setup()
    expect(slide("fontSize", 36, "onChange")).toBe("36px")
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      "36px",
    )
    expect(player.storage.set).not.toHaveBeenCalled()
    slide("fontSize", 36)
    slide("outline", 0)
    slide("bottom", 80)
    expect(subtitle.style.textShadow).toBe("none")
    expect(player.storage.set).toHaveBeenLastCalledWith(SUBTITLE_STYLE_KEY, {
      fontSize: 36,
      outline: 0,
      bottom: 80,
    })
    const restored = setup(player.storage.set.mock.lastCall![1])
    expect(
      restored.element.style.getPropertyValue("--art-subtitle-bottom"),
    ).toBe("80px")
  })

  it("resets styles, sliders and persisted values together", () => {
    const { settings, element, player } = setup({
      fontSize: 50,
      outline: 3,
      bottom: 100,
    })
    const reset = settings.find(
      (item) => item.name === "openlist-subtitle-reset",
    )!
    ;(reset.onClick as Function)()
    expect(settings.slice(0, 3).map((item) => item.range![0])).toEqual([
      20, 1, 15,
    ])
    expect(settings.slice(0, 3).map((item) => item.tooltip)).toEqual([
      "20px",
      "1px",
      "15px",
    ])
    expect(element.style.getPropertyValue("--art-subtitle-bottom")).toBe("15px")
    expect(player.storage.set).toHaveBeenLastCalledWith(SUBTITLE_STYLE_KEY, {
      fontSize: 20,
      outline: 1,
      bottom: 15,
    })
  })
})
