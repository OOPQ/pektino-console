# pektino 控制台

一个跑在本机的视频台账 / 下载管理面板：抓取榜单 → 生成 mp4 直链 → 投递迅雷 →
扫描下载目录自动回填状态 → 打分 / 收藏 / 待看 / 抽卡。

纯 PowerShell 5.1 + 原生 HTML/CSS/JS，无 Node、无 Python、无第三方服务；数据落在本地 SQLite。

## 快速开始

```powershell
tools\启动控制台.cmd
# 浏览器会自动打开 http://127.0.0.1:8791/
```

## 目录

```
tools\
  启动控制台.cmd   双击启动（= powershell -File console.ps1）
  console.ps1     入口：参数、存储初始化、HTTP 循环、路由表
  web\            前端与传输/业务层
    index.html      页面结构
    app.css         样式
    app.js          前端逻辑（过滤/排序/分页/灯箱/抽卡/SSE）
    transport.ps1   HTTP 传输：响应、请求解析、SSE 推送
    actions.ps1     业务动作：统计、扫描、任务、收藏/评分/观看、播放、删除、投递
  store.ps1       SQLite 存储层（WAL、事务 upsert、每日备份）
  ledger.ps1      台账语义：合并去重、状态机、配置、目录扫描
  pektino.ps1     榜单抓取（多页 / 并发 / 增量）
  import.ps1      本地文件反向入库（文件名 → token → 详情页查证）
  thumbs.ps1      封面缩略图（120px）
  thunder.ps1     批量投递迅雷（thunder://）
  daily.ps1       一键：日榜前 N 页 → CSV → 可选整批投递
  lib\            System.Data.SQLite（托管 + x64 interop）
  out\            运行时数据（不入库）：data.db、封面、缩略图、日志
```

## 已知限制

- 仅 Windows（`System.Drawing`、回收站删除、WMP/关联播放器）
- 站点结构变更会导致抓取失败（会显式报错，不静默）
- 服务只监听 `127.0.0.1`，但**任意本机网页仍可向该端口发 POST**，公网机器不要暴露

更多细节见 [tools/README.md](tools/README.md)。
