import type Artplayer from "artplayer"
import { playerIcon } from "./player-icons"

const TAP_DELAY = 300
const MOVE_THRESHOLD = 12
const HIDE_DELAY = 3000
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function swipeSeekTime(
  start: number,
  delta: number,
  width: number,
  duration: number,
) {
  if (!Number.isFinite(duration) || duration <= 0 || width <= 0) return start
  return clamp(start + (delta / width) * Math.min(120, duration), 0, duration)
}

export function pointerPosition(
  x: number,
  y: number,
  rect: Pick<DOMRect, "left" | "right" | "top" | "width" | "height">,
  rotated: boolean,
) {
  return rotated
    ? {
        x: y - rect.top,
        y: rect.right - x,
        width: rect.height,
        height: rect.width,
      }
    : {
        x: x - rect.left,
        y: y - rect.top,
        width: rect.width,
        height: rect.height,
      }
}

export function supportsVideoVolume() {
  const probe = document.createElement("video")
  probe.volume = 0.5
  return probe.volume === 0.5
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>
}
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => void | Promise<void>
}

export function togglePlayerFullscreen(player: Artplayer) {
  const element = player.template.$player as FullscreenElement
  const doc = element.ownerDocument as FullscreenDocument
  if (player.fullscreenWeb) {
    player.fullscreenWeb = false
    return
  }
  const current = doc.fullscreenElement || doc.webkitFullscreenElement
  const operation =
    current === element
      ? (doc.exitFullscreen || doc.webkitExitFullscreen)?.bind(doc)
      : doc.fullscreenEnabled !== false && doc.webkitFullscreenEnabled !== false
        ? (element.requestFullscreen || element.webkitRequestFullscreen)?.bind(
            element,
          )
        : undefined
  if (!operation) {
    player.fullscreenWeb = true
    return
  }
  try {
    void Promise.resolve(operation()).catch(() => {
      if (!player.isDestroy && !current) player.fullscreenWeb = true
    })
  } catch {
    if (!current) player.fullscreenWeb = true
  }
}

type Gesture = {
  id: number
  x: number
  y: number
  width: number
  height: number
  time: number
  targetTime: number
  started: number
  volume: number
  brightness: number
  rate: number
  progress: boolean
  mode: "pending" | "seek" | "volume" | "brightness" | "speed" | "scroll"
}

function timeLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const minutes = Math.floor(total / 60)
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

export function PlayerInteractionsPlugin(player: Artplayer) {
  const { $player, $video, $progress, $bottom, $setting } = player.template
  const chinese = (player.option.lang ?? "en").toLowerCase().startsWith("zh")
  const text = (zh: string, en: string) => (chinese ? zh : en)
  const canSetVolume = supportsVideoVolume()
  const dispose: (() => void)[] = []
  let gesture: Gesture | undefined
  let brightness = 1
  let panelOpen = false
  let hoveringControls = false
  let lastTap: { time: number; x: number; y: number } | undefined
  let ignoreClicksUntil = 0
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let hudTimer: ReturnType<typeof setTimeout> | undefined
  let mouseClickTimer: ReturnType<typeof setTimeout> | undefined
  const originalFilter = $video.style.filter
  const originalTabIndex = $player.getAttribute("tabindex")
  const isFullscreen = () => player.fullscreen || player.fullscreenWeb
  const isTouch = () => $player.dataset.openlistInput === "touch"
  const initialTouch = window.matchMedia?.("(pointer: coarse)").matches
  $player.dataset.openlistInput = initialTouch ? "touch" : "mouse"
  $player.classList.add("openlist-interactive")
  $player.tabIndex = 0
  $player.setAttribute("aria-label", text("视频播放器", "Video player"))

  const hud = document.createElement("div")
  hud.className = "openlist-gesture-hud"
  hud.hidden = true
  hud.setAttribute("role", "status")
  const hudIcon = document.createElement("span")
  const hudValue = document.createElement("strong")
  const hudDetail = document.createElement("span")
  hud.append(hudIcon, hudValue, hudDetail)
  $player.append(hud)
  const preview = document.createElement("div")
  preview.className = "openlist-seek-preview"
  preview.hidden = true
  $progress.append(preview)

  function showHud(
    icon: Parameters<typeof playerIcon>[0],
    value: string,
    detail = "",
  ) {
    clearTimeout(hudTimer)
    hudIcon.replaceChildren(playerIcon(icon))
    hudValue.textContent = value
    hudDetail.textContent = detail
    hud.hidden = false
  }
  function hideHud() {
    hudTimer = setTimeout(() => {
      hud.hidden = true
    }, 650)
  }
  function hasMenu() {
    return (
      panelOpen ||
      player.setting.show ||
      !!$player.querySelector(".openlist-selector-open")
    )
  }
  function scheduleHide() {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!gesture && !hasMenu() && !hoveringControls && player.playing) {
        player.controls.show = false
      } else if (player.playing) {
        scheduleHide()
      }
    }, HIDE_DELAY)
  }
  function showControls() {
    player.controls.show = true
    scheduleHide()
  }
  function closeSelectors() {
    for (const item of $player.querySelectorAll<HTMLElement>(
      ".openlist-selector-open",
    )) {
      item.classList.remove("openlist-selector-open")
      item.setAttribute("aria-expanded", "false")
    }
  }
  function dismissPanels() {
    closeSelectors()
    player.setting.show = false
    player.emit("openlist:close-panels")
  }
  const secondaryControls = [
    { name: "pip", html: text("画中画", "Picture in picture") },
    { name: "airplay", html: "AirPlay" },
    { name: "fullscreenWeb", html: text("网页全屏", "Web fullscreen") },
    { name: "screenshot", html: text("截图", "Screenshot") },
  ].filter(({ name }) => player.controls[name])
  if (secondaryControls.length) {
    player.setting.add({
      name: "openlist-player-more",
      html: text("更多", "More"),
      selector: secondaryControls.map(({ name, html }) => ({
        name: `openlist-player-${name}`,
        html,
        onClick: () => {
          dismissPanels()
          player.controls[name]?.click()
          return ""
        },
      })),
    })
  }
  function togglePlayback() {
    const playing = player.playing
    if (playing) player.pause()
    else
      void player.play().catch((error: unknown) => {
        player.notice.show = error instanceof Error ? error : String(error)
      })
    showHud(
      playing ? "pause" : "play",
      text(playing ? "暂停" : "播放", playing ? "Paused" : "Playing"),
    )
    hideHud()
    showControls()
  }
  function releaseGesture() {
    clearTimeout(holdTimer)
    if (gesture?.mode === "speed") player.playbackRate = gesture.rate
    const id = gesture?.id
    gesture = undefined
    if (id !== undefined && $player.hasPointerCapture?.(id))
      $player.releasePointerCapture(id)
    preview.hidden = true
    $player.classList.remove("openlist-gesturing")
    hideHud()
    scheduleHide()
  }
  function cancelGesture() {
    clearTimeout(mouseClickTimer)
    lastTap = undefined
    if (gesture) {
      ignoreClicksUntil = Date.now() + 700
    }
    releaseGesture()
  }
  function position(event: PointerEvent, progress = false) {
    return pointerPosition(
      event.clientX,
      event.clientY,
      (progress ? $progress : $player).getBoundingClientRect(),
      player.isRotate,
    )
  }
  function isSurface(target: EventTarget | null) {
    return (
      target === $video ||
      target === player.template.$poster ||
      target === player.template.$mask
    )
  }
  function previewSeek() {
    if (!gesture) return
    preview.hidden = false
    preview.style.width = `${(gesture.targetTime / player.duration) * 100}%`
    const delta = gesture.targetTime - gesture.time
    showHud(
      "seek",
      timeLabel(gesture.targetTime),
      `${delta < 0 ? "-" : "+"}${timeLabel(Math.abs(delta))} / ${timeLabel(player.duration)}`,
    )
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    $player.dataset.openlistInput =
      event.pointerType === "mouse" ? "mouse" : "touch"
    if (isTouch()) hoveringControls = false
    else {
      ignoreClicksUntil = 0
      lastTap = undefined
    }
    if (event.isPrimary === false || gesture) {
      cancelGesture()
      return
    }
    const target = event.target as Node
    const progress = $progress.contains(target)
    if (!progress && !isSurface(target)) return
    $player.focus({ preventScroll: true })
    if (player.isLock) {
      showControls()
      return
    }
    if (hasMenu()) {
      dismissPanels()
      ignoreClicksUntil = Date.now() + 700
      return
    }
    if (!progress && !isTouch()) return
    if (
      progress &&
      (!Number.isFinite(player.duration) ||
        player.duration <= 0 ||
        player.option.isLive)
    )
      return
    const point = position(event)
    gesture = {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      width: point.width,
      height: point.height,
      time: player.currentTime,
      targetTime: player.currentTime,
      started: Date.now(),
      volume: player.muted ? 0 : player.volume,
      brightness,
      rate: player.playbackRate,
      progress,
      mode: progress ? "seek" : "pending",
    }
    $player.setPointerCapture?.(event.pointerId)
    if (progress) {
      event.preventDefault()
      const point = position(event, true)
      gesture.targetTime =
        clamp(point.x / (point.width || 1), 0, 1) * player.duration
      previewSeek()
      showControls()
    } else if (player.playing && !player.option.isLive) {
      holdTimer = setTimeout(() => {
        if (!gesture || gesture.mode !== "pending" || player.isLock) return
        gesture.mode = "speed"
        player.playbackRate = Math.max(2, gesture.rate)
        showHud("seek", `${player.playbackRate}x`)
        $player.classList.add("openlist-gesturing")
      }, 500)
    }
  }
  function pointerMove(event: PointerEvent) {
    if (event.pointerType === "mouse" && !gesture) {
      $player.dataset.openlistInput = "mouse"
      hoveringControls =
        $bottom.contains(event.target as Node) ||
        $setting.contains(event.target as Node)
      showControls()
    }
    if (!gesture || gesture.id !== event.pointerId) return
    const point = position(event)
    const dx = point.x - gesture.x
    const dy = point.y - gesture.y
    if (gesture.mode === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < MOVE_THRESHOLD) return
      clearTimeout(holdTimer)
      lastTap = undefined
      if (
        Math.abs(dx) > Math.abs(dy) * 1.2 &&
        Number.isFinite(player.duration) &&
        player.duration > 0 &&
        !player.option.isLive
      ) {
        gesture.mode = "seek"
      } else if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        gesture.mode = !isFullscreen()
          ? "scroll"
          : gesture.x < gesture.width / 2
            ? "brightness"
            : canSetVolume
              ? "volume"
              : "scroll"
      } else return
    }
    if (gesture.mode === "scroll") return
    event.preventDefault()
    $player.classList.add("openlist-gesturing")
    if (gesture.mode === "seek") {
      if (gesture.progress) {
        const point = position(event, true)
        gesture.targetTime =
          clamp(point.x / (point.width || 1), 0, 1) * player.duration
      } else {
        gesture.targetTime = swipeSeekTime(
          gesture.time,
          dx,
          gesture.width,
          player.duration,
        )
      }
      previewSeek()
    } else if (gesture.mode === "brightness") {
      brightness = clamp(
        gesture.brightness - dy / (gesture.height || 1),
        0.25,
        1.5,
      )
      $video.style.filter =
        `${originalFilter === "none" ? "" : originalFilter} brightness(${brightness})`.trim()
      showHud(
        "brightness",
        `${Math.round(brightness * 100)}%`,
        text("画面亮度", "Picture brightness"),
      )
    } else if (gesture.mode === "volume") {
      player.volume = clamp(gesture.volume - dy / (gesture.height || 1), 0, 1)
      player.muted = player.volume === 0
      showHud("volume", `${Math.round(player.volume * 100)}%`)
    }
    showControls()
  }
  function pointerUp(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return
    const finished = gesture
    ignoreClicksUntil = Date.now() + 700
    if (finished.mode === "seek") {
      player.seek = finished.targetTime
    } else if (
      finished.mode === "pending" &&
      Date.now() - finished.started < 500
    ) {
      const now = Date.now()
      if (
        lastTap &&
        now - lastTap.time <= TAP_DELAY &&
        Math.hypot(finished.x - lastTap.x, finished.y - lastTap.y) < 30
      ) {
        lastTap = undefined
        togglePlayback()
      } else {
        lastTap = { time: now, x: finished.x, y: finished.y }
        showControls()
      }
    }
    releaseGesture()
  }
  function click(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (target.closest(".art-control-fullscreen")) {
      event.preventDefault()
      event.stopImmediatePropagation()
      dismissPanels()
      togglePlayerFullscreen(player)
      return
    }
    const selector = target.closest<HTMLElement>(".art-control-selector")
    if (selector) {
      if (target.closest(".art-selector-item")) {
        closeSelectors()
      } else if (isTouch() || event.detail === 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const open = !selector.classList.contains("openlist-selector-open")
        dismissPanels()
        selector.classList.toggle("openlist-selector-open", open)
        selector.setAttribute("aria-expanded", String(open))
        showControls()
      }
      return
    }
    if (!isSurface(target) && target !== $player && !$progress.contains(target))
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (
      Date.now() < ignoreClicksUntil ||
      player.isLock ||
      $progress.contains(target)
    )
      return
    if (hasMenu()) {
      dismissPanels()
      showControls()
      return
    }
    if (isTouch() && event.detail !== 0) {
      showControls()
      return
    }
    clearTimeout(mouseClickTimer)
    if (event.detail >= 2) {
      togglePlayerFullscreen(player)
    } else if (event.detail === 0) {
      togglePlayback()
    } else {
      mouseClickTimer = setTimeout(togglePlayback, TAP_DELAY)
    }
  }
  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (event.key === "Escape" && hasMenu()) {
      event.preventDefault()
      event.stopImmediatePropagation()
      dismissPanels()
      $player.focus({ preventScroll: true })
      return
    }
    if (target.closest("input, textarea, select, [contenteditable]")) return
    const selector = target.closest<HTMLElement>(".art-control-selector")
    if (
      selector &&
      ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!selector.classList.contains("openlist-selector-open")) {
        dismissPanels()
        selector.classList.add("openlist-selector-open")
        selector.setAttribute("aria-expanded", "true")
      }
      const items = Array.from(
        selector.querySelectorAll<HTMLElement>(".art-selector-item"),
      )
      const index = items.indexOf(target)
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (index + 1) % items.length
              : index <= 0
                ? items.length - 1
                : index - 1
      items[next]?.focus()
      showControls()
      return
    }
    const item = target.closest<HTMLElement>(".art-selector-item")
    if (item && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault()
      event.stopImmediatePropagation()
      item.click()
      selector?.focus()
      return
    }
    const control = target.closest<HTMLElement>(".art-control[role='button']")
    if (control && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault()
      event.stopImmediatePropagation()
      control.click()
      return
    }
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      player.isLock
    )
      return
    const action: Record<string, () => void> = {
      " ": togglePlayback,
      k: togglePlayback,
      f: () => togglePlayerFullscreen(player),
      m: () => {
        player.muted = !player.muted
      },
      ArrowLeft: () => {
        if (Number.isFinite(player.duration))
          player.seek = Math.max(0, player.currentTime - 5)
      },
      ArrowRight: () => {
        if (Number.isFinite(player.duration))
          player.seek = Math.min(player.duration, player.currentTime + 5)
      },
      ArrowUp: () => {
        if (canSetVolume) {
          player.volume = clamp(player.volume + 0.05, 0, 1)
          player.muted = false
        }
      },
      ArrowDown: () => {
        if (canSetVolume) player.volume = clamp(player.volume - 0.05, 0, 1)
      },
      Escape: () => {
        player.fullscreenWeb = false
      },
    }
    if (action[event.key]) {
      event.preventDefault()
      event.stopImmediatePropagation()
      action[event.key]()
      showControls()
    }
  }
  function listen(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, handler, options)
    dispose.push(() => target.removeEventListener(type, handler, options))
  }
  listen(
    $player,
    "pointerdown",
    (event) => pointerDown(event as PointerEvent),
    { capture: true },
  )
  listen(
    $player,
    "pointermove",
    (event) => pointerMove(event as PointerEvent),
    { capture: true },
  )
  listen($player, "pointerup", (event) => pointerUp(event as PointerEvent), {
    capture: true,
  })
  listen($player, "pointercancel", cancelGesture, { capture: true })
  listen($player, "lostpointercapture", () => {
    if (gesture) cancelGesture()
  })
  listen($player, "click", (event) => click(event as MouseEvent), {
    capture: true,
  })
  listen(
    $player,
    "dblclick",
    (event) => {
      if (isSurface(event.target)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    { capture: true },
  )
  // Prevent Artplayer's UA-based progress handlers from seeking a second time.
  for (const type of ["touchstart", "touchmove", "mousedown"]) {
    listen(
      $player,
      type,
      (event) => {
        if ($progress.contains(event.target as Node)) event.stopPropagation()
      },
      { capture: true, passive: true },
    )
  }
  listen(
    $player,
    "contextmenu",
    (event) => {
      if (isTouch() && (isSurface(event.target) || !!gesture))
        event.preventDefault()
    },
    { capture: true },
  )
  listen($player, "keydown", (event) => keydown(event as KeyboardEvent), {
    capture: true,
  })
  listen($player, "pointerleave", () => {
    hoveringControls = false
    scheduleHide()
  })
  listen(window, "blur", cancelGesture)
  listen(document, "visibilitychange", () => {
    if (document.hidden) cancelGesture()
  })
  listen(document, "pointerdown", (event) => {
    if (!$player.contains(event.target as Node)) {
      closeSelectors()
      cancelGesture()
    }
  })

  function updateControls() {
    const labels: Record<string, string> = {
      fullscreen: text("全屏", "Fullscreen"),
      fullscreenWeb: text("网页全屏", "Web fullscreen"),
      setting: text("设置", "Settings"),
      playAndPause: text("播放 / 暂停", "Play / Pause"),
      volume: text("音量", "Volume"),
      quality: text("画质", "Quality"),
      "emby-quality": text("画质", "Quality"),
    }
    for (const control of $bottom.querySelectorAll<HTMLElement>(
      ".art-control",
    )) {
      if (
        control.matches(
          ".art-control-progress, .art-control-time, .art-control-thumbnails",
        )
      )
        continue
      control.setAttribute("role", "button")
      control.tabIndex = 0
      if (!control.hasAttribute("aria-label")) {
        const name = Object.keys(labels).find((name) =>
          control.classList.contains(`art-control-${name}`),
        )
        if (name) control.setAttribute("aria-label", labels[name])
      }
      if (control.classList.contains("art-control-selector")) {
        control.setAttribute("aria-haspopup", "listbox")
        control
          .querySelector(".art-selector-list")
          ?.setAttribute("role", "listbox")
        for (const item of control.querySelectorAll<HTMLElement>(
          ".art-selector-item",
        )) {
          item.setAttribute("role", "option")
          item.setAttribute(
            "aria-selected",
            String(item.classList.contains("art-current")),
          )
          item.tabIndex = -1
        }
      }
    }
  }
  function updateMenuSize() {
    const rect = $player.getBoundingClientRect()
    const width =
      $player.clientWidth || (player.isRotate ? rect.height : rect.width)
    const height =
      $player.clientHeight || (player.isRotate ? rect.width : rect.height)
    $player.style.setProperty(
      "--openlist-menu-width",
      `${Math.max(120, width - 20)}px`,
    )
    $player.style.setProperty(
      "--openlist-menu-height",
      `${Math.max(44, height - 80)}px`,
    )
  }
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(updateMenuSize)
  resizeObserver?.observe($player)
  const observer = new MutationObserver(updateControls)
  observer.observe($bottom, { childList: true, subtree: true })
  updateControls()
  updateMenuSize()
  const onControl = (show: boolean) => {
    if (!show && (gesture || hasMenu())) player.controls.show = true
  }
  const onPanel = (open: unknown) => {
    panelOpen = !!open
    if (open) closeSelectors()
    showControls()
  }
  const onSetting = (show: boolean) => {
    if (show) {
      closeSelectors()
      player.emit("openlist:close-panels")
    }
    showControls()
  }
  player.on("control", onControl)
  player.on("openlist:panel", onPanel)
  player.on("setting", onSetting)
  player.on("play", showControls)
  player.on("pause", showControls)
  player.on("video:loadstart", cancelGesture)
  player.on("fullscreen", cancelGesture)
  player.on("fullscreenWeb", cancelGesture)
  player.on("lock", cancelGesture)
  player.on("resize", updateMenuSize)
  player.on("destroy", () => {
    releaseGesture()
    for (const timer of [holdTimer, hideTimer, hudTimer, mouseClickTimer])
      clearTimeout(timer)
    observer.disconnect()
    resizeObserver?.disconnect()
    dispose.forEach((remove) => remove())
    player.off("control", onControl)
    player.off("openlist:panel", onPanel)
    player.off("setting", onSetting)
    player.off("play", showControls)
    player.off("pause", showControls)
    player.off("video:loadstart", cancelGesture)
    player.off("fullscreen", cancelGesture)
    player.off("fullscreenWeb", cancelGesture)
    player.off("lock", cancelGesture)
    player.off("resize", updateMenuSize)
    $video.style.filter = originalFilter
    if (originalTabIndex === null) $player.removeAttribute("tabindex")
    else $player.setAttribute("tabindex", originalTabIndex)
    hud.remove()
    preview.remove()
  })
  return { name: "openlistInteractions" }
}
