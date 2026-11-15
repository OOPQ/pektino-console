# pektino 控制台 — 新会话交接说明

更新时间：2026-11-15

## 项目定位

`D:\project\agent-browser` 是一个 Windows 本机单用户影片抓取 / 下载 / 台账 / 播放控制台。

- 后端：PowerShell 5.1 单线程 `TcpListener`
- 前端：原生 HTML/CSS/JS，无构建步骤
- 主服务：`http://127.0.0.1:8791/`
- 媒体服务：`127.0.0.1:8831`
- 项目数据：`D:\project\pektino-project`
- 台账事实来源：`data\data.db`（SQLite），`data\ledger.csv` 是导出快照
- 媒体布局：`media\<source>\<token>.mp4`
- 当前版本：`VERSION=2.1.0`
- 当前分支：`main`，比 `origin/main` 领先 4 个提交（网络原因未推送）

## 启动方式

双击：

```text
D:\project\agent-browser\start.cmd
```

它会先停掉旧 console/media，再启动新控制台。

**不要**用 DSH 的 `run_in_background` 托管 `start.cmd`：工具 job 结束时会把控制台一起收掉，看起来像“启动失败”。

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8791/api/state
```

当前控制台可能没有运行，新会话先启动再工作。

## 目录结构

```text
app/
  console.ps1        HTTP 路由、状态、启动流程
  lib/               ledger / project / sources / media 等
  server/            actions / covers / media / transport
  sources/           pektino / hsex / qise / web / local 适配器
  cli/download.ps1   下载器（curl + ffmpeg HLS）
  web/               index.html、app.css、js/*
  dev/               test.ps1、start/stop 辅助脚本
  docs/              源说明等
data/                在项目数据目录，不在仓库
```

## 当前数据状态

- 台账：约 1189 条
- 媒体文件：436 个 mp4
- `data\deleted.json`：当前 0 条
- 配置：并发 16，ffmpeg 为 `D:\software\oopz\ffmpeg.exe`，代理为空（跟随系统）

## 近期重要变更

最近 4 个未推送提交：

```text
2367b7b feat(scan): 手动扫库支持 media\local 自动补条目
8cddcb9 refactor(delete): 删除统一走回收站
923b709 feat(scrape): 跳过已删除记录改为用户勾选
058758e feat(scrape): 记录手动移除的条目，抓取时自动跳过
```

更早已推送的：

```text
d484386 fix(download): 下载待下载跟随当前筛选
002bf19 feat(ui): 统一自定义确认弹窗
aa589b7 feat(ui): 标题模糊搜索，Esc 退出多选
758f635 feat(multi): 批量删除 + 画廊滑动勾选
c4cf594 feat(player): 自动续播 + 音量记忆（v2.1.0 tag）
```

### 删除 / 回收站（不要改回旧逻辑）

- 用户侧只有一条删除入口：**删除（移入回收站）**
- 回收站内：**恢复** 或 **彻底删除**
- 彻底删除才：删文件 + 移除台账 + 写 `data\deleted.json`
- 普通移入回收站不会写删除记录
- 旧的「删除文件」「删除并移除台账」按钮和前端 `delFiles` 已移除
- `/api/delete` 仍保留给回收站彻底删除使用

### 抓取过滤已删除

- 抓取合并 CSV 前会检查 `data\deleted.json`
- 默认跳过；在线榜单和链接抓取弹窗都有勾选框，可取消勾选重新抓取
- 任务对象带 `skipDeleted`；`Update-Job` 按它决定是否过滤

### 扫库

- 手动「扫库」先调用 `Import-ProjectFiles`，扫描 `media`（含 `media\local`）下台账没有的 mp4
- 新条目保留原文件、不移动，普通文件 `source=local`（带来源前缀的 token 会识别来源），补时长/分辨率
- 再做常规 `Invoke-Scan`
- 接口返回 `imported`；前端 toast 显示“新入库 N”
- 自动 10 秒扫描不导入孤立文件，只有手动扫库才导入

### 表格 / 播放 / 其他

- 表格固定布局，默认总宽约 1580px，长标题两行省略
- token 列默认 140px、最大 240px，操作列 sticky 右侧冻结
- 表头右侧可拖动列宽，保存在浏览器偏好
- 下载按钮跟随筛选，只下载当前筛选中的 `status=new` 且无文件条目
- 自定义确认弹窗统一替原生 `confirm`；Esc 优先级：确认框 → 其他弹窗 → 多选
- 播放器本地续播/音量记忆在 `localStorage`；全库此前审计均为 H.264/AAC
- 多选：表格勾选、画廊滑动勾选；Esc 退出多选

## 2026-11-15 优化进展

`ce27711` + `e0799be` 完成了三批（正确性/安全 → 性能 → 边界修正），隔离项目冒烟 25/25：

- 修复：HLS 截断视频被记 done、增量抓取标题被裸 token 覆盖、`test.ps1` 端口占用不退出、
  qise Cookie 被“保存设置”清空、标题/日志/备注的存储型 XSS、脏数值让 `/api/state` 500、
  切筛选后 Shift 选择误选整个区间。
- 性能：扫描/刷新/任务收尾/失效复核只落库变化行；项目概况复用扫描索引；空闲不再枚举进程；
  缩略图编码器缓存；前端 load single-flight、队列抽屉按需渲染、KPI 与表格共用一次筛选排序。
- 清理：`console.log`/`.scrape.csv.log` 超 5MB 轮转，下载成功后清 `.dl-*` 临时文件；
  缺封面统计按 token 去重。
- 回归验证：HLS 失败不产生 `.mp4`、标题保护、脏数值容错、qise Cookie 回填/保存、
  XSS 不执行、队列 200 条完成项渲染、Shift 区间、`start.cmd` 不杀运行中实例。

### 下载失败排查（2026-11-15 13:20）

- 现象：pektino 单条下载 403（`download.json` 里 `dead http:403`），但站点内播放正常。
- 原因：`video.twimg.com` 拒绝带 `Referer: https://pektino.com/...` 的请求。实测同一 URL：
  带 pektino Referer → 403；不带 Referer（或带 `x.com`）→ 200/206。
- 修复：`Resolve-PektinoDownload` 对 `video.twimg.com` 不再发送 Referer，其它 CDN 仍保留。
  已直接用同一 URL 在临时目录实测 10 秒：状态 `downloading`、已写入 2MB+，不再 403。
- 队列：完成/失败/取消记录跨重启和新任务保留；失败项带 `history` 标记，不重复复核；
  重试同一 token 会去重并允许原地重排。控制台已用新代码重启，旧的失败项仍在队列里。

### 下一批候选（尚未做）

- `/api/refresh-url`、`/api/covers/repair`、`/api/import/local` 仍是同步长任务，主循环会被卡住：建议 job 化。
- qise/hsex 抓取失败会静默返回“成功 0 条”，需要终态非 0 校验。
- “全部”页大小会一次渲染几千行，建议分批或虚拟滚动。
- SSE 慢客户端写入最长阻塞 8 秒；`/api/state` 仍会每 2 秒携带完整下载队列 items，可做按需下发。

## 已知问题 / 风险

1. **测试与正在运行的控制台**
   - `app\dev\test.ps1 -Start` 现在遇到端口占用会直接退出（exit 2），启动后还会硬校验 `/api/state` 的项目根；
     不会再像以前那样在端口冲突时对真实项目跑 `/api/config`、`/api/download/reset` 等写操作。
   - `start.cmd` 只有带 `-Restart` 才会先停旧实例；普通双击交给 `console.ps1` 判活后直接开浏览器，
     不会中断正在进行的下载。

2. **PowerShell 文件必须是 UTF-8 BOM + CRLF**
   - 曾经因为 `console.ps1` 丢 BOM，PowerShell 5.1 按 ANSI 解析，报一堆假语法错误。
   - 修改 `.ps1` 后检查前三字节必须是 `239,187,191`。
   - 不要写入双 BOM，否则会报 `#Requires` 之类的假错误。

3. **Git push 不稳定**
   - 先直连 `git push origin main`。
   - 失败再试：
     ```powershell
     git -c http.proxy=http://127.0.0.1:7890 push origin main
     ```
   - 本地代理不一定开着；不要为了 push 改提交历史。

4. **v2.1.0 tag 不代表当前代码**
   - tag 在 `c4cf594`，最近这些删除/扫库/多选提交都在 tag 之后。
   - 如果发版，建议 `v2.1.1` 或 `v2.2.0`，不要悄悄移动已发布 tag。

5. **qise / hsex 源限制**
   - qise 的 m3u8 签名 URL 几分钟过期；HLS 不能拿 HEAD 结果提前判死，下载器已改为先刷新再下载。
   - qise `/video` 高清需要登录/VIP；免费 `/vod` 标清可用。
   - hsex HLS CDN 有时 500，属于源限制。
   - 失败排查看 `data\.dl-<token>.log*`、`.probe`、`download.json` 的 `error`。

6. **下载日志目录很脏**
   - `data` 下大量 `.dl-*` 日志是历史遗留，不影响功能；不要误删 `data.db`、`ledger.csv`、`download.json`、`deleted.json`。

## 新会话建议流程

1. 先读本文件、`README.md` 和 `git log --oneline -8`。
2. `git status -sb`，确认是否仍有未推送提交。
3. 启动 `start.cmd`，确认 `http://127.0.0.1:8791/api/state` 可访问。
4. 修改前先确认当前任务范围，不要重新引入已被合并掉的旧删除入口。
5. 改 `.ps1` 后跑解析检查；改 UI 后用浏览器实际点一遍并看 `errors`。
6. 测试使用独立端口/临时项目；跑完重启控制台。
7. 提交信息保持中文、说明行为变化；不要提交 `data`、媒体文件、日志。
8. 网络恢复后再推送。

## 验证命令

```powershell
# 语法解析
$bad=@(); Get-ChildItem app -Recurse -Filter *.ps1 | ForEach-Object {
  $e=$null;$t=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$t,[ref]$e)
  if($e.Count){$bad += "$($_.Name): $($e[0].Message)"}
}
if($bad.Count){$bad}else{'OK'}

# 冒烟测试（临时项目，独立端口；注意可能停掉当前控制台）
powershell -NoProfile -ExecutionPolicy Bypass -File app\dev\test.ps1 -Start -Port 8674
```

## 交接时状态

- 控制台当前未运行（本轮测试都在 8674/8677-8682 等临时端口 + 临时项目，跑完已清理）
- 代码在 `main`，领先远端 2 个提交（`ce27711`、`e0799be`）
- 没有进行中的下载/抓取任务需要保留
- 下一批候选见上面「2026-11-15 优化进展」，不要擅自发版或大重构
