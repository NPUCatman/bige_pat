# 比格桌宠

基于 [dsh-pet 0.3.7](https://github.com/PC2005-cloud/dsh-pet)，用你提供的比格 GIF 替换默认角色。动画链、屏幕漫游、点击回应、拖拽甩抛、右键动作菜单、多开、气泡和聊天等沿用上游实现。

## 启动

安装 **Node.js 22.12 或更新版本**，然后双击根目录的 **`启动比格桌宠.cmd`**。首次启动会自动安装依赖、构建并下载 Electron，之后直接启动。保持启动窗口运行；关闭桌宠可双击 **`关闭比格桌宠.cmd`**，或在启动窗口按 `Ctrl+C`。

也可在本目录运行：

```powershell
npm start
npm stop
npm run check
```

默认配置和聊天记录保存在 `.local/dsh/dsh-pet/`，不读取原 dsh-pet 的用户配置。可通过 `BIGE_PET_HOME` 指定另一个数据目录。API 密钥保存在本机数据目录，不提交到 Git。

右键桌宠可以点播动作、聊天、打开 AI 设置；系统托盘可以显示/隐藏桌宠。在本机 AI 设置中填写接口地址、模型及 API Key 并开启后，对话和碎碎念才会发送模型请求。可接兼容 OpenAI 的本机或远程接口；不配置 AI 也能正常使用桌宠动作。

## 功能范围

| 功能 | 独立启动 | 作为 DSH 插件 |
| --- | --- | --- |
| 比格动画、点击、拖拽甩抛、移动、菜单、多开 | 支持 | 支持 |
| 聊天、碎碎念、聊天配图 | 配置本机 AI 设置后支持 | 使用 DSH 模型/凭据 |
| 余额与额度展示 | 上游独立模式不提供 | 保留，按服务商接口支持情况显示 |
| DSH 会话工作状态、DSH 系统通知 | 需要 DSH 会话环境 | 保留 |

需要 DSH 完整联动时，在 **`dsh-pet/`** 内 `npm install`、`npm run build`，然后在 DSH 的插件管理中安装本地目录，或使用：

```powershell
dsh plugin --profile web add file:D:/pc_pat/bige_pat/dsh-pet
```

如果之前已经安装原版，旧的 `main-config.jsonc` 会覆盖包内默认动画。请先备份旧配置，再在 DSH「桌宠配置」页用「同步」恢复本包的比格默认配置。内部插件名、HTTP 路由和 `@deepseek-ai/*` 依赖保留，因此原版与本版按替换使用。

## 素材和修改

仅使用你提供的大眼漫画比格，原始素材保留在 `gif/`。运行时使用 `dsh-pet/assets/webm/` 下的透明 VP9 视频；直接把 GIF 放入播放目录不会生效。素材转换保持透明背景、帧时长和比例，并统一至 640×360、脚底 y=330，适配上游命中区。短于 1 秒的 GIF 重复完整周期，避免动画切换过快。

![比格桌宠实际渲染](docs/desktop-preview.png)

```powershell
# 仅重新生成素材时需要 Python + Pillow 和 ffmpeg
python -m pip install Pillow
npm run assets
```

修改默认角色/动作映射：`dsh-pet/assets/config.jsonc`。当前是 **8 段不同的角色动画、34 个按用途区分的动画名**，多个事件会复用合适的比格表情；事件入口和状态逻辑保留。独立文件名用于避免上游按名称识别事件时打断随机动作链。完整来源、哈希和转换参数在 `dsh-pet/assets/bige-manifest.json`。

`dsh-pet/src/`、`runtime/` 和 `scripts/` 均为普通源码，可继续本地修改。上游详细功能说明见 `docs/upstream-README.md`，版权与素材来源见 `THIRD_PARTY_NOTICES.md`，验证记录见 `docs/VALIDATION.md`。
