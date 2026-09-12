export const DANMAKU_CONFIG_KEY = "openlist_danmaku_config_v3"

export const DANMAKU_FONT_FAMILIES = [
  "system",
  "sans",
  "serif",
  "rounded",
  "monospace",
] as const

export type DanmakuFontFamily = (typeof DANMAKU_FONT_FAMILIES)[number]
export type DanmakuEngineMode = "scroll" | "top" | "bottom"

export interface DanmakuConfig {
  visible: boolean
  fontSize: number
  fontFamily: DanmakuFontFamily
  fontWeight: number
  outline: number
  opacity: number
  modes: Record<DanmakuEngineMode, boolean>
  antiOverlap: boolean
  followPlaybackRate: boolean
  heatmap: boolean
  traditionalToSimplified: boolean
  displayArea: number
  speed: number
  spacing: number
  lineSpacing: number
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

export function createDefaultDanmakuConfig(): DanmakuConfig {
  return {
    visible: true,
    fontSize: 25,
    fontFamily: "system",
    fontWeight: 400,
    outline: 0.5,
    opacity: 1,
    modes: {
      scroll: true,
      top: true,
      bottom: true,
    },
    antiOverlap: false,
    followPlaybackRate: false,
    heatmap: true,
    traditionalToSimplified: true,
    displayArea: 50,
    speed: 1,
    spacing: 100,
    lineSpacing: 3,
  }
}

export function loadDanmakuConfig(
  storage: StorageLike | undefined = getDefaultStorage(),
): DanmakuConfig {
  if (!storage) return createDefaultDanmakuConfig()

  const current = parseConfig(storage.getItem(DANMAKU_CONFIG_KEY))
  return normalizeConfig(current)
}

export function saveDanmakuConfig(
  config: DanmakuConfig,
  storage: StorageLike | undefined = getDefaultStorage(),
) {
  if (!storage) return
  storage.setItem(DANMAKU_CONFIG_KEY, JSON.stringify(config))
}

function parseConfig(
  value: string | null,
): Record<string, unknown> | undefined {
  if (!value) return
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return
  }
}

function normalizeConfig(
  value: Record<string, unknown> | undefined,
): DanmakuConfig {
  const defaults = createDefaultDanmakuConfig()
  if (!value) return defaults

  return {
    visible: readBoolean(value.visible) ?? defaults.visible,
    fontSize: readNumberOption(value.fontSize, 16, 36, 1, defaults.fontSize),
    fontFamily: readStringOption(
      value.fontFamily,
      DANMAKU_FONT_FAMILIES,
      defaults.fontFamily,
    ),
    fontWeight: readNumberOption(
      value.fontWeight,
      100,
      900,
      100,
      defaults.fontWeight,
    ),
    outline: readNumberOption(value.outline, 0, 3, 0.1, defaults.outline),
    opacity: readNumberOption(value.opacity, 0.1, 1, 0.05, defaults.opacity),
    modes: readModes(value.modes, defaults.modes),
    antiOverlap: readBoolean(value.antiOverlap) ?? defaults.antiOverlap,
    followPlaybackRate:
      readBoolean(value.followPlaybackRate) ?? defaults.followPlaybackRate,
    heatmap: readBoolean(value.heatmap) ?? defaults.heatmap,
    traditionalToSimplified:
      readBoolean(value.traditionalToSimplified) ??
      defaults.traditionalToSimplified,
    displayArea: readNumberOption(
      value.displayArea,
      25,
      100,
      5,
      defaults.displayArea,
    ),
    speed: readNumberOption(value.speed, 0.5, 2, 0.05, defaults.speed),
    spacing: readNumberOption(value.spacing, 0, 300, 10, defaults.spacing),
    lineSpacing: readNumberOption(
      value.lineSpacing,
      0,
      24,
      1,
      defaults.lineSpacing,
    ),
  }
}

function readModes(
  value: unknown,
  defaults: DanmakuConfig["modes"],
): DanmakuConfig["modes"] {
  if (!isRecord(value)) return defaults
  return {
    scroll: readBoolean(value.scroll) ?? defaults.scroll,
    top: readBoolean(value.top) ?? defaults.top,
    bottom: readBoolean(value.bottom) ?? defaults.bottom,
  }
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !value.trim()) return
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readNumberOption(
  value: unknown,
  min: number,
  max: number,
  step: number,
  fallback: number,
) {
  const number = readNumber(value)
  if (number === undefined || number < min || number > max) return fallback

  const steps = (number - min) / step
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return fallback
  return round(min + Math.round(steps) * step, 4)
}

function readStringOption<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && options.includes(value as T)
    ? (value as T)
    : fallback
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getDefaultStorage(): StorageLike | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage
}
