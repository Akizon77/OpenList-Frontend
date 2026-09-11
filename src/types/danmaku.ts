import type { Danmu } from "artplayer-plugin-danmuku"

export type DanmakuMatchStatus = "matched" | "ambiguous" | "not_found"

export interface DanmakuMedia {
  item_id?: string
  item_type?: string
  name?: string
  parent_name?: string
  series_name?: string
  original_title?: string
  season_number?: number
  episode_number?: number
}

export interface DanmakuEpisodeCandidate {
  episode_id: number
  episode_title: string
}

export interface DanmakuAnimeCandidate {
  anime_id: number
  anime_title: string
  type: string
  type_description: string
  episodes: DanmakuEpisodeCandidate[]
}

export interface DanmakuMatchedEpisode {
  anime_id: number
  anime_title: string
  anime_type: string
  type_description: string
  episode_id: number
  episode_title: string
}

export interface DanmakuSearchResult {
  query: string
  suggested_query: string
  season_number?: number
  episode_number?: number
  status: DanmakuMatchStatus
  episode_id?: number
  match?: DanmakuMatchedEpisode
  candidates: DanmakuAnimeCandidate[]
  fallback_queries?: string[]
}

export interface DanmakuCommentsResult {
  comments: Danmu[]
  count: number
  partial: boolean
}

export interface DanmakuMapping {
  key: string
  query: string
  anime_id: number
  anime_title: string
  episode_id: number
  episode_title: string
  updated_at: number
}
