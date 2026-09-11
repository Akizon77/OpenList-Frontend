export interface EmbyTranscodingQuality {
  name: string
  max_height: number
  max_streaming_bitrate: number
}

export interface EmbyPlaybackInfo {
  item_id: string
  item_type: "Episode" | "Movie" | string
  name: string
  series_name?: string
  original_title?: string
  season_number?: number
  episode_number?: number
  media_type: string
  run_time_ticks: number
  playback_position_ticks: number
  play_session_id: string
  device_id: string
  selected_media_source_id: string
  selected_audio_stream_index: number
  selected_subtitle_stream_index: number
  playback_url: string
  playback_type: string
  playback_method: "DirectPlay" | "DirectStream" | "Transcode"
  playback_error?: string
  transcoding_qualities?: EmbyTranscodingQuality[]
}
