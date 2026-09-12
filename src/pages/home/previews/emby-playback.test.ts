// @vitest-environment jsdom

import type Artplayer from "artplayer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EmbyPlaybackInfo } from "~/types"
import { createEmbyPlayback } from "./emby-playback"

const { fsOther, notifyError } = vi.hoisted(() => ({
  fsOther: vi.fn(),
  notifyError: vi.fn(),
}))

vi.mock("~/utils", () => ({
  fsOther,
  notify: { error: notifyError },
  ext: (name: string) => name.split(".").pop() ?? "",
}))

const playbackInfo = (
  overrides: Partial<EmbyPlaybackInfo> = {},
): EmbyPlaybackInfo => ({
  item_id: "episode-1",
  item_type: "Episode",
  name: "Episode 1",
  media_type: "Video",
  run_time_ticks: 600_000_000,
  playback_position_ticks: 120_000_000,
  play_session_id: "session-1",
  device_id: "test-device",
  selected_media_source_id: "source-1",
  selected_audio_stream_index: 1,
  selected_subtitle_stream_index: 2,
  playback_url: "/original.mp4",
  playback_type: "mp4",
  playback_method: "DirectPlay",
  transcoding_qualities: [
    { name: "8 Mbps", max_height: 1080, max_streaming_bitrate: 8_000_000 },
    { name: "4 Mbps", max_height: 720, max_streaming_bitrate: 4_000_000 },
  ],
  ...overrides,
})

function setup(info = playbackInfo()) {
  const handlers = new Map<string, () => void>()
  const player = {
    currentTime: 12,
    playing: true,
    muted: false,
    volume: 0.6,
    option: { url: "/original.mp4" },
    notice: { show: "" },
    controls: { update: vi.fn(), remove: vi.fn() },
    on: vi.fn((event: string, handler: () => void) =>
      handlers.set(event, handler),
    ),
    off: vi.fn((event: string) => handlers.delete(event)),
  }
  let path = "/library/episode.mkv"
  const switchUrl = vi.fn().mockResolvedValue(undefined)
  fsOther.mockImplementation(async (_path, method) => ({
    code: 200,
    message: "",
    data: method === "playback_info" ? info : {},
  }))
  const controller = createEmbyPlayback({
    player: player as unknown as Artplayer,
    getPath: () => path,
    getName: () => path.split("/").pop()!,
    getPassword: () => "folder-password",
    switchUrl,
  })
  return {
    player,
    switchUrl,
    controller,
    emit: (event: string) => handlers.get(event)?.(),
    setPath: (value: string) => {
      path = value
    },
    selectQuality: (value: string) => {
      const control = player.controls.update.mock.lastCall![0]
      return control.onSelect({ value }) as Promise<string>
    },
  }
}

const callsFor = (method: string) =>
  fsOther.mock.calls.filter((call) => call[1] === method)

describe("Emby playback integration", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-12T00:00:00Z"))
    vi.clearAllMocks()
    localStorage.clear()
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("")
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("starts in auto mode, resumes progress and keeps every quality choice", async () => {
    const { controller, player, switchUrl, emit } = setup()
    await controller.load("/fallback.mkv")

    expect(callsFor("playback_info")[0]).toEqual([
      "/library/episode.mkv",
      "playback_info",
      expect.objectContaining({ playback_mode: "auto", mode: "web" }),
      "folder-password",
    ])
    expect(switchUrl).toHaveBeenCalledWith("/original.mp4", 12, "mp4")
    expect(controller.info()?.play_session_id).toBe("session-1")
    const choices = player.controls.update.mock.lastCall![0].selector
    expect(choices.map((choice: { value: string }) => choice.value)).toEqual([
      "auto",
      "direct",
      "transcode:8000000",
      "transcode:4000000",
    ])
    expect(choices[0].default).toBe(true)
    emit("play")
    emit("video:playing")
    expect(callsFor("playback_start")).toHaveLength(1)
  })

  it("throttles progress, but reports pause and stop immediately", async () => {
    const { controller, player, emit } = setup()
    await controller.load("/fallback.mkv")
    player.currentTime = 25
    emit("video:timeupdate")
    emit("video:timeupdate")
    expect(callsFor("playback_progress")).toHaveLength(1)
    expect(callsFor("playback_progress")[0][2]).toMatchObject({
      position_ticks: 250_000_000,
      volume_level: 60,
      is_paused: false,
    })
    await vi.advanceTimersByTimeAsync(10_000)
    emit("video:timeupdate")
    player.playing = false
    emit("pause")
    expect(callsFor("playback_progress")).toHaveLength(3)
    expect(callsFor("playback_progress").at(-1)![2].is_paused).toBe(true)
    emit("video:ended")
    expect(callsFor("playback_stop")).toHaveLength(1)
    controller.destroy()
    expect(player.off).toHaveBeenCalledTimes(5)
    emit("play")
    expect(callsFor("playback_start")).toHaveLength(1)
  })

  it("switches bitrate while preserving position, tracks and report order", async () => {
    const { controller, player, switchUrl, selectQuality } = setup()
    await controller.load("/fallback.mkv")
    player.currentTime = 45
    fsOther.mockImplementation(async (_path, method) => ({
      code: 200,
      data:
        method === "playback_info"
          ? playbackInfo({
              play_session_id: "session-2",
              playback_url: "/transcoded.m3u8",
              playback_type: "m3u8",
              playback_method: "Transcode",
            })
          : {},
    }))
    await selectQuality("transcode:4000000")
    expect(callsFor("playback_info").at(-1)![2]).toMatchObject({
      playback_mode: "transcode",
      max_streaming_bitrate: 4_000_000,
      media_source_id: "source-1",
      audio_stream_index: 1,
      subtitle_stream_index: 2,
    })
    expect(switchUrl).toHaveBeenLastCalledWith("/transcoded.m3u8", 45, "m3u8")
    expect(fsOther.mock.calls.slice(-3).map((call) => call[1])).toEqual([
      "playback_info",
      "playback_stop",
      "playback_start",
    ])
    expect(callsFor("playback_stop").at(-1)![2].play_session_id).toBe(
      "session-1",
    )
    expect(callsFor("playback_start").at(-1)![2].play_session_id).toBe(
      "session-2",
    )
  })

  it("falls back from auto once, using the last known playback position", async () => {
    const { controller, player, switchUrl, emit } = setup()
    await controller.load("/fallback.mkv")
    player.currentTime = 34
    emit("video:timeupdate")
    player.currentTime = 0
    controller.onError()
    controller.onError()
    expect(player.option.url).toBe("")
    await vi.advanceTimersByTimeAsync(1100)
    expect(callsFor("playback_info")).toHaveLength(2)
    expect(callsFor("playback_info")[1][2]).toMatchObject({
      playback_mode: "transcode",
      max_streaming_bitrate: 8_000_000,
    })
    expect(switchUrl).toHaveBeenLastCalledWith("/original.mp4", 34, "mp4")
    controller.onError()
    await vi.advanceTimersByTimeAsync(2000)
    expect(callsFor("playback_info")).toHaveLength(2)
  })

  it("keeps explicit original quality without automatic transcoding", async () => {
    const { controller, selectQuality } = setup()
    await controller.load("/fallback.mkv")
    await selectQuality("direct")
    controller.onError()
    await vi.advanceTimersByTimeAsync(2000)
    expect(callsFor("playback_info")).toHaveLength(2)
    expect(callsFor("playback_info")[1][2].playback_mode).toBe("direct")
  })

  it("falls back to the original URL when playback info fails", async () => {
    const { controller, switchUrl } = setup()
    fsOther.mockResolvedValue({ code: 500, message: "unavailable" })
    await controller.load("/fallback.mkv")
    expect(controller.info()).toBeUndefined()
    expect(switchUrl).toHaveBeenCalledWith("/fallback.mkv")
    expect(callsFor("playback_start")).toHaveLength(0)
  })

  it("reports the previous path before loading another episode", async () => {
    const { controller, setPath } = setup()
    await controller.load("/fallback.mkv")
    setPath("/library/next.mkv")
    await controller.load("/next.mkv")
    expect(callsFor("playback_stop")[0][0]).toBe("/library/episode.mkv")
    expect(callsFor("playback_start").at(-1)![0]).toBe("/library/next.mkv")
    expect(callsFor("playback_info").at(-1)![2].media_source_id).toBeUndefined()
  })

  it("ignores an in-flight response when returning to a normal video", async () => {
    const { controller, switchUrl } = setup()
    let resolve!: (value: unknown) => void
    fsOther.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const loading = controller.load("/fallback.mkv")
    controller.reset()
    resolve({ code: 200, data: playbackInfo() })
    await loading
    expect(controller.info()).toBeUndefined()
    expect(switchUrl).not.toHaveBeenCalled()
  })

  it("clears the quality control and cancels pending fallback on disposal", async () => {
    const { controller, player } = setup()
    await controller.load("/fallback.mkv")
    controller.onError()
    controller.reset()
    expect(player.controls.remove).toHaveBeenCalledWith("emby-quality")
    controller.destroy()
    await vi.advanceTimersByTimeAsync(2000)
    expect(callsFor("playback_info")).toHaveLength(1)
  })
})
