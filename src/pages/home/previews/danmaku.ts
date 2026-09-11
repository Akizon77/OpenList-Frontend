import Artplayer from "artplayer"
import { currentLang } from "~/app/i18n"
import { getSettingBool } from "~/store"
import {
  DanmakuAnimeCandidate,
  DanmakuCommentsResult,
  DanmakuMapping,
  DanmakuMatchedEpisode,
  DanmakuMedia,
  DanmakuSearchResult,
  Obj,
} from "~/types"
import { danmakuComments, danmakuSearch, ext } from "~/utils"
import {
  createDefaultDanmakuConfig,
  loadDanmakuConfig,
  saveDanmakuConfig,
  type DanmakuConfig,
  type DanmakuDisplayArea,
  type DanmakuEngineMode,
  type DanmakuFontFamily,
  type DanmakuFontWeight,
  type DanmakuOutline,
  type DanmakuSpacing,
  type DanmakuSpeed,
} from "./danmaku-config"
import { normalizeComments, parseBilibiliXml } from "./danmaku-data"
import { DanmuJsRenderer } from "./danmaku-renderer"

const MAPPINGS_KEY = "openlist_danmaku_mappings_v1"
const PANEL_ID = "openlist-danmaku-panel"

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>`
const SETTINGS_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10"></path><path d="M18 7h2"></path><circle cx="16" cy="7" r="2"></circle><path d="M4 17h2"></path><path d="M10 17h10"></path><circle cx="8" cy="17" r="2"></circle></svg>`
const DANMAKU_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path><path d="M8 9h8"></path><path d="M8 13h5"></path></svg>`

type DanmakuSource = "none" | "local" | "online"
type DanmakuPanelTab = "source" | "display"

export interface DanmakuControllerOptions {
  player: () => Artplayer | undefined
  getPath: () => string
  getPassword: () => string
  getMedia?: () => DanmakuMedia | undefined
  getLocalXml?: () => Obj | undefined
  getLocalXmlUrl?: (obj: Obj) => string
  defaultQuery?: () => string
}

export class DanmakuController {
  private readonly options: DanmakuControllerOptions
  private player?: Artplayer
  private renderer?: DanmuJsRenderer
  private panel?: HTMLDivElement
  private panelOpen = false
  private panelTab: DanmakuPanelTab = "source"
  private searchInput?: HTMLInputElement
  private statusElement?: HTMLDivElement
  private matchElement?: HTMLDivElement
  private candidatesElement?: HTMLDivElement
  private sourceElement?: HTMLDivElement
  private toggleControl?: HTMLElement
  private abortController?: AbortController
  private generation = 0
  private activeKey = ""
  private currentSource: DanmakuSource = "none"
  private currentMatch?: DanmakuMatchedEpisode
  private lastQuery = ""
  private loading = false
  private destroyed = false
  private loadQueue: Promise<void> = Promise.resolve()
  private config: DanmakuConfig = createDefaultDanmakuConfig()

  constructor(options: DanmakuControllerOptions) {
    this.options = options
  }

  async init() {
    const player = this.options.player()
    if (!player) return
    if (!player.isReady) {
      await new Promise<void>((resolve) => {
        if (player.isReady) resolve()
        else player.once("ready", () => resolve())
      })
    }
    if (this.destroyed) return

    this.player = player
    this.config = loadDanmakuConfig()
    this.renderer = new DanmuJsRenderer(player, this.config)
    this.addControls()
    this.createPanel()
    this.reload()
  }

  reload() {
    if (!this.player || !this.renderer) return
    const key = this.mappingKey()
    if (key !== this.activeKey) {
      this.activeKey = key
      this.lastQuery = ""
      this.currentSource = "none"
      this.currentMatch = undefined
      this.renderer.reset()
      this.candidatesElement?.replaceChildren()
      this.renderMatch()
      this.setStatus("")
      this.setPanelOpen(false)
      this.setInputValue(this.defaultQuery())
    }
    const requestGeneration = ++this.generation
    this.abortController?.abort()
    void this.restorePriority(requestGeneration, key)
  }

  openPanel(tab: DanmakuPanelTab = "source") {
    this.setPanelTab(tab)
    this.setPanelOpen(true)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.generation += 1
    this.abortController?.abort()
    this.panel?.remove()

    if (this.player) {
      for (const name of [
        "danmaku-search",
        "danmaku-settings",
        "danmaku-toggle",
      ]) {
        if (this.player.controls[name]) {
          this.player.controls.remove(name)
        }
      }
    }

    this.renderer?.destroy()
    this.renderer = undefined
    this.toggleControl = undefined
    this.player = undefined
  }

  private async restorePriority(generation: number, key: string) {
    if (generation !== this.generation) return
    const mapping = readMappings()[key]
    if (mapping) {
      this.setStatus(this.text("正在读取已保存的匹配", "Loading saved match"))
      const matched = await this.loadComments(
        mapping.episode_id,
        {
          anime_id: mapping.anime_id,
          anime_title: mapping.anime_title,
          anime_type: "",
          type_description: "",
          episode_id: mapping.episode_id,
          episode_title: mapping.episode_title,
        },
        mapping.query,
        false,
      )
      if (!matched && generation === this.generation) {
        this.openPanel()
      }
      return
    }

    const local = this.options.getLocalXml?.()
    if (local) {
      await this.loadLocal(generation)
      return
    }
    if (!getSettingBool("danmaku_enabled")) {
      this.setStatus(this.text("弹幕功能已关闭", "Danmaku is disabled"))
      return
    }
    await this.search("", generation, false)
  }

  private async loadLocal(generation: number) {
    const renderer = this.renderer
    const local = this.options.getLocalXml?.()
    const url = local ? this.options.getLocalXmlUrl?.(local) : ""
    if (!renderer || !local || !url || generation !== this.generation) {
      return
    }

    const controller = new AbortController()
    this.abortController = controller
    this.loading = true
    this.setStatus(this.text("正在加载本地 XML", "Loading local XML"))

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const xml = await response.text()
      if (generation !== this.generation || controller.signal.aborted) {
        return
      }
      const comments = parseBilibiliXml(xml)
      const loaded = await this.queueRendererLoad(
        () => renderer.load(comments, controller.signal),
        generation,
      )
      if (!loaded || generation !== this.generation) return

      this.currentSource = "local"
      this.currentMatch = {
        anime_id: 0,
        anime_title: local.name,
        anime_type: "local",
        type_description: this.text("本地 XML", "Local XML"),
        episode_id: 0,
        episode_title: local.name,
      }
      this.renderMatch()
      this.setStatus(this.text("已使用本地 XML", "Using local XML"))
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      this.setStatus(errorMessage(error))
    } finally {
      if (generation === this.generation) {
        this.loading = false
      }
    }
  }

  private async search(
    query: string,
    generation: number,
    openOnSuccess: boolean,
  ) {
    if (!getSettingBool("danmaku_enabled")) {
      this.setStatus(this.text("弹幕功能已关闭", "Danmaku is disabled"))
      return
    }
    const path = this.options.getPath()
    const controller = new AbortController()
    this.abortController = controller
    this.loading = true
    this.setStatus(this.text("正在搜索弹幕", "Searching danmaku"))

    let response: Awaited<ReturnType<typeof danmakuSearch>>
    try {
      response = await danmakuSearch(
        path,
        this.options.getPassword(),
        query.trim(),
        this.options.getMedia?.(),
        controller.signal,
      )
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      this.loading = false
      this.setStatus(errorMessage(error))
      this.openPanel()
      return
    }
    if (generation !== this.generation || controller.signal.aborted) return
    this.loading = false
    if (response.code !== 200) {
      this.setStatus(response.message || this.text("搜索失败", "Search failed"))
      this.openPanel()
      return
    }

    const result = response.data
    this.lastQuery = result.query || query
    this.setInputValue(result.suggested_query || query)
    this.renderCandidates(result)
    if (result.status === "matched" && result.episode_id && result.match) {
      await this.loadComments(
        result.episode_id,
        result.match,
        result.query || query,
        false,
      )
      if (openOnSuccess) this.openPanel()
      return
    }
    this.setStatus(
      result.status === "ambiguous"
        ? this.text(
            "找到多个候选，请选择正确剧集",
            "Multiple matches found; select the correct episode",
          )
        : this.text(
            "没有找到匹配，请修改搜索词",
            "No match found; adjust the query",
          ),
    )
    this.openPanel()
  }

  private async loadComments(
    episodeID: number,
    match: DanmakuMatchedEpisode,
    query: string,
    saveMapping: boolean,
  ): Promise<boolean> {
    if (!getSettingBool("danmaku_enabled")) return false
    const renderer = this.renderer
    if (!renderer) return false

    const generation = ++this.generation
    this.abortController?.abort()
    const controller = new AbortController()
    this.abortController = controller
    this.loading = true
    this.setStatus(this.text("正在加载弹幕", "Loading danmaku"))

    let response: Awaited<ReturnType<typeof danmakuComments>>
    try {
      response = await danmakuComments(
        this.options.getPath(),
        this.options.getPassword(),
        episodeID,
        controller.signal,
      )
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted)
        return false
      this.loading = false
      this.setStatus(errorMessage(error))
      this.openPanel()
      return false
    }
    if (generation !== this.generation || controller.signal.aborted) {
      return false
    }
    this.loading = false
    if (response.code !== 200) {
      this.setStatus(
        response.message || this.text("弹幕加载失败", "Failed to load danmaku"),
      )
      this.openPanel()
      return false
    }

    const result: DanmakuCommentsResult = response.data
    const comments = normalizeComments(result.comments)
    try {
      const loaded = await this.queueRendererLoad(
        () => renderer.load(comments, controller.signal),
        generation,
      )
      if (!loaded) return false
    } catch (error) {
      if (generation !== this.generation) return false
      this.setStatus(errorMessage(error))
      this.openPanel()
      return false
    }
    if (generation !== this.generation) return false

    this.currentSource = "online"
    this.currentMatch = match
    this.renderMatch()
    const partial = result.partial
      ? this.text(
          "；部分关联源不可用",
          "; some related sources are unavailable",
        )
      : ""
    this.setStatus(
      this.text(
        `已加载 ${comments.length} 条弹幕${partial}`,
        `Loaded ${comments.length} danmaku${partial}`,
      ),
    )
    if (saveMapping) {
      this.saveMapping(match, query)
    }
    return true
  }

  private queueRendererLoad<T>(
    load: () => Promise<T>,
    generation: number,
  ): Promise<T | undefined> {
    const next = this.loadQueue
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation || this.destroyed) return
        return load()
      })
    this.loadQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private addControls() {
    const player = this.player
    if (!player) return

    if (!player.controls["danmaku-search"]) {
      player.controls.add({
        name: "danmaku-search",
        index: 12,
        position: "right",
        html: SEARCH_ICON,
        tooltip: this.text("弹幕搜索", "Danmaku search"),
        click: () => this.openPanel("source"),
      })
    }

    if (!player.controls["danmaku-settings"]) {
      player.controls.add({
        name: "danmaku-settings",
        index: 13,
        position: "right",
        html: SETTINGS_ICON,
        tooltip: this.text("弹幕设置", "Danmaku settings"),
        click: () => this.openPanel("display"),
      })
    }

    if (!player.controls["danmaku-toggle"]) {
      this.toggleControl = player.controls.add({
        name: "danmaku-toggle",
        index: 14,
        position: "right",
        html: DANMAKU_ICON,
        tooltip: this.text("弹幕开关", "Toggle danmaku"),
        click: () => {
          const next = {
            ...this.config,
            modes: { ...this.config.modes },
            visible: !this.config.visible,
          }
          this.applyConfig(next)
        },
      })
    }
    this.syncToggleControl()
  }

  private createPanel() {
    const player = this.player
    if (!player || this.panel) return

    const panel = document.createElement("div")
    panel.id = PANEL_ID
    panel.className = "openlist-danmaku-panel"
    panel.setAttribute("role", "dialog")
    panel.setAttribute("aria-label", this.text("弹幕", "Danmaku"))
    panel.innerHTML = `
      <div class="openlist-danmaku-panel__header">
        <div>
          <strong>${this.text("弹幕", "Danmaku")}</strong>
          <div class="openlist-danmaku-source"></div>
        </div>
        <button type="button" data-action="close" aria-label="${this.text("关闭", "Close")}">×</button>
      </div>
      <div class="openlist-danmaku-tabs" role="tablist">
        <button type="button" role="tab" data-tab="source" data-active="true">${this.text("来源", "Source")}</button>
        <button type="button" role="tab" data-tab="display" data-active="false">${this.text("显示", "Display")}</button>
      </div>
      <div class="openlist-danmaku-tab-panel" data-tab-panel="source">
        <div class="openlist-danmaku-actions">
          <button type="button" data-action="local">${this.text("恢复本地 XML", "Restore local XML")}</button>
          <button type="button" data-action="online">${this.text("在线聚合", "Online")}</button>
          <button type="button" data-action="clear">${this.text("清除匹配", "Clear match")}</button>
        </div>
        <form class="openlist-danmaku-search">
          <input type="search" maxlength="256" autocomplete="off" placeholder="${this.text("剧名 S01E01", "Title S01E01")}" />
          <button type="submit">${SEARCH_ICON}</button>
        </form>
        <div class="openlist-danmaku-status" role="status"></div>
        <div class="openlist-danmaku-match"></div>
        <div class="openlist-danmaku-candidates"></div>
      </div>
      <div class="openlist-danmaku-tab-panel" data-tab-panel="display" data-active="false">
        <div class="openlist-danmaku-settings">
          <section class="openlist-danmaku-settings-group">
            <div class="openlist-danmaku-settings-title">${this.text("显示模式", "Display modes")}</div>
            <div class="openlist-danmaku-checks">
              <label><input type="checkbox" data-danmaku-mode="scroll" /><span>${this.text("滚动", "Scroll")}</span></label>
              <label><input type="checkbox" data-danmaku-mode="top" /><span>${this.text("顶部", "Top")}</span></label>
              <label><input type="checkbox" data-danmaku-mode="bottom" /><span>${this.text("底部", "Bottom")}</span></label>
            </div>
          </section>
          <section class="openlist-danmaku-settings-group">
            <div class="openlist-danmaku-setting-row">
              <span>${this.text("字体", "Font")}</span>
              <div class="openlist-danmaku-segmented" data-danmaku-segment="fontFamily">
                <button type="button" data-value="system">${this.text("默认", "Default")}</button>
                <button type="button" data-value="sans">${this.text("黑体", "Sans")}</button>
                <button type="button" data-value="serif">${this.text("宋体", "Serif")}</button>
                <button type="button" data-value="rounded">${this.text("圆体", "Rounded")}</button>
                <button type="button" data-value="monospace">${this.text("等宽", "Mono")}</button>
              </div>
            </div>
            <div class="openlist-danmaku-setting-row">
              <span>${this.text("粗细", "Weight")}</span>
              <div class="openlist-danmaku-segmented" data-danmaku-segment="fontWeight">
                <button type="button" data-value="normal">${this.text("常规", "Normal")}</button>
                <button type="button" data-value="bold">${this.text("粗体", "Bold")}</button>
              </div>
            </div>
            <label class="openlist-danmaku-range">
              <span>${this.text("字号", "Font size")}</span>
              <input type="range" min="16" max="36" step="1" data-danmaku-setting="fontSize" />
              <output data-danmaku-output="fontSize"></output>
            </label>
            <label class="openlist-danmaku-range">
              <span>${this.text("描边", "Outline")}</span>
              <input type="range" min="0" max="5" step="1" data-danmaku-setting="outline" />
              <output data-danmaku-output="outline"></output>
            </label>
            <label class="openlist-danmaku-range">
              <span>${this.text("透明度", "Opacity")}</span>
              <input type="range" min="10" max="100" step="5" data-danmaku-setting="opacity" />
              <output data-danmaku-output="opacity"></output>
            </label>
          </section>
          <section class="openlist-danmaku-settings-group">
            <div class="openlist-danmaku-setting-row">
              <span>${this.text("显示区域", "Display area")}</span>
              <div class="openlist-danmaku-segmented" data-danmaku-segment="displayArea">
                <button type="button" data-value="25">25%</button>
                <button type="button" data-value="50">50%</button>
                <button type="button" data-value="75">75%</button>
                <button type="button" data-value="90">90%</button>
                <button type="button" data-value="100">100%</button>
              </div>
            </div>
            <div class="openlist-danmaku-setting-row">
              <span>${this.text("速度", "Speed")}</span>
              <div class="openlist-danmaku-segmented" data-danmaku-segment="speed">
                <button type="button" data-value="0.75">0.75x</button>
                <button type="button" data-value="1">1x</button>
                <button type="button" data-value="1.25">1.25x</button>
                <button type="button" data-value="1.5">1.5x</button>
              </div>
            </div>
            <div class="openlist-danmaku-setting-row">
              <span>${this.text("间距", "Spacing")}</span>
              <div class="openlist-danmaku-segmented" data-danmaku-segment="spacing">
                <button type="button" data-value="0">${this.text("紧凑", "Compact")}</button>
                <button type="button" data-value="100">${this.text("标准", "Normal")}</button>
                <button type="button" data-value="250">${this.text("宽松", "Wide")}</button>
              </div>
            </div>
          </section>
          <section class="openlist-danmaku-settings-group">
            <div class="openlist-danmaku-checks openlist-danmaku-checks--stacked">
              <label><input type="checkbox" data-danmaku-setting="antiOverlap" /><span>${this.text("防止重叠", "Prevent overlap")}</span></label>
              <label><input type="checkbox" data-danmaku-setting="followPlaybackRate" /><span>${this.text("跟随视频倍速", "Follow playback rate")}</span></label>
              <label><input type="checkbox" data-danmaku-setting="heatmap" /><span>${this.text("热度图", "Heatmap")}</span></label>
              <label><input type="checkbox" data-danmaku-setting="traditionalToSimplified" /><span>${this.text("繁体转简体", "Traditional to Simplified")}</span></label>
            </div>
          </section>
        </div>
      </div>
    `
    player.template.$player.appendChild(panel)
    this.panel = panel
    this.searchInput = panel.querySelector("input") ?? undefined
    this.statusElement =
      panel.querySelector(".openlist-danmaku-status") ?? undefined
    this.matchElement =
      panel.querySelector(".openlist-danmaku-match") ?? undefined
    this.candidatesElement =
      panel.querySelector(".openlist-danmaku-candidates") ?? undefined
    this.sourceElement =
      panel.querySelector(".openlist-danmaku-source") ?? undefined

    panel.addEventListener("pointerdown", (event) => event.stopPropagation())
    panel.addEventListener("mousedown", (event) => event.stopPropagation())
    panel.addEventListener("click", (event) => {
      event.stopPropagation()
      const target = event.target as HTMLElement
      const tab = target.closest<HTMLElement>("[data-tab]")?.dataset.tab
      if (tab === "source" || tab === "display") {
        this.setPanelTab(tab)
        return
      }

      const segment = target.closest<HTMLElement>("[data-danmaku-segment]")
      const button = target.closest<HTMLButtonElement>("[data-value]")
      if (segment && button) {
        this.applySegmentValue(segment, button)
      }
    })
    panel.addEventListener("input", (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === "range") {
        this.applyControlValue(target)
      }
    })
    panel.addEventListener("change", (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === "checkbox") {
        this.applyControlValue(target)
      }
    })

    panel
      .querySelector("[data-action='close']")
      ?.addEventListener("click", () => {
        this.setPanelOpen(false)
      })
    panel
      .querySelector("[data-action='local']")
      ?.addEventListener("click", () => {
        void this.restoreLocal()
      })
    panel
      .querySelector("[data-action='online']")
      ?.addEventListener("click", () => {
        void this.restoreOnline()
      })
    panel
      .querySelector("[data-action='clear']")
      ?.addEventListener("click", () => {
        void this.clearMapping()
      })
    panel.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault()
      const generation = ++this.generation
      this.abortController?.abort()
      void this.search(this.searchInput?.value || "", generation, true)
    })

    this.syncConfigControls()
  }

  private applyControlValue(input: HTMLInputElement) {
    const setting = input.dataset.danmakuSetting
    const mode = input.dataset.danmakuMode as DanmakuEngineMode | undefined
    const next: DanmakuConfig = {
      ...this.config,
      modes: { ...this.config.modes },
    }

    if (mode) {
      next.modes[mode] = input.checked
    } else if (setting === "fontSize") {
      next.fontSize = clamp(Number(input.value), 16, 36)
    } else if (setting === "outline") {
      next.outline = clamp(
        Math.round(Number(input.value)),
        0,
        5,
      ) as DanmakuOutline
    } else if (setting === "opacity") {
      next.opacity = clamp(Number(input.value) / 100, 0.1, 1)
    } else if (setting === "antiOverlap") {
      next.antiOverlap = input.checked
    } else if (setting === "followPlaybackRate") {
      next.followPlaybackRate = input.checked
    } else if (setting === "heatmap") {
      next.heatmap = input.checked
    } else if (setting === "traditionalToSimplified") {
      next.traditionalToSimplified = input.checked
    } else {
      return
    }

    this.applyConfig(next)
  }

  private applySegmentValue(segment: HTMLElement, button: HTMLButtonElement) {
    const setting = segment.dataset.danmakuSegment
    const value = button.dataset.value
    const next: DanmakuConfig = {
      ...this.config,
      modes: { ...this.config.modes },
    }

    if (setting === "displayArea") {
      next.displayArea = Number(value) as DanmakuDisplayArea
    } else if (setting === "speed") {
      next.speed = Number(value) as DanmakuSpeed
    } else if (setting === "spacing") {
      next.spacing = Number(value) as DanmakuSpacing
    } else if (setting === "fontFamily") {
      next.fontFamily = value as DanmakuFontFamily
    } else if (setting === "fontWeight") {
      next.fontWeight = value as DanmakuFontWeight
    } else {
      return
    }
    this.applyConfig(next)
  }

  private applyConfig(config: DanmakuConfig) {
    this.config = config
    saveDanmakuConfig(config)
    void this.renderer?.updateConfig(config)
    this.syncConfigControls()
    this.syncToggleControl()
  }

  private syncConfigControls() {
    const panel = this.panel
    if (!panel) return

    for (const mode of ["scroll", "top", "bottom"] as const) {
      const input = panel.querySelector<HTMLInputElement>(
        `[data-danmaku-mode="${mode}"]`,
      )
      if (input) input.checked = this.config.modes[mode]
    }

    const fontSize = panel.querySelector<HTMLInputElement>(
      "[data-danmaku-setting='fontSize']",
    )
    if (fontSize) fontSize.value = String(this.config.fontSize)
    const opacity = panel.querySelector<HTMLInputElement>(
      "[data-danmaku-setting='opacity']",
    )
    if (opacity) opacity.value = String(Math.round(this.config.opacity * 100))
    const outline = panel.querySelector<HTMLInputElement>(
      "[data-danmaku-setting='outline']",
    )
    if (outline) outline.value = String(this.config.outline)

    const fontSizeOutput = panel.querySelector<HTMLOutputElement>(
      "[data-danmaku-output='fontSize']",
    )
    if (fontSizeOutput) fontSizeOutput.value = `${this.config.fontSize}px`
    const opacityOutput = panel.querySelector<HTMLOutputElement>(
      "[data-danmaku-output='opacity']",
    )
    if (opacityOutput) {
      opacityOutput.value = `${Math.round(this.config.opacity * 100)}%`
    }
    const outlineOutput = panel.querySelector<HTMLOutputElement>(
      "[data-danmaku-output='outline']",
    )
    if (outlineOutput) {
      outlineOutput.value = this.outlineLabel(this.config.outline)
    }

    this.syncSegmentState("displayArea", String(this.config.displayArea))
    this.syncSegmentState("speed", String(this.config.speed))
    this.syncSegmentState("spacing", String(this.config.spacing))
    this.syncSegmentState("fontFamily", this.config.fontFamily)
    this.syncSegmentState("fontWeight", this.config.fontWeight)

    for (const setting of [
      "antiOverlap",
      "followPlaybackRate",
      "heatmap",
      "traditionalToSimplified",
    ] as const) {
      const input = panel.querySelector<HTMLInputElement>(
        `[data-danmaku-setting="${setting}"]`,
      )
      if (input) input.checked = this.config[setting]
    }
  }

  private syncSegmentState(setting: string, value: string) {
    const buttons = this.panel?.querySelectorAll<HTMLButtonElement>(
      `[data-danmaku-segment="${setting}"] [data-value]`,
    )
    buttons?.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.value === value)
    })
  }

  private syncToggleControl() {
    this.toggleControl?.classList.toggle("is-active", this.config.visible)
    this.toggleControl?.setAttribute(
      "aria-pressed",
      String(this.config.visible),
    )
  }

  private outlineLabel(value: DanmakuOutline) {
    return [
      this.text("无", "None"),
      this.text("极细", "Hairline"),
      this.text("细", "Thin"),
      this.text("标准", "Normal"),
      this.text("粗", "Bold"),
      this.text("极粗", "Heavy"),
    ][value]
  }

  private async restoreLocal() {
    const key = this.mappingKey()
    writeMappings(deleteMapping(key))
    const generation = ++this.generation
    this.abortController?.abort()
    if (this.options.getLocalXml?.()) {
      await this.loadLocal(generation)
    } else if (getSettingBool("danmaku_enabled")) {
      await this.search("", generation, false)
    }
  }

  private async restoreOnline() {
    const key = this.mappingKey()
    const mapping = readMappings()[key]
    if (mapping) {
      const generation = ++this.generation
      this.abortController?.abort()
      const loaded = await this.loadComments(
        mapping.episode_id,
        {
          anime_id: mapping.anime_id,
          anime_title: mapping.anime_title,
          anime_type: "",
          type_description: "",
          episode_id: mapping.episode_id,
          episode_title: mapping.episode_title,
        },
        mapping.query,
        false,
      )
      if (loaded) this.setPanelOpen(false)
      return
    }
    const generation = ++this.generation
    this.abortController?.abort()
    await this.search("", generation, false)
  }

  private async clearMapping() {
    const key = this.mappingKey()
    writeMappings(deleteMapping(key))
    this.setStatus(this.text("已清除保存的匹配", "Saved match cleared"))
    const local = this.options.getLocalXml?.()
    const generation = ++this.generation
    this.abortController?.abort()
    if (local) {
      await this.loadLocal(generation)
    } else if (getSettingBool("danmaku_enabled")) {
      await this.search("", generation, false)
    }
  }

  private saveMapping(match: DanmakuMatchedEpisode, query: string) {
    const key = this.mappingKey()
    const mappings = readMappings()
    mappings[key] = {
      key,
      query: query.trim() || this.lastQuery,
      anime_id: match.anime_id,
      anime_title: match.anime_title,
      episode_id: match.episode_id,
      episode_title: match.episode_title,
      updated_at: Date.now(),
    }
    writeMappings(mappings)
  }

  private renderCandidates(result: DanmakuSearchResult) {
    if (!this.candidatesElement) return
    this.candidatesElement.replaceChildren()
    if (result.candidates.length === 0) {
      this.candidatesElement.appendChild(
        textElement(
          "div",
          "openlist-danmaku-empty",
          result.status === "not_found"
            ? this.text("没有找到匹配", "No matches found")
            : this.text("没有可选剧集", "No episodes available"),
        ),
      )
      return
    }

    for (const anime of result.candidates) {
      const card = document.createElement("section")
      card.className = "openlist-danmaku-candidate"
      const heading = document.createElement("div")
      heading.className = "openlist-danmaku-candidate__heading"
      heading.appendChild(textElement("strong", "", anime.anime_title))
      const meta = anime.type_description || anime.type
      if (meta) {
        heading.appendChild(textElement("span", "", meta))
      }
      card.appendChild(heading)

      const episodes = document.createElement("div")
      episodes.className = "openlist-danmaku-episodes"
      for (const episode of anime.episodes) {
        const button = document.createElement("button")
        button.type = "button"
        button.textContent = episode.episode_title
        if (result.episode_id === episode.episode_id) {
          button.classList.add("is-current")
        }
        button.addEventListener("click", () => {
          void this.selectEpisode(
            anime,
            episode.episode_id,
            episode.episode_title,
          )
        })
        episodes.appendChild(button)
      }
      card.appendChild(episodes)
      this.candidatesElement.appendChild(card)
    }
  }

  private async selectEpisode(
    anime: DanmakuAnimeCandidate,
    episodeID: number,
    episodeTitle: string,
  ) {
    const saved = await this.loadComments(
      episodeID,
      {
        anime_id: anime.anime_id,
        anime_title: anime.anime_title,
        anime_type: anime.type,
        type_description: anime.type_description,
        episode_id: episodeID,
        episode_title: episodeTitle,
      },
      this.lastQuery || this.searchInput?.value || "",
      true,
    )
    if (saved) {
      this.setPanelOpen(false)
    }
  }

  private renderMatch() {
    if (!this.matchElement) return
    this.matchElement.replaceChildren()
    if (!this.currentMatch) {
      this.matchElement.classList.remove("is-visible")
      if (this.sourceElement) this.sourceElement.textContent = ""
      return
    }
    this.matchElement.classList.add("is-visible")
    this.matchElement.textContent = `${this.currentMatch.anime_title} · ${this.currentMatch.episode_title}`
    if (this.sourceElement) {
      this.sourceElement.textContent =
        this.currentSource === "local"
          ? this.text("本地 XML", "Local XML")
          : this.text("在线聚合", "Online aggregate")
    }
  }

  private setStatus(message: string) {
    if (this.statusElement) this.statusElement.textContent = message
  }

  private setInputValue(value: string) {
    if (this.searchInput) this.searchInput.value = value
  }

  private setPanelOpen(open: boolean) {
    this.panelOpen = open
    this.panel?.classList.toggle("is-open", open)
    if (open) {
      if (!this.searchInput?.value) {
        this.setInputValue(this.defaultQuery())
      }
      if (this.panelTab === "source") {
        window.setTimeout(() => this.searchInput?.focus(), 0)
      }
    }
  }

  private setPanelTab(tab: DanmakuPanelTab) {
    this.panelTab = tab
    this.panel
      ?.querySelectorAll<HTMLElement>("[data-tab]")
      .forEach((button) => {
        button.dataset.active = String(button.dataset.tab === tab)
      })
    this.panel
      ?.querySelectorAll<HTMLElement>("[data-tab-panel]")
      .forEach((panel) => {
        panel.dataset.active = String(panel.dataset.tabPanel === tab)
      })
  }

  private defaultQuery() {
    const custom = this.options.defaultQuery?.()?.trim()
    if (custom) return custom
    const media = this.options.getMedia?.()
    if (media) {
      const title =
        media.item_type?.toLowerCase() === "movie"
          ? media.name || media.original_title || ""
          : media.series_name || media.original_title || media.name || ""
      if (
        media.season_number !== undefined &&
        media.episode_number !== undefined
      ) {
        return `${title} S${String(media.season_number).padStart(2, "0")}E${String(media.episode_number).padStart(2, "0")}`.trim()
      }
      if (title) return title
    }
    const name = this.options.getPath().split("/").pop() || ""
    const extension = name.includes(".") ? ext(name) : ""
    return name
      .slice(0, extension ? name.length - extension.length - 1 : name.length)
      .replace(/[._]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  private mappingKey() {
    const media = this.options.getMedia?.()
    return media?.item_id ? `emby:${media.item_id}` : this.options.getPath()
  }

  private text(chinese: string, english: string) {
    return currentLang().toLowerCase().startsWith("zh") ? chinese : english
  }
}

function readMappings(): Record<string, DanmakuMapping> {
  try {
    const parsed = JSON.parse(localStorage.getItem(MAPPINGS_KEY) || "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed
  } catch {
    return {}
  }
}

function writeMappings(mappings: Record<string, DanmakuMapping>) {
  localStorage.setItem(MAPPINGS_KEY, JSON.stringify(mappings))
}

function deleteMapping(key: string) {
  const mappings = readMappings()
  delete mappings[key]
  return mappings
}

function textElement(tag: string, className: string, text: string) {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
