import type { DanmakuMode } from "~/types"

export const DANMAKU_CONFIG_KEY = "openlist_danmaku_config_v2"
export const LEGACY_DANMAKU_CONFIG_KEY = "danmuku_config"

export const DANMAKU_DISPLAY_AREAS = [25, 50, 75, 90, 100] as const
export const DANMAKU_SPEEDS = [0.75, 1, 1.25, 1.5] as const
export const DANMAKU_SPACINGS = [0, 100, 250] as const
export const DANMAKU_FONT_FAMILIES = [
  "system",
  "sans",
  "serif",
  "rounded",
  "monospace",
] as const
export const DANMAKU_OUTLINES = [0, 1, 2, 3, 4, 5] as const
export const DANMAKU_FONT_WEIGHTS = ["normal", "bold"] as const

export type DanmakuDisplayArea = (typeof DANMAKU_DISPLAY_AREAS)[number]
export type DanmakuSpeed = (typeof DANMAKU_SPEEDS)[number]
export type DanmakuSpacing = (typeof DANMAKU_SPACINGS)[number]
export type DanmakuFontFamily = (typeof DANMAKU_FONT_FAMILIES)[number]
export type DanmakuOutline = (typeof DANMAKU_OUTLINES)[number]
export type DanmakuFontWeight = (typeof DANMAKU_FONT_WEIGHTS)[number]
export type DanmakuEngineMode = "scroll" | "top" | "bottom"

export interface DanmakuConfig {
  visible: boolean
  fontSize: number
  fontFamily: DanmakuFontFamily
  fontWeight: DanmakuFontWeight
  outline: DanmakuOutline
  opacity: number
  modes: Record<DanmakuEngineMode, boolean>
  antiOverlap: boolean
  followPlaybackRate: boolean
  heatmap: boolean
  traditionalToSimplified: boolean
  displayArea: DanmakuDisplayArea
  speed: DanmakuSpeed
  spacing: DanmakuSpacing
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

const MODE_BY_NUMBER: Record<DanmakuMode, DanmakuEngineMode> = {
  0: "scroll",
  1: "top",
  2: "bottom",
}

export function createDefaultDanmakuConfig(): DanmakuConfig {
  return {
    visible: true,
    fontSize: 25,
    fontFamily: "system",
    fontWeight: "normal",
    outline: 2,
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
  }
}

export function loadDanmakuConfig(
  storage: StorageLike | undefined = getDefaultStorage(),
): DanmakuConfig {
  if (!storage) return createDefaultDanmakuConfig()

  const current = parseConfig(storage.getItem(DANMAKU_CONFIG_KEY))
  if (current) {
    return normalizeConfig(current)
  }

  const legacy = parseLegacyConfig(storage.getItem(LEGACY_DANMAKU_CONFIG_KEY))
  const config = normalizeConfig(legacy)
  saveDanmakuConfig(config, storage)
  storage.removeItem(LEGACY_DANMAKU_CONFIG_KEY)
  return config
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

function parseLegacyConfig(
  value: string | null,
): Record<string, unknown> | undefined {
  const parsed = parseConfig(value)
  if (!parsed) return

  const defaults = createDefaultDanmakuConfig()
  const modes = readLegacyModes(parsed)
  const fontSize = readNumber(parsed.fontSize)
  const opacity = readNumber(parsed.opacity)

  return {
    visible: readBoolean(parsed.visible),
    fontSize:
      fontSize === undefined ? defaults.fontSize : clamp(fontSize, 16, 36),
    opacity: opacity === undefined ? defaults.opacity : clamp(opacity, 0.1, 1),
    modes,
    antiOverlap: readBoolean(parsed.antiOverlap),
    followPlaybackRate: readBoolean(parsed.synchronousPlayback),
    heatmap: readBooleanOrObject(parsed.heatmap),
  }
}

function normalizeConfig(
  value: Record<string, unknown> | undefined,
): DanmakuConfig {
  const defaults = createDefaultDanmakuConfig()
  if (!value) return defaults

  return {
    visible: readBoolean(value.visible) ?? defaults.visible,
    fontSize: clamp(readNumber(value.fontSize) ?? defaults.fontSize, 16, 36),
    fontFamily: readStringOption(
      value.fontFamily,
      DANMAKU_FONT_FAMILIES,
      defaults.fontFamily,
    ),
    fontWeight: readStringOption(
      value.fontWeight,
      DANMAKU_FONT_WEIGHTS,
      defaults.fontWeight,
    ),
    outline: clamp(
      Math.round(readNumber(value.outline) ?? defaults.outline),
      DANMAKU_OUTLINES[0],
      DANMAKU_OUTLINES[DANMAKU_OUTLINES.length - 1],
    ) as DanmakuOutline,
    opacity: clamp(readNumber(value.opacity) ?? defaults.opacity, 0.1, 1),
    modes: readModes(value.modes, defaults.modes),
    antiOverlap: readBoolean(value.antiOverlap) ?? defaults.antiOverlap,
    followPlaybackRate:
      readBoolean(value.followPlaybackRate) ?? defaults.followPlaybackRate,
    heatmap: readBoolean(value.heatmap) ?? defaults.heatmap,
    traditionalToSimplified:
      readBoolean(value.traditionalToSimplified) ??
      defaults.traditionalToSimplified,
    displayArea: readOption(
      value.displayArea,
      DANMAKU_DISPLAY_AREAS,
      defaults.displayArea,
    ),
    speed: readOption(value.speed, DANMAKU_SPEEDS, defaults.speed),
    spacing: readOption(value.spacing, DANMAKU_SPACINGS, defaults.spacing),
  }
}

function readLegacyModes(
  value: Record<string, unknown>,
): DanmakuConfig["modes"] {
  const defaults = createDefaultDanmakuConfig().modes
  const selected = new Set<DanmakuEngineMode>()
  const modes = Array.isArray(value.modes) ? value.modes : []

  for (const mode of [...modes, value.mode]) {
    const numeric = readNumber(mode)
    if (numeric === 0 || numeric === 1 || numeric === 2) {
      selected.add(MODE_BY_NUMBER[numeric])
    }
  }

  if (selected.size === 0) return defaults
  return {
    scroll: selected.has("scroll"),
    top: selected.has("top"),
    bottom: selected.has("bottom"),
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

function readBooleanOrObject(value: unknown): boolean | undefined {
  const boolean = readBoolean(value)
  if (boolean !== undefined) return boolean
  return isRecord(value) ? true : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !value.trim()) return
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function readOption<T extends number>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  const number = readNumber(value)
  return options.includes(number as T) ? (number as T) : fallback
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getDefaultStorage(): StorageLike | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage
}
