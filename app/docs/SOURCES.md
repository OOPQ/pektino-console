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
| `download_kind` | 下载方式（目前 `http`） |
| `download_headers` | JSON，下载时附加的请求头 |
| `extra` | 源特有字段 JSON，留给以后扩展 |

### token 命名

- 默认源（`pektino`）保持**裸 id**，兼容老数据、老文件名、老 URL
- 其他源用 `<source>@<native id>`，例如 `hanime@abc123`
- `lib/sources.ps1` 的 `New-ItemToken` / `Split-ItemToken` 统一处理
- 文件名、封面缓存、合集、下载队列都以 token 为准；`@` 在 Windows 文件名里合法

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

- `download_kind` 目前只实现 `http`；HLS/magnet/迅雷等需要扩展 `cli/download.ps1`
- `cli/import.ps1` 是串行核对，来源很多时可以考虑按源分批并发
- `daily.ps1` / `thunder.ps1` 仍是 pektino 时代的 CLI 兼容入口，未接入多源
