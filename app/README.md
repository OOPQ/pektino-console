# app\ —— 程序（只读）

> 这个目录是**程序**：可整包替换、可删除重装，里面不含任何用户数据。
> 数据在一个独立的**项目文件夹**里（`data\ media\ cache\`），换项目等价于换数据目录。
>
> 快速开始、目录约定、备份策略见上级 [`..\README.md`](../README.md)。
> 本文件面向维护者：分层、数据模型、接口、已知取舍。

纯 PowerShell 5.1 + 系统 `curl.exe`，不依赖 Node / Python / 数据库服务。
唯一的第三方依赖是 `lib\System.Data.SQLite.dll`（附带 `lib\x64\SQLite.Interop.dll`）。

运行环境：

- **必须是 64 位 Windows PowerShell 5.1**（`powershell.exe`）。`console.ps1` 开头会检查
  `PSEdition` 和 `Is64BitProcess`，用 PowerShell 7 / 32 位进程启动会直接给出提示并退出
  （System.Data.SQLite 是 .NET Framework 混合模式程序集，且只带了 x64 的 Interop）
- 程序路径与项目路径**可以含中文和空格**：所有 `Start-Process` 的参数都经过
  `ConvertTo-QuotedArg` 加引号（否则参数会被空格拆开，下载器起不来）

## 1. 目录结构

```
app\
  console.ps1          入口：参数、项目解析、HTTP 循环、路由表（约 740 行）
  server\
    transport.ps1      HTTP 传输：Send-Bytes / Send-Json / Read-Request / Push-Sse
    actions.ps1        业务：统计、扫描、抓取/导入 Job、收藏/评分/观看、播放、删除、下载器、源地址刷新
    media.ps1          浏览器内播放的独立媒体服务（Range 流式、单次 8MB、只服务 media\ 下的 mp4，token 允许中文）
    covers.ps1         封面补齐：本地视频取帧（Shell 缩略图）+ 站点抓取，含主循环里的自动补封面
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
| `-Restart` | 先结束端口上正在跑的旧控制台，再启动（改完代码后用） |
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
- **扫盘：不进请求路径**——`FileSystemWatcher` 监听 media 目录，有变动才扫；另有 10 分钟兜底；有请求在处理时最多拖 30 秒
- 下载进程探测：5 秒缓存（`Win32_Process` 全量枚举要 100~200ms，直接在 `/api/state` 里做会明显拖慢页面）
- **行数据按需下发**：前端带 `rowsRev`，台账没变时 `/api/state` 不重传几千行 JSON
- 缺封面统计：30 秒算一次；项目概况（媒体数量/体积）：缓存 10 秒

## 4. 数据模型

单个 `items` 表，`token` 为主键（`data\data.db`）；另有 `collections` / `collection_items` 两张表存合集：

```
站点元数据   rank page duration seconds res views likes uploaded url page_url site
生命周期     status first_seen last_seen note（sent_at 为历史列，保留但不再写入）
本地状态     file_name file_size file_date
个人数据     fav rating play_count last_play
```

状态机（只有四个状态，下载中不再单独入库）：

```
new ──开始下载（队列里显示进度）──▶ done（磁盘命中）
 │
 ├──源失效──▶ failed ──刷新源地址──▶ new
 │
 └──手动/右键──▶ recycled（回收站）
```

`recycled`（回收站）只能手动设置：主列表和画廊不显示它，只在「更多 → 回收站」里维护；
扫描到文件时**不会**把 recycled 推回 done，恢复（改成 new）后才会按磁盘命中变 done。
回收站列表只显示 token / 时长 / 分辨率 / 入库日期，**不显示封面**。

> 旧的 `sent`（迅雷已投递）与 `downloading`（下载中）在启动时自动迁移成 `new` / `done`。
> 下载进度看队列（`data\download.json`），不再占用台账状态。

- **token 唯一**：重复抓取只更新排名/时长/观看/直链，`status`、`first_seen`、
  `fav`、`rating` 一律保留，所以已完成的条目不会被重新下载
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

### 下载（内置下载器）

内置：`Start-Download` 写队列 JSON → 起独立 `download.ps1` 进程 →

- 已经有下载器在跑时，新条目**追加**进同一个队列（`data\.dl-add.json`，下载器每轮
  读一次就删），不另起进程；返回 `{appended:N}`
- 启动下载时服务端先写一份初始进度（`items=queued`），前端立刻能看到排队条目；
  已完成的记录会从旧进度文件继承到新一轮，只有 `POST /api/download/clear-done` 会清除
- 抓取/入库（`Start-Job`）与下载（独立进程）互不阻塞；抓取/入库自身仍是单任务槽位
- 优先 `aria2c.exe`（`-x8 -s8`），否则 `curl.exe -C -` 续传
- 先写 `<token>.mp4.part`，大小等于远端 `Content-Length` 才改名成 `.mp4`
- 并发 1–16（配置里存，默认 3）；代理留空时跟随注册表里的系统代理
- 取消：控制台写取消文件，下载器下一轮 poll 时 kill 对应进程，`.part` 保留可续传
- 暂停/继续：控制台写 `data\.dl-pause`（内容 `1`，整体暂停）或
  `data\.dl-pause-items.json`（按 token 单条暂停），下载器下一轮 poll 生效：
  暂停时不再发起该条目、杀掉正在跑的 curl 并把状态记成 `paused`（`.part` 保留），
  继续时 `paused → queued` 重新排队，`curl -C -` 从断点续传。
  下载器进程在暂停期间**不退出**，所以队列、进度、并发位都还在。
- 进程识别（`Get-DownloadProcesses`）：只认命令行里带 `cli\download.ps1` **完整路径**的
  PowerShell，以及命令行同时带内容目录和 `.mp4.part` 的 curl/aria2c；
  跟踪进程时再用 PID + 启动时间双重校验，避免 PID 被系统复用后误判
- `POST /api/download/reset`：强制解除「已有任务在跑」的占用（结束残留进程、清标记），
  `.part` 保留
- 403/404/410 先用 1 字节 Range GET 复核，确认后标 `failed` 且不再重试；
  本地已有 `.mp4`/`.part` 的绝不判死

迅雷投递已经从界面移除（迅雷本身支持直接粘贴 URL，复制链接即可）；
命令行脚本 `cli\thunder.ps1` 仍然保留，给批处理用。

下载闭环靠「磁盘命中即完成」：`Step-Download` 在进程结束后整理 `.part`、重扫目录、补缩略图；
`POST /api/download/clear-done` 只清理队列里的完成记录（不动文件、不动台账）。

### 回填（扫描）

`Invoke-Scan` 建「文件名 → token」索引（剥掉 ` (1)` 后缀，`-Recurse -Depth 4`）：

| 情况 | 结果 |
|---|---|
| 台账条目在目录里有同名 mp4 | 写 `file_*`，状态推成 `done` |
| 目录里没有 | 清 `file_*`；原先是扫描标 done 的退回 `new` |
| 目录里有、台账没有 | 记为「孤立文件」，不自动入库（避免污染） |
| `*.mp4.xltd` / `*.mp4.part` | 记「下载中」，不计完成 |
| **目录不可达**（移动硬盘掉线） | **直接返回上次结果，绝不把 done 打回 new** |

自动扫描**不在 `/api/state` 里做**：`FileSystemWatcher` 收到 media 变动后，主循环挑空闲轮次扫（至少间隔 5 秒）；
如果前端一直高频轮询导致没有空闲，最迟 30 秒也会强制扫一次（不会被饿死）。
目录里文件再多，也不会拉长任何一次页面请求的响应时间；
扫描发现变化时会 `rev+1` 并通过 SSE 推给页面。

## 6. API

所有接口只绑回环（127.0.0.1）。

```
GET  /                             控制台页面
GET  /static/*                     静态资源（白名单正则 + 拒绝 ..）
GET  /api/state[?rowsRev=N]        {api, rev, rowsRev, stats, log, job, download, project, settings, metrics}
                                   api 是接口版本；前端发现缺失就提示「后台是旧版本」
                                   rows 只在 rowsRev 与当前台账版本不同时下发（大台账的关键优化）
GET  /api/events                    SSE：event: state + {"rev":N}，连接先发 hello，15s 心跳
GET  /api/cover?token=&full=1       缩略图（默认）或原图；404 = 没有封面
GET  /api/project                   项目概况（媒体数量/体积/封面数/库大小）
GET  /api/download                  下载器状态（进程是否活着 + 进度）
GET  /api/export                    ledger.csv 下载（强制生成快照）

POST /api/scrape    {rank,pages,limit,threads,incremental,freshDays}  异步抓取
POST /api/import    {tokens?,threads}                                异步扫本地文件入库
POST /api/job/cancel                                                 取消当前抓取/导入
POST /api/download  {tokens|status,limit,force}                      开始内置下载；已在跑则追加（返回 appended）
POST /api/download/cancel {tokens?}                                  取消单条/全部
POST /api/download/pause {on}                                        暂停 / 继续（保留 .part）
POST /api/download/reset                                             强制解除「已有任务在跑」
POST /api/download/clear-done                                        清理队列里的完成记录（不动文件/台账）
POST /api/download/repair                                            整理 .part
POST /api/mark      {tokens,status}                                  改状态（new/done/recycled/failed）
GET  /api/collections                                                合集列表（含条目数）
GET  /api/collections/items?id=N                                     合集内 token
GET  /api/download/preview                                           下载前预估（条数/平均体积/磁盘剩余）
POST /api/collections {action,id,name,tokens}                        合集 create/rename/delete/add/remove
POST /api/fav       {tokens,on}                                      收藏
POST /api/watched   {tokens,on}                                      已看/未看
POST /api/rate      {tokens,value}                                   评分 0–5（0 = 清除）
POST /api/play      {token, count?}                                  默认播放器打开 + 记一次播放；count=true 只计数（浏览器内播放）
POST /api/reveal    {token}                                          资源管理器定位
POST /api/delete    {tokens,purge,permanent}                         删文件（默认回收站）
POST /api/scan                                                       重新扫描内容目录
POST /api/refresh-url {tokens}                                       重抓详情页刷新直链（≤20 条/次）
POST /api/check-url {token}                                          看源地址 HTTP 状态
POST /api/config    {proxy,concurrent}                               代理 / 并发（1–16）
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
- **下载队列卡片**：每条带封面缩略图、进度条、▶ 播放 / ☆ 收藏 / 定位 / 暂停 / 取消；
  队列按状态分区：进行中、已暂停、已完成、失败、已取消（互不混在一起）
- **画廊视图**：查询条右侧「表格 / 画廊」切换，卡片墙复用同一套行内交互
  （`data-lb` / `data-play` / `data-fav` / `data-rate` / `data-dl`），选择存 `PREFS.view`；
  宽屏一行 10 张、窄屏自动减列
- **合集**：`collections.js`；点「📚 合集」直接打开 `#colBrowser` 弹窗，tabs 切换合集、
  弹窗内完成新建/重命名/删除，卡片墙复用 `table.js` 的 `cardHtml`（搜索/状态过滤、
  卡片播放、悬停移出、在台账中筛选）
- **播放器**：灯箱和抽卡共用 `PLAYERS`（img/video/overlay/pip 四件套），
  空格播放/暂停、长按空格 2× 倍速（260ms 后生效，松开恢复）、**←/→ 快退/快进 5 秒**、
  **↑/↓ 音量 ±5%**、F 全屏、M 静音；画中画按钮走 `video.requestPictureInPicture()`，
  关灯箱时若画中画在播则保留视频继续播放；底部 `.kbd-hint` 有一行快捷键提示
- 播放快捷键用 **capture 阶段**监听并 `stopPropagation`，视频控件聚焦时也不会吞掉
  Ctrl+←/→；`video.tabIndex=-1` + focus 立即 blur，避免控件焦点框
- **封面清晰度**：表格和画廊都用原图（`/api/cover?...&full=1`，失败回退缩略图）；
  下载队列卡片和灯箱的降级路径仍用 120px 缩略图（省流量）
- **本地视频封面**：没有封面但有本地视频的条目，用 Shell 缩略图抽一帧存成
  `cache\covers\<token>.jpg`；token 允许中文（`Test-SafeTokenName` 挡掉 `\/:*?"<>|` 和 `..`）
- **入队反馈**：`renderDownloadQueue` 比较上一次的 `total`，变大就触发
  `pulseDlQueue()`（按钮脉冲 + 浮出「+N 已加入队列」）
- **完成提示音**：`playDing()` 用 Web Audio 现场合成（无音频文件），
  首次 `pointerdown` 解锁 AudioContext；开关存 `PREFS.sound`
- **二级菜单**：低频操作收进「更多 ▾」、筛选收进「筛选 ▾」，设置抽屉用 `<details>` 折叠

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

- **单线程**：长请求会顺延 SSE 和页面响应；所有重活都靠子进程 + 节流规避，架构上限仍在。
  视频流不走主循环，由 `server\media.ps1` 独立进程提供（Range + 单次 8MB），
  `/api/state` 的 `media.base` / `media.key` 给前端拼播放地址
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
