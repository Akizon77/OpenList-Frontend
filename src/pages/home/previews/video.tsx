import { Box } from "@hope-ui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js"
import { useRouter, useLink } from "~/hooks"
import {
  getMainColor,
  getSettingBool,
  objStore,
  password,
  setShouldKeepState,
} from "~/store"
import { EmbyPlaybackInfo, Obj, ObjType } from "~/types"
import {
  ext,
  fsOther,
  getEmbyDeviceID,
  getEmbyWebClientProfile,
  isEmbyProvider,
  isSubtitleFile,
  notify,
  pathDir,
  pathJoin,
  secondsToTicks,
  ticksToSeconds,
} from "~/utils"
import Artplayer from "artplayer"
import { type Option } from "artplayer"
import { type Setting } from "artplayer"
import { type Events } from "artplayer"
import artplayerPluginAss from "~/components/artplayer-plugin-ass"
import mpegts from "mpegts.js"
import Hls from "hls.js"
import { currentLang } from "~/app/i18n"
import { AutoHeightPlugin, VideoBox } from "./video_box"
import { ArtPlayerIconsSubtitle } from "~/components/icons"
import { useNavigate } from "@solidjs/router"
import { DanmakuController } from "./danmaku"
import { sortSubtitlesByLanguage } from "./subtitle"
import "./artplayer.css"

type EmbyPlaybackMode = "auto" | "direct" | "transcode"

interface EmbyQualityChoice {
  key: string
  label: string
  playbackMode: EmbyPlaybackMode
  maxStreamingBitrate?: number
}

const Preview = () => {
  const { pathname, searchParams } = useRouter()
  const { proxyLink } = useLink()
  const navigate = useNavigate()
  const [embyInfo, setEmbyInfo] = createSignal<EmbyPlaybackInfo>()
  const embyDeviceID = getEmbyDeviceID()
  let activeEmbySessionID = ""
  let activeEmbyPath = ""
  let lastEmbyProgressAt = 0
  let embyRequestVersion = 0
  let embyOriginalURL = ""
  let embyAutoNeedsProcessing = false
  let activeEmbyQualityKey = ""
  let hasEmbyQualityControl = false
  let embyQualitySwitching = false
  let embyClientProfile: ReturnType<typeof getEmbyWebClientProfile>
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
  let danmakuController: DanmakuController
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
        hlsPlayer = new Hls()
        hlsPlayer.loadSource(url)
        hlsPlayer.attachMedia(video)
        if (!video.src) {
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
  const subtitleAndDanmu = createMemo(() => {
    const subtitle: Obj[] = []
    let danmu: Obj | undefined
    for (const obj of objStore.related) {
      const name = obj.name.toLowerCase()
      if (isSubtitleFile(name)) {
        subtitle.push(obj)
      } else if (!danmu && name.endsWith(".xml")) {
        danmu = obj
      }
    }
    return { subtitle: sortSubtitlesByLanguage(subtitle), danmu }
  })

  // TODO: add a switch in manage panel to choose whether to enable `libass-wasm`
  const enableEnhanceAss = true

  const switchUrl = (
    url: string,
    resumeSeconds?: number,
    type = ext(objStore.obj.name),
  ) => {
    const { playing } = player
    player.pause()
    flvPlayer?.destroy()
    flvPlayer = undefined
    hlsPlayer?.destroy()
    hlsPlayer = undefined
    player.option.id = pathname()
    player.option.type = type
    return player
      .switchUrl(url)
      .then(() => {
        if (resumeSeconds && resumeSeconds > 0) {
          player.currentTime = resumeSeconds
        }
        const { subtitle } = subtitleAndDanmu()
        let isEnhanceAssMode = false
        const setSubtitleVisible = (visible: boolean) => {
          const type = isEnhanceAssMode ? "ass" : "webvtt"

          switch (type) {
            case "ass":
              player.subtitle.show = false
              player.emit(
                "artplayer-plugin-ass:visible" as keyof Events,
                visible,
              )
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
          const innerMenu: Setting[] = [
            {
              name: "setting_subtitle_display",
              html: "Display",
              tooltip: "Show",
              switch: true,
              onSwitch: function (item: Setting) {
                item.tooltip = item.switch ? "Hide" : "Show"
                setSubtitleVisible(!item.switch)

                // sync menu subtitle tooltip
                const menu_sub = this.setting.find("setting_subtitle")
                menu_sub && (menu_sub.tooltip = item.tooltip)

                return !item.switch
              },
            },
          ]
          subtitle.forEach((item, i) => {
            const subtitleType = ext(item.name).toLowerCase()
            innerMenu.push({
              default: i === 0,
              html: (
                <span class="openlist-subtitle-option" title={item.name}>
                  <span class="openlist-subtitle-option__name">
                    {item.name}
                  </span>
                </span>
              ) as HTMLElement,
              name: item.name,
              url: proxyLink(item, true),
              type: subtitleType,
              tooltip: subtitleType.toUpperCase(),
              value: "openlist-subtitle-track",
            })
          })

          const onSelect = function (this: Artplayer, item: Setting) {
            if (enableEnhanceAss && item.type === "ass") {
              isEnhanceAssMode = true
              if (!player.plugins.artplayerPluginAss) {
                player.plugins.add(artplayerPluginAss({ subUrl: item.url }))
              } else {
                this.emit(
                  "artplayer-plugin-ass:switch" as keyof Events,
                  item.url,
                )
              }
              setSubtitleVisible(true)
            } else {
              isEnhanceAssMode = false
              this.subtitle.switch(item.url, {
                name: item.name,
                type: item.type,
              })
              this.once("subtitleLoad", setSubtitleVisible.bind(this, true))
            }

            const switcher = innerMenu.find(
              (_) => _.name === "setting_subtitle_display",
            )

            if (switcher && !switcher.switch) switcher.$html?.click?.()

            // sync from display switcher
            return switcher?.tooltip
          }
          player.setting.update({
            name: "setting_subtitle",
            html: "Subtitle",
            tooltip: "Show",
            icon: ArtPlayerIconsSubtitle({ size: 24 }) as HTMLElement,
            selector: innerMenu,
            onSelect,
          })
          onSelect.call(player, innerMenu[1])
        } else {
          player.setting.find("setting_subtitle") &&
            player.setting.remove("setting_subtitle")
          setSubtitleVisible(false)
        }
        danmakuController?.reload()
      })
      .finally(() => playing && player.play())
  }

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
      { key: "direct", label: "原始", playbackMode: "direct" },
    ]
    if (embyAutoNeedsProcessing) {
      choices.push({ key: "auto", label: "自动", playbackMode: "auto" })
    }
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
    )?.label ?? "原始"

  const switchEmbyQuality = async (choice: EmbyQualityChoice) => {
    if (choice.key === activeEmbyQualityKey || embyQualitySwitching) {
      return activeEmbyQualityLabel()
    }
    const requestID = ++embyRequestVersion
    const requestPath = activeEmbyPath || pathname()
    const previousInfo = embyInfo()
    const position = Number.isFinite(player.currentTime)
      ? player.currentTime
      : ticksToSeconds(previousInfo?.playback_position_ticks ?? 0)
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
      await switchUrl(
        info.playback_url || embyOriginalURL,
        position,
        info.playback_type || ext(objStore.obj.name),
      )
      activeEmbyQualityKey = choice.key
      startEmbyPlayback()
      player.notice.show = `画质：${choice.label}`
      return choice.label
    } catch (error) {
      if (requestID === embyRequestVersion) {
        console.warn("Emby quality switch failed", error)
        notify.error(
          error instanceof Error ? error.message : "Emby 画质切换失败",
        )
      }
      return activeEmbyQualityLabel()
    } finally {
      embyQualitySwitching = false
      setTimeout(updateEmbyQualityControl, 0)
    }
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

  const loadEmbyPlayback = async (url: string) => {
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
      embyOriginalURL = url
      embyAutoNeedsProcessing = info.playback_method !== "DirectPlay"
      activeEmbyQualityKey = embyAutoNeedsProcessing ? "auto" : "direct"
      updateEmbyQualityControl()
      await switchUrl(
        info.playback_url || url,
        ticksToSeconds(info.playback_position_ticks),
        info.playback_type || ext(objStore.obj.name),
      )
      startEmbyPlayback()
    } catch (error) {
      if (requestID !== embyRequestVersion) return
      console.warn("Emby playback info failed", error)
      setEmbyInfo(undefined)
      activeEmbyPath = ""
      activeEmbySessionID = ""
      embyOriginalURL = ""
      embyAutoNeedsProcessing = false
      activeEmbyQualityKey = ""
      updateEmbyQualityControl()
      switchUrl(url)
    }
  }

  onMount(() => {
    player = new Artplayer(option)
    embyClientProfile = getEmbyWebClientProfile()
    danmakuController = new DanmakuController({
      player: () => player,
      getPath: () => pathname(),
      getPassword: () => password(),
      getMedia: () => {
        const info = embyInfo()
        if (!info) {
          return {
            name: objStore.obj.name,
            parent_name: pathDir(pathname()).split("/").pop(),
          }
        }
        return {
          item_id: info.item_id,
          item_type: info.item_type,
          name: info.name,
          series_name: info.series_name,
          original_title: info.original_title,
          season_number: info.season_number,
          episode_number: info.episode_number,
        }
      },
      getLocalXml: () => subtitleAndDanmu().danmu,
      getLocalXmlUrl: (obj) => proxyLink(obj, true),
    })
    void danmakuController.init()
    createEffect(
      on(
        () => objStore.raw_url,
        (url) => {
          if (!url) return
          if (isEmbyProvider(objStore.provider)) {
            void loadEmbyPlayback(url)
            return
          }
          const info = embyInfo()
          if (info?.play_session_id) {
            void reportEmbyPlayback("playback_stop", info)
          }
          ++embyRequestVersion
          setEmbyInfo(undefined)
          activeEmbyPath = ""
          activeEmbySessionID = ""
          embyOriginalURL = ""
          embyAutoNeedsProcessing = false
          activeEmbyQualityKey = ""
          updateEmbyQualityControl()
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
    player.on("play", startEmbyPlayback)
    player.on("video:playing", startEmbyPlayback)
    player.on("pause", () => {
      if (embyInfo()?.play_session_id) {
        void reportEmbyPlayback("playback_progress")
      }
    })
    player.on("video:timeupdate", () => {
      const info = embyInfo()
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
    })
    player.on("video:ended", () => {
      if (embyInfo()?.play_session_id) {
        void reportEmbyPlayback("playback_stop")
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
    ++embyRequestVersion
    if (embyInfo()?.play_session_id) {
      void reportEmbyPlayback("playback_stop")
    }
    setShouldKeepState(false)
    danmakuController?.destroy()
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
  return (
    <VideoBox onAutoNextChange={setAutoNext}>
      <Box w="$full" h="60vh" id="video-player" />
    </VideoBox>
  )
}

export default Preview
