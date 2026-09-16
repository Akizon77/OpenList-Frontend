import Artplayer from "artplayer"
import type { Setting, SettingOption } from "artplayer"
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
  type DanmakuFontFamily,
} from "./danmaku-config"
import { normalizeComments, parseBilibiliXml } from "./danmaku-data"
import { DanmuJsRenderer } from "./danmaku-renderer"

const MAPPINGS_KEY = "openlist_danmaku_mappings_v1"
const MORE_SETTING = "openlist-player-more"
const SOURCE_SETTING = "openlist-danmaku-source"
const DISPLAY_SETTING = "openlist-danmaku-display"
const TOGGLE_CONTROL = "danmaku-toggle"

const DANMAKU_SWITCH_ON = `<span class="bui-danmaku-switch-on"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 24 24"><path d="M15.386 2.201a.75.75 0 0 1 1.228.86l-.888 1.27a94.01 94.01 0 0 1 2.228.114 3.872 3.872 0 0 1 3.634 3.602c.086 1.227.162 2.778.162 4.453 0 .495-.007.977-.02 1.44a.75.75 0 1 1-1.499-.034c.012-.453.019-.923.019-1.406 0-1.632-.074-3.147-.158-4.348a2.372 2.372 0 0 0-2.236-2.21A91.112 91.112 0 0 0 12 5.75a91.11 91.11 0 0 0-5.856.192 2.372 2.372 0 0 0-2.236 2.21A62.667 62.667 0 0 0 3.75 12.5c0 1.638.074 3.146.16 4.335.083 1.18.999 2.097 2.182 2.188A78.45 78.45 0 0 0 12 19.25l.361-.002a.75.75 0 1 1 .006 1.5c-.385.001-.254.002-.367.002-2.375 0-4.48-.114-6.022-.232a3.847 3.847 0 0 1-3.565-3.576A63.008 63.008 0 0 1 2.25 12.5c0-1.674.076-3.226.162-4.453a3.872 3.872 0 0 1 3.634-3.602 94.013 94.013 0 0 1 2.228-.115l-.888-1.27a.75.75 0 0 1 1.228-.859l1.45 2.072c.62-.014 1.267-.023 1.936-.023.668 0 1.316.009 1.935.023l1.45-2.072Z"></path><path d="M23.02 15.938a.75.75 0 0 0-1.061.002l-3.922 3.936a.135.135 0 0 1-.191 0L15.9 17.925a.75.75 0 0 0-1.062 1.058l2.04 2.047a1.5 1.5 0 0 0 2.125 0L23.02 17a.75.75 0 0 0-.002-1.062Z" data-danmu-color="accent"></path><path d="M9.132 7.694c.578 0 1.046.468 1.047 1.046v1.73c0 .578-.47 1.047-1.047 1.047h-.883l-.158 1.427h1.105c.602 0 1.08.507 1.045 1.108l-.117 1.98a1.957 1.957 0 0 1-1.954 1.84H7.59a.592.592 0 0 1 0-1.183h.581c.41 0 .748-.32.772-.728l.109-1.834H7.938a1.046 1.046 0 0 1-1.04-1.162l.189-1.7c.059-.53.506-.931 1.04-.931h.869V8.877H7.43a.591.591 0 0 1 0-1.183h1.702Z"></path><path fill-rule="evenodd" d="M14.944 7.504a.591.591 0 1 1 .955.698l-.225.306c.765.159 1.34.837 1.34 1.649v2.208c0 .93-.754 1.684-1.684 1.684h-.808v.597h2.048a.592.592 0 0 1 0 1.183h-2.062a.591.591 0 0 1-1.155 0h-2.062a.592.592 0 0 1 0-1.183h2.048v-.597h-.806c-.93 0-1.684-.754-1.684-1.684v-2.208c0-.782.533-1.438 1.255-1.628l-.191-.215a.592.592 0 0 1 .884-.787l.643.724a.59.59 0 0 1 .123.222h.673l.708-.97Zm-2.912 4.861a.5.5 0 0 0 .5.5h.889v-1.043h-1.389v.543Zm2.412.5h.886a.5.5 0 0 0 .5-.5v-.543h-1.386v1.044Zm-1.911-3.209a.5.5 0 0 0-.5.5v.642h1.388V9.656h-.888Zm1.911 1.142h1.387v-.641a.5.5 0 0 0-.5-.5h-.887v1.141Z" clip-rule="evenodd"></path></svg></span>`
const DANMAKU_SWITCH_OFF = `<span class="bui-danmaku-switch-off"><svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 24 24"><path d="M16.43 2.016a.75.75 0 0 0-1.044.185l-1.451 2.071A88.83 88.83 0 0 0 12 4.25c-.669 0-1.316.009-1.935.022l-1.45-2.071a.75.75 0 1 0-1.23.86l.89 1.269c-.827.034-1.577.073-2.23.115a3.872 3.872 0 0 0-3.633 3.602A64.147 64.147 0 0 0 2.25 12.5c0 1.681.076 3.226.163 4.442a3.847 3.847 0 0 0 3.565 3.575c1.541.118 3.647.233 6.022.233.113 0-.018-.001.367-.002a.75.75 0 0 0-.006-1.5c-.386 0-.25.002-.361.002-2.329 0-4.395-.112-5.908-.228a2.348 2.348 0 0 1-2.183-2.187A61.514 61.514 0 0 1 3.75 12.5c0-1.631.074-3.147.158-4.348a2.372 2.372 0 0 1 2.236-2.21A91.11 91.11 0 0 1 12 5.75c2.302 0 4.347.094 5.856.192a2.372 2.372 0 0 1 2.236 2.21c.084 1.201.158 2.716.158 4.348a.75.75 0 0 0 1.5.008V12.5c0-1.675-.076-3.227-.162-4.453a3.872 3.872 0 0 0-3.634-3.602 93.96 93.96 0 0 0-2.228-.115l.888-1.269a.75.75 0 0 0-.183-1.045Z"></path><path fill="none" stroke="currentColor" stroke-width="1.35" d="M15.656 15.255a3.702 3.702 0 1 1 5.235 5.235 3.702 3.702 0 0 1-5.235-5.235Z" data-danmu-color="stroke"></path><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.35" d="m15.656 15.255 5.235 5.234" data-danmu-color="stroke"></path><path d="M9.133 7.694c.578 0 1.047.468 1.047 1.046v1.73c0 .578-.47 1.047-1.047 1.047H8.25l-.158 1.427h1.104c.603 0 1.082.507 1.046 1.108l-.117 1.979a1.958 1.958 0 0 1-1.954 1.84H7.59a.592.592 0 0 1 0-1.182h.581c.41 0 .748-.32.772-.728l.109-1.834H7.94a1.046 1.046 0 0 1-1.04-1.162l.188-1.7c.059-.53.507-.931 1.04-.931h.87V8.877H7.43a.591.591 0 0 1 0-1.183h1.702ZM12.571 14.646c.327 0 .591.265.591.592 0 .326-.224.592-.59.592h-1.28a.592.592 0 0 1 0-1.184h1.28Z"></path><path fill-rule="evenodd" d="M14.945 7.504a.591.591 0 0 1 .955.698l-.224.306a1.684 1.684 0 0 1 1.339 1.649v2.029a.591.591 0 0 1-1.183 0v-.364h-1.387v1.228a1 1 0 0 1-1 1h-.91c-.93 0-1.685-.755-1.685-1.685v-2.208c0-.782.533-1.437 1.256-1.627l-.193-.216a.593.593 0 0 1 .885-.787l.643.725a.59.59 0 0 1 .123.22h.673l.708-.968Zm-2.912 4.861c0 .276.225.5.501.5h.888v-1.043h-1.389v.543Zm.501-2.708a.5.5 0 0 0-.5.5v.642h1.388V9.657h-.888Zm1.911 1.142h1.387v-.642a.5.5 0 0 0-.5-.5h-.887v1.142Z" clip-rule="evenodd"></path></svg></span>`

const FONT_LABELS: Record<DanmakuFontFamily, [string, string]> = {
  system: ["默认", "Default"],
  sans: ["黑体", "Sans"],
  serif: ["宋体", "Serif"],
  rounded: ["圆体", "Rounded"],
  monospace: ["等宽", "Mono"],
}

type DanmakuSource = "none" | "local" | "online"

type SettingManager = Artplayer["setting"] & {
  active?: Setting[]
  render: (option?: Setting[]) => void
}

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
  private toggleControl?: HTMLElement
  private sourceSetting?: Setting
  private sourceSelector: Setting[] = []
  private searchInput?: HTMLInputElement
  private searchQuery = ""
  private statusMessage = ""
  private lastSearchResult?: DanmakuSearchResult
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
    this.searchQuery = this.defaultQuery()
    this.renderer = new DanmuJsRenderer(player, this.config)
    this.addToggleControl()
    this.installSettings()
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
      this.lastSearchResult = undefined
      this.renderer.reset()
      this.setStatus("")
      this.searchQuery = this.defaultQuery()
      this.refreshSourceMenu()
      this.closeSettings()
    }
    const requestGeneration = ++this.generation
    this.abortController?.abort()
    void this.restorePriority(requestGeneration, key)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.generation += 1
    this.abortController?.abort()

    const player = this.player
    if (player) {
      const more = player.setting.find(MORE_SETTING)
      if (more?.selector) {
        more.selector = more.selector.filter(
          (item: Setting) =>
            item.name !== SOURCE_SETTING && item.name !== DISPLAY_SETTING,
        )
      }
      if (player.controls[TOGGLE_CONTROL]) {
        player.controls.remove(TOGGLE_CONTROL)
      }
    }

    this.renderer?.destroy()
    this.renderer = undefined
    this.toggleControl = undefined
    this.sourceSetting = undefined
    this.sourceSelector = []
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
        this.openSourceMenu(true)
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
      this.openSourceMenu(true)
      return
    }
    if (generation !== this.generation || controller.signal.aborted) return
    this.loading = false
    if (response.code !== 200) {
      this.setStatus(response.message || this.text("搜索失败", "Search failed"))
      this.openSourceMenu(true)
      return
    }

    const result = response.data
    this.lastQuery = result.query || query
    this.searchQuery = result.suggested_query || query
    this.lastSearchResult = result
    this.setStatus(
      result.status === "matched"
        ? this.text("已找到匹配", "Match found")
        : result.status === "ambiguous"
          ? this.text("请选择正确的剧集", "Select an episode")
          : this.text("没有找到匹配", "No match found"),
      false,
    )
    this.refreshSourceMenu()
    if (result.status === "matched" && result.episode_id && result.match) {
      await this.loadComments(
        result.episode_id,
        result.match,
        result.query || query,
        false,
      )
      if (openOnSuccess) this.openSourceMenu()
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
    this.openSourceMenu()
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
      this.openSourceMenu(true)
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
      this.openSourceMenu(true)
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
      this.openSourceMenu(true)
      return false
    }
    if (generation !== this.generation) return false

    this.currentSource = "online"
    this.currentMatch = match
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

  private addToggleControl() {
    const player = this.player
    if (!player || player.controls[TOGGLE_CONTROL]) return

    player.controls.add({
      name: TOGGLE_CONTROL,
      index: 12,
      position: "right",
      html: DANMAKU_SWITCH_ON,
      tooltip: this.text("弹幕开关", "Toggle danmaku"),
      click: () => {
        this.applyConfig({
          ...this.config,
          modes: { ...this.config.modes },
          visible: !this.config.visible,
        })
      },
    })
    this.toggleControl = player.controls[TOGGLE_CONTROL]
    this.syncToggleControl()
  }

  private installSettings() {
    const player = this.player
    if (!player) return

    this.sourceSelector = this.buildSourceSelector()
    this.sourceSetting = {
      name: SOURCE_SETTING,
      html: this.text("弹幕来源", "Danmaku source"),
      selector: this.sourceSelector,
    }
    const displaySetting: Setting = {
      name: DISPLAY_SETTING,
      html: this.text("弹幕设置", "Danmaku settings"),
      selector: this.buildDisplaySelector(),
    }

    const more = player.setting.find(MORE_SETTING)
    // ArtPlayer caches each child's parent option array. Rebuilding the
    // existing more items prevents stale $option references and keeps the
    // submenu's native back header working after settings.update().
    const selector = (more?.selector ?? [])
      .map(cloneSetting)
      .filter(
        (item: Setting) =>
          item.name !== SOURCE_SETTING && item.name !== DISPLAY_SETTING,
      )
    selector.push(this.sourceSetting, displaySetting)

    if (more) {
      player.setting.update({
        name: MORE_SETTING,
        html: more.html,
        selector,
      })
    } else {
      player.setting.add({
        name: MORE_SETTING,
        html: this.text("更多", "More"),
        selector,
      })
    }
    this.syncSettingControls()
  }

  private buildDisplaySelector(): Setting[] {
    const font = (value: DanmakuFontFamily) => this.text(...FONT_LABELS[value])

    return [
      this.switchSetting("visible", this.text("弹幕开关", "Danmaku"), () => ({
        ...this.config,
        modes: { ...this.config.modes },
        visible: !this.config.visible,
      })),
      this.switchSetting(
        "mode-scroll",
        this.text("滚动弹幕", "Scrolling"),
        () => this.nextModeConfig("scroll"),
      ),
      this.switchSetting("mode-top", this.text("顶部弹幕", "Top"), () =>
        this.nextModeConfig("top"),
      ),
      this.switchSetting("mode-bottom", this.text("底部弹幕", "Bottom"), () =>
        this.nextModeConfig("bottom"),
      ),
      {
        name: "openlist-danmaku-fontFamily",
        html: this.text("字体", "Font"),
        tooltip: font(this.config.fontFamily),
        selector: (Object.keys(FONT_LABELS) as DanmakuFontFamily[]).map(
          (value) => ({
            name: `openlist-danmaku-fontFamily-${value}`,
            html: font(value),
            value,
            default: this.config.fontFamily === value,
          }),
        ),
        onSelect: (item) => {
          this.applyConfig({
            ...this.config,
            modes: { ...this.config.modes },
            fontFamily: item.value as DanmakuFontFamily,
          })
          return font(item.value as DanmakuFontFamily)
        },
      },
      this.rangeSetting(
        "fontSize",
        this.text("字号", "Font size"),
        16,
        36,
        1,
        this.config.fontSize,
        (value) => `${value}px`,
        (value) => ({ fontSize: value }),
      ),
      this.rangeSetting(
        "fontWeight",
        this.text("字重", "Weight"),
        100,
        900,
        100,
        this.config.fontWeight,
        String,
        (value) => ({ fontWeight: value }),
      ),
      this.rangeSetting(
        "lineSpacing",
        this.text("行间距", "Line spacing"),
        0,
        24,
        1,
        this.config.lineSpacing,
        (value) => `${value}px`,
        (value) => ({ lineSpacing: value }),
      ),
      this.rangeSetting(
        "outline",
        this.text("描边", "Outline"),
        0,
        3,
        0.1,
        this.config.outline,
        (value) => `${formatNumber(value)}px`,
        (value) => ({ outline: value }),
      ),
      this.rangeSetting(
        "opacity",
        this.text("透明度", "Opacity"),
        10,
        100,
        5,
        Math.round(this.config.opacity * 100),
        (value) => `${value}%`,
        (value) => ({ opacity: value / 100 }),
      ),
      this.rangeSetting(
        "displayArea",
        this.text("显示区域", "Display area"),
        25,
        100,
        5,
        this.config.displayArea,
        (value) => `${value}%`,
        (value) => ({ displayArea: value }),
      ),
      this.rangeSetting(
        "speed",
        this.text("速度", "Speed"),
        0.5,
        2,
        0.05,
        this.config.speed,
        (value) => `${formatNumber(value)}x`,
        (value) => ({ speed: value }),
      ),
      this.rangeSetting(
        "spacing",
        this.text("弹幕间距", "Danmaku spacing"),
        0,
        300,
        10,
        this.config.spacing,
        (value) => `${value}px`,
        (value) => ({ spacing: value }),
      ),
      this.switchSetting(
        "antiOverlap",
        this.text("防止重叠", "Prevent overlap"),
        (value) => this.patchConfig({ antiOverlap: !value }),
      ),
      this.switchSetting(
        "followPlaybackRate",
        this.text("跟随视频倍速", "Follow playback rate"),
        (value) => this.patchConfig({ followPlaybackRate: !value }),
      ),
      this.switchSetting("heatmap", this.text("热度图", "Heatmap"), (value) =>
        this.patchConfig({ heatmap: !value }),
      ),
      this.switchSetting(
        "traditionalToSimplified",
        this.text("繁体转简体", "Traditional to Simplified"),
        (value) => this.patchConfig({ traditionalToSimplified: !value }),
      ),
      {
        name: "openlist-danmaku-reset",
        html: this.text("恢复默认", "Reset to default"),
        onClick: () => {
          this.applyConfig(createDefaultDanmakuConfig())
          return ""
        },
      },
    ]
  }

  private switchSetting(
    key: string,
    html: string,
    next: (current: boolean) => DanmakuConfig,
  ): Setting {
    const current = this.switchValue(key)
    return {
      name: `openlist-danmaku-${key}`,
      html,
      switch: current,
      onSwitch: () => {
        const current = this.switchValue(key)
        this.applyConfig(next(current))
        return !current
      },
    }
  }

  private rangeSetting(
    key: string,
    html: string,
    min: number,
    max: number,
    step: number,
    value: number,
    format: (value: number) => string,
    patch: (value: number) => Partial<DanmakuConfig>,
  ): Setting {
    const update = (item: SettingOption) => {
      const next = clamp(item.range?.[0] ?? value, min, max)
      this.applyConfig({
        ...this.config,
        modes: { ...this.config.modes },
        ...patch(next),
      })
      return format(next)
    }
    return {
      name: `openlist-danmaku-${key}`,
      html,
      tooltip: format(value),
      range: [value, min, max, step],
      mounted: (_panel, item) => {
        item.$range?.setAttribute("aria-label", html)
      },
      onChange: update,
      onRange: update,
    }
  }

  private buildSourceSelector(): Setting[] {
    const selector: Setting[] = [
      {
        name: "openlist-danmaku-search",
        html: this.createSearchForm(),
        onClick: () => "",
      },
    ]

    if (this.currentMatch) {
      selector.push({
        name: "openlist-danmaku-current",
        html: this.text("当前来源", "Current source"),
        tooltip: `${this.currentMatch.anime_title} · ${this.currentMatch.episode_title}`,
        onClick: () => "",
      })
    }
    if (this.options.getLocalXml?.()) {
      selector.push({
        name: "openlist-danmaku-local",
        html: this.text("本地 XML", "Local XML"),
        onClick: () => {
          void this.restoreLocal()
          return ""
        },
      })
    }
    selector.push(
      {
        name: "openlist-danmaku-online",
        html: this.text("在线聚合", "Online"),
        onClick: () => {
          void this.restoreOnline()
          return ""
        },
      },
      {
        name: "openlist-danmaku-clear",
        html: this.text("清除匹配", "Clear match"),
        onClick: () => {
          void this.clearMapping()
          return ""
        },
      },
    )

    if (this.statusMessage) {
      selector.push({
        name: "openlist-danmaku-status",
        html: this.text("状态", "Status"),
        tooltip: this.statusMessage,
        onClick: () => "",
      })
    }

    for (const [index, anime] of (
      this.lastSearchResult?.candidates ?? []
    ).entries()) {
      selector.push({
        name: `openlist-danmaku-anime-${anime.anime_id}-${index}`,
        html: anime.anime_title,
        tooltip: anime.type_description || anime.type,
        selector: anime.episodes.map((episode) => ({
          name: `openlist-danmaku-episode-${anime.anime_id}-${episode.episode_id}`,
          html: episode.episode_title,
          value: episode.episode_id,
          default: this.lastSearchResult?.episode_id === episode.episode_id,
        })),
        onSelect: (item) => {
          const episode = anime.episodes.find(
            (candidate) => candidate.episode_id === Number(item.value),
          )
          if (episode) {
            void this.selectEpisode(
              anime,
              episode.episode_id,
              episode.episode_title,
            )
          }
          return item.html
        },
      })
    }

    return selector
  }

  private createSearchForm() {
    const form = document.createElement("form")
    const input = document.createElement("input")
    input.type = "search"
    input.maxLength = 256
    input.autocomplete = "off"
    input.placeholder = this.text("剧名 S01E01", "Title S01E01")
    input.setAttribute(
      "aria-label",
      this.text("搜索弹幕来源", "Search danmaku sources"),
    )
    input.value = this.searchQuery
    input.style.width = "160px"
    input.style.minWidth = "0"
    input.style.padding = "2px 0"
    input.style.border = "0"
    input.style.outline = "0"
    input.style.background = "transparent"
    input.style.color = "inherit"
    input.style.font = "inherit"
    input.style.textShadow = "none"
    this.searchInput = input

    const submit = document.createElement("button")
    submit.type = "submit"
    submit.textContent = this.text("搜索", "Search")
    submit.style.marginLeft = "auto"
    submit.style.border = "0"
    submit.style.background = "transparent"
    submit.style.color = "var(--art-theme)"
    submit.style.cursor = "pointer"
    submit.style.font = "inherit"
    submit.style.fontSize = "12px"
    submit.style.textShadow = "none"

    form.style.display = "flex"
    form.style.width = "100%"
    form.style.minWidth = "0"
    form.style.alignItems = "center"
    form.append(input, submit)
    form.addEventListener("pointerdown", (event) => event.stopPropagation())
    form.addEventListener("click", (event) => event.stopPropagation())
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.searchQuery = input.value
      const generation = ++this.generation
      this.abortController?.abort()
      void this.search(input.value, generation, true)
    })
    return form
  }

  private refreshSourceMenu(open = false) {
    const player = this.player
    if (!player || !this.sourceSetting) return

    const wasActive = this.isSourceMenuActive()
    const selector = this.buildSourceSelector()
    this.sourceSelector = selector
    player.setting.update({
      name: SOURCE_SETTING,
      html: this.sourceSetting.html,
      selector,
    })
    if (open) {
      this.openSourceMenu()
    } else if (wasActive) {
      ;(player.setting as SettingManager).render(selector)
    }
  }

  private openSourceMenu(focus = false) {
    const player = this.player
    if (!player) return
    const setting = player.setting as SettingManager
    const more = player.setting.find(MORE_SETTING)
    if (!more?.selector) return

    setting.show = true
    player.controls.show = true
    setting.render(more.selector)
    setting.render(this.sourceSelector)
    if (focus && player.template.$player.dataset.openlistInput !== "touch") {
      window.setTimeout(() => this.searchInput?.focus(), 0)
    }
  }

  private isSourceMenuActive() {
    return (
      this.player &&
      (this.player.setting as SettingManager).active === this.sourceSelector
    )
  }

  private closeSettings() {
    if (!this.player) return
    this.player.setting.show = false
  }

  private applyConfig(config: DanmakuConfig) {
    this.config = config
    saveDanmakuConfig(config)
    void this.renderer?.updateConfig(config)
    this.syncSettingControls()
    this.syncToggleControl()
  }

  private syncSettingControls() {
    const player = this.player
    if (!player) return
    const find = (name: string) => player.setting.find(name)

    const switches: Array<[string, boolean]> = [
      ["visible", this.config.visible],
      ["mode-scroll", this.config.modes.scroll],
      ["mode-top", this.config.modes.top],
      ["mode-bottom", this.config.modes.bottom],
      ["antiOverlap", this.config.antiOverlap],
      ["followPlaybackRate", this.config.followPlaybackRate],
      ["heatmap", this.config.heatmap],
      ["traditionalToSimplified", this.config.traditionalToSimplified],
    ]
    for (const [key, value] of switches) {
      const item = find(`openlist-danmaku-${key}`)
      if (item) item.switch = value
    }

    const ranges: Array<
      [string, number, number, number, number, (value: number) => string]
    > = [
      ["fontSize", this.config.fontSize, 16, 36, 1, (value) => `${value}px`],
      [
        "fontWeight",
        this.config.fontWeight,
        100,
        900,
        100,
        (value) => String(value),
      ],
      [
        "lineSpacing",
        this.config.lineSpacing,
        0,
        24,
        1,
        (value) => `${value}px`,
      ],
      [
        "outline",
        this.config.outline,
        0,
        3,
        0.1,
        (value) => `${formatNumber(value)}px`,
      ],
      [
        "opacity",
        Math.round(this.config.opacity * 100),
        10,
        100,
        5,
        (value) => `${value}%`,
      ],
      [
        "displayArea",
        this.config.displayArea,
        25,
        100,
        5,
        (value) => `${value}%`,
      ],
      [
        "speed",
        this.config.speed,
        0.5,
        2,
        0.05,
        (value) => `${formatNumber(value)}x`,
      ],
      ["spacing", this.config.spacing, 0, 300, 10, (value) => `${value}px`],
    ]
    for (const [key, value, min, max, step, format] of ranges) {
      const item = find(`openlist-danmaku-${key}`)
      if (!item) continue
      item.range = [value, min, max, step]
      item.tooltip = format(value)
    }

    const font = find("openlist-danmaku-fontFamily")
    if (font) {
      font.tooltip = this.text(...FONT_LABELS[this.config.fontFamily])
      for (const option of font.selector ?? []) {
        const current = option.value === this.config.fontFamily
        option.default = current
        option.$item?.classList.toggle("art-current", current)
      }
    }
  }

  private syncToggleControl() {
    if (!this.toggleControl) return
    this.toggleControl.classList.toggle("is-active", this.config.visible)
    this.toggleControl.setAttribute("aria-pressed", String(this.config.visible))
    this.toggleControl.setAttribute(
      "aria-label",
      this.text(
        this.config.visible ? "关闭弹幕" : "开启弹幕",
        this.config.visible ? "Hide danmaku" : "Show danmaku",
      ),
    )
    this.toggleControl.innerHTML = this.config.visible
      ? DANMAKU_SWITCH_ON
      : DANMAKU_SWITCH_OFF
  }

  private switchValue(key: string) {
    if (key === "visible") return this.config.visible
    if (key === "mode-scroll") return this.config.modes.scroll
    if (key === "mode-top") return this.config.modes.top
    if (key === "mode-bottom") return this.config.modes.bottom
    return this.config[key as keyof DanmakuConfig] as boolean
  }

  private nextModeConfig(mode: "scroll" | "top" | "bottom"): DanmakuConfig {
    return {
      ...this.config,
      modes: {
        ...this.config.modes,
        [mode]: !this.config.modes[mode],
      },
    }
  }

  private patchConfig(patch: Partial<DanmakuConfig>): DanmakuConfig {
    return {
      ...this.config,
      ...patch,
      modes: { ...this.config.modes, ...patch.modes },
    }
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
      if (loaded) this.closeSettings()
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
      this.lastQuery || this.searchQuery,
      true,
    )
    if (saved) {
      this.closeSettings()
    }
  }

  private setStatus(message: string, refresh = true) {
    this.statusMessage = message
    if (refresh) this.refreshSourceMenu()
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function cloneSetting(item: Setting): Setting {
  return {
    ...item,
    selector: item.selector?.map(cloneSetting),
  }
}
