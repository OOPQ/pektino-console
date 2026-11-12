# pektino

本地视频台账与下载管理：抓榜单 → 生成直链 → 内置下载器 / 迅雷 → 扫描回填 → 打分收藏待看抽卡。

**开盒即用**：双击 `start.cmd`，浏览器会自动打开控制台。

## 项目结构

```
pektino/                  ← 整个文件夹可随意搬移/改名
  start.cmd               ← 唯一入口
  workspace.json          ← 工作区配置（相对路径，可省略用默认值）
  README.md

  app/                    ← 程序（只读；升级时整体替换）
    console.ps1             入口：HTTP 服务、路由、任务
    server/                 传输层 / 业务动作 / 封面修复
    lib/                    SQLite 存储、台账语义、工作区、缩略图、依赖 DLL
    cli/                    抓取、入库、迅雷、下载器、定时脚本
    web/                    前端（index.html + css + ES modules）
    dev/                    冒烟测试、测试条目挑选、目录整理脚本

  data/                   ← 数据（唯一事实来源，必须备份）
    data.db  ledger.csv  config.json  logs/  exports/

  media/                  ← 内容：mp4 都在这里
  cache/                  ← 缓存：covers/ thumbs/（可随时删除，自动重建）
```

## 三条约定

| 目录 | 语义 | 能删吗 | 备份 |
|---|---|---|---|
| `app/` | 程序 | 可重新获取 | 不需要 |
| `data/` | 数据库 + 配置 + 日志 | **不能删** | **必须** |
| `media/` | 视频文件 | 删了就丢内容 | 建议 |
| `cache/` | 封面缩略图 | 随便删 | 不需要 |

- **备份/迁移 = 拷 `data/` + `media/`**
- 配置里只有相对路径；整个文件夹搬到别的盘、换台电脑都不用改任何东西
- 首次运行缺什么建什么；`media/` 里已有的 mp4 会被自动识别入库

## 要求

- Windows 10/11 + PowerShell 5.1（系统自带）
- 无需 Node / Python / 数据库服务

## 深入

- 开发与内部实现：`app/README.md`
- 冒烟测试：`app\dev\test.ps1`（服务在跑时直接执行，9 项检查）
- 整理目录：`app\dev\organize-workspace.ps1`（把散落的 mp4 收进 media\）
- 采纳已有文件夹为工作区：`app\dev\adopt-into-folder.ps1 -Target <文件夹>`
