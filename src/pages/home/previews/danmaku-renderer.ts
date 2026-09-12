import Artplayer from "artplayer"
import DanmuJsModule, {
  type DanmuJsComment,
  type DanmuJsConstructor,
  type DanmuJs as DanmuJsInstance,
  type DanmuJsMode,
} from "danmu.js"
import * as OpenCC from "opencc-js/t2cn"
import type { DanmakuComment } from "~/types"
import {
  buildDanmakuHeatmap,
  prepareDisplayComments,
  toDanmuJsComment,
} from "./danmaku-data"
import type { DanmakuConfig, DanmakuEngineMode } from "./danmaku-config"

const NORMAL_SCROLL_DURATION = {
  min: 6500,
  max: 12000,
  width: 320,
  divisor: 240,
}

const AREA_TOP = 0.02
const AREA_BOTTOM = 0.9
const HEATMAP_WIDTH = 256
const HEATMAP_HEIGHT = 32
const DANMU_SCAN_INTERVAL = 250

let simplifiedConverter: ((text: string) => string) | undefined

interface DanmuJsInternalBullet {
  mode: DanmuJsMode
  updateOffset?: (offset: number, dryRun?: boolean) => unknown
}

interface DanmuJsInternalChannel {
  addBullet?: (bullet: DanmuJsInternalBullet) => unknown
}

type DanmuJsInternalEngine = DanmuJsInstance & {
  main?: {
    channel?: DanmuJsInternalChannel
  }
}

export class DanmuJsRenderer {
  private readonly player: Artplayer
  private readonly overlay: HTMLDivElement
  private readonly heatmapSvg: SVGSVGElement
  private readonly heatmapPath: SVGPathElement
  private readonly conversionCache = new Map<string, string>()
  private config: DanmakuConfig
  private engine?: DanmuJsInstance
  private rawComments: DanmakuComment[] = []
  private displayComments: DanmakuComment[] = []
  private sourceGeneration = 0
  private conversionGeneration = 0
  private visible: boolean
  private destroyed = false
  private resizeObserver?: ResizeObserver
  private resizeTimer?: number
  private seekTimer?: number

  private readonly onPlay = () => {
    if (!this.visible || !this.engine) return
    if (this.engine.status === "closed") {
      this.syncEngine()
    } else {
      this.engine.play()
    }
  }

  private readonly onPause = () => {
    this.engine?.pause()
  }

  private readonly onEnded = () => {
    this.engine?.pause()
  }

  private readonly onSeeking = () => {
    this.engine?.pause()
  }

  private readonly onSeeked = () => {
    this.scheduleSeekResync()
  }

  private readonly onRateChange = () => {
    this.updateSpeed()
  }

  private readonly onDurationChange = () => {
    this.updateHeatmap()
  }

  private readonly onLoadedMetadata = () => {
    this.updateHeatmap()
    this.scheduleSeekResync()
  }

  private readonly onEmptied = () => {
    this.engine?.stop()
  }

  private readonly onRestart = () => {
    this.scheduleSeekResync()
  }

  private readonly onResize = () => {
    this.scheduleResize()
  }

  private readonly onFullscreen = () => {
    this.scheduleResize()
  }

  constructor(player: Artplayer, config: DanmakuConfig) {
    this.player = player
    this.config = cloneConfig(config)
    this.visible = config.visible
    this.overlay = this.createOverlay()
    const heatmap = this.createHeatmap()
    this.heatmapSvg = heatmap.svg
    this.heatmapPath = heatmap.path
    this.bindPlayerEvents()
    this.createResizeObserver()
    this.createEngine()
  }

  async load(
    comments: readonly DanmakuComment[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (this.destroyed) return false

    const sourceGeneration = ++this.sourceGeneration
    this.conversionGeneration += 1
    const rawComments = comments.map(cloneComment)

    while (this.isSourceCurrent(sourceGeneration, signal)) {
      const conversionGeneration = this.conversionGeneration
      const traditionalToSimplified = this.config.traditionalToSimplified
      const displayComments = await this.buildDisplayComments(
        rawComments,
        traditionalToSimplified,
        signal,
        () =>
          this.isSourceCurrent(sourceGeneration, signal) &&
          conversionGeneration === this.conversionGeneration,
      )

      if (!this.isSourceCurrent(sourceGeneration, signal)) return false
      if (
        !displayComments ||
        conversionGeneration !== this.conversionGeneration
      ) {
        continue
      }

      this.rawComments = rawComments
      this.displayComments = displayComments
      this.replaceEngineComments()
      this.updateHeatmap()
      return true
    }

    return false
  }

  reset() {
    if (this.destroyed) return
    this.sourceGeneration += 1
    this.conversionGeneration += 1
    this.rawComments = []
    this.displayComments = []
    this.engine?.stop()
    this.engine?.updateComments([], true)
    this.updateHeatmap()
  }

  show() {
    if (this.destroyed || this.visible) {
      if (!this.destroyed && this.visible) this.scheduleSeekResync()
      return
    }
    this.visible = true
    this.overlay.style.display = ""
    this.syncEngine()
  }

  hide() {
    if (this.destroyed || !this.visible) return
    this.visible = false
    this.overlay.style.display = "none"
    this.engine?.stop()
  }

  async updateConfig(config: DanmakuConfig) {
    if (this.destroyed) return

    const previous = this.config
    this.config = cloneConfig(config)

    if (previous.visible !== this.config.visible) {
      if (this.config.visible) this.show()
      else this.hide()
    }

    const requiresRebuild =
      previous.displayArea !== this.config.displayArea ||
      previous.spacing !== this.config.spacing ||
      previous.lineSpacing !== this.config.lineSpacing ||
      previous.antiOverlap !== this.config.antiOverlap
    const requiresCommentRebuild =
      previous.fontFamily !== this.config.fontFamily ||
      previous.fontWeight !== this.config.fontWeight ||
      previous.outline !== this.config.outline

    if (requiresRebuild) {
      this.rebuildEngine()
    } else {
      this.applyHotConfig()
      if (requiresCommentRebuild) {
        this.replaceEngineComments()
      }
    }

    if (
      previous.traditionalToSimplified !== this.config.traditionalToSimplified
    ) {
      await this.reloadDisplayComments()
    }
  }

  resync() {
    if (this.destroyed) return
    if (!this.visible) {
      this.engine?.stop()
      return
    }
    this.syncEngine()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.sourceGeneration += 1
    this.conversionGeneration += 1
    this.clearTimers()
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    this.unbindPlayerEvents()
    this.destroyEngine()
    this.heatmapSvg.remove()
    this.overlay.remove()
    this.rawComments = []
    this.displayComments = []
    this.conversionCache.clear()
  }

  private createOverlay() {
    const overlay = document.createElement("div")
    overlay.className = "openlist-danmaku-layer"
    overlay.setAttribute("aria-hidden", "true")
    this.player.template.$player.appendChild(overlay)
    return overlay
  }

  private createHeatmap() {
    const namespace = "http://www.w3.org/2000/svg"
    const svg = document.createElementNS(namespace, "svg")
    const path = document.createElementNS(namespace, "path")
    svg.classList.add("openlist-danmaku-heatmap")
    svg.setAttribute("viewBox", `0 0 ${HEATMAP_WIDTH} ${HEATMAP_HEIGHT}`)
    svg.setAttribute("preserveAspectRatio", "none")
    svg.setAttribute("aria-hidden", "true")
    svg.style.display = "none"
    svg.appendChild(path)
    const heatmapContainer =
      this.player.template.$progress.querySelector(
        ".art-control-progress-inner",
      ) || this.player.template.$progress
    heatmapContainer.appendChild(svg)
    return { svg, path }
  }

  private createEngine() {
    this.engine = new (resolveDanmuJsConstructor())({
      container: this.overlay,
      containerStyle: {
        position: "absolute",
        inset: 0,
        zIndex: 19,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      },
      player: this.player.video,
      comments: this.buildEngineComments(),
      area: this.areaConfig(),
      channelSize: this.channelSize(),
      bulletOffset: 0,
      chaseEffect: true,
      needResizeObserver: true,
      defaultOff: true,
      interval: DANMU_SCAN_INTERVAL,
      dropStaleComments: false,
      highScorePriority: false,
      mouseControl: false,
    })
    this.installCollisionPolicy(this.engine)
    this.applyHotConfig()

    if (this.visible) {
      this.syncEngine()
    } else {
      this.engine.stop()
      this.overlay.style.display = "none"
    }
  }

  private rebuildEngine() {
    this.destroyEngine()
    this.createEngine()
  }

  private destroyEngine() {
    this.engine?.destroy()
    this.engine = undefined
  }

  private applyHotConfig() {
    const engine = this.engine
    if (!engine) return

    engine.setOpacity(this.config.opacity)
    engine.setFontSize(this.config.fontSize, this.channelSize())
    this.applyModeVisibility()
    this.updateSpeed()
    this.updateHeatmap()
  }

  private applyModeVisibility() {
    const engine = this.engine
    if (!engine) return

    for (const mode of Object.keys(this.config.modes) as DanmakuEngineMode[]) {
      if (this.config.modes[mode]) engine.show(mode)
      else engine.hide(mode)
    }
  }

  private updateSpeed() {
    const engine = this.engine
    if (!engine) return

    const rate = this.effectivePlaybackRate()
    engine.setAllDuration("scroll", this.normalScrollDuration(), false)
    engine.setPlayRate("scroll", rate)
    const fixedDuration = Math.round(5000 / rate)
    engine.setAllDuration("top", fixedDuration, false)
    engine.setAllDuration("bottom", fixedDuration, false)
  }

  private async reloadDisplayComments() {
    const generation = ++this.conversionGeneration
    const traditionalToSimplified = this.config.traditionalToSimplified
    const displayComments = await this.buildDisplayComments(
      this.rawComments,
      traditionalToSimplified,
      undefined,
      () => this.isConversionCurrent(generation),
    )
    if (!displayComments || !this.isConversionCurrent(generation)) return
    this.displayComments = displayComments
    this.replaceEngineComments()
  }

  private async buildDisplayComments(
    comments: readonly DanmakuComment[],
    traditionalToSimplified: boolean,
    signal?: AbortSignal,
    shouldContinue?: () => boolean,
  ): Promise<DanmakuComment[] | undefined> {
    const converter = traditionalToSimplified
      ? getSimplifiedConverter()
      : () => ""
    return prepareDisplayComments(
      comments,
      traditionalToSimplified,
      converter,
      {
        batchSize: 500,
        cache: this.conversionCache,
        signal,
        shouldContinue,
      },
    )
  }

  private replaceEngineComments() {
    const engine = this.engine
    if (!engine) return

    if (!this.visible) {
      engine.stop()
      engine.updateComments(this.buildEngineComments(), true)
      return
    }
    this.syncEngine()
  }

  private syncEngine() {
    const engine = this.engine
    if (!engine || !this.visible) return

    const wasPlaying = this.isPlaying()
    engine.stop()
    engine.updateComments(this.buildEngineComments(), true)
    this.applyHotConfig()
    engine.start()
    if (!wasPlaying) engine.pause()
  }

  private buildEngineComments(): DanmuJsComment[] {
    const rate = this.effectivePlaybackRate()
    const fixedDuration = Math.round(5000 / rate)
    const scrollDuration = this.normalScrollDuration()

    return this.displayComments.map((comment) => {
      const engineMode = toEngineMode(comment.mode)
      return toDanmuJsComment(
        comment,
        engineMode === "scroll" ? scrollDuration : fixedDuration,
        {
          fontSize: this.config.fontSize,
          fontFamily: this.config.fontFamily,
          fontWeight: this.config.fontWeight,
          outline: this.config.outline,
          spacing: this.config.spacing,
          lineSpacing: this.config.lineSpacing,
        },
      )
    })
  }

  private installCollisionPolicy(engine: DanmuJsInstance) {
    const channel = (engine as DanmuJsInternalEngine).main?.channel
    const addBullet = channel?.addBullet
    if (!channel || typeof addBullet !== "function") return

    // danmu.js 1.2.1 stores `overlap` but never reads it. Suppress its
    // chase-offset correction when overlap prevention is disabled.
    channel.addBullet = (bullet) => {
      if (
        this.config.antiOverlap ||
        bullet.mode !== "scroll" ||
        typeof bullet.updateOffset !== "function"
      ) {
        return addBullet.call(channel, bullet)
      }

      const updateOffset = bullet.updateOffset
      bullet.updateOffset = () => undefined
      try {
        return addBullet.call(channel, bullet)
      } finally {
        bullet.updateOffset = updateOffset
      }
    }
  }

  private areaConfig() {
    const availableHeight = AREA_BOTTOM - AREA_TOP
    return {
      start: AREA_TOP,
      end: AREA_TOP + availableHeight * (this.config.displayArea / 100),
    }
  }

  private channelSize() {
    return this.config.fontSize + this.config.lineSpacing
  }

  private normalScrollDuration() {
    const width = this.overlay.clientWidth || this.player.width || 0
    const duration =
      ((width + NORMAL_SCROLL_DURATION.width) /
        NORMAL_SCROLL_DURATION.divisor) *
      1000
    return clamp(
      duration,
      NORMAL_SCROLL_DURATION.min,
      NORMAL_SCROLL_DURATION.max,
    )
  }

  private effectivePlaybackRate() {
    const playbackRate = this.config.followPlaybackRate
      ? this.player.video.playbackRate || 1
      : 1
    return clamp(this.config.speed * playbackRate, 0.25, 8)
  }

  private isPlaying() {
    const video = this.player.video
    return !video.paused && !video.ended && !video.seeking
  }

  private updateHeatmap() {
    if (
      !this.config.heatmap ||
      this.rawComments.length === 0 ||
      !Number.isFinite(this.player.video.duration) ||
      this.player.video.duration <= 0
    ) {
      this.heatmapSvg.style.display = "none"
      return
    }

    const values = buildDanmakuHeatmap(
      this.rawComments,
      this.player.video.duration,
      HEATMAP_WIDTH,
    )
    if (values.length === 0) {
      this.heatmapSvg.style.display = "none"
      return
    }

    const points = values.map((value, index) => {
      const x = index
      const y = HEATMAP_HEIGHT - value * HEATMAP_HEIGHT
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    this.heatmapPath.setAttribute(
      "d",
      `M 0 ${HEATMAP_HEIGHT} L ${points.join(" L ")} L ${HEATMAP_WIDTH} ${HEATMAP_HEIGHT} Z`,
    )
    this.heatmapSvg.style.display = ""
  }

  private createResizeObserver() {
    if (typeof ResizeObserver === "undefined") return
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleResize()
    })
    this.resizeObserver.observe(this.overlay)
  }

  private scheduleResize() {
    if (this.resizeTimer !== undefined) {
      window.clearTimeout(this.resizeTimer)
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = undefined
      this.engine?.resize()
      this.updateSpeed()
    }, 80)
  }

  private scheduleSeekResync() {
    if (this.seekTimer !== undefined) {
      window.clearTimeout(this.seekTimer)
    }
    this.seekTimer = window.setTimeout(() => {
      this.seekTimer = undefined
      this.syncEngine()
    }, 0)
  }

  private clearTimers() {
    if (this.resizeTimer !== undefined) {
      window.clearTimeout(this.resizeTimer)
      this.resizeTimer = undefined
    }
    if (this.seekTimer !== undefined) {
      window.clearTimeout(this.seekTimer)
      this.seekTimer = undefined
    }
  }

  private bindPlayerEvents() {
    this.player.on("video:play", this.onPlay)
    this.player.on("video:pause", this.onPause)
    this.player.on("video:ended", this.onEnded)
    this.player.on("video:seeking", this.onSeeking)
    this.player.on("video:seeked", this.onSeeked)
    this.player.on("video:ratechange", this.onRateChange)
    this.player.on("video:durationchange", this.onDurationChange)
    this.player.on("video:loadedmetadata", this.onLoadedMetadata)
    this.player.on("video:emptied", this.onEmptied)
    this.player.on("restart", this.onRestart)
    this.player.on("resize", this.onResize)
    this.player.on("fullscreen", this.onFullscreen)
    this.player.on("fullscreenWeb", this.onFullscreen)
  }

  private unbindPlayerEvents() {
    this.player.off("video:play", this.onPlay)
    this.player.off("video:pause", this.onPause)
    this.player.off("video:ended", this.onEnded)
    this.player.off("video:seeking", this.onSeeking)
    this.player.off("video:seeked", this.onSeeked)
    this.player.off("video:ratechange", this.onRateChange)
    this.player.off("video:durationchange", this.onDurationChange)
    this.player.off("video:loadedmetadata", this.onLoadedMetadata)
    this.player.off("video:emptied", this.onEmptied)
    this.player.off("restart", this.onRestart)
    this.player.off("resize", this.onResize)
    this.player.off("fullscreen", this.onFullscreen)
    this.player.off("fullscreenWeb", this.onFullscreen)
  }

  private isSourceCurrent(generation: number, signal?: AbortSignal) {
    return (
      !this.destroyed &&
      generation === this.sourceGeneration &&
      !signal?.aborted
    )
  }

  private isConversionCurrent(generation: number) {
    return !this.destroyed && generation === this.conversionGeneration
  }
}

function getSimplifiedConverter() {
  if (!simplifiedConverter) {
    simplifiedConverter = OpenCC.Converter({ from: "t", to: "cn" })
  }
  return simplifiedConverter
}

function resolveDanmuJsConstructor(): DanmuJsConstructor {
  if (typeof DanmuJsModule === "function") {
    return DanmuJsModule
  }
  const constructor = DanmuJsModule.DanmuJs ?? DanmuJsModule.default
  if (constructor) return constructor
  throw new Error("danmu.js constructor is unavailable")
}

function toEngineMode(mode: DanmakuComment["mode"]): DanmuJsMode {
  if (mode === 1) return "top"
  if (mode === 2) return "bottom"
  return "scroll"
}

function cloneComment(comment: DanmakuComment): DanmakuComment {
  return {
    ...comment,
    style: comment.style ? { ...comment.style } : undefined,
  }
}

function cloneConfig(config: DanmakuConfig): DanmakuConfig {
  return {
    ...config,
    modes: { ...config.modes },
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
