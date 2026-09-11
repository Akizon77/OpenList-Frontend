import Artplayer from "artplayer"
import artplayerPluginDanmuku, {
  type Danmu,
  type Option as DanmukuOption,
  type Result as DanmukuResult,
} from "artplayer-plugin-danmuku"
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

const MAPPINGS_KEY = "openlist_danmaku_mappings_v1"
const PANEL_ID = "openlist-danmaku-panel"

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>`

type DanmakuSource = "none" | "local" | "online"

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
  private plugin?: DanmukuResult
  private panel?: HTMLDivElement
  private panelOpen = false
  private searchInput?: HTMLInputElement
  private statusElement?: HTMLDivElement
  private matchElement?: HTMLDivElement
  private candidatesElement?: HTMLDivElement
  private sourceElement?: HTMLDivElement
  private abortController?: AbortController
  private generation = 0
  private activeKey = ""
  private currentSource: DanmakuSource = "none"
  private currentMatch?: DanmakuMatchedEpisode
  private lastQuery = ""
  private loading = false
  private destroyed = false
  private loadQueue: Promise<void> = Promise.resolve()

  constructor(options: DanmakuControllerOptions) {
    this.options = options
  }

  async init() {
    const player = this.options.player()
    if (!player) return
    if (!player.isReady) {
      await new Promise<void>((resolve) => {
        player.once("ready", () => resolve())
      })
    }
    if (this.destroyed) return
    this.player = player

    if (!player.plugins.artplayerPluginDanmuku) {
      await player.plugins.add(
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
          danmuku: [],
        }),
      )
    }
    if (this.destroyed) return
    this.plugin = player.plugins
      .artplayerPluginDanmuku as unknown as DanmukuResult
    this.bindConfig()
    this.addControl()
    this.createPanel()
    this.reload()
  }

  reload() {
    if (!this.player || !this.plugin) return
    const key = this.mappingKey()
    if (key !== this.activeKey) {
      this.activeKey = key
      this.lastQuery = ""
      this.currentSource = "none"
      this.currentMatch = undefined
      void this.resetPlugin()
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

  openPanel() {
    this.setPanelOpen(true)
  }

  destroy() {
    this.destroyed = true
    this.generation++
    this.abortController?.abort()
    this.panel?.remove()
    this.player?.controls.remove("danmaku-search")
    this.player = undefined
    this.plugin = undefined
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
    const player = this.player
    const plugin = this.plugin
    const local = this.options.getLocalXml?.()
    const url = local ? this.options.getLocalXmlUrl?.(local) : ""
    if (
      !player ||
      !plugin ||
      !local ||
      !url ||
      generation !== this.generation
    ) {
      return
    }
    this.loading = true
    this.setStatus(this.text("正在加载本地 XML", "Loading local XML"))
    try {
      await this.queuePluginLoad(async () => {
        plugin.reset()
        plugin.option.danmuku = []
        await plugin.load(url)
      }, generation)
      if (generation !== this.generation) return
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
      if (generation === this.generation) {
        this.setStatus(errorMessage(error))
      }
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
    try {
      await this.queuePluginLoad(
        () => this.loadIntoPlayer(result.comments),
        generation,
      )
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
        `已加载 ${result.count} 条弹幕${partial}`,
        `Loaded ${result.count} danmaku${partial}`,
      ),
    )
    if (saveMapping) {
      this.saveMapping(match, query)
    }
    return true
  }

  private async loadIntoPlayer(comments: Danmu[]) {
    const plugin = this.plugin
    if (!plugin) return
    plugin.reset()
    plugin.option.danmuku = []
    await plugin.load(comments)
  }

  private async resetPlugin() {
    const plugin = this.plugin
    if (!plugin) return
    this.loadQueue = this.loadQueue
      .catch(() => undefined)
      .then(() => {
        plugin.reset()
        plugin.option.danmuku = []
      })
    await this.loadQueue
  }

  private queuePluginLoad(
    load: () => Promise<unknown>,
    generation: number,
  ): Promise<void> {
    const next = this.loadQueue
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation || this.destroyed) return
        await load()
      })
    this.loadQueue = next
    return next
  }

  private bindConfig() {
    this.player?.on("artplayerPluginDanmuku:config", (option) => {
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

  private addControl() {
    if (!this.player || this.player.controls["danmaku-search"]) return
    this.player.controls.add({
      name: "danmaku-search",
      index: 12,
      position: "right",
      html: SEARCH_ICON,
      tooltip: this.text("弹幕", "Danmaku"),
      click: () => this.openPanel(),
    })
  }

  private createPanel() {
    const player = this.player
    if (!player || this.panel) return
    const panel = document.createElement("div")
    panel.id = PANEL_ID
    panel.className = "openlist-danmaku-panel"
    panel.setAttribute("role", "dialog")
    panel.setAttribute("aria-label", this.text("弹幕搜索", "Danmaku search"))
    panel.innerHTML = `
      <div class="openlist-danmaku-panel__header">
        <div>
          <strong>${this.text("弹幕", "Danmaku")}</strong>
          <div class="openlist-danmaku-source"></div>
        </div>
        <button type="button" data-action="close" aria-label="${this.text("关闭", "Close")}">×</button>
      </div>
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
    panel.addEventListener("click", (event) => event.stopPropagation())
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
      window.setTimeout(() => this.searchInput?.focus(), 0)
    }
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
