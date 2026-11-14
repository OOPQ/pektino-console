# 多源架构与适配器开发

## 目标

- 台账可以混放多个来源的条目，按 `source` 区分
- 每个来源一个适配器文件，抓取 / 详情 / 封面 / 下载解析各自实现
- 业务层（console、下载器、封面、刷新）只依赖统一契约，不再出现站点硬编码

## 目录

```
app/sources/sources.json      源清单（启用顺序、能力）
app/sources/<key>.ps1         适配器实现
app/lib/sources.ps1           注册表 / 分发 / token 命名 / 进度
app/cli/scrape.ps1            通用抓取入口（按源抓取 → 统一 CSV）
app/cli/import.ps1            通用本地入库（按 token 找源 → 详情）
```

## 数据模型

`items` 表新增：

| 字段 | 说明 |
|---|---|
| `source` | 源 key，默认 `pektino`；老数据启动时自动补齐 |
| `source_id` | 该站原生 id（老数据 = token） |
| `title` | 标题，展示用；没有时前端回退 token |
| `cover_url` | 封面原图 URL，补封面用 |
| `download_kind` | 下载方式：`http` / `hls` |
| `download_headers` | JSON，下载时附加的请求头 |
| `extra` | 源特有字段 JSON，留给以后扩展 |

### token 命名

- 默认源（`pektino`）保持**裸 id**，兼容老数据、老文件名、老 URL
- 其他源用 `<source>@<native id>`，例如 `hanime@abc123`
- `lib/sources.ps1` 的 `New-ItemToken` / `Split-ItemToken` 统一处理
- 文件名、封面缓存、合集、下载队列都以 token 为准；`@` 在 Windows 文件名里合法
- 新下载的文件按来源放进子目录：`media\<source>\<token>.mp4`；老文件继续平铺在 `media\`，
  扫描/播放/补封面都按递归查找，两种布局可以共存

当前已接入：

| key | 抓取 | 详情 | 封面 | 下载 |
|---|---|---|---|---|
| `pektino` | 榜单 | JSON-LD | JSON-LD | HTTP（Referer） |
| `hsex` | 首页 / `index-N.htm` | `<source>` 的 m3u8 | thumb 图 | HLS（ffmpeg，需配置路径） |
| `local` | 本地文件（无抓取能力） | - | 本地取帧 | - |

### 源清单里的 UI/行为字段

`sources.json` 不只决定加载哪个文件，还驱动 UI 和校验：

| 字段 | 作用 |
|---|---|
| `siteUrl` | 详情页模板（`{id}`），前端「站点」按钮的回退地址 |
| `ranks` | 该源支持的榜单；抓取弹窗的榜单下拉、后端校验都来自这里 |
| `pageSize` | 每页条数，弹窗提示用 |
| `supportsPages` | 是否支持翻页；false 时 UI 隐藏页数 |
| `incremental` | 是否支持增量；false 时 UI 禁用「增量」 |
| `capabilities` | `scrape/detail/cover/download`；抓取源下拉只显示有 `scrape` 的源 |

新增源时只改清单和适配器，不需要再改 `console.ps1` 的榜单枚举或前端下拉。

前端抓取弹窗只填「抓取数量」，后端按当前源的 `pageSize` 自动换算要翻几页并截断到目标条数。

hsex 的榜单：`latest`（最新）、`weekly`（周榜）、`monthly`（月榜）、`min5`（5 分钟+）、`long`（10 分钟+），对应 `list-N.htm / top7_list-N.htm / top_list-N.htm / 5min_list-N.htm / long_list-N.htm`。

## 适配器契约

在 `sources/sources.json` 注册：

```json
{
  "key": "hanime",
  "name": "Hanime",
  "file": "hanime.ps1",
  "enabled": true,
  "order": 20,
  "capabilities": ["scrape", "detail", "cover", "download"]
}
```

`key` 只能是小写字母/数字。适配器文件按 `key` 首字母大写导出函数：

| 能力 | 函数 | 返回 |
|---|---|---|
| `scrape` | `Invoke-HanimeScrape -Context -Options` | 规范化 item 数组 |
| `detail` | `Get-HanimeDetail -Context -Id` | item / `$null` / `@{error}` |
| `cover` | `Get-HanimeCoverUrl -Context -Row` | 封面 URL |
| `download` | `Resolve-HanimeDownload -Context -Row` | `@{url; mode; headers}` |

规范化 item 字段（必需 `source_id`、`url`）：

```
source_id, title, duration, seconds, res, views, likes, uploaded,
url, page_url, cover_url, download_kind, download_headers, extra
```

- `duration` 用 `mm:ss` / `hh:mm:ss`，`seconds` 是整数
- `res` 用 `1920x1080`
- 不要把 `source` 前缀拼进 `source_id`
- 抓取进度写 `Write-SourceProgress -Path $Options.progressFile ...`
- 增量抓取时 `$Options.knownTokens` 是原生 id 列表

## 新增一个来源

1. 复制 `sources/_template.ps1` 为 `sources/<key>.ps1`
2. 实现四个函数（不需要的能力可以不导出，清单里去掉即可）
3. 在 `sources/sources.json` 注册并设置 `order`
4. 跑：
   ```powershell
   cd app
   powershell -NoProfile -ExecutionPolicy Bypass -File .\cli\scrape.ps1 -Source <key> -Rank daily -Page 1 -Limit 3 -Out $env:TEMP\test.csv
   ```
5. 控制台重启，抓取弹窗的「来源」下拉会自动出现；表格出现「来源」列和筛选

## 各环节如何使用适配器

- **抓取**：`Start-Scrape` → `cli/scrape.ps1 -Source` → `Invoke-SourceScrape` → 通用封面缓存 → CSV → `Merge-Ledger`
- **本地入库**：`cli/import.ps1` 按 token 拆分来源，逐个 `Get-SourceDetail`
- **刷新源地址**：`Refresh-ItemUrls` → `Get-SourceDetail`，同时更新 title/duration/res/cover
- **补封面**：`Repair-Covers` → `Get-SourceCoverUrl` → 统一下载
- **下载**：`Start-Download` → `Resolve-SourceDownload`，把 `url/mode/headers` 写进队列；
  `cli/download.ps1` 用 `-H`（curl）或 `--header`（aria2）带上请求头
- **前端**：`/api/state` 返回 `sources`；表格/画廊显示 title 与 source；来源筛选、抓取源下拉

## 兼容与迁移

- 老库启动时 `Repair-SourceFields` 自动补 `source=pektino`、`source_id=token`
- `Merge-Ledger` 对新行补默认 source/title；老 CSV/导入结果仍可合并
- `siteUrl()` 优先用行里的 `page_url`，没有才回退到 pektino 详情页

## 当前限制（后续可扩展）

- `hsex` 的 HLS 下载需要 ffmpeg：在「设置 → FFmpeg 路径」填写，或加入 PATH，或配置 `ffmpegPath`
- `cli/import.ps1` 是串行核对，来源很多时可以考虑按源分批并发
- `daily.ps1` / `thunder.ps1` 仍是 pektino 时代的 CLI 兼容入口，未接入多源
