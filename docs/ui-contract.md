# UI 改造契约（React 重做版）

日期：2026-11-15  
分支：`web-redo`  
目标：彻底重做前端，不在旧 `app/web` 的 DOM/CSS 上继续修补。

## 技术决定

- Vite + React 19 + TypeScript
- Tailwind CSS 4
- Radix UI primitives（Dialog / Drawer / Select / Tabs / Tooltip / Popover / Checkbox / Switch）
- Lucide React 图标，不使用 emoji 当图标
- TanStack Query 管 API；Zustand 管 UI 状态
- 现有 Python API 不改；开发时 Vite 代理 `/api` 到 8791
- 旧前端保留作回退；新前端构建通过后接管静态服务

## 单一来源

### Tokens

在 `web/src/index.css` 定义，只允许从这里取：

- 背景：`--background` / `--surface` / `--surface-2` / `--surface-3`
- 边框：`--border` / `--border-strong`
- 文字：`--foreground` / `--muted` / `--subtle`
- 主色：`--primary`；成功/警告/危险：`--success` / `--warning` / `--danger`
- 圆角：控件 9px，卡片 14px，浮层 18px
- 控件高度：34px；紧凑 28px
- 字体：系统 Inter / Segoe UI / 微软雅黑

### 组件

- `Button`：default / outline / ghost / danger；sm / md / lg / icon
- `IconButton`：34×34（sm 28，lg 46），边框、hover、focus、tooltip、`aria-label`
- `Input` / `Select` / `Checkbox` / `Switch`：Radix + Tailwind
- `Card`：唯一卡片壳；画廊/合集用竖卡，队列用 `.is-row` 横向变体
- `Dialog` / `Drawer`：Radix Dialog；默认点击遮罩关闭、Esc 关闭
- `Tabs`：Radix Tabs
- `Progress`：统一进度条
- `Badge`：ok / new / live / bad / muted
- `Tooltip`：图标按钮必须有
- `Skeleton`：加载占位，保持尺寸稳定

### 媒体

- 画廊/合集封面：3:4 固定框，`object-fit: cover`
- 表格缩略图：40×54，`object-fit: cover`
- 预览图片/视频：`object-fit: contain`，`max-width/height:100%`，不固定宽高
- 无文件显示占位，不拉伸

### 交互

- 所有 Dialog/Drawer 点击遮罩关闭；Esc 关闭
- 确认框点击遮罩视为取消，不执行危险操作
- 图标按钮必须有容器、hover/focus、tooltip、aria-label
- 键盘：Esc、方向键、Enter、空格保持

### 首屏稳定

- 主题在 `<head>` 内联脚本先定
- `#root` 内置 boot skeleton，侧栏宽度、顶栏高度、KPI/表格占位与真实布局一致
- 数据加载用同尺寸 skeleton；不使用会撑开布局的 spinner 容器
- 主题、侧栏宽度、预览开关不导致页面宽度变化

## 验收

- 用户手动测试，边改边验收
- 每个切片只改一个屏幕范围
- 一屏内只允许一套 Card、一套按钮、一套图标
- 弹层遮罩可关闭；媒体不拉伸；刷新无明显布局跳动
- 明暗主题逐屏对齐

## 切片顺序

1. **骨架 + 台账 + 预览**（当前）
2. 下载队列 Drawer
3. 合集
4. 设置 / 回收站 / 抓取
5. 构建接入 + 旧前端清理
