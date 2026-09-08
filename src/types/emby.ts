export interface EmbyPlaybackStream {
  index: number
  type: string
  codec: string
  language: string
  display_title: string
  title: string
  is_external: boolean
  is_default: boolean
  is_forced: boolean
  supports_external_stream: boolean
  delivery_method: string
  url?: string
}

export interface EmbyPlaybackMediaSource {
  id: string
  name: string
  container: string
  protocol: string
  supports_direct_play: boolean
  supports_direct_stream: boolean
  supports_transcoding: boolean
  default_audio_stream_index: number
  default_subtitle_stream_index: number
  direct_url: string
  audio_streams: EmbyPlaybackStream[]
  subtitle_streams: EmbyPlaybackStream[]
}

export interface EmbyPlaybackInfo {
  item_id: string
  name: string
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
  media_sources: EmbyPlaybackMediaSource[]
}

export interface EmbyPlaybackInfoRequest {
  mode?: "web" | "external"
  device_id: string
  media_source_id?: string
  audio_stream_index?: number
  subtitle_stream_index?: number
  max_streaming_bitrate?: number
}

export interface EmbyPlaybackReportRequest {
  device_id: string
  play_session_id: string
  media_source_id: string
  audio_stream_index?: number
  subtitle_stream_index?: number
  position_ticks: number
  is_paused: boolean
  is_muted: boolean
  volume_level: number
  play_method: EmbyPlaybackInfo["playback_method"]
}
