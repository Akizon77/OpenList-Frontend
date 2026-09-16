// @vitest-environment jsdom

import * as OpenCC from "opencc-js/t2cn"
// @ts-expect-error jsdom does not ship type declarations in this project.
import { JSDOM } from "jsdom"
import type Artplayer from "artplayer"
import type { Setting } from "artplayer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DanmakuComment } from "~/types"
import {
  DANMAKU_CONFIG_KEY,
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
import { DanmakuController } from "./danmaku"

// These unit tests exercise the controller without bootstrapping the app.
vi.mock("~/app/i18n", () => ({ currentLang: () => "zh-CN" }))
vi.mock("~/store", () => ({ getSettingBool: () => true }))
vi.mock("~/utils", () => ({
  danmakuSearch: vi.fn(),
  danmakuComments: vi.fn(),
  ext: (name: string) => name.split(".").pop() ?? "",
}))

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

  it("loads supported numeric configuration values", () => {
    localStorage.setItem(
      DANMAKU_CONFIG_KEY,
      JSON.stringify({
        visible: false,
        fontSize: 31,
        fontFamily: "serif",
        fontWeight: 700,
        outline: 1.2,
        opacity: 0.4,
        modes: { scroll: true, top: true, bottom: false },
        antiOverlap: true,
        followPlaybackRate: true,
        heatmap: false,
        traditionalToSimplified: false,
        displayArea: 75,
        speed: 1.25,
        spacing: 200,
        lineSpacing: 8,
      }),
    )

    const config = loadDanmakuConfig()

    expect(config).toMatchObject({
      visible: false,
      fontSize: 31,
      fontFamily: "serif",
      fontWeight: 700,
      outline: 1.2,
      opacity: 0.4,
      modes: {
        scroll: true,
        top: true,
        bottom: false,
      },
      antiOverlap: true,
      followPlaybackRate: true,
      heatmap: false,
      traditionalToSimplified: false,
      displayArea: 75,
      speed: 1.25,
      spacing: 200,
      lineSpacing: 8,
    })
  })

  it("uses defaults for unsupported numeric configuration values", () => {
    localStorage.setItem(
      DANMAKU_CONFIG_KEY,
      JSON.stringify({
        fontSize: 31.5,
        fontWeight: 650,
        outline: 3.1,
        opacity: 0.42,
        displayArea: 91,
        speed: 2.5,
        spacing: 125,
        lineSpacing: -1,
      }),
    )

    const config = loadDanmakuConfig()
    expect(config).toMatchObject({
      fontSize: 25,
      fontWeight: 400,
      outline: 0.5,
      opacity: 1,
      displayArea: 50,
      speed: 1,
      spacing: 100,
      lineSpacing: 3,
    })
  })

  it("does not migrate earlier configuration keys", () => {
    localStorage.setItem(
      "openlist_danmaku_config_v2",
      JSON.stringify({ fontSize: 36, fontWeight: "bold", outline: 5 }),
    )

    expect(loadDanmakuConfig()).toEqual(createDefaultDanmakuConfig())
  })

  it("maps business modes to danmu.js modes", () => {
    expect(danmakuModeToEngineMode(0)).toBe("scroll")
    expect(danmakuModeToEngineMode(1)).toBe("top")
    expect(danmakuModeToEngineMode(2)).toBe("bottom")
    const config = createDefaultDanmakuConfig()
    expect(config.spacing).toBe(100)
    expect(config.lineSpacing).toBe(3)
    expect(config.outline).toBe(0.5)

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
        fontWeight: 700,
        outline: 1.8,
        spacing: 100,
        lineSpacing: 4,
      },
    )
    expect(comment.style).toMatchObject({
      color: "#ffffff",
      fontSize: "30px",
      fontFamily: '"Songti SC", STSong, SimSun, "Noto Serif CJK SC", serif',
      fontWeight: "700",
      lineHeight: "34px",
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

describe("danmaku player settings", () => {
  const cleanup: (() => void)[] = []
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup.splice(0).forEach((dispose) => dispose())
  })

  function setupSettings() {
    const element = document.createElement("div")
    const toolbar = document.createElement("div")
    element.append(toolbar)
    document.body.append(element)
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    let settings: Setting[] = [
      {
        name: "openlist-player-more",
        html: "更多",
        selector: [
          {
            name: "openlist-player-pip",
            html: "画中画",
            onClick: () => "",
          },
        ],
      },
    ]
    const find = (name: string) => {
      let result: Setting | undefined
      const visit = (items: Setting[]) => {
        for (const item of items) {
          if (item.name === name) result = item
          if (item.selector) visit(item.selector)
        }
      }
      visit(settings)
      return result
    }
    const setting = {
      show: false,
      active: settings,
      add: (item: Setting) => {
        settings.push(item)
        return setting
      },
      update: (item: Setting) => {
        const index = settings.findIndex((value) => value.name === item.name)
        if (index >= 0) settings[index] = item
        else settings.push(item)
        return setting
      },
      find,
      remove: (name: string) => {
        settings = settings.filter((item) => item.name !== name)
        return setting
      },
      render: vi.fn(),
    } as unknown as Artplayer["setting"] & {
      active: Setting[]
      render: ReturnType<typeof vi.fn>
    }
    const controls = {
      show: false,
      add: (option: {
        name: string
        html: string | HTMLElement
        click: () => void
      }) => {
        const control = document.createElement("div")
        control.className = `art-control art-control-${option.name}`
        control.tabIndex = 0
        if (typeof option.html === "string") control.innerHTML = option.html
        else control.append(option.html)
        control.addEventListener("click", option.click)
        toolbar.append(control)
        controls[option.name] = control
      },
      remove: (name: string) => {
        controls[name]?.remove()
        delete controls[name]
      },
    } as unknown as Artplayer["controls"]
    const player = {
      template: { $player: element },
      controls,
      setting,
      on: (name: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name)!.add(handler)
      },
      off: (name: string, handler: (...args: unknown[]) => void) =>
        listeners.get(name)?.delete(handler),
      emit: (name: string, ...args: unknown[]) =>
        listeners.get(name)?.forEach((handler) => handler(...args)),
    } as unknown as Artplayer
    const controller = new DanmakuController({
      player: () => player,
      getPath: () => "/test.mkv",
      getPassword: () => "",
    })
    const internal = controller as unknown as {
      player: Artplayer
      addToggleControl: () => void
      installSettings: () => void
    }
    internal.player = player
    internal.addToggleControl()
    internal.installSettings()
    cleanup.push(() => {
      controller.destroy()
      element.remove()
    })
    return { controller, player, element, controls, setting, find }
  }

  it("keeps only the toggle in the bottom bar and uses the provided icons", () => {
    const { controls } = setupSettings()
    const toggle = controls["danmaku-toggle"]!
    expect(
      Object.keys(controls).filter((name) => name.startsWith("danmaku-")),
    ).toEqual(["danmaku-toggle"])
    expect(toggle.querySelector(".bui-danmaku-switch-on")).not.toBeNull()
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    toggle.click()
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    expect(toggle.getAttribute("aria-label")).toBe("开启弹幕")
    expect(toggle.querySelector(".bui-danmaku-switch-off")).not.toBeNull()
    expect(JSON.parse(localStorage.getItem(DANMAKU_CONFIG_KEY)!).visible).toBe(
      false,
    )
  })

  it("places source and display menus under the native More menu", () => {
    const { find } = setupSettings()
    const more = find("openlist-player-more")

    expect(more?.selector?.map((item) => item.name)).toEqual([
      "openlist-player-pip",
      "openlist-danmaku-source",
      "openlist-danmaku-display",
    ])
    expect(find("openlist-danmaku-source")?.html).toBe("弹幕来源")
    expect(find("openlist-danmaku-display")?.html).toBe("弹幕设置")
  })

  it("uses ArtPlayer switch and range items for danmaku display settings", () => {
    const { find } = setupSettings()
    const display = find("openlist-danmaku-display")
    const names = display?.selector?.map((item) => item.name) ?? []

    expect(names).toContain("openlist-danmaku-visible")
    expect(names).toContain("openlist-danmaku-fontSize")
    expect(names).toContain("openlist-danmaku-fontFamily")
    expect(find("openlist-danmaku-visible")?.switch).toBe(true)
    expect(find("openlist-danmaku-fontSize")?.range).toEqual([25, 16, 36, 1])
    expect(find("openlist-danmaku-fontFamily")?.selector?.length).toBe(5)

    const size = find("openlist-danmaku-fontSize")!
    size.onChange?.call(
      {} as Artplayer,
      {
        ...size,
        range: [32, 16, 36, 1],
      } as never,
      {} as HTMLDivElement,
      new Event("input"),
    )
    expect(JSON.parse(localStorage.getItem(DANMAKU_CONFIG_KEY)!).fontSize).toBe(
      32,
    )
  })

  it("removes its menus and toggle when destroyed", () => {
    const { controller, controls, find } = setupSettings()
    controller.destroy()
    expect(controls["danmaku-toggle"]).toBeUndefined()
    expect(find("openlist-danmaku-source")).toBeUndefined()
    expect(find("openlist-danmaku-display")).toBeUndefined()
  })
})

describe("danmaku ArtPlayer submenu navigation", () => {
  it("keeps the native back item after updating the More menu", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="player"></div></body></html>',
      { url: "http://localhost", pretendToBeVisual: true },
    )
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: globalThis.navigator,
      screen: globalThis.screen,
      location: globalThis.location,
      HTMLElement: globalThis.HTMLElement,
      Element: globalThis.Element,
      Node: globalThis.Node,
      Event: globalThis.Event,
      MouseEvent: globalThis.MouseEvent,
      CustomEvent: globalThis.CustomEvent,
      getComputedStyle: globalThis.getComputedStyle,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
    }
    const bind = (key: keyof typeof previous, value: unknown) => {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      })
    }
    bind("window", dom.window)
    bind("document", dom.window.document)
    bind("navigator", dom.window.navigator)
    bind("screen", dom.window.screen)
    bind("location", dom.window.location)
    bind("HTMLElement", dom.window.HTMLElement)
    bind("Element", dom.window.Element)
    bind("Node", dom.window.Node)
    bind("Event", dom.window.Event)
    bind("MouseEvent", dom.window.MouseEvent)
    bind("CustomEvent", dom.window.CustomEvent)
    bind("getComputedStyle", dom.window.getComputedStyle)
    bind("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
    )
    bind("cancelAnimationFrame", clearTimeout)

    try {
      const { default: Artplayer } = await import("artplayer")
      const player = new Artplayer({
        container: "#player",
        url: "",
        setting: true,
        autoplay: false,
        muted: true,
        controls: [],
        settings: [
          {
            name: "openlist-player-more",
            html: "更多",
            selector: [
              {
                name: "openlist-player-pip",
                html: "画中画",
                onClick: () => "",
              },
            ],
          },
        ],
      })
      const controller = new DanmakuController({
        player: () => player,
        getPath: () => "/test.mkv",
        getPassword: () => "",
      })
      const internal = controller as unknown as {
        player: Artplayer
        addToggleControl: () => void
        installSettings: () => void
      }
      internal.player = player
      internal.addToggleControl()
      internal.installSettings()
      const toggle = player.controls["danmaku-toggle"]!
      expect(toggle.querySelector(".bui-danmaku-switch-on")).not.toBeNull()
      toggle.click()
      expect(toggle.getAttribute("aria-pressed")).toBe("false")
      expect(toggle.querySelector(".bui-danmaku-switch-on")).toBeNull()
      expect(toggle.querySelector(".bui-danmaku-switch-off")).not.toBeNull()
      expect(player.setting.find("openlist-danmaku-visible")?.switch).toBe(
        false,
      )
      toggle.click()
      expect(toggle.getAttribute("aria-pressed")).toBe("true")
      expect(toggle.querySelector(".bui-danmaku-switch-on")).not.toBeNull()
      expect(toggle.querySelector(".bui-danmaku-switch-off")).toBeNull()
      player.setting.show = true
      const more = player.setting.find("openlist-player-more")!
      ;(
        player.setting as Artplayer["setting"] & {
          render: (option?: Setting[]) => void
        }
      ).render(more.selector)

      document
        .querySelector<HTMLElement>('[data-name="openlist-danmaku-source"]')
        ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
      await Promise.resolve()

      const current = document.querySelector(".art-setting-panel.art-current")
      expect(
        current?.querySelector(":scope > .art-setting-item-back"),
      ).not.toBeNull()
      controller.destroy()
      player.destroy()
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        bind(key as keyof typeof previous, value)
      }
      dom.window.close()
    }
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
