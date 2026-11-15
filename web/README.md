# pektino web

v3.0.0 正式前端。后端 API 由根目录 `app/console.ps1` 提供，构建产物随发布包提供。

## 技术栈

- Vite 8 + React 19 + TypeScript
- Tailwind CSS 4
- Radix UI primitives（Dialog / Drawer / Select / Tabs / Tooltip / Popover / Checkbox / Switch）
- Lucide React 图标
- TanStack Query（API 缓存 / 轮询）
- Zustand（侧栏、视图、主题、选择、预览状态）

## 开发

```powershell
cd web
pnpm install
pnpm dev
```

- 开发地址：`http://127.0.0.1:5173/`
- `/api` 由 Vite 代理到 `http://127.0.0.1:8791`
- 封面走 `/api/cover`；视频走 `state.media.base` 指向的 8831 媒体服务

## 构建

```powershell
pnpm build       # 普通构建，base=/
pnpm build:new   # 旧 /new/ 预览构建；正式发布用 pnpm build
```

构建产物在 `web/dist`，`app/console.ps1` 直接从根路径 `http://127.0.0.1:8791/` 服务；旧 `/new/` 已重定向到根路径，`app/web` 仅作备份。

## 目录

```
src/
  components/
    ui/               # Button / Dialog / Drawer / Select / Checkbox / Tabs / Tooltip ...
    app-shell.tsx     # 侧栏 + 顶栏 + 路由出口
    cover-image.tsx   # 固定比例、object-fit、加载失败占位
    stat-card.tsx
    status-badge.tsx
  features/
    library/          # 台账：筛选 / 表格 / 画廊 / 预览
    use-app-state.ts  # /api/state 查询与收藏 mutation
  lib/                # api / utils
  store/ui.ts         # 全局 UI 状态
  types.ts            # API 类型
```

## v3.0.0 功能

- 侧栏 / 顶栏 / 主题切换
- 7 张 KPI 卡片（真实 `/api/state`）
- 查询、状态 / 来源 / 标记筛选、分辨率 / 最短时长筛选、排序、分页、每页条数
- 表格 / 画廊双视图；表格行更高，直接评分，评分/入库可排序；合集复用画廊卡片并支持多选/右键移出；亮暗主题用统一分段按钮；已收藏统一红色
- 卡片默认宽松、更大；设置里可切紧凑/标准/宽松；下载/定位和收藏在卡片底部，时长放大；外链只在右键「打开原网页」
- 多选模式：默认不显示勾选框，点「多选」后才显示；行/卡片选择、全选本页
- 卡片支持直接点收藏、点星星评分；点封面直接进浮层播放；已下载显示绿勾定位，未下载显示下载；外链替代复制
- 浮层加高；自定义单进度条整合播放进度与快照节点，进度条 16px 命中区、节点吸附、悬停时间和缩略图；全屏时控制条/时间轴一起进入全屏；「时间轴」弹窗按时间竖向串联，可跳转/删除/设为封面
- 快捷键：空格播放/暂停、长按自定义倍速、←→ 5s、↑↓ 音量、F 全屏/退出全屏、M 静音、1-5 评分；媒体库 R 连续随机抽卡；快捷键操作后不聚焦浮窗/控件
- 右键菜单：播放 / 详情 / 下载 / 收藏 / 加入合集 / 评分 / 标记完成 / 已看 / 复制 / 定位 / 移入回收站
- 多选浮条：下载 / 合集 / 收藏 / 已看 / 完成 / 复制 / 删除 / 清空
- 获取数据（在线榜单 / 本地视频）、链接抓取、任务进度条、取消任务
- 下载队列页：进行中 / 已完成 / 失败 / 已取消、按日期分组展开/收起、进度、暂停/继续/取消、重试失败、清理完成、并发
- 合集页：合集 tab、卡片墙、新建、改名/改色、删除、移出条目、批量移出、在台账中查看
- 设置页：项目路径、代理/Cookie/FFmpeg/并发、卡片密度、长按倍速、扫描/导入、封面修复、.part/下载占用、指标与日志
- 回收站：按 recycled_at 日期分组，默认收起；「移入回收站」只改状态、不删文件，台账默认排除 recycled；彻底删除才删文件；恢复/清空/搜索
- 预览弹窗：图片/视频 `object-fit: contain`、视频 autoplay 前保留封面层、上下条固定在媒体左右居中、Ctrl+←/→
- 弹层点击遮罩关闭（Radix 默认）；Esc 关闭
- 首屏 boot skeleton，主题在 `<head>` 内联脚本先定

## 已接入

- 生产根路径 `http://127.0.0.1:8791/`，`/new/` 重定向
- 快照异步队列、命令面板、URL 筛选、保存视图、时间轴聚合
- 长按加速提示、续播/倍速/PiP
- 抓取诊断文件与全榜单冒烟测试

## 约定

- 不再使用 Web Awesome；旧 `demo/ui-kit` 只作历史参考
- 所有弹层用 Radix Dialog，默认 light-dismiss
- 卡片只有 `Card` 一套；队列用横向变体
- 图标只用 Lucide，不要 emoji 当图标
- 图片/视频必须明确 `object-fit`，不得同时固定宽高造成拉伸
