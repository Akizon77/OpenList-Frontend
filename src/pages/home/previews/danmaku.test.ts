// @vitest-environment jsdom

import * as OpenCC from "opencc-js/t2cn"
import type Artplayer from "artplayer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DanmakuComment } from "~/types"
import {
  DANMAKU_CONFIG_KEY,
  LEGACY_DANMAKU_CONFIG_KEY,
  createDefaultDanmakuConfig,
  loadDanmakuConfig,
  type DanmakuConfig,
} from "./danmaku-config"
import {
  danmakuModeToEngineMode,
  normalizeComments,
  parseBilibiliXml,
  prepareDisplayComments,
  toDanmuJsComment,
} from "./danmaku-data"
import { DanmuJsRenderer } from "./danmaku-renderer"

describe("danmaku data pipeline", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("parses Bilibili XML modes, entities, and six-digit colors", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <i>
        <d p="1.25,1,25,16711680,0,0,0,0">滚动 &amp; &lt;标签&gt;</d>
        <d p="2.5,4,25,255,0,0,0,0">底部</d>
        <d p="3.75,5,25,65280,0,0,0,0">顶部</d>
        <d p="4.5,3,25,,0,0,0,0">三号也是滚动</d>
      </i>`

    const comments = parseBilibiliXml(xml)

    expect(comments).toHaveLength(4)
    expect(comments.map((comment) => comment.mode)).toEqual([0, 2, 1, 0])
    expect(comments[0]).toMatchObject({
      text: "滚动 & <标签>",
      color: "#ff0000",
    })
    expect(comments[1].color).toBe("#0000ff")
    expect(comments[2].color).toBe("#00ff00")
    expect(comments[3].color).toBeUndefined()
    expect(() => parseBilibiliXml("<i><d")).toThrow("Invalid Bilibili XML")
  })

  it("filters invalid comments, sorts stably, and makes unique IDs", () => {
    const comments = normalizeComments([
      {
        text: " duplicate ",
        time: 5,
        mode: 2,
        color: "#abc",
      },
      { text: "invalid color", time: 4, mode: 0, color: "red" },
      { text: "valid first", time: 1, mode: 0, color: "#fff" },
      { text: "missing time", mode: 0 },
      { text: "", time: 2, mode: 0 },
      { text: "invalid mode", time: 3, mode: 9 },
      {
        text: " duplicate ",
        time: 5,
        mode: 2,
        color: "#abc",
      },
    ])

    expect(comments).toHaveLength(3)
    expect(comments.map((comment) => comment.text)).toEqual([
      "valid first",
      "duplicate",
      "duplicate",
    ])
    expect(comments[0].color).toBe("#ffffff")
    expect(comments[1].mode).toBe(2)
    expect(comments[1].id).not.toBe(comments[2].id)
  })

  it("migrates the legacy configuration once and uses the new key", () => {
    localStorage.setItem(
      LEGACY_DANMAKU_CONFIG_KEY,
      JSON.stringify({
        visible: false,
        fontSize: 31,
        opacity: 0.42,
        mode: 0,
        modes: [1],
        antiOverlap: true,
        synchronousPlayback: true,
        heatmap: false,
        speed: 9,
        margin: ["12%", "18%"],
      }),
    )

    const config = loadDanmakuConfig()

    expect(config).toMatchObject({
      visible: false,
      fontSize: 31,
      opacity: 0.42,
      modes: {
        scroll: true,
        top: true,
        bottom: false,
      },
      antiOverlap: true,
      followPlaybackRate: true,
      heatmap: false,
      speed: 1,
      spacing: 100,
      displayArea: 50,
      traditionalToSimplified: true,
      fontFamily: "system",
      fontWeight: "normal",
      outline: 2,
    })
    expect(localStorage.getItem(LEGACY_DANMAKU_CONFIG_KEY)).toBeNull()
    expect(localStorage.getItem(DANMAKU_CONFIG_KEY)).not.toBeNull()

    localStorage.setItem(
      LEGACY_DANMAKU_CONFIG_KEY,
      JSON.stringify({ visible: true, fontSize: 36 }),
    )
    const second = loadDanmakuConfig()
    expect(second.visible).toBe(false)
    expect(second.fontSize).toBe(31)
  })

  it("maps business modes to danmu.js modes", () => {
    expect(danmakuModeToEngineMode(0)).toBe("scroll")
    expect(danmakuModeToEngineMode(1)).toBe("top")
    expect(danmakuModeToEngineMode(2)).toBe("bottom")
    const config = createDefaultDanmakuConfig()
    expect(config.spacing).toBe(100)
    expect(config.outline).toBe(2)

    const comment = toDanmuJsComment(
      {
        id: "style-test",
        text: "样式",
        time: 1,
        mode: 0,
        color: "#ffffff",
      },
      5000,
      {
        fontSize: 30,
        fontFamily: "serif",
        fontWeight: "bold",
        outline: 5,
        spacing: 100,
      },
    )
    expect(comment.style).toMatchObject({
      color: "#ffffff",
      fontSize: "30px",
      fontFamily: '"Songti SC", STSong, SimSun, "Noto Serif CJK SC", serif',
      fontWeight: "700",
      WebkitTextStroke: "1.8px rgba(0, 0, 0, 0.96)",
      paddingRight: "100px",
    })
    expect(comment.style?.textShadow).toBeTruthy()
  })

  it("converts a display copy to Simplified Chinese without mutating raw comments", async () => {
    const raw = normalizeComments([
      {
        text: '漢語 & <臺灣> "異體字"',
        time: 1,
        mode: 0,
      },
      {
        text: '漢語 & <臺灣> "異體字"',
        time: 2,
        mode: 0,
      },
      {
        text: "简体保持不变",
        time: 3,
        mode: 0,
      },
    ])
    const before = structuredClone(raw)
    const converter = OpenCC.Converter({ from: "t", to: "cn" })
    const spy = vi.fn(converter)

    const converted = await prepareDisplayComments(raw, true, spy, {
      batchSize: 1,
      cache: new Map<string, string>(),
    })

    expect(converted?.[0].text).toBe('汉语 & <台湾> "异体字"')
    expect(converted?.[1].text).toBe(converted?.[0].text)
    expect(converted?.[2].text).toBe("简体保持不变")
    expect(raw).toEqual(before)
    expect(
      spy.mock.calls.filter(([text]) => text === '漢語 & <臺灣> "異體字"'),
    ).toHaveLength(1)

    spy.mockClear()
    const restored = await prepareDisplayComments(raw, false, spy)
    expect(restored).toEqual(raw)
    expect(restored).not.toBe(raw)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("danmu.js renderer integration", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    mockDanmakuLayout()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("uses a narrow scan window instead of rendering seconds early", async () => {
    const player = createRendererPlayer()
    const renderer = new DanmuJsRenderer(player, rendererConfig())

    await renderer.load(
      normalizeComments([{ text: "timed", time: 1.5, mode: 0 }]),
    )
    const layer = player.template.$player.querySelector(
      ".openlist-danmaku-layer",
    )
    expect(layer?.children).toHaveLength(0)

    player.video.currentTime = 1.4
    renderer.resync()
    expect(layer?.children).toHaveLength(1)
    renderer.destroy()
  })

  it("only applies chase offsets when overlap prevention is enabled", async () => {
    const player = createRendererPlayer()
    const config = rendererConfig({ antiOverlap: false })
    const renderer = new DanmuJsRenderer(player, config)
    const updateOffset = vi.fn()
    const channel = {
      addBullet: (bullet: { updateOffset?: (offset: number) => unknown }) =>
        bullet.updateOffset?.(80),
    }

    ;(
      renderer as unknown as {
        installCollisionPolicy: (engine: unknown) => void
      }
    ).installCollisionPolicy({ main: { channel } })

    channel.addBullet({ mode: "scroll", updateOffset } as never)
    expect(updateOffset).not.toHaveBeenCalled()

    await renderer.updateConfig({ ...config, antiOverlap: true })
    channel.addBullet({ mode: "scroll", updateOffset } as never)
    expect(updateOffset).toHaveBeenCalledWith(80)
    renderer.destroy()
  })

  it("retries a source load when conversion settings change", async () => {
    const player = createRendererPlayer()
    const config = rendererConfig({ traditionalToSimplified: true })
    const renderer = new DanmuJsRenderer(player, config)
    const comments = normalizeComments(
      Array.from({ length: 1001 }, (_, index) => ({
        text: `漢語 ${index}`,
        time: index,
        mode: 0,
      })),
    )

    const loading = renderer.load(comments)
    const updating = renderer.updateConfig({
      ...config,
      traditionalToSimplified: false,
    })

    await expect(loading).resolves.toBe(true)
    await updating
    const displayComments = (
      renderer as unknown as { displayComments: DanmakuComment[] }
    ).displayComments
    expect(displayComments).toHaveLength(comments.length)
    expect(displayComments[0].text).toBe("漢語 0")
    renderer.destroy()
  })
})

function rendererConfig(overrides: Partial<DanmakuConfig> = {}): DanmakuConfig {
  const config = createDefaultDanmakuConfig()
  return {
    ...config,
    ...overrides,
    modes: { ...config.modes, ...overrides.modes },
    spacing: overrides.spacing ?? 0,
    traditionalToSimplified: overrides.traditionalToSimplified ?? false,
  }
}

function createRendererPlayer(): Artplayer {
  const playerElement = document.createElement("div")
  const progress = document.createElement("div")
  const video = document.createElement("video")
  playerElement.appendChild(progress)
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: 0, writable: true },
    duration: { configurable: true, value: 120, writable: true },
    paused: { configurable: true, value: true },
    ended: { configurable: true, value: false },
    seeking: { configurable: true, value: false },
  })

  return {
    video,
    width: 800,
    template: {
      $player: playerElement,
      $progress: progress,
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Artplayer
}

function mockDanmakuLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains("openlist-danmaku-layer")) {
        return rect(0, 0, 800, 450)
      }
      if (this.parentElement?.classList.contains("openlist-danmaku-layer")) {
        if (this.textContent === "short") return rect(600, 0, 100, 25)
        if (this.textContent === "a much longer comment") {
          return rect(800, 0, 300, 25)
        }
        return rect(800, 0, 100, 25)
      }
      return rect(0, 0, 800, 450)
    },
  )
}

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}
