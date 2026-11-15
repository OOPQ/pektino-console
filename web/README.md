# pektino web

React 重做版前端。后端 API 仍由根目录 `app/console.ps1` 提供，前端独立构建。

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
pnpm build
```

产物在 `web/dist`。构建接入现有控制台静态服务前，旧 `app/web` 保留作回退。

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

## 当前切片（第一个可验收版本）

- 侧栏 / 顶栏 / 主题切换
- 7 张 KPI 卡片（真实 `/api/state`）
- 查询、状态 / 来源 / 标记筛选、分辨率 / 最短时长筛选、排序、分页、每页条数
- 表格 / 画廊双视图；统一 Card；封面 `object-fit: cover`，画廊用 `full=1` 高清封面
- 行/卡片选择、全选本页、收藏、复制链接
- 右键菜单：播放 / 详情 / 下载 / 收藏 / 加入合集 / 评分 / 标记完成 / 已看 / 复制 / 定位 / 移入回收站
- 多选浮条：下载 / 合集 / 收藏 / 已看 / 完成 / 复制 / 删除 / 清空
- 获取数据（在线榜单 / 本地视频）、链接抓取、任务进度条、取消任务
- 下载队列页：进行中 / 已完成 / 失败 / 已取消、进度、暂停/继续/取消、重试失败、清理完成、并发
- 预览弹窗：图片/视频 `object-fit: contain`、视频 autoplay 前保留封面层、上下条固定在媒体左右居中、Ctrl+←/→
- 弹层点击遮罩关闭（Radix 默认）；Esc 关闭
- 首屏 boot skeleton，主题在 `<head>` 内联脚本先定

## 下一批

- 合集
- 设置 / 回收站 / 抓取
- 构建产物接入 8791、旧 `app/web` 清理

## 约定

- 不再使用 Web Awesome；旧 `demo/ui-kit` 只作历史参考
- 所有弹层用 Radix Dialog，默认 light-dismiss
- 卡片只有 `Card` 一套；队列用横向变体
- 图标只用 Lucide，不要 emoji 当图标
- 图片/视频必须明确 `object-fit`，不得同时固定宽高造成拉伸
