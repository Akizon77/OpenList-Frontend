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
  playback_method: "DirectPlay" | "DirectStream" | "Transcode"
}
