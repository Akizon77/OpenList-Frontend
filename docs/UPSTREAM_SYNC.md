# 上游同步说明

本仓库与 `../OpenList` 分别维护，后端同步流程见其 `docs/UPSTREAM_SYNC.md`。
定制功能优先放在独立模块，上游页面只保留接入调用。

## 定制边界

- `src/pages/home/previews/emby-playback.ts`：Emby 会话、续播、进度上报、画质切换及自动回退。`video.tsx` 只负责创建、加载、重置、错误通知和销毁。
- `src/utils/emby.ts`、`src/types/emby.ts`：浏览器能力、设备标识、时间换算和接口类型。
- `src/pages/home/previews/danmaku*.ts`：弹幕控制、配置、解析、渲染与测试；普通视频和阿里云视频均需保留初始化及清理调用。
- `src/pages/home/previews/playback.css`：Emby、字幕与弹幕的定制样式。两个视频入口都在 `artplayer.css` 之后导入，保持覆盖顺序。`artplayer.css` 保留上游原样。
- `src/pages/home/previews/subtitle.ts`、`src/utils/subtitle.ts`：字幕语言排序、文件识别及 PotPlayer 链接。

仍需手动关注的上游页面差异：

- `video.tsx` / `aliyun_video.tsx`：字幕选择、流切换和弹幕接入。
- `video_box.tsx` / `folder/context-menu.tsx`：PotPlayer 字幕菜单。
- `manage/indexes/indexes.tsx`：扫描进度和最近尝试时间。
- `utils/api.ts`、类型导出、英文语言包、`package.json` / lockfile：接口与依赖接入。

这些差异不是可删除的冗余。后续重构要保留功能，不要仅为了减小 diff 恢复上游文件。

## 行为约束

- 默认请求 `auto`，保留原始流优先及失败时的一次转码回退；手动选“原始”不自动转码。
- 画质切换保留播放位置和所选音轨、字幕，先上报旧会话停止，再上报新会话开始。
- 进度按十秒节流，暂停、结束及销毁仍上报；普通视频不发送 Emby 播放请求。
- 页面切换使旧请求失效，离开页面清理事件监听和回退定时器。
- 保留字幕语言优先级、本地 XML、在线弹幕及其设置。

## 验证

```sh
pnpm test
pnpm lint
pnpm build
```

单元测试隔离应用的全局配置、网络与提示依赖，不依赖真实 Emby。
发布前仍需在真实服务上检查原始流、转码、续播、字幕、弹幕、PotPlayer 及移动端布局。
不要把模拟接口测试当成真实服务联调通过。

本次比较的上游基准为 `8de44dadf199580ba9b09a5cc5430525be803a21`（2026-09-12）。
未合并上游、升级依赖或改变设置默认值。
