# 发版与版本维护

## 分支模型

```
main                日常开发，允许大改 / 重构
release/2.1         2.1 维护线，冻结在 v2.1.0，只接受修复
release/2.0         2.0 维护线，冻结在 v2.0.0，只接受修复
release/1.0         1.0 维护线，冻结在 v1.0.0，只接受修复
tag v2.1.0          当前发布点
tag v2.0.0          2.0 发布点
tag v1.0.0          1.0 发布点
tag v1.0.1          1.0 维护线的补丁版本
```

- `main` 不直接发布；发布从 tag 出包
- `release/1.0` 在 `v1.0.0` 时创建，不在上面做功能开发
- 需要新功能时只改 `main`；1.0 只修 bug

## 版本号

采用 SemVer：

| 变化 | 版本 |
|---|---|
| 修 bug、兼容性修复 | `v1.0.1` |
| 兼容的新功能 | `v1.1.0` |
| 破坏性改动 / 重构 / 数据不兼容 | `v2.0.0` |

版本号写在根目录 `VERSION`，并在 `CHANGELOG.md` 顶部加一节。

## 日常发布流程

1. 确认 `main` 干净、测试通过：
   ```powershell
   cd app
   powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\test.ps1 -Start -Port 8720
   ```
2. 更新 `VERSION` 和 `CHANGELOG.md`
3. 提交：
   ```powershell
   git add -A
   git commit -m "chore(release): v1.1.0"
   ```
4. 打 annotated tag：
   ```powershell
   git tag -a v1.1.0 -m "pektino v1.1.0"
   git push origin main
   git push origin v1.1.0
   ```
5. 从 tag 打包（不包含 `data/`、`media/`、`cache/`、`.git`）：
   ```powershell
   git archive --format=zip --prefix=pektino-console-v1.1.0/ `
     -o dist\pektino-console-v1.1.0.zip v1.1.0
   ```
6. 生成校验和并解压验证：
   ```powershell
   (Get-FileHash dist\pektino-console-v1.1.0.zip -Algorithm SHA256).Hash
   ```
   解压后跑一次 `app\dev\test.ps1`，确认 25 个用例通过。
7. 建 GitHub Release：
   - 打开 `https://github.com/OOPQ/pektino-console/releases/new?tag=v1.1.0`
   - 标题填版本号，说明贴 `CHANGELOG.md` 对应章节
   - 上传 zip 和 `.sha256`

## 1.0 维护线 hotfix 流程

原则：**优先在 main 修，再 cherry-pick 回 release 分支**，避免两边分叉。

1. 在 `main` 修复并提交
2. 切到维护线：
   ```powershell
   git switch release/1.0
   git cherry-pick <main 上的提交>
   ```
3. 更新 `VERSION`（如 `1.0.1`）和 `CHANGELOG.md`
4. 提交、打 tag、推送：
   ```powershell
   git commit -am "chore(release): v1.0.1"
   git tag -a v1.0.1 -m "pektino v1.0.1"
   git push origin release/1.0
   git push origin v1.0.1
   ```
5. 从 `v1.0.1` 出包，步骤同上

如果修复只对 1.0 有意义（例如临时兼容），也可以直接在 `release/1.0` 修，再 cherry-pick 回 `main`。

## 数据库兼容

- 1.x 内的 schema 变化只允许**加表 / 加列**，不改已有列语义
- 2.0 如果必须破坏兼容：
  - 使用新的数据库文件，或
  - 在启动时做显式迁移并备份原库
- 老版本打开新库不在支持范围内；发布说明里写清楚

## 发版检查清单

- [ ] `dev\test.ps1` 25/25 通过
- [ ] `VERSION` 已更新
- [ ] `CHANGELOG.md` 已更新
- [ ] `main` 与 tag 已推送
- [ ] zip 已生成、解压后可启动
- [ ] sha256 已生成
- [ ] GitHub Release 已创建并上传附件
- [ ] 老数据目录不受影响（`data/`、`media/` 不入包）
