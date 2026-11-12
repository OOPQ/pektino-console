# tools/ —— 可复用脚本

两个脚本，纯 PowerShell 5.1 + 系统 curl，不依赖 agent-browser / Node / Python。

```
tools\
  启动控制台.cmd  双击即可（等价于 powershell -File console.ps1）
  console.ps1    入口：参数、存储初始化、HTTP 循环、路由表（~540 行）
  web\
    index.html   页面结构（只留骨架，不含逻辑）
    app.css      样式
    js\          前端 ES modules（无构建，浏览器原生 import）
      core.js      常量、全局 state、事件总线、API 封装、错误上报
      table.js     过滤/排序/分页/表格渲染/列显隐/KPI 快捷筛选
      rows.js      选择、行内操作、右键菜单、播放、删除
      panels.js    灯箱、抽卡、设置抽屉、SSE、键盘
      main.js      加载数据、工具条、批量操作、初始化
    transport.ps1 HTTP 传输层：Send-Bytes / Send-Json / Read-Request / Push-Sse
    actions.ps1  业务动作：统计、扫描、任务、收藏/评分/观看、播放、删除、投递
  store.ps1      **SQLite 存储层**（out\data.db，WAL，事务 upsert，每日 VACUUM 备份）
  ledger.ps1     台账业务语义：合并、状态、配置、扫盘（读写委托给 store）
  thumbs.ps1     封面缩略图（120px，System.Drawing）
  import.ps1     本地文件反向入库（扫目录 → 查详情 → 入库 + 封面）
  daily.ps1      一键：日榜前 N 页 → CSV → 可选整批丢迅雷
  pektino.ps1    抓榜单（-Page 多页 / -Threads 并发 / -KnownFile 增量）
  thunder.ps1    URL 批量投递迅雷（thunder:// 协议），支持去重、dry-run
  test.ps1       冒烟测试：页面/静态资源/核心接口/路径穿越，改完代码先跑它
  lib\           System.Data.SQLite.dll + x64\SQLite.Interop.dll
  out\           data.db（事实来源）、data-YYYYMMDD.db（每日备份）、covers、thumbs、日志
```

> 前端是三个静态文件（`/` 出 HTML，`/static/app.css`、`/static/app.js` 分别出样式和脚本），
> 强刷只需刷 HTML；改 CSS/JS 后刷新即可生效，不用重启服务。
> 服务端分三层：入口（console.ps1）→ 路由表（Handle-Request）→ 业务（web\actions.ps1）/ 传输（web\transport.ps1）。
>
> ⚠️ 编辑 `web\*.js` / `web\*.html` 时**不要用 PowerShell 的 `Get-Content` / `Set-Content` 直接回写**：
> 这些文件是 UTF-8 无 BOM，PS 5.1 会按 ANSI 解码，中文会变成乱码且不可逆。
> 用编辑器改，或 `[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)` + `WriteAllText(...,UTF8Encoding($false))`。

### 存储：SQLite 是事实来源，CSV 只是快照

- 所有读写走 `out\data.db`（WAL 模式，事务 upsert），崩溃不会写坏台账
- `out\ledger.csv` 变成**快照/导出**：最多 30 秒写一次，原子写（temp → replace），并按天留 `.bak.csv`
- **WAL 不会无限长**：每 200 次写入做一次被动 checkpoint，启动/退出各做一次 `TRUNCATE`（实测 4.3MB → 0）
- **每日自动备份**：启动时 `VACUUM INTO out\data-YYYYMMDD.db`，只保留最近 3 份
- 首次启动自动把旧 `ledger.csv` 迁移进库（日志里有「迁移 N 条」）
- 只有被改动的行才 upsert：收藏/评分/改状态现在 **3~9ms**（原来是 124ms 全表重写）

### 评分（0–5 星）

- 表格「评分」列点星星打分，**再点同一颗清除**；可排序、可筛选（已评分 / 未评分 / ≥4 星）
- 右键菜单里也有一行星星，选中浮条可批量打分
- 存 `rating` 列（空 = 未评分），灯箱和抽卡卡片都会显示


## 控制台（推荐入口）

双击 `启动控制台.cmd`（或 ASCII 名的 `console.cmd`），或：

```powershell
.\console.ps1              # 默认 8791，自动开浏览器
.\console.ps1 -Port 9000 -NoBrowser
```

### 双击没反应？三个已知原因（都已修）

| 现象 | 原因 | 现在的行为 |
| --- | --- | --- |
| 窗口一闪就没了 | `powershell -File` 启动时 `$PSScriptRoot` 在 `param` 默认值里是空的，脚本第一行就崩 | 改成运行期兜底解析路径，并在 `out\console.log` 里留痕 |
| 窗口一闪就没了 | 8791 已被上一个实例占用，绑定失败后直接 return | 先探测已有实例 → 有就直接开浏览器；否则自动往 8791+1…+19 找空端口 |
| 双击后完全无反应 | `.cmd` 用了 LF 换行 + 中文 + `chcp`，cmd.exe 解析异常 | 启动器改成 **CRLF + 纯 ASCII**，用全路径 `powershell.exe`，结束加 `pause` |

排查入口永远是 `out\console.log`（每次启动/端口占用/已有实例都会记一行）。

打开 http://127.0.0.1:8791/ 之后：

| 区域 | 作用 |
| --- | --- |
| 顶部看板 | 总数 / 待下载 / 已投递 / 已完成 / 在磁盘 / 未下载 / 收藏 / 待看 / 总时长 / 今日新增 —— **每张卡都可点，直接筛选对应集合**（当前生效的卡会高亮；「总时长」按时长从长到短排序） |
| 查询栏 | 关键词（token/分辨率/时长，`/` 聚焦、`Esc` 清空）+ 状态（含**待看/已看**）+ 分辨率 + 最短时长 + 快捷排序 + 重置 + 列显隐 |
| 操作栏 | 榜单 + 页码 + 条数 + **增量**开关 + 抓取 / 本地入库 / 投递待下载 / 预览 dry-run / 导出 CSV |
| 表格 | **只有一个滚动容器**（页面本身不滚动），表头吸顶，封面 84×118，收藏按钮 30×30，点击封面开大图 |
| 选中浮条 | 勾选后底部浮出：投递 / 收藏 / 取消收藏 / 标记完成 / 复制 URL / 清空；**Shift 点选可整段选择** |
| 右键菜单 | 行上右键：播放 / 定位 / 复制 URL / thunder / token / **收藏（按当前状态显示为「取消收藏」）** / **已看（按状态显示为「标记未看」）** / 标记完成 / 重置 / 忽略 / 删除文件 / 删除并移出台账 / 在站点打开。没有本地文件时「播放/定位/删除」自动置灰 |
| 删除 | 删除本地文件走**回收站**（可还原），台账里清空 `file_*` 并把状态退回；「删除文件并从台账移除」会连台账行一起删。只允许删下载目录内的文件 |
| 列显隐 | 查询栏「列 ▾」可关掉不需要的列（封面/排名/时长/分辨率/观看/点赞/token/状态/磁盘/入库），选择会记住 |
| 实时 | **SSE 推送**：任何变更（收藏/状态/扫描/任务）服务端 `rev+1` 并推给页面，实测 2 秒内自动刷新；兜底轮询降到 60s |
| 大图预览 | 点封面 → 原图 + 时长/分辨率/观看/点赞/状态 + 收藏/播放/定位/复制 |
| 设置抽屉 | 下载目录、扫描、**运行指标**（请求数/平均/最慢/慢请求列表）、**前端错误列表**、孤立文件、日志、自检（右上 ⚙ / ☰） |
| 抽卡 | 操作栏「🎲 抽一卡」或按 `R`：从当前筛选出的在盘条目里随机抽一个，弹卡带封面/时长/观看/收藏状态，可播放、收藏、再抽 |

### 抽卡规则

- 候选池：**当前筛选结果里 `file_name` 非空**的条目（没筛选就是全部在盘条目）；池子为空时提示先下载
- 权重：**没看过的 ×3**、看过的 ×1、收藏的再 ×1.5 —— 抽到的大概率是"你还没看的"
- 卡片上有「🎲 抽到 · 还没看 / 看过了」标记，避免抽到看过的还以为没看过
- 卡片下方有 **评分星星**：点星星打分，再点同一颗清除；也可以直接按 **1–5 数字键**给当前卡片打分
- `R` 键随时随地再抽一次，`Esc` 关闭

### 前端上报 + 请求耗时

前端所有请求都经过 `api()` 包装，记录三件事并上报到 `POST /api/log`：

| 上报内容 | 触发条件 |
| --- | --- |
| `慢请求 /api/xxx 1234ms` | 单次请求 > 1s（warn） |
| `请求失败 /api/xxx: HTTP 500` | 网络错误或非 2xx（error，带调用栈） |
| `接口返回失败 /api/xxx: 非法状态` | 业务层 `{ok:false}`（warn）—— 就是上次「忽略失效」那类被吞掉的错误 |
| `Uncaught Error …` / `unhandledrejection` | `window.onerror` + 未捕获 Promise |

服务端把它们写进 **`out\client.log`（JSON Lines，>1MB 自动轮转）**，同时进内存环形缓冲，
在「设置 → 前端错误」里直接看；服务端自己也记每请求耗时：

- `/api/state` 的 `metrics` 里有 `total / avgMs / maxMs / maxPath / slow[] / clientErrors[] / uptime`
- 单请求 ≥ 800ms 会额外写一条 `[slow]` 日志并进 `slow` 列表
- 同类前端消息 5 秒内去重，避免刷屏


| 分页 | 25/50/100/200/全部，首尾页 + 页码收拢 |
| 记忆 | 排序、每页条数、筛选、封面开关、紧凑模式全部存 localStorage，刷新不丢 |

> 布局是 `100vh` 的 flex 纵向排版：`html,body{overflow:hidden}`，只有 `.tablewrap` 滚动，
> 所以不会出现「表格滚动条 + 页面滚动条」两条互相打架的情况。


### 播放记录 + 待看列表

- **播放即记录**：`/api/play` 成功启动播放器后，`play_count + 1`、`last_play = 当前时间`，行内「播放」列显示 `▶N`，悬停看上次播放时间
- **待看** = 磁盘上有文件（`file_name` 非空）且 `last_play` 为空。看板「待看」卡片可点，一键筛出「下了但还没看」的
- **已看** = `last_play` 非空；筛选里有「已看」，也可按「播放次数」列排序
- 手动校正：右键菜单 / 选中浮条里的「标记已看 / 标记未看」（`POST /api/watched {tokens,on}`）
- 播放器是系统默认关联程序（这台机器上 VLC / PotPlayer 都试过），服务端只负责 `Start-Process`


- **收藏**：每行最左边的 ☆ 点一下变 ★，写进台账 `fav` 列；顶部「收藏」卡片和 `收藏 ★` 筛选都基于它
- **播放**：点**封面**、**token** 或「播放」按钮 → 服务端用默认播放器打开本地文件
  （`POST /api/play {token}`，只允许打开下载目录里确实存在的文件）
- **定位**：`定位` 按钮 → 资源管理器选中该文件（`POST /api/reveal {token}`）

### 本地文件入库

`本地文件入库` 按钮（或 `import.ps1`）会把下载目录里已存在的文件反向录入台账：

1. 扫出所有 `<token>.mp4`（去重、剥掉 ` (1)` 后缀）
2. 逐个请求 `https://pektino.com/zh-CN/movie/<token>`，解析 JSON-LD
3. 能解析出 `VideoObject` → 视为本站视频，写入时长/分辨率/观看/点赞/直链/封面，并因文件存在自动置 `done`
4. 解析不出来（404 或不是该站点）→ 跳过，仍留在「孤立文件」里

实测：280 个文件 → 243 个识别入库（新增 147 条），37 个识别不出（改名/别的来源）。


### 下载目录 + 文件索引

迅雷下来的文件按 `<token>.mp4` 命名（`token` 就是详情页 URL 最后那段）。
控制台会扫描这个目录，建 `文件名 → token` 的索引，然后：

| 情况 | 结果 |
| --- | --- |
| 台账某条在目录里有同名 mp4 | `status` 自动置 `done`，写入 `file_name / file_size / file_date` |
| 目录里没有 | `file_*` 清空；若原来是被扫描自动标 done 的，退回 `sent`/`new` |
| 目录里有、台账没有 | 记为「孤立文件」，单独列出（不自动进台账，避免污染） |
| `xxx.mp4.xltd` | 记为「下载中」，不计入完成 |
| `token (1).mp4` | 迅雷重复下载后缀，自动剥掉再匹配 |

去重因此有两道：**台账状态**（sent/done 跳过）+ **磁盘命中**（`file_name` 非空就跳过，
即使状态还是 new）。抓取入库后会自动重扫一次，所以「榜单里刚好已经下过的」会立刻变绿。

> 文件名容错：只认 `<token>.mp4`。如果迅雷给你存成了别的名字（比如 `<token>.mp4.crdownload`），
> 扫描不到，需要在迅雷里改文件名或手动点「标记完成」。

**去重逻辑**：台账 `out\ledger.csv` 以 `token` 为唯一键。抓取时老条目只更新
排名/时长/观看数，**status、first_seen、sent_at 保持不变**；所以：

- 昨天投过的条目，今天再抓一次仍然是 `sent`，不会重复下载；
- 「投递全部待下载」只挑 `status = new` 且不是 `done` 的；
- 投完自动置 `sent`，你下完手动点「标记完成」变 `done`，之后永远跳过。

台账列：`token,status,rank,page,duration,seconds,res,views,likes,uploaded,url,page_url,first_seen,last_seen,sent_at,note`

API（前端用的就是这几个，也可以自己 curl）：

```
GET  /api/state                     -> {stats, rows, log, job}（job.progress 是抓取进度）
GET  /api/events                    -> **SSE** 流：`event: state` + `{"rev":N}`，连上先发 `hello`
GET  /api/cover?token=<token>       -> 本地**缩略图** jpg（`&full=1` 取原图），404 表示没刮到
GET  /api/export                    -> ledger.csv 下载
POST /api/scrape {rank,pages,limit,threads,incremental} -> 异步启动抓取，立刻返回 {started,skipped}
POST /api/job/cancel                -> 取消当前抓取/导入任务
POST /api/send   {tokens|status,dryRun,force} -> 投迅雷，跳过 done 与磁盘已有的
POST /api/mark   {tokens,status}    -> 改状态
POST /api/fav    {tokens,on}        -> 收藏 / 取消收藏
POST /api/import {tokens?,threads}  -> 异步扫描本地文件入库
POST /api/play   {token}            -> 用默认播放器打开本地文件，并记一次播放
POST /api/watched {tokens,on}       -> 标记已看 / 未看（写 play_count + last_play）
POST /api/delete {tokens,purge,permanent} -> 删本地文件（默认回收站）；purge=1 时同时移除台账行
POST /api/log    {level,msg,url,ms,stack} -> 前端上报（写 client.log + 内存环形缓冲）
POST /api/reveal {token}            -> 资源管理器定位文件
POST /api/scan                      -> 重新扫描下载目录
POST /api/config {downloadDir}      -> 改下载目录（不存在则创建）并立即扫描
```

抓取是**异步**的：`/api/scrape` 只启动后台 Job，前端每 1.2s 轮询 `/api/state` 里的
`job.progress`（phase / done / total / speed / eta）来画进度条；Job 结束后服务端自动
导入 CSV、合并台账、重扫磁盘。任务运行期间前端才会高频轮询，平时靠 SSE 推送。

> SSE 实现说明：服务端原来是 `AcceptTcpClient()` 阻塞循环，一条长连接就会把整个服务卡死。
> 现在改成 `Socket.Poll(250ms)` 非阻塞轮询 + 在同一个循环里 flush SSE 客户端（`Push-Sse`），
> 所以既能保持单线程无锁，又能维持长连接。代价是：一个慢请求会让 SSE 最多延迟它的耗时
> （目前 `/api/state` 约 50ms，可忽略）。断线由浏览器按 `retry: 2000` 自动重连。


## 性能

| 场景 | 耗时 |
| --- | --- |
| 3 页 150 条（旧：串行 `Invoke-WebRequest`） | ~90 s |
| 3 页 150 条（16 线程 HttpClient） | **~10 s** |
| 3 页全量（含封面+缩略图） | 11.9 s |
| **增量**（跳过 3 天内抓过的）单页 | 3.9 s |
| 150 张封面并发下载 | ~2 s（缓存 11 MB） |
| 150 张缩略图生成 | <1 s（总计 1.6 MB / 392 张，平均 4.1 KB） |
| 收藏 / 改状态写库 | 3~9 ms |

封面流量：列表一屏 50 张，原图约 **4 MB → 缩略图约 250 KB（-94%）**；`/api/cover` 默认发缩略图，`&full=1` 才发原图。


配置落在 `out\config.json`（`{"downloadDir":"D:\\Downloads"}`），改完重启控制台也保留。

## daily.ps1（命令行版同款流程）

```powershell
.\daily.ps1                 # 日榜第 1-3 页（150 条）→ 只抓不下载
.\daily.ps1 -Send           # 抓完一次性全部丢迅雷（迅雷里生成 150 个任务）
.\daily.ps1 -Send -DryRun   # 只打印将投递的 thunder:// 链接
.\daily.ps1 -Pages 1,2 -Send
.\daily.ps1 -Rank weekly -Pages 1 -MinWidth 1920 -Send
```

产物落在 `tools\out\`：`daily-p1-2-3-<时间戳>.csv` / `.md` / `.urls.txt`
（`.urls.txt` 就是合并后的一行一条链接清单，可直接拖进迅雷或喂给 aria2）。

## pektino.ps1

数据来源全部是页面内嵌的 schema.org JSON-LD，不用浏览器、不解析 DOM：

| 页面 | 取什么 | 怎么取 |
| --- | --- | --- |
| 榜单页 `/zh-CN?page=N` | 有序排名 + token | 页面里 `/zh-CN/movie/<token>` 的 **DOM 出现顺序就是排名**；JSON-LD 的 `ItemList` 只覆盖前 10 名，不够用，所以按 DOM 抽 |
| 详情页 `/zh-CN/movie/<token>` | mp4 直链、时长、封面、上传时间、观看数 | `VideoObject.contentUrl / duration / thumbnailUrl / uploadDate / interactionStatistic` |
| 详情页 HTML | 点赞数 | JSON-LD 里没有，只能从 `alt="お気に入り"` 后面的 `<span>` 抠 |

```powershell
# 第 1 页前 3 条
.\pektino.ps1 -Limit 3

# 前 3 页（每页 50 条，排名跨页连续：51-100 是第 2 页）
.\pektino.ps1 -Page 1,2,3 -Out .\daily3.csv -Markdown .\daily3.md -UrlList .\daily3.urls.txt

# 周榜前 2 页，只要 1080p 以上
.\pektino.ps1 -Rank weekly -Page (1..2) -MinWidth 1920 -Out .\hd.csv

# 机器可读
.\pektino.ps1 -Limit 10 -Json
```

参数：`-Rank daily|weekly|monthly|all`、`-Page 1,2,3`（或 `(1..3)`）、`-Limit N`、
`-MinWidth 像素宽`、`-Out x.csv`、`-Markdown x.md`、`-UrlList x.txt`、`-Json`、
`-Threads 8`（并发）、`-CoverDir out\covers`（顺带刮封面）、`-ProgressFile x.json`（进度）。


**注意**：详情页里混着 8 条推荐视频的直链，兜底正则必须按 token 精确匹配
（`/<token>.mp4`），否则会抓成别人的视频。

## thunder.ps1

```powershell
# 从 CSV 里挑第 1、3、9-12 条
.\thunder.ps1 -Csv .\daily.csv -Pick '1,3,9-12'

# 全量投递
.\thunder.ps1 -Csv .\daily.csv

# 只想看会发什么
.\thunder.ps1 -Csv .\daily.csv -Pick '1,3' -DryRun

# 单个 URL / 管道
.\thunder.ps1 -Url 'https://video.twimg.com/xxx.mp4'
(.\pektino.ps1 -Limit 5 -Json | ConvertFrom-Json).url | .\thunder.ps1
```

- 投递记录写 `tools\.sent-thunder.txt`，默认跳过已投递过的 URL；`-Force` 强制重投。
- `-DryRun` 只打印 `thunder://` 链接，绝不调起迅雷。
- 迅雷路径自动探测：先读 `HKCU:\Software\Classes\thunder` 协议注册，再退回常见安装路径。
- `thunder://` 编码规则：`base64("AA" + url + "ZZ")`。

## 一条完整流水线

```powershell
D:\tools\tools\pektino.ps1 -Rank daily -Out D:\tmp\daily.csv -Markdown D:\tmp\daily.md
# 人工看 daily.md，决定要哪几条
D:\tools\tools\thunder.ps1 -Csv D:\tmp\daily.csv -Pick '1,2,9' -DryRun
D:\tools\tools\thunder.ps1 -Csv D:\tmp\daily.csv -Pick '1,2,9'
```

## 已知限制

- 榜单页按天刷新（`/zh-CN`），`weekly/monthly/all` 同理；分页靠 `?page=N`，每页 50 条，排名跨页连续。
- **JSON-LD 的 ItemList 只有前 10 名**，所以排名一律按 DOM 顺序取，别信 ItemList 的数量。
- 站点改版会打断 JSON-LD 解析 —— 脚本会直接抛「没找到 ItemList」，不会静默返回空。
- 视频在 `video.twimg.com`，URL 带 `?tag=NN` 签名参数，**别删参数**（通常仍可直连，但保留更稳）。
- 脚本中文内容必须以 **UTF-8 with BOM** 保存，否则 PowerShell 5.1 按 ANSI 读会直接语法报错。
