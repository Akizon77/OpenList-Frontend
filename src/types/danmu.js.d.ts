declare module "danmu.js" {
  export type DanmuJsMode = "scroll" | "top" | "bottom"

  export interface DanmuJsComment {
    id: string
    txt: string
    start: number
    duration?: number
    mode?: DanmuJsMode
    color?: boolean
    style?: Record<string, string | number>
  }

  export interface DanmuJsArea {
    start: number
    end: number
    lines?: number
    reflow?: boolean
  }

  export interface DanmuJsOptions {
    container: HTMLElement
    containerStyle?: Record<string, string | number>
    player?: HTMLMediaElement
    comments?: DanmuJsComment[]
    area?: DanmuJsArea
    channelSize?: number
    bulletOffset?: number
    bOffset?: number
    overlap?: boolean
    chaseEffect?: boolean
    needResizeObserver?: boolean
    defaultOff?: boolean
    interval?: number
    maxCommentsLength?: number
    dropStaleComments?: boolean
    highScorePriority?: boolean
    mouseControl?: boolean
  }

  export class DanmuJs {
    constructor(options: DanmuJsOptions)

    readonly status: "idle" | "paused" | "playing" | "closed"

    start(): void
    play(): void
    pause(): void
    stop(): void
    clear(): void
    updateComments(comments: DanmuJsComment[], isClear?: boolean): void
    setAllDuration(mode: DanmuJsMode, duration: number, force?: boolean): void
    setOpacity(opacity: number): void
    setFontSize(size: number, channelSize?: number): void
    setPlayRate(mode: DanmuJsMode, rate: number): void
    show(mode: DanmuJsMode): void
    hide(mode: DanmuJsMode): void
    resize(): void
    destroy(): void
  }

  export type DanmuJsConstructor = new (options: DanmuJsOptions) => DanmuJs

  interface DanmuJsModuleObject {
    readonly default?: DanmuJsConstructor
    readonly DanmuJs?: DanmuJsConstructor
  }

  const DanmuJsModule: DanmuJsConstructor | DanmuJsModuleObject

  export default DanmuJsModule
}
