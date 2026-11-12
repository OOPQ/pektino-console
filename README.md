# pektino

本地视频台账与下载管理：抓榜单 → 生成直链 → 内置下载器 / 迅雷 → 扫描回填 → 打分收藏待看抽卡。

**IDE 模型**：程序和数据是两个东西。
程序（`app\`）只读、可随时删除或升级；数据在你的**项目文件夹**里，可搬家、备份、放移动硬盘。

## 启动

```
双击 start.cmd
```

- 第一次：让你选/新建一个项目文件夹（像 IDE 的欢迎页）
- 之后：自动打开上次的项目
- 想换项目：`start.cmd -Project D:\my-project` 或 `start.cmd -Pick`

## 两个目录

```
程序（可替换/升级，不含任何数据）
  <安装位置>\
    start.cmd
    app\              console.ps1 · server\ · lib\ · cli\ · web\ · dev\

项目（你的数据，可随意搬移/备份）
  <项目文件夹>\
    project.json      项目标识
    data\             data.db · config.json · ledger.csv · logs\ · exports\
    media\            mp4 都在这里
    cache\covers\     封面（可删，自动重建）
    cache\thumbs\     缩略图（可删，自动重建）
```

对照 IDE：程序目录 ≈ IDEA 安装目录，项目文件夹 ≈ 你的代码项目，
`data\` ≈ 项目里的 `.idea\`。**IDEA 不会跟着项目走，这个程序也不会。**

## 三条规则

| 目录 | 语义 | 能删吗 | 备份 |
|---|---|---|---|
| `app\` | 程序 | 可重新获取 | 不需要 |
| 项目 `data\` | 数据库 + 配置 + 日志 | **不能删** | **必须** |
| 项目 `media\` | 媒体文件 | 删了就丢内容 | 建议 |
| 项目 `cache\` | 封面/缩略图 | 随便删 | 不需要 |

- **备份/迁移项目 = 拷整个项目文件夹**
- 项目根目录**不在界面里修改**；换项目 = 启动时选择（最近项目存 `%APPDATA%\pektino\projects.json`）
- 程序中不存在绝对路径硬编码，项目文件夹搬到哪都能打开

## 要求

- Windows 10/11 + PowerShell 5.1（系统自带），无需 Node / Python / 数据库服务

## 深入

- 内部实现与运维：`app\README.md`
- 冒烟测试：`app\dev\test.ps1`
- 整理媒体目录：`app\dev\organize-workspace.ps1`