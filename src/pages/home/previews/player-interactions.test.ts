// @vitest-environment jsdom

import Artplayer from "artplayer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PlayerInteractionsPlugin,
  pointerPosition,
  supportsVideoVolume,
  swipeSeekTime,
  togglePlayerFullscreen,
} from "./player-interactions"
import { playerIcon } from "./player-icons"

const cleanups: (() => void)[] = []
const volumeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "volume",
)!
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  Object.defineProperty(HTMLMediaElement.prototype, "volume", volumeDescriptor)
  vi.useRealTimers()
})

function rect(width = 800, height = 450) {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON() {},
  } as DOMRect
}

function setup() {
  const element = document.createElement("div")
  element.className = "art-video-player"
  element.innerHTML = `
    <video class="art-video"></video>
    <div class="art-bottom">
      <div class="art-control art-control-progress"></div>
      <div class="art-controls">
        <div class="art-control art-control-setting"></div>
        <div class="art-control art-control-fullscreen"></div>
        <div class="art-control art-control-quality art-control-selector">
          <div class="art-selector-value">1080p</div>
          <div class="art-selector-list"><div class="art-selector-item">720p</div></div>
        </div>
      </div>
    </div>
    <div class="art-settings"><input type="range" /></div>`
  document.body.append(element)
  const video = element.querySelector("video")!
  const progress = element.querySelector<HTMLElement>(".art-control-progress")!
  const bottom = element.querySelector<HTMLElement>(".art-bottom")!
  const setting = element.querySelector<HTMLElement>(".art-settings")!
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect())
  vi.spyOn(progress, "getBoundingClientRect").mockReturnValue(rect(800, 26))
  const captured = new Set<number>()
  element.setPointerCapture = vi.fn((id: number) => {
    captured.add(id)
  })
  element.hasPointerCapture = vi.fn((id: number) => captured.has(id))
  element.releasePointerCapture = vi.fn((id: number) => {
    captured.delete(id)
  })
  const events = new Map<string, Set<(...args: any[]) => void>>()
  const emit = (name: string, ...args: unknown[]) =>
    events.get(name)?.forEach((handler) => handler(...args))
  const state = {
    playing: true,
    currentTime: 600,
    duration: 7200,
    volume: 0.5,
    muted: false,
    rate: 1,
    fullscreen: false,
    fullscreenWeb: false,
    control: false,
    setting: false,
    locked: false,
    rotated: false,
  }
  const seek = vi.fn((time: number) => {
    state.currentTime = time
  })
  const player = {
    option: { lang: "zh-cn", isLive: false },
    template: {
      $player: element,
      $video: video,
      $progress: progress,
      $bottom: bottom,
      $setting: setting,
    },
    on: vi.fn((name: string, handler: (...args: any[]) => void) => {
      if (!events.has(name)) events.set(name, new Set())
      events.get(name)!.add(handler)
    }),
    off: vi.fn((name: string, handler: (...args: any[]) => void) =>
      events.get(name)?.delete(handler),
    ),
    emit,
    get currentTime() {
      return state.currentTime
    },
    get duration() {
      return state.duration
    },
    get playing() {
      return state.playing
    },
    get isLock() {
      return state.locked
    },
    get isRotate() {
      return state.rotated
    },
    get fullscreen() {
      return state.fullscreen
    },
    get fullscreenWeb() {
      return state.fullscreenWeb
    },
    set fullscreenWeb(value: boolean) {
      state.fullscreenWeb = value
    },
    get volume() {
      return state.volume
    },
    set volume(value: number) {
      state.volume = value
    },
    get muted() {
      return state.muted
    },
    set muted(value: boolean) {
      state.muted = value
    },
    get playbackRate() {
      return state.rate
    },
    set playbackRate(value: number) {
      state.rate = value
    },
    set seek(value: number) {
      seek(value)
    },
    pause: vi.fn(() => {
      state.playing = false
      emit("pause")
    }),
    play: vi.fn(async () => {
      state.playing = true
      emit("play")
    }),
    controls: {
      get show() {
        return state.control
      },
      set show(value: boolean) {
        state.control = value
        emit("control", value)
      },
    },
    setting: {
      get show() {
        return state.setting
      },
      set show(value: boolean) {
        state.setting = value
        emit("setting", value)
      },
    },
    notice: { show: "" },
  } as unknown as Artplayer
  PlayerInteractionsPlugin(player)
  cleanups.push(() => {
    emit("destroy")
    element.remove()
  })
  const pointer = (
    type: string,
    x = 400,
    y = 200,
    target: Element = video,
    pointerType = "touch",
    pointerId = 1,
    isPrimary = true,
  ) => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      pointerId: { value: pointerId },
      isPrimary: { value: isPrimary },
    })
    target.dispatchEvent(event)
    return event
  }
  const click = (target: Element = video, detail = 1) =>
    target.dispatchEvent(
      new MouseEvent("click", { detail, bubbles: true, cancelable: true }),
    )
  const tap = (x = 400, y = 200) => {
    pointer("pointerdown", x, y)
    pointer("pointerup", x, y)
    click()
  }
  return {
    player,
    state,
    element,
    video,
    progress,
    setting,
    pointer,
    click,
    tap,
    emit,
    seek,
  }
}

describe("player interaction helpers", () => {
  it("caps swipe sensitivity independently of movie length", () => {
    expect(swipeSeekTime(600, 400, 800, 7200)).toBe(660)
    expect(swipeSeekTime(600, 400, 800, 36000)).toBe(660)
    expect(swipeSeekTime(5, -400, 800, 60)).toBe(0)
    expect(swipeSeekTime(55, 400, 800, 60)).toBe(60)
    expect(swipeSeekTime(10, 100, 800, Infinity)).toBe(10)
  })

  it("maps CSS-rotated fullscreen coordinates into player space", () => {
    expect(pointerPosition(100, 300, rect(450, 800), true)).toEqual({
      x: 300,
      y: 350,
      width: 800,
      height: 450,
    })
  })

  it("detects read-only media volume without changing the active video", () => {
    expect(supportsVideoVolume()).toBe(true)
    vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1)
    vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(
      () => {},
    )
    expect(supportsVideoVolume()).toBe(false)
  })

  it("clones actual library icons without shared mutable nodes", () => {
    const first = playerIcon("danmaku")
    const second = playerIcon("danmaku")
    expect(first.querySelector("svg")).not.toBeNull()
    expect(first).not.toBe(second)
    expect(first.outerHTML).toBe(second.outerHTML)
  })
})

describe("touch and mouse playback", () => {
  it("a touch tap only shows controls, including its synthesized click", () => {
    const { tap, player, state } = setup()
    tap()
    expect(state.control).toBe(true)
    expect(player.pause).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(state.control).toBe(false)
  })

  it("a second isolated tap renews the control timer without hiding controls", () => {
    const { tap, state } = setup()
    tap()
    vi.advanceTimersByTime(2500)
    tap()
    vi.advanceTimersByTime(600)
    expect(state.control).toBe(true)
    expect(state.playing).toBe(true)
    vi.advanceTimersByTime(2400)
    expect(state.control).toBe(false)
  })

  it("double taps toggle playback once, not fullscreen or seeking", () => {
    const { tap, state, player, seek } = setup()
    tap()
    vi.advanceTimersByTime(100)
    tap()
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(state.fullscreenWeb).toBe(false)
    expect(seek).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    tap()
    vi.advanceTimersByTime(100)
    tap()
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it("does not treat taps far apart on the screen as double taps", () => {
    const { tap, player } = setup()
    tap(100)
    vi.advanceTimersByTime(100)
    tap(600)
    expect(player.pause).not.toHaveBeenCalled()
  })

  it("mouse double click enters fullscreen without first pausing", () => {
    const { pointer, click, player, state } = setup()
    pointer("pointerdown", 400, 200, undefined, "mouse")
    click()
    vi.advanceTimersByTime(100)
    click(undefined, 2)
    vi.advanceTimersByTime(400)
    expect(state.fullscreenWeb).toBe(true)
    expect(player.pause).not.toHaveBeenCalled()
  })

  it("uses mouse semantics on a tablet after a touch interaction", () => {
    const { pointer, click, tap, player, element } = setup()
    tap()
    vi.advanceTimersByTime(800)
    pointer("pointerdown", 400, 200, undefined, "mouse")
    click()
    vi.advanceTimersByTime(300)
    expect(element.dataset.openlistInput).toBe("mouse")
    expect(player.pause).toHaveBeenCalledTimes(1)
  })

  it("clears stale mouse hover when returning to touch", () => {
    const { pointer, tap, state, element } = setup()
    const control = element.querySelector<HTMLElement>(".art-control-setting")!
    pointer("pointermove", 700, 400, control, "mouse")
    tap()
    vi.advanceTimersByTime(3000)
    expect(state.control).toBe(false)
  })

  it("keeps control and settings input clicks out of video gestures", () => {
    const { pointer, click, setting, seek, player } = setup()
    const input = setting.querySelector("input")!
    pointer("pointerdown", 300, 200, input)
    pointer("pointermove", 600, 200, input)
    pointer("pointerup", 600, 200, input)
    click(input)
    expect(seek).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
  })
})

describe("gesture lifecycle", () => {
  it("previews while dragging and seeks only once on release", () => {
    const { pointer, click, seek, element, player } = setup()
    pointer("pointerdown", 200)
    pointer("pointermove", 400)
    pointer("pointermove", 600)
    expect(seek).not.toHaveBeenCalled()
    expect(
      element.querySelector<HTMLElement>(".openlist-seek-preview")?.hidden,
    ).toBe(false)
    pointer("pointerup", 600)
    click()
    expect(seek).toHaveBeenCalledExactlyOnceWith(660)
    expect(player.pause).not.toHaveBeenCalled()
  })

  it("handles mouse and touch progress positioning through the same path", () => {
    const { pointer, progress, seek } = setup()
    pointer("pointerdown", 200, 10, progress, "mouse")
    pointer("pointermove", 400, 10, progress, "mouse")
    expect(seek).not.toHaveBeenCalled()
    pointer("pointerup", 400, 10, progress, "mouse")
    expect(seek).toHaveBeenCalledExactlyOnceWith(3600)
  })

  it("cancels seeks on pointercancel and suppresses the trailing click", () => {
    const { pointer, click, seek, player } = setup()
    pointer("pointerdown", 200)
    pointer("pointermove", 600)
    pointer("pointercancel", 600)
    pointer("pointerup", 600)
    click()
    expect(seek).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
  })

  it("cancels multi-touch instead of treating it as a drag or tap", () => {
    const { pointer, seek, player } = setup()
    pointer("pointerdown", 200)
    pointer("pointerdown", 300, 200, undefined, "touch", 2, false)
    pointer("pointermove", 700)
    pointer("pointerup", 700)
    expect(seek).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
  })

  it("leaves vertical page scrolling alone outside fullscreen", () => {
    const { pointer, state, video, seek } = setup()
    pointer("pointerdown", 100, 200)
    const move = pointer("pointermove", 100, 50)
    pointer("pointerup", 100, 50)
    expect(move.defaultPrevented).toBe(false)
    expect(video.style.filter).toBe("")
    expect(state.volume).toBe(0.5)
    expect(seek).not.toHaveBeenCalled()
  })

  it("adjusts picture brightness on the left and media volume on the right", () => {
    const { pointer, state, video, element } = setup()
    state.fullscreenWeb = true
    pointer("pointerdown", 100, 200)
    pointer("pointermove", 100, 100)
    pointer("pointerup", 100, 100)
    expect(video.style.filter).toContain("brightness(1.222")
    expect(element.style.filter).toBe("")
    pointer("pointerdown", 700, 200)
    pointer("pointermove", 700, 100)
    pointer("pointerup", 700, 100)
    expect(state.volume).toBeCloseTo(0.72222)
  })

  it("skips unsupported iOS media volume gestures", () => {
    vi.spyOn(HTMLMediaElement.prototype, "volume", "get").mockReturnValue(1)
    vi.spyOn(HTMLMediaElement.prototype, "volume", "set").mockImplementation(
      () => {},
    )
    const { pointer, state, element } = setup()
    state.fullscreenWeb = true
    pointer("pointerdown", 700, 200)
    pointer("pointermove", 700, 100)
    pointer("pointerup", 700, 100)
    expect(state.volume).toBe(0.5)
    expect(
      element.querySelector<HTMLElement>(".openlist-gesture-hud")?.hidden,
    ).toBe(true)
  })

  it("restores the previous rate after a long press, cancellation, and source change", () => {
    const { pointer, state, emit } = setup()
    state.rate = 1.5
    for (const finish of [
      () => pointer("pointerup"),
      () => pointer("pointercancel"),
      () => emit("video:loadstart"),
    ]) {
      pointer("pointerdown")
      vi.advanceTimersByTime(501)
      expect(state.rate).toBe(2)
      finish()
      expect(state.rate).toBe(1.5)
    }
  })

  it("does not enable seeking or long-press speed for live streams", () => {
    const { player, state, pointer, seek } = setup()
    player.option.isLive = true
    state.duration = Infinity
    pointer("pointerdown", 200)
    vi.advanceTimersByTime(600)
    pointer("pointermove", 600)
    pointer("pointerup", 600)
    expect(state.rate).toBe(1)
    expect(seek).not.toHaveBeenCalled()
  })

  it("holds controls open while a panel is open", () => {
    const { emit, state, player } = setup()
    emit("openlist:panel", true)
    vi.advanceTimersByTime(6000)
    expect(state.control).toBe(true)
    player.controls.show = false
    expect(state.control).toBe(true)
    emit("openlist:panel", false)
    vi.advanceTimersByTime(3000)
    expect(state.control).toBe(false)
  })

  it("opens touch quality menus by tapping and closes them after selecting", () => {
    const { element, pointer, click } = setup()
    const control = element.querySelector<HTMLElement>(".art-control-quality")!
    pointer("pointerdown", 700, 400, control)
    click(control)
    expect(control.classList.contains("openlist-selector-open")).toBe(true)
    click(control.querySelector(".art-selector-item")!)
    expect(control.classList.contains("openlist-selector-open")).toBe(false)
  })

  it("removes listeners and restores temporary speed on destruction", () => {
    const { pointer, state, emit, element, tap, player } = setup()
    pointer("pointerdown")
    vi.advanceTimersByTime(501)
    emit("destroy")
    expect(state.rate).toBe(1)
    expect(element.querySelector(".openlist-gesture-hud")).toBeNull()
    tap()
    expect(player.pause).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("fullscreen and keyboard", () => {
  it("uses web fullscreen when container fullscreen is unavailable", () => {
    const { player, state } = setup()
    togglePlayerFullscreen(player)
    expect(state.fullscreenWeb).toBe(true)
    togglePlayerFullscreen(player)
    expect(state.fullscreenWeb).toBe(false)
  })

  it("recovers from a rejected fullscreen request", async () => {
    const { player, element, state } = setup()
    element.requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"))
    togglePlayerFullscreen(player)
    await Promise.resolve()
    expect(state.fullscreenWeb).toBe(true)
  })

  it("requests container fullscreen instead of the native video player", () => {
    const { player, element, state } = setup()
    element.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    togglePlayerFullscreen(player)
    expect(element.requestFullscreen).toHaveBeenCalledTimes(1)
    expect(state.fullscreenWeb).toBe(false)
  })

  it("handles player keyboard shortcuts but leaves text and range inputs alone", () => {
    const { element, setting, player } = setup()
    const nativeHotkey = vi.fn()
    document.addEventListener("keydown", nativeHotkey)
    const input = setting.querySelector("input")!
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(player.pause).not.toHaveBeenCalled()
    nativeHotkey.mockClear()
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(nativeHotkey).not.toHaveBeenCalled()
    document.removeEventListener("keydown", nativeHotkey)
  })

  it("supports keyboard selection without toggling playback", () => {
    const { element, player } = setup()
    const control = element.querySelector<HTMLElement>(".art-control-quality")!
    const item = control.querySelector<HTMLElement>(".art-selector-item")!
    const selected = vi.fn()
    item.addEventListener("click", selected)
    control.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(document.activeElement).toBe(item)
    item.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(selected).toHaveBeenCalledTimes(1)
    expect(control.classList.contains("openlist-selector-open")).toBe(false)
    expect(player.pause).not.toHaveBeenCalled()
  })
})

describe("Artplayer event compatibility", () => {
  it("does not let built-in progress or click handlers perform duplicate actions", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
    const container = document.createElement("div")
    document.body.append(container)
    const player = new Artplayer({
      container,
      url: "/test-video.mp4",
      gesture: false,
      fastForward: false,
      setting: true,
      fullscreenWeb: true,
      plugins: [PlayerInteractionsPlugin],
    })
    cleanups.push(() => {
      player.destroy()
      container.remove()
    })
    await Promise.resolve()
    const { $player, $video, $progress } = player.template
    Object.defineProperty($video, "duration", {
      configurable: true,
      value: 1000,
    })
    vi.spyOn($player, "getBoundingClientRect").mockReturnValue(rect())
    vi.spyOn($progress, "getBoundingClientRect").mockReturnValue(rect(800, 26))
    const seeks = vi.fn()
    play.mockClear()
    player.on("seek", seeks)
    const send = (type: string, target: HTMLElement, x: number) => {
      const event = new MouseEvent(type, {
        clientX: x,
        clientY: 10,
        button: 0,
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperties(event, {
        pointerType: { value: "mouse" },
        pointerId: { value: 1 },
        isPrimary: { value: true },
      })
      target.dispatchEvent(event)
    }
    send("pointerdown", $progress, 200)
    send("mousedown", $progress, 200)
    send("pointermove", $progress, 400)
    send("mousemove", $progress, 400)
    expect(seeks).not.toHaveBeenCalled()
    send("pointerup", $progress, 400)
    send("mouseup", $progress, 400)
    send("click", $progress, 400)
    expect(seeks).toHaveBeenCalledTimes(1)
    expect(player.currentTime).toBe(500)
    send("pointerdown", $video, 400)
    $video.dispatchEvent(
      new MouseEvent("click", { detail: 1, bubbles: true, cancelable: true }),
    )
    expect(play).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(play).toHaveBeenCalledTimes(1)
    expect(player.setting.find("openlist-player-more")).toBeDefined()
  })
})
