import { Box } from "@hope-ui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js"
import { useRouter, useLink, useT } from "~/hooks"
import {
  getMainColor,
  getSettingBool,
  objStore,
  password,
  setShouldKeepState,
} from "~/store"
import { EmbyPlaybackInfo, EmbyPlaybackStream, Obj, ObjType } from "~/types"
import {
  embyMediaSourceLabel,
  embyStreamLabel,
  embySubtitleExtension,
  ExternalPlayerMedia,
  ext,
  fsOther,
  getRelatedMediaTracks,
  getEmbyDeviceID,
  getEmbyMediaSource,
  getEmbySubtitle,
  isEmbyProvider,
  pathDir,
  pathJoin,
  secondsToTicks,
  ticksToSeconds,
} from "~/utils"
import Artplayer from "artplayer"
import { type Option } from "artplayer"
import { type Setting } from "artplayer"
import { type Events } from "artplayer"
import artplayerPluginDanmuku from "artplayer-plugin-danmuku"
import { type Option as DanmukuOption } from "artplayer-plugin-danmuku"
import artplayerPluginAss from "~/components/artplayer-plugin-ass"
import mpegts from "mpegts.js"
import Hls from "hls.js"
import { currentLang } from "~/app/i18n"
import {
  AutoHeightPlugin,
  VideoBox,
  type EmbyPlaybackControls,
} from "./video_box"
import { ArtPlayerIconsSubtitle } from "~/components/icons"
import { useNavigate } from "@solidjs/router"
import "./artplayer.css"

type PlayerSubtitle = {
  name: string
  url: string
  codec: string
  trackKey: string
  embyIndex?: number
}

type PlayerAudio = {
  name: string
  url?: string
  trackKey: string
  embyIndex?: number
}

type SubtitleSetting = Setting & {
  codec?: string
  embyIndex?: number
  trackKey?: string
  off?: boolean
}

type EmbySetting = Setting & {
  label?: string
  mediaSourceID?: string
  streamIndex?: number
}

type EmbyPlaybackSelection = {
  mediaSourceID?: string
  audioStreamIndex?: number
  subtitleStreamIndex?: number
  resumeSeconds?: number
}

const Preview = () => {
  const { pathname, searchParams } = useRouter()
  const { proxyLink } = useLink()
  const t = useT()
  const navigate = useNavigate()
  const videos = createMemo(() =>
    objStore.objs.filter((obj) => obj.type === ObjType.VIDEO),
  )
  const next_video = () => {
    const index = videos().findIndex((f) => f.name === objStore.obj.name)
    if (index < videos().length - 1) {
      navigate(
        pathJoin(pathDir(location.pathname), videos()[index + 1].name) +
          "?auto_fullscreen=" +
          player.fullscreen,
      )
    }
  }
  const previous_video = () => {
    const index = videos().findIndex((f) => f.name === objStore.obj.name)
    if (index > 0) {
      navigate(
        pathJoin(pathDir(location.pathname), videos()[index - 1].name) +
          "?auto_fullscreen=" +
          player.fullscreen,
      )
    }
  }
  let player: Artplayer
  let flvPlayer: mpegts.Player | undefined
  let hlsPlayer: Hls | undefined
  const [embyInfo, setEmbyInfo] = createSignal<EmbyPlaybackInfo>()
  const [embyLoading, setEmbyLoading] = createSignal(false)
  const [selectedSubtitleURL, setSelectedSubtitleURL] = createSignal<
    string | null
  >()
  const [selectedAudioTrack, setSelectedAudioTrack] = createSignal("native")
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = createSignal("off")
  const embyDeviceID = getEmbyDeviceID()
  let activeEmbySessionID = ""
  let activeEmbyPath = ""
  let lastEmbyProgressAt = 0
  let embyRequestVersion = 0
  let switchingPlayback = false
  let disposed = false
  let selectSubtitleTrack: ((trackKey: string) => void) | undefined
  let externalAudio: HTMLAudioElement | undefined
  let externalAudioTrackKey = ""
  let mutedBeforeExternalAudio = false
  let option: Option = {
    container: "#video-player",
    volume: 1.0,
    autoplay: getSettingBool("video_autoplay"),
    autoSize: false,
    autoMini: true,
    loop: false,
    flip: true,
    playbackRate: true,
    aspectRatio: true,
    screenshot: true,
    setting: true,
    hotkey: true,
    pip: true,
    mutex: true,
    fullscreen: true,
    fullscreenWeb: true,
    subtitleOffset: true,
    miniProgressBar: false,
    playsInline: true,
    theme: getMainColor(),
    // layers: [],
    // settings: [],
    // contextmenu: [],
    controls: [
      {
        name: "previous-button",
        index: 10,
        position: "left",
        html: '<svg fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" height="22" width="22" class="icon icon-tabler icon-tabler-player-track-prev-filled" width="1em" height="1em" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible; color: currentcolor;"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M20.341 4.247l-8 7a1 1 0 0 0 0 1.506l8 7c.647 .565 1.659 .106 1.659 -.753v-14c0 -.86 -1.012 -1.318 -1.659 -.753z" stroke-width="0" fill="currentColor"></path><path d="M9.341 4.247l-8 7a1 1 0 0 0 0 1.506l8 7c.647 .565 1.659 .106 1.659 -.753v-14c0 -.86 -1.012 -1.318 -1.659 -.753z" stroke-width="0" fill="currentColor"></path></svg>',
        tooltip: "Previous",
        click: function () {
          previous_video()
        },
      },
      {
        name: "next-button",
        index: 11,
        position: "left",
        html: '<svg fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" height="22" width="22" class="icon icon-tabler icon-tabler-player-track-next-filled" width="1em" height="1em" viewBox="0 0 24 24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible; color: currentcolor;"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M2 5v14c0 .86 1.012 1.318 1.659 .753l8 -7a1 1 0 0 0 0 -1.506l-8 -7c-.647 -.565 -1.659 -.106 -1.659 .753z" stroke-width="0" fill="currentColor"></path><path d="M13 5v14c0 .86 1.012 1.318 1.659 .753l8 -7a1 1 0 0 0 0 -1.506l-8 -7c-.647 -.565 -1.659 -.106 -1.659 .753z" stroke-width="0" fill="currentColor"></path></svg>',
        tooltip: "Next",
        click: function () {
          next_video()
        },
      },
    ],
    quality: [],
    // highlight: [],
    plugins: [AutoHeightPlugin],
    whitelist: [],
    settings: [],
    // subtitle:{}
    moreVideoAttr: {
      // @ts-ignore
      "webkit-playsinline": true,
      playsInline: true,
      crossOrigin: "anonymous",
    },
    customType: {
      flv: function (video: HTMLMediaElement, url: string) {
        flvPlayer?.destroy()
        flvPlayer = mpegts.createPlayer(
          {
            type: "flv",
            url: url,
          },
          { referrerPolicy: "same-origin" },
        )
        flvPlayer.attachMediaElement(video)
        flvPlayer.load()
      },
      m2ts: function (video: HTMLMediaElement, url: string) {
        flvPlayer?.destroy()
        flvPlayer = mpegts.createPlayer(
          {
            type: "m2ts",
            url: url,
          },
          { referrerPolicy: "same-origin" },
        )
        flvPlayer.attachMediaElement(video)
        flvPlayer.load()
      },
      m3u8: function (video: HTMLMediaElement, url: string) {
        hlsPlayer?.destroy()
        hlsPlayer = undefined
        if (Hls.isSupported()) {
          hlsPlayer = new Hls()
          hlsPlayer.loadSource(url)
          hlsPlayer.attachMedia(video)
        } else {
          video.src = url
        }
      },
    },
    lang: ["en", "zh-cn", "zh-tw"].includes(currentLang().toLowerCase())
      ? (currentLang().toLowerCase() as string)
      : "en",
    lock: true,
    fastForward: true,
    autoPlayback: true,
    autoOrientation: true,
    airplay: true,
  }
  const relatedMediaTracks = createMemo(() =>
    getRelatedMediaTracks(objStore.obj.name, objStore.related),
  )

  const stopExternalAudio = () => {
    if (!externalAudio) return
    externalAudio.pause()
    externalAudio.removeAttribute("src")
    externalAudio.load()
    externalAudio = undefined
    externalAudioTrackKey = ""
    if (player) player.muted = mutedBeforeExternalAudio
  }

  const syncExternalAudio = () => {
    if (!externalAudio || !player) return
    if (Number.isFinite(player.currentTime)) {
      const delta = Math.abs(externalAudio.currentTime - player.currentTime)
      if (delta > 0.35 && externalAudio.readyState >= 1) {
        externalAudio.currentTime = player.currentTime
      }
    }
    if (player.playing && externalAudio.paused) {
      void externalAudio.play().catch(() => undefined)
    } else if (!player.playing && !externalAudio.paused) {
      externalAudio.pause()
    }
  }

  const setExternalAudio = async (track?: PlayerAudio) => {
    if (!track?.url) {
      stopExternalAudio()
      return
    }
    if (externalAudioTrackKey === track.trackKey && externalAudio) {
      syncExternalAudio()
      return
    }

    stopExternalAudio()
    mutedBeforeExternalAudio = player.muted
    player.muted = true

    const audio = new Audio()
    audio.crossOrigin = "anonymous"
    audio.preload = "auto"
    audio.src = track.url
    externalAudio = audio
    externalAudioTrackKey = track.trackKey

    await new Promise<void>((resolve) => {
      const finish = () => {
        audio.removeEventListener("loadedmetadata", finish)
        audio.removeEventListener("error", finish)
        resolve()
      }
      audio.addEventListener("loadedmetadata", finish, { once: true })
      audio.addEventListener("error", finish, { once: true })
      audio.load()
    })

    if (externalAudio !== audio) return
    if (Number.isFinite(player.currentTime)) {
      audio.currentTime = player.currentTime
    }
    audio.volume = player.volume
    audio.muted = mutedBeforeExternalAudio
    if (player.playing) void audio.play().catch(() => undefined)
  }

  const subtitleAndDanmu = createMemo(() => {
    const subtitle: PlayerSubtitle[] = []
    let danmu: Obj | undefined
    for (const track of relatedMediaTracks()) {
      if (track.kind === "subtitle") {
        subtitle.push({
          name: track.name,
          url: proxyLink(track.obj, true),
          codec: track.codec,
          trackKey: `sidecar-subtitle:${track.name}`,
        })
      }
    }
    for (const obj of objStore.related) {
      if (!danmu && obj.name.toLowerCase().endsWith(".xml")) {
        danmu = obj
      }
    }
    const source = getEmbyMediaSource(embyInfo())
    for (const stream of source?.subtitle_streams ?? []) {
      if (!stream.url) continue
      const extension = embySubtitleExtension(stream.codec)
      subtitle.push({
        name: embyStreamLabel(stream) + "." + extension,
        url: stream.url,
        codec: extension,
        trackKey: `emby-subtitle:${stream.index}`,
        embyIndex: stream.index,
      })
    }
    return { subtitle, danmu }
  })

  const audioTracks = createMemo(() => {
    const tracks: PlayerAudio[] = []
    const source = getEmbyMediaSource(embyInfo())
    for (const stream of source?.audio_streams ?? []) {
      tracks.push({
        name: embyStreamLabel(stream),
        trackKey: `emby-audio:${stream.index}`,
        embyIndex: stream.index,
      })
    }
    for (const track of relatedMediaTracks()) {
      if (track.kind !== "audio") continue
      tracks.push({
        name: track.name,
        url: proxyLink(track.obj, true),
        trackKey: `sidecar-audio:${track.name}`,
      })
    }
    return tracks
  })

  // TODO: add a switch in manage panel to choose whether to enable `libass-wasm`
  const enableEnhanceAss = true

  const switchUrl = (
    url: string,
    type = ext(objStore.obj.name),
    resumeSeconds?: number,
    preferredSubtitleIndex?: number,
  ) => {
    const { playing } = player
    const playbackType = type.toLowerCase()
    selectSubtitleTrack = undefined
    stopExternalAudio()
    if (!embyInfo()) setSelectedAudioTrack("native")
    switchingPlayback = true
    player.pause()
    if (playbackType !== "m3u8") {
      hlsPlayer?.destroy()
      hlsPlayer = undefined
    }
    if (playbackType !== "flv" && playbackType !== "m2ts") {
      flvPlayer?.destroy()
      flvPlayer = undefined
    }
    player.option.id = pathname()
    player.option.type = playbackType
    const switchPromise = player
      .switchUrl(url)
      .then(() => {
        if (resumeSeconds && resumeSeconds > 0) {
          player.currentTime = resumeSeconds
        }
      })
      .catch((error) => console.warn("Video URL switch failed", error))
      .finally(() => {
        switchingPlayback = false
        if (!disposed && playing) void player.play()
      })

    const { subtitle, danmu } = subtitleAndDanmu()
    let isEnhanceAssMode = false
    const setSubtitleVisible = (visible: boolean) => {
      const type = isEnhanceAssMode ? "ass" : "webvtt"

      switch (type) {
        case "ass":
          player.subtitle.show = false
          player.emit("artplayer-plugin-ass:visible" as keyof Events, visible)
          break

        case "webvtt":
        default:
          player.subtitle.show = visible
          player.emit("artplayer-plugin-ass:visible" as keyof Events, false)
          break
      }
    }
    if (subtitle.length) {
      // render subtitle toggle menu
      const innerMenu: SubtitleSetting[] = [
        {
          name: "setting_subtitle_display",
          html: t("home.preview.emby.subtitle_display"),
          tooltip: t("home.preview.emby.show"),
          switch: preferredSubtitleIndex !== -1,
          onSwitch: function (item: Setting) {
            item.tooltip = item.switch
              ? t("home.preview.emby.hide")
              : t("home.preview.emby.show")
            setSubtitleVisible(!item.switch)

            // sync menu subtitle tooltip
            const menu_sub = this.setting.find("setting_subtitle")
            menu_sub && (menu_sub.tooltip = item.tooltip)

            return !item.switch
          },
        },
        {
          name: "setting_subtitle_off",
          html: t("home.preview.emby.off"),
          tooltip: t("home.preview.emby.off"),
          default: preferredSubtitleIndex === -1,
          trackKey: "off",
          embyIndex: -1,
          off: true,
        },
      ]
      subtitle.forEach((item, i) => {
        innerMenu.push({
          default:
            preferredSubtitleIndex !== undefined
              ? item.embyIndex === preferredSubtitleIndex
              : i === 0,
          html: (
            <span
              title={item.name}
              style={{
                "max-width": "200px",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "word-break": "break-all",
                "white-space": "normal",
                display: "-webkit-box",
                "-webkit-line-clamp": "2",
                "-webkit-box-orient": "vertical",
                "font-size": "12px",
              }}
            >
              {item.name}
            </span>
          ) as HTMLElement,
          name: item.name,
          url: item.url,
          codec: item.codec,
          trackKey: item.trackKey,
          embyIndex: item.embyIndex,
        })
      })

      const onSelect = function (this: Artplayer, item: Setting) {
        const selected = item as SubtitleSetting
        const info = embyInfo()
        const selectedEmbyIndex = selected.embyIndex ?? -1
        if (info && info.selected_subtitle_stream_index !== selectedEmbyIndex) {
          setEmbyInfo({
            ...info,
            selected_subtitle_stream_index: selectedEmbyIndex,
          })
        }
        if (selected.off) {
          const switcher = innerMenu.find(
            (_) => _.name === "setting_subtitle_display",
          )
          if (switcher?.switch) switcher.switch = false
          setSelectedSubtitleURL(null)
          setSelectedSubtitleTrack("off")
          setSubtitleVisible(false)
          return t("home.preview.emby.off")
        }
        setSelectedSubtitleURL(selected.url)
        setSelectedSubtitleTrack(selected.trackKey ?? "off")
        if (
          enableEnhanceAss &&
          (selected.codec ?? ext(item.name)).toLowerCase() === "ass"
        ) {
          isEnhanceAssMode = true
          if (!player.plugins.artplayerPluginAss) {
            player.plugins.add(artplayerPluginAss({ subUrl: item.url }))
          } else {
            this.emit("artplayer-plugin-ass:switch" as keyof Events, item.url)
          }
          setSubtitleVisible(true)
        } else {
          isEnhanceAssMode = false
          this.subtitle.switch(item.url, { name: item.name })
          this.once("subtitleLoad", setSubtitleVisible.bind(this, true))
        }

        const switcher = innerMenu.find(
          (_) => _.name === "setting_subtitle_display",
        )

        if (switcher && !switcher.switch) switcher.$html?.click?.()

        return selected.off ? t("home.preview.emby.off") : item.name
      }
      selectSubtitleTrack = (trackKey) => {
        const selected = innerMenu.find(
          (item) => (item as SubtitleSetting).trackKey === trackKey,
        )
        if (selected) onSelect.call(player, selected)
      }
      player.setting.update({
        name: "setting_subtitle",
        html: t("home.preview.emby.subtitle"),
        tooltip: t("home.preview.emby.show"),
        icon: ArtPlayerIconsSubtitle({ size: 24 }) as HTMLElement,
        selector: innerMenu,
        onSelect,
      })
      const preferredMenu =
        preferredSubtitleIndex === -1
          ? innerMenu[1]
          : (innerMenu
              .slice(2)
              .find((item) => item.embyIndex === preferredSubtitleIndex) ??
            innerMenu[2])
      preferredMenu && onSelect.call(player, preferredMenu)
    } else {
      player.setting.find("setting_subtitle") &&
        player.setting.remove("setting_subtitle")
      setSelectedSubtitleURL(null)
      setSelectedSubtitleTrack("off")
      const info = embyInfo()
      if (info && info.selected_subtitle_stream_index !== -1) {
        setEmbyInfo({ ...info, selected_subtitle_stream_index: -1 })
      }
      setSubtitleVisible(false)
    }
    const danmukuPlugin = player.plugins.artplayerPluginDanmuku as ReturnType<
      ReturnType<typeof artplayerPluginDanmuku>
    >
    if (danmukuPlugin) {
      danmukuPlugin.reset()
      danmukuPlugin.option.danmuku = []
      danmukuPlugin.load(danmu ? proxyLink(danmu, true) : undefined)
    } else if (danmu) {
      player.plugins.add(
        artplayerPluginDanmuku({
          speed: 5,
          opacity: 1,
          fontSize: 25,
          mode: 0,
          antiOverlap: false,
          synchronousPlayback: false,
          theme: "dark",
          heatmap: true,
          ...JSON.parse(localStorage.getItem("danmuku_config") || "{}"),
          emitter: false,
          danmuku: proxyLink(danmu, true),
        }),
      )
      player.on("artplayerPluginDanmuku:config", (option) => {
        const {
          speed,
          margin,
          opacity,
          mode,
          modes,
          fontSize,
          antiOverlap,
          synchronousPlayback,
          heatmap,
          visible,
        } = option as DanmukuOption
        localStorage.setItem(
          "danmuku_config",
          JSON.stringify({
            speed,
            margin,
            opacity,
            mode,
            modes,
            fontSize,
            antiOverlap,
            synchronousPlayback,
            heatmap,
            visible,
          }),
        )
      })
    }
    return switchPromise
  }

  const removeSetting = (name: string) => {
    if (player.setting.find(name)) player.setting.remove(name)
  }

  const clearEmbySettings = () => {
    removeSetting("setting_emby_media_source")
    removeSetting("setting_emby_audio")
  }

  const updateEmbySettings = (info: EmbyPlaybackInfo) => {
    const source = getEmbyMediaSource(info)
    if (!source) {
      clearEmbySettings()
      return
    }

    if (info.media_sources.length > 1) {
      const selector: EmbySetting[] = info.media_sources.map((item) => {
        const label = embyMediaSourceLabel(item)
        return {
          name: `emby_media_source_${item.id}`,
          html: label,
          tooltip: label,
          label,
          mediaSourceID: item.id,
          default: item.id === info.selected_media_source_id,
        }
      })
      player.setting.update({
        name: "setting_emby_media_source",
        html: t("home.preview.emby.media_source"),
        tooltip: embyMediaSourceLabel(source),
        selector,
        onSelect: (item) => {
          const selected = item as EmbySetting
          const currentInfo = embyInfo()
          if (
            !embyLoading() &&
            currentInfo &&
            selected.mediaSourceID !== currentInfo.selected_media_source_id
          ) {
            void loadEmbyPlayback({
              mediaSourceID: selected.mediaSourceID,
            })
          }
          return selected.label ?? ""
        },
      })
    } else {
      removeSetting("setting_emby_media_source")
    }

    if (source.audio_streams.length > 1) {
      const selector: EmbySetting[] = source.audio_streams.map(
        (stream: EmbyPlaybackStream) => {
          const label = embyStreamLabel(stream)
          return {
            name: `emby_audio_${stream.index}`,
            html: label,
            tooltip: label,
            label,
            streamIndex: stream.index,
            default: stream.index === info.selected_audio_stream_index,
          }
        },
      )
      const selectedAudio = source.audio_streams.find(
        (stream) => stream.index === info.selected_audio_stream_index,
      )
      player.setting.update({
        name: "setting_emby_audio",
        html: t("home.preview.emby.audio"),
        tooltip: selectedAudio ? embyStreamLabel(selectedAudio) : "-",
        selector,
        onSelect: (item) => {
          const selected = item as EmbySetting
          const currentInfo = embyInfo()
          if (
            !embyLoading() &&
            currentInfo &&
            selected.streamIndex !== undefined &&
            selected.streamIndex !== currentInfo.selected_audio_stream_index
          ) {
            void loadEmbyPlayback({
              mediaSourceID: currentInfo.selected_media_source_id,
              audioStreamIndex: selected.streamIndex,
              subtitleStreamIndex: currentInfo.selected_subtitle_stream_index,
            })
          }
          return selected.label ?? ""
        },
      })
    } else {
      removeSetting("setting_emby_audio")
    }
  }

  async function loadEmbyPlayback(selection: EmbyPlaybackSelection = {}) {
    const requestID = ++embyRequestVersion
    const requestPath = pathname()
    const previousInfo = embyInfo()
    const previousPath = activeEmbyPath
    const replacingCurrent = Boolean(
      previousInfo && previousPath === requestPath,
    )

    if (
      previousInfo?.play_session_id &&
      activeEmbySessionID === previousInfo.play_session_id &&
      previousPath &&
      !replacingCurrent
    ) {
      activeEmbySessionID = ""
      void reportEmbyPlayback("playback_stop", previousInfo, previousPath)
    }

    setEmbyLoading(true)
    try {
      const resp = await fsOther<EmbyPlaybackInfo>(
        requestPath,
        "playback_info",
        {
          mode: "web",
          device_id: embyDeviceID,
          media_source_id: selection.mediaSourceID,
          audio_stream_index: selection.audioStreamIndex,
          subtitle_stream_index: selection.subtitleStreamIndex,
        },
        password(),
      )
      if (requestID !== embyRequestVersion) return
      if (resp.code !== 200) {
        throw new Error(resp.message)
      }

      const info = resp.data
      const resumeSeconds =
        selection.resumeSeconds ??
        (replacingCurrent
          ? player.currentTime
          : ticksToSeconds(info.playback_position_ticks))
      if (
        previousInfo?.play_session_id &&
        activeEmbySessionID === previousInfo.play_session_id &&
        previousPath
      ) {
        activeEmbySessionID = ""
        void reportEmbyPlayback("playback_stop", previousInfo, previousPath)
      }
      activeEmbyPath = requestPath
      activeEmbySessionID = ""
      lastEmbyProgressAt = 0
      setEmbyInfo(info)
      setSelectedAudioTrack(
        info.selected_audio_stream_index >= 0
          ? `emby-audio:${info.selected_audio_stream_index}`
          : "native",
      )
      updateEmbySettings(info)
      void switchUrl(
        info.playback_url,
        info.playback_type,
        resumeSeconds,
        info.selected_subtitle_stream_index,
      ).then(() => startEmbyPlayback(info))
    } catch (error) {
      if (requestID !== embyRequestVersion) return
      console.warn("Emby playback info failed", error)
      if (replacingCurrent) return
      activeEmbyPath = ""
      activeEmbySessionID = ""
      setEmbyInfo(undefined)
      clearEmbySettings()
      switchUrl(objStore.raw_url)
    } finally {
      if (requestID === embyRequestVersion) setEmbyLoading(false)
    }
  }

  const reportEmbyPlayback = async (
    method: "playback_start" | "playback_progress" | "playback_stop",
    info = embyInfo(),
    reportPath = activeEmbyPath,
  ) => {
    if (!info?.play_session_id || !reportPath || !player) return
    try {
      const positionSeconds = Number.isFinite(player.currentTime)
        ? player.currentTime
        : ticksToSeconds(info.playback_position_ticks)
      const resp = await fsOther(
        reportPath,
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
        console.warn(`Emby ${method} failed: ${resp.message}`)
      }
    } catch (error) {
      console.warn(`Emby ${method} failed`, error)
    }
  }

  const startEmbyPlayback = (info = embyInfo()) => {
    if (
      !info?.play_session_id ||
      activeEmbySessionID === info.play_session_id
    ) {
      return
    }
    activeEmbySessionID = info.play_session_id
    void reportEmbyPlayback("playback_start", info)
  }

  const getEmbyPlaybackControls = (): EmbyPlaybackControls | undefined => {
    const info = embyInfo()
    const sidecarAudio = audioTracks().filter((track) => track.url)
    const subtitles = subtitleAndDanmu().subtitle
    if (!info && sidecarAudio.length === 0 && subtitles.length === 0) {
      return undefined
    }

    const audioOptions: { value: string; label: string }[] = []
    if (!info) {
      audioOptions.push({
        value: "native",
        label: t("home.preview.emby.video_audio"),
      })
    }
    for (const track of audioTracks()) {
      audioOptions.push({
        value: track.trackKey,
        label: track.name,
      })
    }

    const subtitleOptions = [
      { value: "off", label: t("home.preview.emby.off") },
      ...subtitles.map((track) => ({
        value: track.trackKey,
        label: track.name,
      })),
    ]

    return {
      title: info ? "Emby" : t("home.preview.emby.related"),
      mediaSources:
        info?.media_sources.map((item) => ({
          value: item.id,
          label: embyMediaSourceLabel(item),
        })) ?? [],
      selectedMediaSource: info?.selected_media_source_id ?? "",
      audioTracks: audioOptions,
      selectedAudioTrack: selectedAudioTrack(),
      subtitles: subtitleOptions,
      selectedSubtitle: selectedSubtitleTrack(),
      loading: embyLoading(),
      onMediaSourceChange: (value) => {
        const currentInfo = embyInfo()
        if (
          currentInfo &&
          value !== currentInfo.selected_media_source_id &&
          !embyLoading()
        ) {
          void loadEmbyPlayback({ mediaSourceID: value })
        }
      },
      onAudioTrackChange: (value) => {
        const selected = audioTracks().find((track) => track.trackKey === value)
        setSelectedAudioTrack(value)
        if (selected?.url) {
          void setExternalAudio(selected)
          return
        }

        stopExternalAudio()
        const currentInfo = embyInfo()
        if (
          currentInfo &&
          selected?.embyIndex !== undefined &&
          selected.embyIndex !== currentInfo.selected_audio_stream_index &&
          !embyLoading()
        ) {
          void loadEmbyPlayback({
            mediaSourceID: currentInfo.selected_media_source_id,
            audioStreamIndex: selected.embyIndex,
            subtitleStreamIndex: currentInfo.selected_subtitle_stream_index,
          })
        }
      },
      onSubtitleChange: (value) => {
        selectSubtitleTrack?.(value)
      },
    }
  }

  onMount(() => {
    player = new Artplayer(option)
    createEffect(
      on(
        () => objStore.raw_url,
        (url) => {
          if (!url) return
          if (isEmbyProvider(objStore.provider)) {
            void loadEmbyPlayback()
            return
          }
          const previousInfo = embyInfo()
          if (
            previousInfo?.play_session_id &&
            activeEmbySessionID === previousInfo.play_session_id &&
            activeEmbyPath
          ) {
            activeEmbySessionID = ""
            void reportEmbyPlayback(
              "playback_stop",
              previousInfo,
              activeEmbyPath,
            )
          }
          ++embyRequestVersion
          setEmbyLoading(false)
          activeEmbyPath = ""
          activeEmbySessionID = ""
          setEmbyInfo(undefined)
          clearEmbySettings()
          switchUrl(url)
        },
      ),
    )
    let auto_fullscreen: boolean
    switch (searchParams["auto_fullscreen"]) {
      case "true":
        auto_fullscreen = true
      case "false":
        auto_fullscreen = false
      default:
        auto_fullscreen = false
    }
    player.on("ready", () => {
      player.fullscreen = auto_fullscreen
    })
    const onFullscreen = () =>
      setShouldKeepState(player.fullscreen || player.fullscreenWeb)
    player.on("fullscreen", onFullscreen)
    player.on("fullscreenWeb", onFullscreen)
    player.on("play", () => {
      syncExternalAudio()
      const info = embyInfo()
      startEmbyPlayback(info)
    })
    player.on("video:playing", () => startEmbyPlayback())
    player.on("pause", () => {
      externalAudio?.pause()
      const info = embyInfo()
      if (
        !switchingPlayback &&
        info?.play_session_id &&
        activeEmbySessionID === info.play_session_id
      )
        void reportEmbyPlayback("playback_progress", info)
    })
    player.on("video:timeupdate", () => {
      syncExternalAudio()
      const info = embyInfo()
      if (
        switchingPlayback ||
        !info?.play_session_id ||
        activeEmbySessionID !== info.play_session_id
      )
        return
      const now = Date.now()
      if (now - lastEmbyProgressAt < 10_000) return
      lastEmbyProgressAt = now
      void reportEmbyPlayback("playback_progress", info)
    })
    player.on("video:seeking", syncExternalAudio)
    player.on("video:volumechange", () => {
      if (externalAudio) externalAudio.volume = player.volume
    })
    player.on("video:ended", () => {
      const info = embyInfo()
      if (
        info?.play_session_id &&
        activeEmbySessionID === info.play_session_id
      ) {
        activeEmbySessionID = ""
        void reportEmbyPlayback("playback_stop", info)
      }
      if (!autoNext()) return
      next_video()
    })
    player.on("error", () => {
      if (player.video.crossOrigin) {
        console.log(
          "Error detected. Trying to remove Cross-Origin attribute. Screenshot may not be available.",
        )
        player.video.crossOrigin = null
      }
    })
  })
  onCleanup(() => {
    disposed = true
    embyRequestVersion++
    stopExternalAudio()
    const info = embyInfo()
    if (info?.play_session_id && activeEmbySessionID === info.play_session_id) {
      activeEmbySessionID = ""
      void reportEmbyPlayback("playback_stop", info)
    }
    setShouldKeepState(false)
    if (player) {
      player.fullscreenWeb = false
      player.fullscreen = false
      player.pip && (player.pip = false)
      player.destroy()
    }
    flvPlayer?.destroy()
    hlsPlayer?.destroy()
  })
  const [autoNext, setAutoNext] = createSignal()
  const getExternalPlayerMedia = (): ExternalPlayerMedia | undefined => {
    if (embyLoading() || switchingPlayback) return undefined
    const info = embyInfo()
    const source = getEmbyMediaSource(info)
    const hasRelatedMedia = relatedMediaTracks().length > 0
    if (!info && !hasRelatedMedia) return undefined

    const selectedSubtitle = selectedSubtitleURL()
    const subtitleURL =
      selectedSubtitle === undefined
        ? getEmbySubtitle(info)?.url
        : selectedSubtitle || undefined

    return {
      rawURL: objStore.raw_url,
      directURL: source?.direct_url || info?.playback_url || objStore.raw_url,
      name: objStore.obj.name,
      subtitleURL,
      positionSeconds:
        player && Number.isFinite(player.currentTime)
          ? player.currentTime
          : ticksToSeconds(info?.playback_position_ticks ?? 0),
    }
  }
  return (
    <VideoBox
      onAutoNextChange={setAutoNext}
      getExternalPlayerMedia={getExternalPlayerMedia}
      getEmbyPlaybackControls={getEmbyPlaybackControls}
    >
      <Box w="$full" h="60vh" id="video-player" />
    </VideoBox>
  )
}

export default Preview
