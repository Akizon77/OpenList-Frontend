import * as i18n from "@solid-primitives/i18n"
import { createResource, createSignal } from "solid-js"
export { i18n }

// glob search by Vite
const langs = import.meta.glob("~/lang/*/index.json", {
  eager: true,
  import: "lang",
})

// all available languages
export const languages = Object.keys(langs).map((langPath) => {
  const langCode = langPath.split("/")[3]
  const langName = langs[langPath] as string
  return { code: langCode, lang: langName }
})

// determine browser's default language
const userLang = navigator.language.toLowerCase()
const defaultLang =
  languages.find((lang) => lang.code.toLowerCase() === userLang)?.code ||
  languages.find(
    (lang) => lang.code.toLowerCase().split("-")[0] === userLang.split("-")[0],
  )?.code ||
  "en"

// Get initial language from localStorage or fallback to defaultLang
export let initialLang = localStorage.getItem("lang") ?? defaultLang

if (!languages.some((lang) => lang.code === initialLang)) {
  initialLang = defaultLang
}

// Type imports
// use `type` to not include the actual dictionary in the bundle
import type * as en from "~/lang/en/entry"

export type Lang = keyof typeof langs
export type RawDictionary = typeof en.dict
export type Dictionary = i18n.Flatten<RawDictionary>

const localDictionaryOverrides: Record<string, Partial<Dictionary>> = {
  "zh-cn": {
    "home.preview.emby.media_source": "媒体源",
    "home.preview.emby.audio": "音轨",
    "home.preview.emby.subtitle": "字幕",
    "home.preview.emby.subtitle_display": "字幕显示",
    "home.preview.emby.show": "显示",
    "home.preview.emby.hide": "隐藏",
    "home.preview.emby.off": "关闭",
    "home.preview.emby.related": "附属资源",
    "home.preview.emby.video_audio": "视频内置音轨",
    "home.preview.emby.playback_info_failed":
      "获取 Emby 播放信息失败，已改用原始直链",
  },
  "zh-tw": {
    "home.preview.emby.media_source": "媒體來源",
    "home.preview.emby.audio": "音軌",
    "home.preview.emby.subtitle": "字幕",
    "home.preview.emby.subtitle_display": "字幕顯示",
    "home.preview.emby.show": "顯示",
    "home.preview.emby.hide": "隱藏",
    "home.preview.emby.off": "關閉",
    "home.preview.emby.related": "附屬資源",
    "home.preview.emby.video_audio": "影片內置音軌",
    "home.preview.emby.playback_info_failed":
      "取得 Emby 播放資訊失敗，已改用原始直連",
  },
}

const getLocalDictionaryOverrides = (locale: string) =>
  localDictionaryOverrides[locale.toLowerCase()] ?? {}

// English dictionary cache for fallback
let enDictCache: Dictionary | null = null

const fetchEnDict = async (): Promise<Dictionary> => {
  if (!enDictCache) {
    const dict: RawDictionary = (await import("~/lang/en/entry")).dict
    enDictCache = i18n.flatten(dict)
  }
  return enDictCache
}

// Fetch and flatten the dictionary, with English fallback
const fetchDictionary = async (locale: Lang): Promise<Dictionary> => {
  const overrides = getLocalDictionaryOverrides(locale)
  try {
    const dict: RawDictionary = (await import(`~/lang/${locale}/entry.ts`)).dict
    const flatDict = i18n.flatten(dict)

    // If not English, merge with English as fallback (English keys underneath, locale on top)
    if (locale !== "en") {
      const enDict = await fetchEnDict()
      return { ...enDict, ...flatDict, ...overrides } as Dictionary
    }

    return { ...flatDict, ...overrides } as Dictionary
  } catch (err) {
    console.error(`Error loading dictionary for locale: ${locale}`, err)
    // Fallback to English if the requested locale fails to load
    if (locale !== "en") {
      return { ...(await fetchEnDict()), ...overrides } as Dictionary
    }
    throw new Error(`Failed to load dictionary for ${locale}`)
  }
}

// Signals to track current language and dictionary state
export const [currentLang, setCurrentLang] = createSignal<Lang>(initialLang)

export const [dict] = createResource(currentLang, fetchDictionary)
