# app\ —— 程序（只读）

> 这个目录是**程序**：可整包替换、可删除重装，里面不含任何用户数据。
> 数据在一个独立的**项目文件夹**里（`data\ media\ cache\`），换项目等价于换数据目录。
>
> 快速开始、目录约定、备份策略见上级 [`..\README.md`](../README.md)。
> 本文件面向维护者：分层、数据模型、接口、已知取舍。

纯 PowerShell 5.1 + 系统 `curl.exe`，不依赖 Node / Python / 数据库服务。
唯一的第三方依赖是 `lib\System.Data.SQLite.dll`（附带 `lib\x64\SQLite.Interop.dll`）。

## 1. 目录结构

```
app\
  console.ps1          入口：参数、项目解析、HTTP 循环、路由表（约 740 行）
  server\
    transport.ps1      HTTP 传输：Send-Bytes / Send-Json / Read-Request / Push-Sse
    actions.ps1        业务：统计、扫描、抓取/导入 Job、收藏/评分/观看、播放、删除、投递、下载器、源地址刷新
    covers.ps1         封面补齐（含主循环里的自动补封面）
  lib\
    project.ps1        项目（数据单元）解析、初始化、媒体识别
    ledger.ps1         台账业务语义：合并去重、状态机、配置读写、内容目录扫描
    store.ps1          SQLite 存储层（事实来源）
    thumbs.ps1         封面缩略图（System.Drawing，120px）
  cli\
    pektino.ps1        抓榜单 → mp4 直链（JSON-LD + DOM 顺序）
    download.ps1       内置下载器（curl/aria2c，断点续传、并发、可单条取消）
    import.ps1         本地文件反查入库（文件名 → 详情页 → 入库 + 封面）
    thunder.ps1        URL 批量投递迅雷（thunder:// 协议）
    daily.ps1          一条命令跑完「抓 N 页 → CSV → 可选投递」
  web\
    index.html         页面骨架（无逻辑）
    app.css            样式
    js\                原生 ES modules，无构建
      core.js          常量、state、事件总线、api() 封装、错误上报
      table.js         过滤/排序/分页/渲染/列显隐/KPI 快捷筛选
      rows.js          选择、行内操作、右键菜单、播放、删除
      panels.js        灯箱、抽卡、设置抽屉、SSE、键盘
      main.js          数据加载、看板、进度条、批量操作、初始化
      actions.js       写操作统一出口（收藏/评分/观看/状态）
  dev\
    test.ps1           冒烟测试（默认用隔离的临时项目）
    api-probe.ps1      接口探针
    organize-workspace.ps1  把散落的 mp4 收进 media\
    pick-test-items.ps1     按时长挑最短的几条做实验
  lib\System.Data.SQLite.dll, lib\x64\SQLite.Interop.dll
```

## 2. 启动

```powershell
.\console.ps1                      # 默认 8791，自动开浏览器
.\console.ps1 -Port 9000 -NoBrowser
.\console.ps1 -Project D:\my-data  # 直接打开指定项目（不存在则创建结构）
.\console.ps1 -Pick                # 强制显示项目选择器
```

参数：

| 参数 | 作用 |
|---|---|
| `-Port` | 起始端口，默认 8791；被占用时自动往后找 8791+1…+19 |
| `-Project` | 项目目录；留空则用「最近项目」→ 交互选择 |
| `-Pick` | 强制交互选择项目 |
| `-NoPrompt` | 非交互（无人值守），直接用默认/最近项目 |
| `-NoBrowser` | 不自动打开浏览器 |
| `-PauseOnError` | 出错/结束时停住窗口（双击启动时看报错用） |

启动顺序：解析项目 → 初始化 SQLite → 迁移旧 CSV（仅库为空时）→ 每日备份 + WAL 合并 →
修时长 → 补缩略图 → 空台账时识别 `media\` 已有文件 → 整理 `.part` → 首次扫盘 → 绑端口 → 进主循环。

同一端口已有实例时**直接开浏览器并退出**，不碰数据库和 `.part`（重复启动会争抢 SQLite）。

排查入口永远是项目里的 `data\logs\console.log`。

## 3. 分层与调用链

```
浏览器 ──HTTP──▶ main loop (console.ps1)
                   │ Socket.Poll(250ms) → AcceptTcpClient → Read-Request
                   ▼
                Handle-Request ──路由──▶ server\actions.ps1 / covers.ps1
                   │                        │
                   │                        ├─▶ lib\ledger.ps1（合并/状态/扫描）
                   │                        │      └─▶ lib\store.ps1（SQLite）
                   │                        └─▶ cli\*.ps1（Start-Job / Start-Process 子进程）
                   ▼
                Send-Json / Send-Bytes / Push-Sse
```

**单线程事件循环**：所有请求、SSE 推送、后台任务推进（`Update-Job` / `Step-Download` /
`Step-Covers` / `Step-DownloadGuard`）都在同一个循环里顺序执行。好处是无锁、简单；
代价是**任何一个慢请求都会顺延 SSE**。因此耗时动作都做了节流：

- 抓取/入库：`Start-Job` 丢给子进程，主线程只轮询进度文件
- 下载：独立 `powershell.exe` 进程，主线程只读进度 JSON、每 2 秒推一次 `rev`
- 封面：每 10 分钟最多一次，每次 ≤15 张
- 源地址刷新：一次最多 20 条（每条同步 HTTP，超时 25s）
- 失效复核：一次最多 4 条、总预算 6 秒
- **扫盘：不进请求路径**——空闲时每 10 秒一次；前端高频轮询时最迟 30 秒一次
- 下载进程探测：5 秒缓存（`Win32_Process` 全量枚举要 100~200ms，直接在 `/api/state` 里做会明显拖慢页面）
- **行数据按需下发**：前端带 `rowsRev`，台账没变时 `/api/state` 不重传几千行 JSON
- 缺封面统计：30 秒算一次；项目概况（媒体数量/体积）：缓存 10 秒

## 4. 数据模型

单个 `items` 表，`token` 为主键（`data\data.db`）：

```
站点元数据   rank page duration seconds res views likes uploaded url page_url site
生命周期     status first_seen last_seen sent_at note
本地状态     file_name file_size file_date
个人数据     fav rating play_count last_play
```

状态机：

```
new ──投递/开始下载──▶ sent / downloading ──磁盘命中──▶ done
 │                        │
 └──源失效──────────────▶ failed ──刷新源地址──▶ new
忽略（ignored）只能手动设置；扫描到文件时任何状态都会被推成 done。
```

- **token 唯一**：重复抓取只更新排名/时长/观看/直链，`status`、`first_seen`、`sent_at`、
  `fav`、`rating` 一律保留，所以昨天投过的条目今天不会再投一次
- `seconds` 是排序用的整数，`duration` 只是展示文本；历史数据 `seconds=0` 的会在启动时用
  `duration` 回算修正
- `note` 记录来源：`auto:file`（扫描自动标完成）、`scan:init`（首次识别）、`unreachable:*`、
  `removed:site`、`refresh:url` 等

### 存储策略：SQLite 是事实来源

| 机制 | 行为 |
|---|---|
| 写入 | 单事务批量 upsert，WAL 模式，崩溃不损坏 |
| CSV | 只作快照/导出：最多 30 秒写一次，临时文件 + 替换，按天留 `.bak.csv` |
| WAL | 每 200 次写被动 checkpoint；启动/退出各一次 `TRUNCATE` |
| 备份 | 启动时 `VACUUM INTO data\data-YYYYMMDD.db`，只留最近 3 份 |
| 迁移 | 库为空时才把旧 `data\ledger.csv` 导入（日志里有「迁移 N 条」） |

## 5. 三条业务链路

### 抓取（`/api/scrape`）

1. `Start-Scrape` 把增量名单（3 天内抓过的 token）写进 `.known.txt`
2. `Start-Job` 跑 `cli\pektino.ps1`，进度写 `progress.json`（phase/done/total/speed/eta）
3. Job 结束 → `Update-Job` 导入 `.scrape.csv` → `Merge-Ledger` → 落库 → 重扫磁盘
4. 合并/落盘失败时**保留 CSV**，不丢整轮结果

`pektino.ps1` 的数据来源：

| 页面 | 取什么 | 怎么取 |
|---|---|---|
| 榜单 `/zh-CN?page=N` | 排名 + token | `/zh-CN/movie/<token>` 在 DOM 里的出现顺序（JSON-LD `ItemList` 只有前 10 名，不可信） |
| 详情页 | mp4 直链、时长、封面、上传时间、观看 | JSON-LD `VideoObject` |
| 详情页 HTML | 点赞数 | `alt="お気に入り"` 后的 `<span>` |

### 下载（内置下载器 / 迅雷）

内置：`Start-Download` 写队列 JSON → 起独立 `download.ps1` 进程 →

- 优先 `aria2c.exe`（`-x8 -s8`），否则 `curl.exe -C -` 续传
- 先写 `<token>.mp4.part`，大小等于远端 `Content-Length` 才改名成 `.mp4`
- 并发 1–8（配置里存，默认 3）；代理留空时跟随注册表里的系统代理
- 取消：控制台写取消文件，下载器下一轮 poll 时 kill 对应进程，`.part` 保留可续传
- 403/404/410 先用 1 字节 Range GET 复核，确认后标 `failed` 且不再重试；
  本地已有 `.mp4`/`.part` 的绝不判死

迅雷：`thunder://base64("AA" + url + "ZZ")` 逐条 `Start-Process`，只把真正启动成功的标 `sent`。

两者都靠「磁盘命中即完成」闭环：`Step-Download` 在进程结束后整理 `.part`、重扫目录、补缩略图。

### 回填（扫描）

`Invoke-Scan` 建「文件名 → token」索引（剥掉 ` (1)` 后缀，`-Recurse -Depth 4`）：

| 情况 | 结果 |
|---|---|
| 台账条目在目录里有同名 mp4 | 写 `file_*`，状态推成 `done` |
| 目录里没有 | 清 `file_*`；原先是扫描标 done 的退回 `sent`/`new` |
| 目录里有、台账没有 | 记为「孤立文件」，不自动入库（避免污染） |
| `*.mp4.xltd` / `*.mp4.part` | 记「下载中」，不计完成 |
| **目录不可达**（移动硬盘掉线） | **直接返回上次结果，绝不把 done 打回 new** |

自动扫描**不在 `/api/state` 里做**：主循环在没有待处理请求的空闲轮次里扫，间隔 ≥10 秒；
如果前端一直高频轮询导致没有空闲，最迟 30 秒也会强制扫一次（不会被饿死）。
目录里文件再多，也不会拉长任何一次页面请求的响应时间；
扫描发现变化时会 `rev+1` 并通过 SSE 推给页面。

## 6. API

所有接口只绑回环（127.0.0.1）。

```
GET  /                             控制台页面
GET  /static/*                     静态资源（白名单正则 + 拒绝 ..）
GET  /api/state[?rowsRev=N]        {rev, rowsRev, stats, log, job, download, project, settings, metrics}
                                   rows 只在 rowsRev 与当前台账版本不同时下发（大台账的关键优化）
GET  /api/events                    SSE：event: state + {"rev":N}，连接先发 hello，15s 心跳
GET  /api/cover?token=&full=1       缩略图（默认）或原图；404 = 没有封面
GET  /api/project                   项目概况（媒体数量/体积/封面数/库大小）
GET  /api/download                  下载器状态（进程是否活着 + 进度）
GET  /api/export                    ledger.csv 下载（强制生成快照）

POST /api/scrape    {rank,pages,limit,threads,incremental,freshDays}  异步抓取
POST /api/import    {tokens?,threads}                                异步扫本地文件入库
POST /api/job/cancel                                                 取消当前抓取/导入
POST /api/download  {tokens|status,limit,force}                      开始内置下载
POST /api/download/cancel {tokens?}                                  取消单条/全部
POST /api/download/repair                                            整理 .part
POST /api/send      {tokens|status,dryRun,force}                     投迅雷（dryRun 只返回链接）
POST /api/mark      {tokens,status}                                  改状态
POST /api/fav       {tokens,on}                                      收藏
POST /api/watched   {tokens,on}                                      已看/未看
POST /api/rate      {tokens,value}                                   评分 0–5（0 = 清除）
POST /api/play      {token}                                          默认播放器打开 + 记一次播放
POST /api/reveal    {token}                                          资源管理器定位
POST /api/delete    {tokens,purge,permanent}                         删文件（默认回收站）
POST /api/scan                                                       重新扫描内容目录
POST /api/refresh-url {tokens}                                       重抓详情页刷新直链（≤20 条/次）
POST /api/check-url {token}                                          看源地址 HTTP 状态
POST /api/config    {proxy,concurrent}                               代理 / 并发（1–8）
POST /api/project/open                                               打开项目文件夹
POST /api/project/import                                             识别 media\ 里未入账的 mp4
POST /api/content/open                                               打开媒体目录
POST /api/covers/repair {limit}                                      补封面（≤200 条/次）
POST /api/log       {level,msg,url,ms,stack}                          前端上报
```

`metrics` 里是服务端自己的观测数据：`total / avgMs / maxMs / maxPath / slow[] /
clientErrors[] / clientWarns / uptime`。单请求 ≥800ms 会进 `slow` 列表并写一条 `[slow]` 日志。

前端上报写到 `data\logs\client.log`（JSON Lines，>1MB 轮转），同类消息 5 秒内去重。

## 7. 前端

原生 ES module，无构建、无依赖，改完刷新即可（HTML 需要强刷）。

- **状态**：`core.js` 里一个 `state` 对象；`PREFS`（排序/每页/筛选/列显隐/封面/紧凑）
  存 localStorage 的 `pektino.ui.v3`
- **解耦**：模块之间用 `emit()/onEvent()` 事件总线，不互相 import 实现细节
- **写操作**统一走 `actions.js`（`setFav / setRating / setWatched / setStatus`），
  先请求再把结果同步进本地 `state`，避免每个入口各改一遍
- **实时**：SSE 收到 `state` 事件就 `reload`；兜底轮询 60 秒
- **增量行数据**：`state.HAVE_ROWS` / `state.ROWS_REV` 记住手里的账本版本，下次请求带
  `?rowsRev=N`；服务端回 rows 才替换并重绘，否则只更新统计和进度条，不重建表格 DOM
- **大图/抽卡**：原图 + 缩略图两级回退，`fitMedia()` 按窗口算尺寸（不放大）
- **抽卡权重**：没看过 ×3、收藏 ×1.5；候选池 = 当前筛选结果里有文件的条目

## 8. CLI 与 dev

```powershell
# 抓榜单（前 3 页，顺带封面）
.\cli\pektino.ps1 -Page 1,2,3 -Threads 8 -Out daily.csv -CoverDir covers
# 整个流程：抓 → CSV → 投迅雷
.\cli\daily.ps1 -Pages 1,2,3 -Send
# 单条下载器（一般不用手调，控制台会带参数启动）
.\cli\download.ps1 -QueueFile q.json -Dir media -ProgressFile p.json
```

冒烟测试（**默认用临时项目，不会碰你的数据**）：

```powershell
.\dev\test.ps1 -Start              # 临时项目 + 临时端口，跑完自动删除
.\dev\test.ps1 -Start -Project D:\tmp\smoke   # 指定测试项目（不会自动删）
.\dev\test.ps1 -Port 9000          # 测已在跑的服务
```

覆盖：页面 / 静态资源 / 路径穿越（`curl --path-as-is`，绕开客户端规范化）/ `/api/state` 结构 /
项目隔离 / `/api/scan` / `/api/export` / 非法参数 / 评分往返。

## 9. 性能与已知限制

| 场景 | 耗时 |
|---|---|
| 3 页 150 条（16 线程 HttpClient） | ~10 s |
| 增量单页（3 天内抓过的跳过详情页） | ~3.9 s |
| 150 张封面并发 | ~2 s |
| 收藏/改状态写库 | 3–9 ms |
| `GET /api/state`（空台账基线，本机） | **~3 ms**（修复前 ~114 ms：每次轮询都枚举全量进程 + 媒体目录） |
| `GET /api/state`（2000 行，稳态轮询） | **1.6 KB / ~17 ms**（修复前 773 KB / ~343 ms：每次重传全部行） |
| `GET /api/state`（2000 行，首次或台账变更） | 773 KB / ~315 ms（一次性，之后回到稳态） |
| 列表 50 张封面 | 原图 ~4 MB → 缩略图 ~250 KB（-94%） |

限制：

- **单线程**：长请求会顺延 SSE 和页面响应；所有重活都靠子进程 + 节流规避，架构上限仍在
- 榜单排名只信 DOM 顺序；站点改版会让 JSON-LD 解析直接抛错（不会静默返回空）
- 视频直链带 `?tag=NN` 签名参数，别删参数
- 只认 `<token>.mp4` 命名；迅雷存成别的名字需要手动改名或「标记完成」
- 删除只允许项目 `media\` 内的文件；删除失败（被占用）保持原状

## 10. 编辑约定（很重要）

- `web\*.js` / `*.html` 是 **UTF-8 无 BOM**；`.ps1` 是 **UTF-8 with BOM**
  （PS 5.1 会把无 BOM 的 UTF-8 按 ANSI 解码，中文变乱码甚至语法报错）
- 不要用 `Get-Content` / `Set-Content` 直接回写这些文件：PS 5.1 的默认编码会破坏内容。
  用编辑器，或者
  `[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)` +
  `[IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))`
- 改完先跑 `dev\test.ps1 -Start`，再手动点一遍受影响的按钮
