// @vitest-environment jsdom

import type Artplayer from "artplayer"
import type { Setting } from "artplayer"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  normalizeSubtitleStyle,
  SUBTITLE_STYLE_KEY,
  SubtitleStylePlugin,
  LEGACY_SUBTITLE_STYLE_KEY,
  migrateSubtitleStyle,
  subtitleLayout,
} from "./subtitle-style"

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function setup(saved?: unknown, legacy?: unknown) {
  const element = document.createElement("div")
  const subtitle = document.createElement("div")
  const assCanvas = document.createElement("canvas")
  const video = document.createElement("video")
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 854 },
    clientHeight: { configurable: true, value: 480 },
  })
  Object.defineProperties(video, {
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
  })
  element.append(subtitle, assCanvas)
  let settings: Setting[] = []
  const events = new Map<string, Set<() => void>>()
  const emit = (name: string) =>
    events.get(name)?.forEach((handler) => handler())
  const player = {
    option: { lang: "zh-cn" },
    aspectRatio: "default",
    template: { $player: element, $video: video, $subtitle: subtitle },
    on: vi.fn((name: string, handler: () => void) => {
      if (!events.has(name)) events.set(name, new Set())
      events.get(name)!.add(handler)
    }),
    off: vi.fn((name: string, handler: () => void) =>
      events.get(name)?.delete(handler),
    ),
    subtitle: {
      style: vi.fn((style) => Object.assign(subtitle.style, style)),
    },
    storage: {
      get: vi.fn((key: string) =>
        key === SUBTITLE_STYLE_KEY
          ? saved
          : key === LEGACY_SUBTITLE_STYLE_KEY
            ? legacy
            : undefined,
      ),
      set: vi.fn(),
    },
    setting: {
      add: vi.fn((item: Setting) => {
        settings = item.selector!
      }),
      find: (name: string) => settings.find((item) => item.name === name),
    },
  }
  SubtitleStylePlugin(player as unknown as Artplayer)
  cleanups.push(() => emit("destroy"))
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
  return { player, element, subtitle, assCanvas, settings, slide, emit }
}

describe("subtitle style", () => {
  it("uses defaults and rejects malformed stored settings", () => {
    const defaults = normalizeSubtitleStyle(undefined)
    expect(defaults).toMatchObject({
      scale: 100,
      outline: 1,
      bottom: 12,
      fontWeight: 400,
      backgroundOpacity: 0,
    })
    expect(normalizeSubtitleStyle("invalid")).toEqual(defaults)
    expect(
      normalizeSubtitleStyle({
        scale: "30",
        outline: NaN,
        bottom: Infinity,
      }),
    ).toEqual(defaults)
    expect(
      normalizeSubtitleStyle({ scale: 900, outline: -1, bottom: 240 }),
    ).toMatchObject({
      scale: 250,
      outline: 0,
      bottom: 40,
    })
    expect(normalizeSubtitleStyle({ outline: 1.26 }).outline).toBe(1.3)
  })

  it("migrates legacy pixels to a bounded relative scale", () => {
    expect(
      migrateSubtitleStyle({ fontSize: 32, bottom: 96, outline: 2 }),
    ).toMatchObject({
      scale: 160,
      bottom: 20,
      outline: 2,
    })
    const { player, element } = setup(undefined, { fontSize: 24, bottom: 15 })
    expect(player.storage.get).toHaveBeenCalledWith(LEGACY_SUBTITLE_STYLE_KEY)
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      "24px",
    )
  })

  it("restores styles and fixes the bottom position without changing ASS", () => {
    const { element, subtitle, assCanvas, settings } = setup({
      scale: 160,
      outline: 2,
      bottom: 20,
      fontWeight: 700,
    })
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      "32px",
    )
    expect(element.style.getPropertyValue("--art-subtitle-bottom")).toBe("96px")
    expect(subtitle.style.textShadow).toContain("2px 0px 1px #000")
    expect(subtitle.style.bottom).toBe("var(--art-subtitle-bottom)")
    expect(subtitle.style.transition).toBe("none")
    expect(subtitle.style.fontWeight).toBe("700")
    expect(assCanvas.style.cssText).toBe("")
    expect(settings.filter((item) => item.range)).toHaveLength(7)
  })

  it("previews while dragging and saves on release", () => {
    const { slide, player, element, subtitle } = setup()
    expect(slide("scale", 180, "onChange")).toBe("180%")
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      "36px",
    )
    expect(player.storage.set).not.toHaveBeenCalled()
    slide("scale", 180)
    slide("outline", 0)
    slide("bottom", 25)
    expect(subtitle.style.textShadow).toBe("none")
    expect(player.storage.set).toHaveBeenLastCalledWith(
      SUBTITLE_STYLE_KEY,
      expect.objectContaining({
        scale: 180,
        outline: 0,
        bottom: 25,
      }),
    )
    const restored = setup(player.storage.set.mock.lastCall![1])
    expect(
      restored.element.style.getPropertyValue("--art-subtitle-bottom"),
    ).toBe("120px")
  })

  it("resets styles, sliders and persisted values together", () => {
    const { settings, element, player } = setup({
      scale: 250,
      outline: 3,
      bottom: 40,
      color: "#ffff00",
      fontFamily: "serif",
      backgroundOpacity: 80,
    })
    const reset = settings.find(
      (item) => item.name === "openlist-subtitle-reset",
    )!
    ;(reset.onClick as Function)()
    expect(settings.slice(0, 3).map((item) => item.range![0])).toEqual([
      100, 400, 1,
    ])
    expect(settings.slice(0, 3).map((item) => item.tooltip)).toEqual([
      "100%",
      "400",
      "1px",
    ])
    expect(element.style.getPropertyValue("--art-subtitle-bottom")).toBe(
      "57.6px",
    )
    expect(
      settings.find((item) => item.name === "openlist-subtitle-color")?.tooltip,
    ).toBe("白色")
    expect(player.storage.set).toHaveBeenLastCalledWith(
      SUBTITLE_STYLE_KEY,
      normalizeSubtitleStyle(undefined),
    )
  })

  it("rescales on fullscreen round trips and handles letterboxing", () => {
    const { element, emit } = setup()
    const initial = element.style.getPropertyValue("--art-subtitle-font-size")
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 1920 },
      clientHeight: { configurable: true, value: 1080 },
    })
    emit("fullscreen")
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      "45px",
    )
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 854 },
      clientHeight: { configurable: true, value: 480 },
    })
    emit("fullscreen")
    expect(element.style.getPropertyValue("--art-subtitle-font-size")).toBe(
      initial,
    )
    expect(
      subtitleLayout(800, 600, 16 / 9, { scale: 100, bottom: 10 }),
    ).toEqual({
      fontSize: 18.75,
      bottom: 120,
    })
    expect(
      subtitleLayout(320, 180, 16 / 9, { scale: 50, bottom: 0 }).fontSize,
    ).toBe(12)
  })

  it("keeps text and background opacity separate and preserves inline markup", () => {
    const { element, subtitle, slide, emit } = setup()
    subtitle.innerHTML = '<div class="art-subtitle-line"><i>字幕</i></div>'
    emit("subtitleAfterUpdate")
    emit("subtitleAfterUpdate")
    expect(subtitle.querySelectorAll(".openlist-subtitle-text")).toHaveLength(1)
    expect(
      subtitle.querySelector(".openlist-subtitle-text > i")?.textContent,
    ).toBe("字幕")
    slide("opacity", 60)
    slide("backgroundOpacity", 75)
    expect(element.style.getPropertyValue("--openlist-subtitle-opacity")).toBe(
      "0.6",
    )
    expect(
      element.style.getPropertyValue("--openlist-subtitle-background"),
    ).toBe("rgba(0, 0, 0, 0.75)")
    expect(subtitle.style.opacity).toBe("")
  })

  it("disconnects its resize observer and listeners", () => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = disconnect
        observe = observe
      },
    )
    const { player, element, emit } = setup()
    expect(observe).toHaveBeenCalledWith(element)
    emit("destroy")
    expect(disconnect).toHaveBeenCalled()
    expect(player.off).toHaveBeenCalledWith("resize", expect.any(Function))
  })
})
