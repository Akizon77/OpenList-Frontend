import type Artplayer from "artplayer"
import type { Setting } from "artplayer"

export const SUBTITLE_STYLE_KEY = "openlist_subtitle_style_v2"
export const LEGACY_SUBTITLE_STYLE_KEY = "openlist_subtitle_style_v1"

const fields = {
  scale: { initial: 100, min: 50, max: 250, step: 5, unit: "%" },
  fontWeight: { initial: 400, min: 100, max: 900, step: 100, unit: "" },
  outline: { initial: 1, min: 0, max: 4, step: 0.1, unit: "px" },
  bottom: { initial: 12, min: 0, max: 40, step: 1, unit: "%" },
  lineHeight: { initial: 1.3, min: 1, max: 2, step: 0.1, unit: "" },
  opacity: { initial: 100, min: 20, max: 100, step: 5, unit: "%" },
  backgroundOpacity: { initial: 0, min: 0, max: 100, step: 5, unit: "%" },
}

const fonts = {
  system: "system-ui, sans-serif",
  sans: '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", SimSun, serif',
  monospace: "ui-monospace, monospace",
}
const colors = ["#ffffff", "#ffff00", "#00ffff", "#00ff00", "#000000"] as const
const backgrounds = ["#000000", "#ffffff", "#333333"] as const
type StyleKey = keyof typeof fields
type SubtitleStyle = Record<StyleKey, number> & {
  fontFamily: keyof typeof fonts
  color: string
  background: string
}
const keys = Object.keys(fields) as StyleKey[]

export function normalizeSubtitleStyle(value: unknown): SubtitleStyle {
  const stored =
    value && typeof value === "object" ? (value as Partial<SubtitleStyle>) : {}
  const numeric = Object.fromEntries(
    keys.map((key) => {
      const { initial, min, max, step } = fields[key]
      const value = stored[key]
      const number =
        typeof value === "number" && Number.isFinite(value)
          ? Math.min(max, Math.max(min, value))
          : initial
      return [key, Number((Math.round(number / step) * step).toFixed(1))]
    }),
  ) as Record<StyleKey, number>
  return {
    ...numeric,
    fontFamily:
      stored.fontFamily && Object.hasOwn(fonts, stored.fontFamily)
        ? stored.fontFamily
        : "system",
    color: colors.includes(stored.color as (typeof colors)[number])
      ? stored.color!
      : "#ffffff",
    background: backgrounds.includes(
      stored.background as (typeof backgrounds)[number],
    )
      ? stored.background!
      : "#000000",
  }
}

export function migrateSubtitleStyle(value: unknown): SubtitleStyle {
  const old =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return normalizeSubtitleStyle({
    scale: typeof old.fontSize === "number" ? old.fontSize * 5 : undefined,
    outline: old.outline,
    bottom:
      typeof old.bottom === "number"
        ? Math.max(12, Math.round((old.bottom / 480) * 100))
        : undefined,
  })
}

export function subtitleLayout(
  width: number,
  height: number,
  aspect: number,
  config: Pick<SubtitleStyle, "scale" | "bottom">,
) {
  const videoHeight =
    aspect > 0 && Number.isFinite(aspect)
      ? Math.min(height, width / aspect)
      : height
  return {
    fontSize: Math.min(
      96,
      Math.max(
        12,
        (Math.min(48, Math.max(14, videoHeight / 24)) * config.scale) / 100,
      ),
    ),
    bottom: (height - videoHeight) / 2 + (videoHeight * config.bottom) / 100,
  }
}

export function SubtitleStylePlugin(player: Artplayer) {
  const chinese = (player.option.lang ?? "en").toLowerCase().startsWith("zh")
  const text = (zh: string, en: string) => (chinese ? zh : en)
  const labels: Record<StyleKey, string> = {
    scale: text("字幕大小", "Size"),
    fontWeight: text("字重", "Weight"),
    outline: text("描边", "Outline"),
    bottom: text("底部距离", "Bottom gap"),
    lineHeight: text("行距", "Line height"),
    opacity: text("文字不透明度", "Text opacity"),
    backgroundOpacity: text("背景不透明度", "Background opacity"),
  }
  const stored = player.storage.get(SUBTITLE_STYLE_KEY)
  let config = stored
    ? normalizeSubtitleStyle(stored)
    : migrateSubtitleStyle(player.storage.get(LEGACY_SUBTITLE_STYLE_KEY))
  const { $player, $video, $subtitle } = player.template
  const settingName = (key: string) => `openlist-subtitle-${key}`
  const range = (key: StyleKey): Setting["range"] => {
    const { min, max, step } = fields[key]
    return [config[key], min, max, step]
  }

  const tooltip = (key: StyleKey) => `${config[key]}${fields[key].unit}`

  const resize = () => {
    const width = $player.clientWidth
    const height = $player.clientHeight
    if (!width || !height) return
    const ratio = player.aspectRatio
    const [x, y] =
      ratio && ratio !== "default" ? ratio.split(":").map(Number) : []
    const aspect = x && y ? x / y : $video.videoWidth / $video.videoHeight
    const layout = subtitleLayout(width, height, aspect, config)
    $player.style.setProperty(
      "--art-subtitle-font-size",
      `${layout.fontSize}px`,
    )
    $player.style.setProperty("--art-subtitle-bottom", `${layout.bottom}px`)
  }
  const styleLines = () => {
    for (const line of $subtitle.querySelectorAll(".art-subtitle-line")) {
      if (line.querySelector(".openlist-subtitle-text")) continue
      const span = document.createElement("span")
      span.className = "openlist-subtitle-text"
      span.append(...line.childNodes)
      line.append(span)
    }
  }
  const apply = () => {
    resize()
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
    const rgb = config.background
      .slice(1)
      .match(/.{2}/g)!
      .map((part) => parseInt(part, 16))
    $player.style.setProperty(
      "--openlist-subtitle-background",
      `rgba(${rgb.join(", ")}, ${config.backgroundOpacity / 100})`,
    )
    $player.style.setProperty("--openlist-subtitle-color", config.color)
    $player.style.setProperty(
      "--openlist-subtitle-opacity",
      `${config.opacity / 100}`,
    )
    const shadow =
      width === 0
        ? "none"
        : offsets
            .map(([x, y]) => `${x * width}px ${y * width}px 1px #000`)
            .join(",")
    $player.style.setProperty("--openlist-subtitle-shadow", shadow)
    // The ASS canvas is deliberately left under libass's control.
    player.subtitle.style({
      bottom: "var(--art-subtitle-bottom)",
      transition: "none",
      fontFamily: fonts[config.fontFamily],
      fontWeight: String(config.fontWeight),
      lineHeight: String(config.lineHeight),
      textShadow: shadow,
    })
  }
  const save = () => player.storage.set(SUBTITLE_STYLE_KEY, { ...config })
  const change = (key: StyleKey, value: number | undefined) => {
    config = normalizeSubtitleStyle({ ...config, [key]: value })
    apply()
    return tooltip(key)
  }
  const fontLabels = {
    system: text("默认", "Default"),
    sans: text("黑体", "Sans"),
    serif: text("宋体", "Serif"),
    monospace: text("等宽", "Monospace"),
  }
  const colorLabels: Record<string, string> = {
    "#ffffff": text("白色", "White"),
    "#ffff00": text("黄色", "Yellow"),
    "#00ffff": text("青色", "Cyan"),
    "#00ff00": text("绿色", "Green"),
    "#000000": text("黑色", "Black"),
    "#333333": text("深灰", "Dark gray"),
  }
  const choice = (
    key: "fontFamily" | "color" | "background",
    label: string,
    values: readonly string[],
    names: Record<string, string>,
  ): Setting => ({
    name: settingName(key),
    html: label,
    tooltip: names[config[key]],
    selector: values.map((value) => {
      const html = document.createElement("span")
      html.className = "openlist-subtitle-choice"
      if (key !== "fontFamily") {
        const swatch = document.createElement("span")
        swatch.className = "openlist-color-swatch"
        swatch.style.background = value
        swatch.setAttribute("aria-hidden", "true")
        html.append(swatch)
      }
      html.append(names[value])
      return {
        name: `${settingName(key)}-${value}`,
        html,
        value,
        default: config[key] === value,
      }
    }),
    onSelect: (item) => {
      config = normalizeSubtitleStyle({ ...config, [key]: item.value })
      apply()
      save()
      return names[config[key]]
    },
  })

  player.setting.add({
    name: "openlist-subtitle-style",
    html: text("字幕样式 (SRT/VTT)", "Subtitle style (SRT/VTT)"),
    width: 320,
    selector: [
      ...keys.map((key): Setting => ({
        name: settingName(key),
        html: labels[key],
        tooltip: tooltip(key),
        range: range(key),
        mounted: (panel) => {
          panel.querySelector("input")?.setAttribute("aria-label", labels[key])
        },
        onChange: (item) => change(key, item.range?.[0]),
        onRange: (item) => {
          const value = change(key, item.range?.[0])
          save()
          return value
        },
      })),
      choice(
        "fontFamily",
        text("字体", "Font"),
        Object.keys(fonts),
        fontLabels,
      ),
      choice("color", text("文字颜色", "Text color"), colors, colorLabels),
      choice(
        "background",
        text("背景颜色", "Background color"),
        backgrounds,
        colorLabels,
      ),
      {
        name: "openlist-subtitle-reset",
        html: text("恢复默认", "Reset to default"),
        onClick: () => {
          config = normalizeSubtitleStyle(undefined)
          apply()
          save()
          for (const key of keys) {
            const item = player.setting.find(settingName(key))
            if (item) {
              item.range = range(key)
              item.tooltip = tooltip(key)
            }
          }
          for (const key of ["fontFamily", "color", "background"] as const) {
            const item = player.setting.find(settingName(key))
            if (!item) continue
            item.tooltip =
              key === "fontFamily"
                ? fontLabels[config[key]]
                : colorLabels[config[key]]
            for (const option of item.selector ?? []) {
              option.default = option.value === config[key]
              option.$item?.classList.toggle("art-current", option.default)
            }
          }
          return ""
        },
      },
    ],
  })
  $subtitle.classList.add("openlist-styled-subtitle")
  player.on("subtitleAfterUpdate", styleLines)
  styleLines()
  const observer =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(resize)
  observer?.observe($player)
  const events = [
    "resize",
    "ready",
    "fullscreen",
    "fullscreenWeb",
    "aspectRatio",
    "video:loadedmetadata",
  ] as const
  for (const event of events) player.on(event, resize)
  player.on("destroy", () => {
    observer?.disconnect()
    player.off("subtitleAfterUpdate", styleLines)
    for (const event of events) player.off(event, resize)
  })
  apply()
  return { name: "openlistSubtitleStyle" }
}
