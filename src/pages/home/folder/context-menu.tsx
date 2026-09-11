import { Menu, Item, Submenu } from "solid-contextmenu"
import { useCopyLink, useDownload, useLink, useRouter, useT } from "~/hooks"
import "solid-contextmenu/dist/style.css"
import { HStack, Icon, Text, useColorMode, Image } from "@hope-ui/solid"
import { operations } from "../toolbar/operations"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  buildPotPlayerURL,
  bus,
  convertURL,
  fsGet,
  isSubtitleFile,
  notify,
  pathJoin,
  torrentParse,
} from "~/utils"
import { Obj, ObjType, UserMethods } from "~/types"
import {
  getSettingBool,
  haveSelected,
  me,
  objStore,
  oneChecked,
  password,
  selectedObjs,
  userCan,
} from "~/store"
import { players } from "../previews/video_box"
import { getPreviews } from "../previews"
import { BsPlayCircleFill } from "solid-icons/bs"
import { isArchive } from "~/store/archive"
import axios from "axios"

const ItemContent = (props: { name: string }) => {
  const t = useT()
  return (
    <HStack spacing="$2">
      <Icon
        p={operations[props.name].p ? "$1" : undefined}
        as={operations[props.name].icon}
        boxSize="$7"
        color={operations[props.name].color}
      />
      <Text>{t(`home.toolbar.${props.name}`)}</Text>
    </HStack>
  )
}

export const ContextMenu = () => {
  const t = useT()
  const { colorMode } = useColorMode()
  const { copySelectedRawLink, copySelectedPreviewPage } = useCopyLink()
  const { batchDownloadSelected, sendToAria2, playlistDownloadSelected } =
    useDownload()
  const canPackageDownload = () => {
    return UserMethods.is_admin(me()) || getSettingBool("package_download")
  }
  const { rawLink } = useLink()
  const { isShare, pathname, pushHref, to } = useRouter()
  const [potPlayerSubtitles, setPotPlayerSubtitles] = createSignal<Obj[]>([])
  const potPlayerSubtitleCache = new Map<string, Promise<Obj[]>>()
  let potPlayerRequestID = 0
  const loadPotPlayerSubtitles = async (obj?: Obj) => {
    if (!obj || obj.type !== ObjType.VIDEO) {
      setPotPlayerSubtitles([])
      return
    }
    const requestID = ++potPlayerRequestID
    setPotPlayerSubtitles([])
    const path = pathJoin(pathname(), obj.name)
    let request = potPlayerSubtitleCache.get(path)
    if (!request) {
      request = fsGet(path, password())
        .then((resp) => {
          if (resp.code !== 200) throw new Error(resp.message)
          return (resp.data.related ?? []).filter((item) =>
            isSubtitleFile(item.name),
          )
        })
        .catch((error) => {
          console.warn("Failed to load PotPlayer subtitles", error)
          return []
        })
      potPlayerSubtitleCache.set(path, request)
    }
    const subtitles = await request
    if (requestID === potPlayerRequestID) {
      setPotPlayerSubtitles(subtitles)
    }
  }
  const openWithPreviews = createMemo(() => {
    const objs = selectedObjs()
    if (objs.length !== 1) return []
    const obj = objs[0]
    if (obj.is_dir) return []
    return getPreviews({ ...obj, provider: objStore.provider })
    // .filter((p) => p.key !== "download")
  })
  return (
    <Menu
      id={1}
      animation="scale"
      theme={colorMode() !== "dark" ? "light" : "dark"}
      style="z-index: var(--hope-zIndices-popover)"
    >
      <Show when={openWithPreviews().length > 0}>
        <Submenu label={<ItemContent name="open_with" />}>
          <For each={openWithPreviews()}>
            {(preview) => (
              <Item
                onClick={({ props }) => {
                  to(`${pushHref(props.name)}?preview=${preview.key}`)
                }}
              >
                {preview.name}
              </Item>
            )}
          </For>
        </Submenu>
      </Show>
      <For each={["rename", "move", "copy", "delete"] as const}>
        {(name) => (
          <Item
            hidden={!userCan(name) || !objStore.write || isShare()}
            onClick={() => {
              bus.emit("tool", name)
            }}
          >
            <ItemContent name={name} />
          </Item>
        )}
      </For>
      <Item
        hidden={!userCan("share") || isShare()}
        onClick={() => {
          bus.emit("tool", "share")
        }}
      >
        <ItemContent name="share" />
      </Item>
      <Item
        hidden={() => {
          return (
            isShare() ||
            !userCan("decompress") ||
            !objStore.write ||
            selectedObjs().some((o) => o.is_dir) ||
            selectedObjs().some((o) => !isArchive(o.name))
          )
        }}
        onClick={() => {
          bus.emit("tool", "decompress")
        }}
      >
        <ItemContent name="decompress" />
      </Item>
      <Item
        hidden={() => {
          return (
            isShare() ||
            !userCan("offline_download") ||
            !objStore.write ||
            !oneChecked() ||
            selectedObjs().some((o) => o.is_dir) ||
            !selectedObjs().every((o) =>
              o.name.toLowerCase().endsWith(".torrent"),
            )
          )
        }}
        onClick={async () => {
          const obj = selectedObjs()[0]
          if (!obj) return
          try {
            // 获取 torrent 文件的下载链接并下载内容
            const link = rawLink(obj, false)
            const resp = await axios.get(link, { responseType: "arraybuffer" })
            const buffer = resp.data as ArrayBuffer
            const bytes = new Uint8Array(buffer)
            let binary = ""
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i])
            }
            const base64Data = btoa(binary)

            // 调用解析 API
            const parseResp = await torrentParse(base64Data)
            if (parseResp.code === 200) {
              bus.emit("torrent_parsed", {
                torrentData: base64Data,
                info: parseResp.data,
              })
            } else {
              notify.error(parseResp.message || "解析 torrent 失败")
            }
          } catch (err) {
            notify.error(`解析 torrent 失败: ${err}`)
          }
        }}
      >
        <ItemContent name="offline_download_torrent" />
      </Item>
      <Show when={oneChecked()}>
        <Item
          onClick={({ props }) => {
            if (props.is_dir) {
              copySelectedPreviewPage()
            } else {
              copySelectedRawLink(true)
            }
          }}
        >
          <ItemContent name="copy_link" />
        </Item>
        <Item
          onClick={({ props }) => {
            if (props.is_dir) {
              if (!canPackageDownload()) {
                notify.warning(t("home.toolbar.package_download_disabled"))
                return
              }
              bus.emit("tool", "package_download")
            } else {
              batchDownloadSelected()
            }
          }}
        >
          <ItemContent name="download" />
        </Item>
        <Submenu
          hidden={({ props }) => {
            return props.type !== ObjType.VIDEO
          }}
          label={
            <HStack spacing="$2">
              <Icon
                as={BsPlayCircleFill}
                boxSize="$7"
                p="$0_5"
                color="$info9"
              />
              <Text>{t("home.preview.play_with")}</Text>
            </HStack>
          }
        >
          <For each={players}>
            {(player) =>
              player.name === "PotPlayer" ? (
                <Submenu
                  onMouseEnter={() => {
                    void loadPotPlayerSubtitles(selectedObjs()[0])
                  }}
                  onClick={() => {
                    void loadPotPlayerSubtitles(selectedObjs()[0])
                  }}
                  label={
                    <HStack spacing="$2">
                      <Image
                        m="0 auto"
                        boxSize="$7"
                        src={`${window.__dynamic_base__}/images/${player.icon}.webp`}
                      />
                      <Text>{player.name}</Text>
                    </HStack>
                  }
                >
                  <Item
                    onClick={({ props }) => {
                      window.open(
                        buildPotPlayerURL(rawLink(props, true)),
                        "_self",
                      )
                    }}
                  >
                    {t("home.preview.no_subtitles")}
                  </Item>
                  <For each={potPlayerSubtitles()}>
                    {(subtitle) => (
                      <Item
                        data={subtitle}
                        onClick={({ props, data }) => {
                          window.open(
                            buildPotPlayerURL(
                              rawLink(props, true),
                              rawLink(data, true),
                            ),
                            "_self",
                          )
                        }}
                      >
                        <span
                          title={subtitle.name}
                          style={{
                            "max-width": "240px",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {subtitle.name}
                        </span>
                      </Item>
                    )}
                  </For>
                </Submenu>
              ) : (
                <Item
                  onClick={({ props }) => {
                    const href = convertURL(player.scheme, {
                      raw_url: "",
                      name: props.name,
                      d_url: rawLink(props, true),
                    })
                    window.open(href, "_self")
                  }}
                >
                  <HStack spacing="$2">
                    <Image
                      m="0 auto"
                      boxSize="$7"
                      src={`${window.__dynamic_base__}/images/${player.icon}.webp`}
                    />
                    <Text>{player.name}</Text>
                  </HStack>
                </Item>
              )
            }
          </For>
        </Submenu>
      </Show>
      <Show when={!oneChecked() && haveSelected()}>
        <Submenu label={<ItemContent name="copy_link" />}>
          <Item onClick={copySelectedPreviewPage}>
            {t("home.toolbar.preview_page")}
          </Item>
          <Item onClick={() => copySelectedRawLink()}>
            {t("home.toolbar.down_link")}
          </Item>
          <Item onClick={() => copySelectedRawLink(true)}>
            {t("home.toolbar.encode_down_link")}
          </Item>
        </Submenu>
        <Submenu label={<ItemContent name="download" />}>
          <Item onClick={batchDownloadSelected}>
            {t("home.toolbar.batch_download")}
          </Item>
          <Show
            when={
              UserMethods.is_admin(me()) || getSettingBool("package_download")
            }
          >
            <Item onClick={() => bus.emit("tool", "package_download")}>
              {t("home.toolbar.package_download")}
            </Item>
            <Item onClick={playlistDownloadSelected}>
              {t("home.toolbar.playlist_download")}
            </Item>
          </Show>
          <Item onClick={sendToAria2}>{t("home.toolbar.send_aria2")}</Item>
        </Submenu>
      </Show>
    </Menu>
  )
}
