import type Artplayer from "artplayer"
import type { Events } from "artplayer"
import { createSignal } from "solid-js"
import type { EmbyPlaybackInfo } from "~/types"
import { ext, fsOther, notify } from "~/utils"
import {
  getEmbyDeviceID,
  getEmbyWebClientProfile,
  secondsToTicks,
  ticksToSeconds,
} from "~/utils/emby"

type EmbyPlaybackMode = "auto" | "direct" | "transcode"

interface EmbyQualityChoice {
  key: string
  label: string
  playbackMode: EmbyPlaybackMode
  maxStreamingBitrate?: number
}

interface EmbyPlaybackOptions {
  player: Artplayer
  getPath: () => string
  getName: () => string
  getPassword: () => string
  switchUrl: (
    url: string,
    resumeSeconds?: number,
    type?: string,
  ) => Promise<unknown>
}

export const createEmbyPlayback = (options: EmbyPlaybackOptions) => {
  const {
    player,
    getPath: pathname,
    getPassword: password,
    switchUrl,
  } = options
  const [embyInfo, setEmbyInfo] = createSignal<EmbyPlaybackInfo>()
  const embyDeviceID = getEmbyDeviceID()
  const embyClientProfile = getEmbyWebClientProfile()
  const playbackType = () => ext(options.getName())
  let activeEmbySessionID = ""
  let activeEmbyPath = ""
  let lastEmbyProgressAt = 0
  let lastEmbyPlaybackSeconds = 0
  let embyRequestVersion = 0
  let embyOriginalURL = ""
  let activeEmbyQualityKey = ""
  let hasEmbyQualityControl = false
  let embyQualitySwitching = false
  let embyAutoFallbackAttempted = false
  let embyAutoFallbackTimer: number | undefined

  const reportEmbyPlayback = async (
    method: "playback_start" | "playback_progress" | "playback_stop",
    info = embyInfo(),
  ) => {
    if (!info?.play_session_id || !activeEmbyPath || !player) return
    try {
      const positionSeconds = Number.isFinite(player.currentTime)
        ? player.currentTime
        : ticksToSeconds(info.playback_position_ticks)
      const resp = await fsOther(
        activeEmbyPath,
        method,
        {
          device_id: embyDeviceID,
          play_session_id: info.play_session_id,
          media_source_id: info.selected_media_source_id,
          audio_stream_index: info.selected_audio_stream_index,
          subtitle_stream_index: info.selected_subtitle_stream_index,
          position_ticks: secondsToTicks(positionSeconds),
          is_paused: !player.playing,
          is_muted: player.muted,
          volume_level: Math.round(player.volume * 100),
          play_method: info.playback_method,
        },
        password(),
      )
      if (resp.code !== 200) {
        console.warn("Emby " + method + " failed: " + resp.message)
      }
    } catch (error) {
      console.warn("Emby " + method + " failed", error)
    }
  }

  const startEmbyPlayback = () => {
    const info = embyInfo()
    if (
      !info?.play_session_id ||
      activeEmbySessionID === info.play_session_id
    ) {
      return
    }
    activeEmbySessionID = info.play_session_id
    void reportEmbyPlayback("playback_start", info)
  }

  const requestEmbyPlayback = async (
    requestPath: string,
    playbackMode: EmbyPlaybackMode,
    maxStreamingBitrate?: number,
  ) => {
    const current = requestPath === activeEmbyPath ? embyInfo() : undefined
    const resp = await fsOther<EmbyPlaybackInfo>(
      requestPath,
      "playback_info",
      {
        mode: "web",
        playback_mode: playbackMode,
        device_id: embyDeviceID,
        media_source_id: current?.selected_media_source_id,
        audio_stream_index: current?.selected_audio_stream_index,
        subtitle_stream_index: current?.selected_subtitle_stream_index,
        max_streaming_bitrate: maxStreamingBitrate,
        ...embyClientProfile,
      },
      password(),
    )
    if (resp.code !== 200) throw new Error(resp.message)
    return resp.data
  }

  const getEmbyQualityChoices = (info = embyInfo()) => {
    if (!info) return []
    const choices: EmbyQualityChoice[] = [
      { key: "auto", label: "自动", playbackMode: "auto" },
      { key: "direct", label: "原始", playbackMode: "direct" },
    ]
    for (const quality of info.transcoding_qualities ?? []) {
      choices.push({
        key: `transcode:${quality.max_streaming_bitrate}`,
        label: `${quality.max_height}p · ${quality.name}`,
        playbackMode: "transcode",
        maxStreamingBitrate: quality.max_streaming_bitrate,
      })
    }
    return choices
  }

  const activeEmbyQualityLabel = () =>
    getEmbyQualityChoices().find(
      (choice) => choice.key === activeEmbyQualityKey,
    )?.label ?? "自动"

  const switchEmbyQuality = async (
    choice: EmbyQualityChoice,
    options?: { automatic?: boolean; resumeSeconds?: number },
  ) => {
    if (choice.key === activeEmbyQualityKey || embyQualitySwitching) {
      return activeEmbyQualityLabel()
    }
    if (!options?.automatic) {
      embyAutoFallbackAttempted = false
    }
    const requestID = ++embyRequestVersion
    const requestPath = activeEmbyPath || pathname()
    const previousInfo = embyInfo()
    const previousQualityKey = activeEmbyQualityKey
    const currentPlaybackSeconds = Number.isFinite(player.currentTime)
      ? player.currentTime
      : 0
    const position =
      options?.resumeSeconds ??
      Math.max(currentPlaybackSeconds, lastEmbyPlaybackSeconds)
    let fallbackAfterSwitch = false
    embyQualitySwitching = true
    player.notice.show = `正在切换到 ${choice.label}`
    try {
      const info = await requestEmbyPlayback(
        requestPath,
        choice.playbackMode,
        choice.maxStreamingBitrate,
      )
      if (requestID !== embyRequestVersion) return activeEmbyQualityLabel()
      if (previousInfo?.play_session_id) {
        await reportEmbyPlayback("playback_stop", previousInfo)
      }
      setEmbyInfo(info)
      activeEmbySessionID = ""
      lastEmbyProgressAt = 0
      if (choice.playbackMode === "auto") {
        activeEmbyQualityKey = choice.key
      }
      await switchUrl(
        info.playback_url || embyOriginalURL,
        position,
        info.playback_type || playbackType(),
      )
      activeEmbyQualityKey = choice.key
      lastEmbyPlaybackSeconds = position
      startEmbyPlayback()
      player.notice.show = `画质：${choice.label}`
      return choice.label
    } catch (error) {
      if (requestID === embyRequestVersion) {
        console.warn("Emby quality switch failed", error)
        if (!options?.automatic && choice.playbackMode === "auto") {
          fallbackAfterSwitch = true
        } else {
          notify.error(
            options?.automatic
              ? "原始流无法播放，自动回退失败，请手动选择画质"
              : error instanceof Error
                ? error.message
                : "Emby 画质切换失败",
          )
        }
      }
      return activeEmbyQualityLabel()
    } finally {
      embyQualitySwitching = false
      setTimeout(() => {
        if (
          fallbackAfterSwitch &&
          !fallbackEmbyAutoPlayback() &&
          requestID === embyRequestVersion
        ) {
          activeEmbyQualityKey = previousQualityKey
        }
        updateEmbyQualityControl()
      }, 0)
    }
  }

  const fallbackEmbyAutoPlayback = () => {
    const info = embyInfo()
    if (
      !info ||
      activeEmbyQualityKey !== "auto" ||
      embyAutoFallbackAttempted ||
      embyQualitySwitching
    ) {
      return false
    }
    const fallback = getEmbyQualityChoices(info).find(
      (choice) => choice.playbackMode === "transcode",
    )
    if (!fallback) return false

    embyAutoFallbackAttempted = true
    const position = Math.max(
      Number.isFinite(player.currentTime) ? player.currentTime : 0,
      lastEmbyPlaybackSeconds,
    )
    player.option.url = ""
    player.notice.show = `原始流无法播放，正在回退到 ${fallback.label}`
    const requestID = embyRequestVersion
    embyAutoFallbackTimer = window.setTimeout(() => {
      embyAutoFallbackTimer = undefined
      if (requestID !== embyRequestVersion) return
      void switchEmbyQuality(fallback, {
        automatic: true,
        resumeSeconds: position,
      })
    }, 1100)
    return true
  }

  const updateEmbyQualityControl = () => {
    const info = embyInfo()
    if (!info) {
      if (hasEmbyQualityControl) {
        player.controls.remove("emby-quality")
        hasEmbyQualityControl = false
      }
      return
    }
    const choices = getEmbyQualityChoices(info)
    player.controls.update({
      name: "emby-quality",
      position: "right",
      index: 25,
      html: activeEmbyQualityLabel(),
      tooltip: "画质",
      selector: choices.map((choice) => ({
        html: choice.label,
        value: choice.key,
        default: choice.key === activeEmbyQualityKey,
      })),
      onSelect: async function (item) {
        const choice = choices.find((choice) => choice.key === item.value)
        if (!choice) return activeEmbyQualityLabel()
        return switchEmbyQuality(choice)
      },
    })
    hasEmbyQualityControl = true
  }

  const clearState = () => {
    setEmbyInfo(undefined)
    activeEmbyPath = ""
    activeEmbySessionID = ""
    lastEmbyPlaybackSeconds = 0
    embyOriginalURL = ""
    embyAutoFallbackAttempted = false
    activeEmbyQualityKey = ""
    updateEmbyQualityControl()
  }

  const load = async (url: string) => {
    const requestID = ++embyRequestVersion
    const requestPath = pathname()
    try {
      const previousInfo = embyInfo()
      const info = await requestEmbyPlayback(requestPath, "auto")
      if (requestID !== embyRequestVersion) return
      if (previousInfo?.play_session_id) {
        await reportEmbyPlayback("playback_stop", previousInfo)
      }
      setEmbyInfo(info)
      activeEmbyPath = requestPath
      activeEmbySessionID = ""
      lastEmbyProgressAt = 0
      lastEmbyPlaybackSeconds = ticksToSeconds(info.playback_position_ticks)
      embyOriginalURL = url
      embyAutoFallbackAttempted = false
      activeEmbyQualityKey = "auto"
      updateEmbyQualityControl()
      try {
        await switchUrl(
          info.playback_url || url,
          ticksToSeconds(info.playback_position_ticks),
          info.playback_type || playbackType(),
        )
        startEmbyPlayback()
      } catch (error) {
        if (requestID !== embyRequestVersion) return
        if (fallbackEmbyAutoPlayback()) return
        throw error
      }
    } catch (error) {
      if (requestID !== embyRequestVersion) return
      console.warn("Emby playback info failed", error)
      clearState()
      switchUrl(url)
    }
  }

  const stop = () => {
    if (embyInfo()?.play_session_id) {
      void reportEmbyPlayback("playback_stop")
    }
  }

  const events: [keyof Events, () => void][] = [
    ["play", startEmbyPlayback],
    ["video:playing", startEmbyPlayback],
    [
      "pause",
      () => {
        if (embyInfo()?.play_session_id) {
          void reportEmbyPlayback("playback_progress")
        }
      },
    ],
    [
      "video:timeupdate",
      () => {
        const info = embyInfo()
        if (Number.isFinite(player.currentTime)) {
          lastEmbyPlaybackSeconds = player.currentTime
        }
        if (
          !info?.play_session_id ||
          activeEmbySessionID !== info.play_session_id
        ) {
          return
        }
        const now = Date.now()
        if (now - lastEmbyProgressAt < 10_000) return
        lastEmbyProgressAt = now
        void reportEmbyPlayback("playback_progress", info)
      },
    ],
    ["video:ended", stop],
  ]
  for (const [event, handler] of events) player.on(event, handler)

  return {
    info: embyInfo,
    load,
    reset: () => {
      stop()
      ++embyRequestVersion
      clearState()
    },
    onError: () => {
      if (
        embyInfo()?.playback_method !== "Transcode" &&
        activeEmbyQualityKey === "auto"
      ) {
        fallbackEmbyAutoPlayback()
      }
    },
    destroy: () => {
      ++embyRequestVersion
      if (embyAutoFallbackTimer !== undefined) {
        window.clearTimeout(embyAutoFallbackTimer)
        embyAutoFallbackTimer = undefined
      }
      stop()
      for (const [event, handler] of events) player.off(event, handler)
    },
  }
}
