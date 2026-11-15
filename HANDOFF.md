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

## 已知问题 / 风险

1. **控制台被测试/后台 job 终止**
   - `app\dev\test.ps1 -Start` 和旧的 stop 逻辑可能把正在运行的控制台一起停掉。
   - 跑测试前先确认能否接受中断；跑完重新 `start.cmd`。

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

- 控制台当前可能未运行（最后一个后台 job 被 DSH 杀掉）
- 代码在 `main`，领先远端 4 个提交
- 没有进行中的下载/抓取任务需要保留
- 下一步由新会话按用户新指令决定，不要擅自发版或重构
