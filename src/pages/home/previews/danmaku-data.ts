import type { DanmuJsComment, DanmuJsMode } from "danmu.js"
import type { DanmakuComment, DanmakuMode } from "~/types"
import type { DanmakuFontFamily } from "./danmaku-config"

export const DANMAKU_HEATMAP_BUCKETS = 256

const BILIBILI_MODE: Record<number, DanmakuMode> = {
  1: 0,
  2: 0,
  3: 0,
  4: 2,
  5: 1,
}

const SAFE_STYLE_PROPERTIES = new Set([
  "backgroundColor",
  "border",
  "borderRadius",
  "color",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "opacity",
  "padding",
  "textShadow",
  "WebkitTextStroke",
])

const FONT_FAMILY_STACKS: Record<
  Exclude<DanmakuFontFamily, "system">,
  string
> = {
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", STSong, SimSun, "Noto Serif CJK SC", serif',
  rounded:
    '"Hiragino Maru Gothic ProN", "Yuanti SC", "Microsoft YaHei", sans-serif',
  monospace: 'SFMono-Regular, Consolas, "Noto Sans Mono CJK SC", monospace',
}

const OUTLINE_SHADOWS = [
  "0 1px 1px rgba(0, 0, 0, 0.86)",
  "0 1px 2px rgba(0, 0, 0, 0.92), 0 0 1px rgba(0, 0, 0, 0.86)",
  "0 1px 2px rgba(0, 0, 0, 0.96), 0 0 2px rgba(0, 0, 0, 0.9)",
  "0 0 1px #000, 0 1px 2px rgba(0, 0, 0, 0.96), 1px 0 2px rgba(0, 0, 0, 0.9), -1px 0 2px rgba(0, 0, 0, 0.9), 0 -1px 2px rgba(0, 0, 0, 0.9)",
  "0 0 1px #000, 0 0 2px #000, 0 1px 2px rgba(0, 0, 0, 0.98), 1px 0 2px rgba(0, 0, 0, 0.96), -1px 0 2px rgba(0, 0, 0, 0.96), 0 -1px 2px rgba(0, 0, 0, 0.96), 1px 1px 2px rgba(0, 0, 0, 0.94), -1px -1px 2px rgba(0, 0, 0, 0.94), 1px -1px 2px rgba(0, 0, 0, 0.94), -1px 1px 2px rgba(0, 0, 0, 0.94)",
] as const

export interface DanmakuTextStyleOptions {
  fontSize: number
  fontFamily: DanmakuFontFamily
  fontWeight: number
  outline: number
  spacing: number
  lineSpacing: number
}

export interface ConvertCommentsOptions {
  batchSize?: number
  signal?: AbortSignal
  shouldContinue?: () => boolean
  cache?: Map<string, string>
}

export function normalizeComments(
  comments: readonly unknown[],
): DanmakuComment[] {
  const candidates: Array<{
    index: number
    time: number
    mode: DanmakuMode
    text: string
    color?: string
    border?: boolean
    style?: Record<string, string>
  }> = []

  comments.forEach((value, index) => {
    if (!isRecord(value)) return

    const text = typeof value.text === "string" ? value.text.trim() : ""
    const time = readFiniteNumber(value.time)
    const mode = readDanmakuMode(value.mode)
    const color = readOptionalColor(value.color)

    if (!text || time === undefined || time < 0 || mode === undefined) return
    if (!color.valid) return

    candidates.push({
      index,
      text,
      time,
      mode,
      color: color.value,
      border: typeof value.border === "boolean" ? value.border : undefined,
      style: sanitizeStyle(value.style),
    })
  })

  candidates.sort(
    (left, right) => left.time - right.time || left.index - right.index,
  )

  return candidates.map((comment, index) => ({
    id: deterministicCommentID(comment, index),
    text: comment.text,
    time: comment.time,
    mode: comment.mode,
    color: comment.color,
    border: comment.border,
    style: comment.style,
  }))
}

export function parseBilibiliXml(xml: string): DanmakuComment[] {
  const document = new DOMParser().parseFromString(xml, "application/xml")
  if (document.querySelector("parsererror")) {
    throw new Error("Invalid Bilibili XML")
  }

  const comments: Array<Omit<DanmakuComment, "id">> = []
  for (const node of Array.from(document.querySelectorAll("d"))) {
    const text = (node.textContent || "").trim()
    const parts = (node.getAttribute("p") || "").split(",")
    const mode = BILIBILI_MODE[Number.parseInt(parts[1], 10)]
    const time = Number.parseFloat(parts[0])
    const color = readBilibiliColor(parts[3])

    if (!text || !Number.isFinite(time) || time < 0) continue
    if (mode === undefined || !color.valid) continue

    comments.push({
      text,
      time,
      mode,
      color: color.value,
    })
  }

  return normalizeComments(comments)
}

export function danmakuModeToEngineMode(mode: DanmakuMode): DanmuJsMode {
  if (mode === 1) return "top"
  if (mode === 2) return "bottom"
  return "scroll"
}

export function toDanmuJsComment(
  comment: DanmakuComment,
  duration: number,
  options: DanmakuTextStyleOptions,
): DanmuJsComment {
  const style: Record<string, string | number> = {
    ...comment.style,
    fontSize: `${options.fontSize}px`,
  }
  if (comment.color) style.color = comment.color

  if (options.fontFamily === "system") {
    delete style.fontFamily
  } else {
    style.fontFamily = FONT_FAMILY_STACKS[options.fontFamily]
  }
  style.fontWeight = String(options.fontWeight)
  style.lineHeight = `${options.fontSize + options.lineSpacing}px`

  if (comment.mode === 0 && options.spacing > 0) {
    style.paddingRight = `${options.spacing}px`
  } else {
    delete style.paddingRight
  }

  const strokeWidth = options.outline
  if (strokeWidth > 0) {
    style.WebkitTextStroke = `${strokeWidth}px rgba(0, 0, 0, 0.96)`
    style.textShadow = outlineShadow(strokeWidth)
  } else {
    delete style.WebkitTextStroke
    delete style.textShadow
  }
  delete style.border

  return {
    id: comment.id,
    txt: comment.text,
    start: Math.round(comment.time * 1000),
    duration,
    mode: danmakuModeToEngineMode(comment.mode),
    color: !!comment.color,
    style,
  }
}

function outlineShadow(width: number) {
  if (width <= 0.3) return OUTLINE_SHADOWS[0]
  if (width <= 0.6) return OUTLINE_SHADOWS[1]
  if (width <= 0.9) return OUTLINE_SHADOWS[2]
  if (width <= 1.4) return OUTLINE_SHADOWS[3]
  return OUTLINE_SHADOWS[4]
}

export function normalizeDanmakuColor(value: unknown): string | undefined {
  return readOptionalColor(value).value
}

export async function convertCommentsToSimplified(
  comments: readonly DanmakuComment[],
  converter: (text: string) => string,
  options: ConvertCommentsOptions = {},
): Promise<DanmakuComment[] | undefined> {
  const batchSize = Math.max(1, options.batchSize ?? 500)
  const cache = options.cache ?? new Map<string, string>()
  const result = comments.map(cloneComment)

  for (let offset = 0; offset < result.length; offset += batchSize) {
    if (!isCurrent(options)) return

    const end = Math.min(result.length, offset + batchSize)
    for (let index = offset; index < end; index += 1) {
      const text = result[index].text
      let converted = cache.get(text)
      if (converted === undefined) {
        converted = converter(text)
        cache.set(text, converted)
      }
      result[index] = { ...result[index], text: converted }
    }

    await yieldToBrowser()
  }

  return isCurrent(options) ? result : undefined
}

export async function prepareDisplayComments(
  comments: readonly DanmakuComment[],
  traditionalToSimplified: boolean,
  converter: (text: string) => string,
  options: ConvertCommentsOptions = {},
): Promise<DanmakuComment[] | undefined> {
  if (!isCurrent(options)) return
  if (!traditionalToSimplified) return comments.map(cloneComment)
  return convertCommentsToSimplified(comments, converter, options)
}

export function buildDanmakuHeatmap(
  comments: readonly DanmakuComment[],
  duration: number,
  bucketCount = DANMAKU_HEATMAP_BUCKETS,
): number[] {
  if (
    comments.length === 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    bucketCount <= 0
  ) {
    return []
  }

  const buckets = new Array<number>(bucketCount).fill(0)
  for (const comment of comments) {
    if (comment.time < 0 || comment.time > duration) continue
    const index = Math.min(
      bucketCount - 1,
      Math.floor((comment.time / duration) * bucketCount),
    )
    buckets[index] += 1
  }

  const smoothed = movingAverage(buckets, 5)
  const maximum = Math.max(...smoothed)
  if (maximum <= 0) return []
  return smoothed.map((value) => value / maximum)
}

function cloneComment(comment: DanmakuComment): DanmakuComment {
  return {
    ...comment,
    style: comment.style ? { ...comment.style } : undefined,
  }
}

function deterministicCommentID(
  comment: {
    text: string
    time: number
    mode: DanmakuMode
    color?: string
  },
  index: number,
) {
  const signature = `${comment.time}|${comment.mode}|${comment.color || ""}|${comment.text}`
  return `d${index.toString(36)}-${hashString(signature).toString(36)}`
}

function hashString(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function readBilibiliColor(value: string | undefined): {
  valid: boolean
  value?: string
} {
  if (value === undefined || value === "") return { valid: true }
  const decimal = Number(value)
  if (!Number.isInteger(decimal) || decimal < 0 || decimal > 0xffffff) {
    return { valid: false }
  }
  return {
    valid: true,
    value: `#${decimal.toString(16).padStart(6, "0")}`,
  }
}

function readOptionalColor(value: unknown): {
  valid: boolean
  value?: string
} {
  if (value === undefined || value === null || value === "") {
    return { valid: true }
  }
  if (typeof value !== "string") return { valid: false }

  const color = value.trim().toLowerCase()
  const short = /^#([0-9a-f]{3,4})$/i.exec(color)
  if (short) {
    const channels = short[1].split("").map((part) => part + part)
    return {
      valid: true,
      value: `#${channels.join("")}`,
    }
  }

  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
    return { valid: true, value: color }
  }
  return { valid: false }
}

function sanitizeStyle(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return

  const style: Record<string, string> = {}
  for (const [property, raw] of Object.entries(value)) {
    if (!SAFE_STYLE_PROPERTIES.has(property)) continue
    if (
      typeof raw !== "string" &&
      (typeof raw !== "number" || !Number.isFinite(raw))
    ) {
      continue
    }
    const styleValue = String(raw).trim()
    if (
      !styleValue ||
      styleValue.length > 200 ||
      /url\s*\(/i.test(styleValue) ||
      /[;{}<>]/.test(styleValue)
    ) {
      continue
    }
    style[property] = styleValue
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function readDanmakuMode(value: unknown): DanmakuMode | undefined {
  if (value === undefined || value === null || value === "") return 0
  const mode = Number(value)
  if (mode === 0 || mode === 1 || mode === 2) return mode
  return
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !value.trim()) return
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function movingAverage(values: readonly number[], radius: number) {
  const half = Math.floor(radius / 2)
  return values.map((_, index) => {
    let total = 0
    let count = 0
    for (
      let point = Math.max(0, index - half);
      point <= Math.min(values.length - 1, index + half);
      point += 1
    ) {
      total += values[point]
      count += 1
    }
    return count > 0 ? total / count : 0
  })
}

function isCurrent(options: ConvertCommentsOptions) {
  return !options.signal?.aborted && options.shouldContinue?.() !== false
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
