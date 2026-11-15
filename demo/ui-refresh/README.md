# UI refresh reference

这是 2026-11-15 的静态参考稿，用来对齐 Web Awesome 风格的预览、合集编辑和下载队列。

- 不接任何业务接口，数据都是 mock
- Web Awesome 3.14 通过 CDN 加载；程序本体已把同一套组件放在 `app\web\vendor\webawesome`，不依赖 CDN
- 可以直接用任意静态服务器打开：

```powershell
python -m http.server 8731 --directory demo\ui-refresh
```

然后访问 `http://127.0.0.1:8731/`。

正式界面已经按这个方向落地；这个目录仅保留作设计对照，后续改样式时可以先在这里试。
