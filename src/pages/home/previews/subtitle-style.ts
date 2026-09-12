import type Artplayer from "artplayer"
import type { Setting } from "artplayer"

export const SUBTITLE_STYLE_KEY = "openlist_subtitle_style_v1"

const fields = {
  fontSize: { initial: 20, min: 12, max: 64, step: 1 },
  outline: { initial: 1, min: 0, max: 4, step: 0.1 },
  bottom: { initial: 15, min: 0, max: 200, step: 1 },
}

type StyleKey = keyof typeof fields
type SubtitleStyle = Record<StyleKey, number>
const keys = Object.keys(fields) as StyleKey[]

export function normalizeSubtitleStyle(value: unknown): SubtitleStyle {
  const stored =
    value && typeof value === "object" ? (value as Partial<SubtitleStyle>) : {}
  return Object.fromEntries(
    keys.map((key) => {
      const { initial, min, max, step } = fields[key]
      const value = stored[key]
      const number =
        typeof value === "number" && Number.isFinite(value)
          ? Math.min(max, Math.max(min, value))
          : initial
      return [key, Number((Math.round(number / step) * step).toFixed(1))]
    }),
  ) as SubtitleStyle
}

export function SubtitleStylePlugin(player: Artplayer) {
  const chinese = (player.option.lang ?? "en").toLowerCase().startsWith("zh")
  const labels = chinese
    ? { fontSize: "字号", outline: "描边", bottom: "距底部" }
    : { fontSize: "Font size", outline: "Outline", bottom: "Bottom gap" }
  let config = normalizeSubtitleStyle(player.storage.get(SUBTITLE_STYLE_KEY))
  const settingName = (key: StyleKey) => `openlist-subtitle-${key}`
  const range = (key: StyleKey): Setting["range"] => {
    const { min, max, step } = fields[key]
    return [config[key], min, max, step]
  }

  const apply = () => {
    const style = player.template.$player.style
    style.setProperty("--art-subtitle-font-size", `${config.fontSize}px`)
    // Keep Artplayer's extra offset when the playback controls are visible.
    style.setProperty("--art-subtitle-bottom", `${config.bottom}px`)
    const width = config.outline
    const offsets = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]
    // Only style Artplayer's text layer, never the ASS renderer's canvas.
    player.subtitle.style({
      textShadow:
        width === 0
          ? "none"
          : offsets
              .map(([x, y]) => `${x * width}px ${y * width}px 1px #000`)
              .join(","),
    })
  }
  const save = () => player.storage.set(SUBTITLE_STYLE_KEY, { ...config })
  const change = (key: StyleKey, value: number | undefined) => {
    config = normalizeSubtitleStyle({ ...config, [key]: value })
    apply()
    return `${config[key]}px`
  }

  player.setting.add({
    name: "openlist-subtitle-style",
    html: chinese ? "字幕样式 (SRT/VTT)" : "Subtitle style (SRT/VTT)",
    selector: [
      ...keys.map((key): Setting => ({
        name: settingName(key),
        html: labels[key],
        tooltip: `${config[key]}px`,
        range: range(key),
        mounted: (panel) => {
          panel.querySelector("input")?.setAttribute("aria-label", labels[key])
        },
        onChange: (item) => change(key, item.range?.[0]),
        onRange: (item) => {
          const tooltip = change(key, item.range?.[0])
          save()
          return tooltip
        },
      })),
      {
        name: "openlist-subtitle-reset",
        html: chinese ? "恢复默认" : "Reset to default",
        onClick: () => {
          config = normalizeSubtitleStyle(undefined)
          apply()
          save()
          for (const key of keys) {
            const item = player.setting.find(settingName(key))
            if (item) {
              item.range = range(key)
              item.tooltip = `${config[key]}px`
            }
          }
          return ""
        },
      },
    ],
  })
  apply()
  return { name: "openlistSubtitleStyle" }
}
