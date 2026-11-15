# UI 改造契约（v1）

日期：2026-11-15
分支：`ui-refactor`
参考稿：`demo/ui-refresh` + `demo/ui-kit`

## 决策

- 保持**无构建**：原生 HTML/CSS/ES Module，Web Awesome 3.14 本地化在 `app\web\vendor\webawesome`
- 视觉方向：demo 的暗色组件质感 + 当前控制台的信息密度
- 图标：Lucide，本地 SVG sprite（ISC），不使用 emoji 当图标
- 布局：表格为主；画廊/合集/队列使用统一 card
- 当前 main 上的 WIP 保留，在 `ui-refactor` 分支继续
- 验收方式：用户手动测试，边改边验收；每批只改一个屏幕范围

## 单一来源

### Design tokens

只允许从 `ui-kit` / `app.css` 的 token 取值，不在组件里写新的硬编码色值：

- 背景：`--ui-bg` / `--ui-panel` / `--ui-panel-2` / `--ui-panel-3`
- 边框：`--ui-line` / `--ui-line-strong`
- 文字：`--ui-text` / `--ui-dim` / `--ui-faint`
- 主色：`--ui-accent`；成功/警告/危险：`--ui-good` / `--ui-warn` / `--ui-bad`
- 圆角：控件 `9px`，卡片 `14px`，浮层 `18px`
- 间距：4 / 8 / 12 / 16 / 24
- 字号：11 / 12 / 13 / 14 / 18 / 28
- 控件高度：34px（默认），28px（紧凑表格/队列）

### 组件

- **Button**：`wa-button`，`brand` / `outlined` / `plain` / `danger` 四种语义
- **IconButton**：必须使用 `.ui-icon-btn`，34×34、边框、hover、focus、`title` + `aria-label`；不能只放一个没有容器的字符
- **Input / Select / Checkbox**：只用 `wa-input` / `wa-select` / `wa-checkbox`
- **Card**：只有一个 `.ui-card` 组件（媒体/主体/底部插槽）；画廊、合集、队列都复用它
- **Dialog / Drawer**：只用 `wa-dialog` / `wa-drawer`，统一 header/footer
- **Tabs**：`wa-tab-group`
- **Progress / Badge**：`wa-progress-bar` / `wa-badge`
- **Toast**：统一 `.ui-toast`
- **Empty**：统一 `.ui-empty`

### 媒体

- 卡片封面：固定宽高比（画廊 3:4，合集 3:4，队列 56×72），`object-fit: cover`
- 预览图片/视频：`object-fit: contain`，`max-width:100%`，`max-height:70vh`，**不设固定宽高**
- 任何图片/视频不得同时设置固定宽高造成拉伸
- 没有媒体时显示 `.ui-media-empty` 占位，不用拉伸的图片

### 交互

- 所有 dialog / drawer：`light-dismiss`，点击遮罩关闭；Esc 关闭
- 确认框：点击遮罩等同取消；危险操作不自动执行
- 图标按钮：容器、hover、focus、tooltip、aria-label 缺一不可
- 键盘操作保持：Esc、方向键、Enter、空格
- 焦点圈定由 WA 组件负责；不再手写第二套

### 刷新稳定

- 主题 class 在 `<head>` 内联脚本先定
- 侧栏宽度、顶栏高度、表格容器在首屏前有稳定占位
- WA 组件升级前不显示未升级的裸控件（`wa-*` 默认隐藏，`defined` 后显示）
- 字体、图标 sprite 预加载；避免首屏后插入大块 DOM
- 不因 dialog 开关导致页面宽度变化（滚动条补偿）

## 验收清单

- [ ] 每个屏幕只有一种 card、一种按钮体系、一套图标
- [ ] 所有弹层点击遮罩可关闭，Esc 可关闭
- [ ] 视频/图片无拉伸，封面裁切、预览留边
- [ ] 图标按钮有明显容器和 tooltip
- [ ] 刷新无可见布局跳动
- [ ] 明暗主题逐页一致
- [ ] 无原生 input/select/checkbox
- [ ] 用户手动测试通过后再迁移下一屏

## 迁移顺序

1. `ui-kit` 静态规范（本批）
2. 预览/抽卡
3. 下载队列
4. 合集浏览/编辑/选择
5. 设置/回收站/抓取
6. 主表格/工具栏/分页
7. 清理旧 CSS、拆分模块
