# 比格桌宠

基于 [dsh-pet 0.3.7](https://github.com/PC2005-cloud/dsh-pet)，用你提供的比格 GIF 替换默认角色。动画链、屏幕漫游、点击回应、拖拽甩抛、右键动作菜单、多开、气泡和聊天等沿用上游实现。

## Windows 便携版

将 **`dist/比格桌宠-0.1.0-win-x64.zip`** 发给使用者，完整解压后，双击文件夹中的 **`比格桌宠.exe`** 即可运行。适用于 Windows 10/11 x64，**无需安装 Node.js、npm 或 Python，也无需管理员权限**。请保留 EXE 旁的文件和目录，不能只移动或发送单独一个 EXE，也不要直接在压缩包里运行。

桌宠支持拖拽，右键可以点播动作、聊天和打开 AI 设置。右下角系统托盘的比格图标可能收在“隐藏的图标”中：右键启动器图标，可选择“显示 / 恢复比格”“打开 AI 设置”“打开数据目录”“打开日志目录”或“退出比格桌宠”。再次双击 EXE 会恢复已有实例。

便携版的个人配置、聊天记录、API Key 和 Chromium 数据保存在 **`%APPDATA%\BigePet`**；程序目录不保存这些个人数据，移动或更新程序后仍可沿用。`BIGE_PET_HOME` 可覆盖便携版的整个数据根目录，建议使用绝对路径；其中 `dsh/dsh-pet/` 保存配置和聊天数据，`logs/desktop.log` 保存启动日志。分发包不附带制作者的个人配置、密钥或聊天记录。

## 从源码启动

安装 **Node.js 22.12 或更新版本**，然后双击根目录的 **`启动比格桌宠.cmd`**。首次启动会自动安装依赖、构建并下载 Electron，之后直接启动。保持启动窗口运行；关闭桌宠可双击 **`关闭比格桌宠.cmd`**，或在启动窗口按 `Ctrl+C`。

也可在本目录运行：

```powershell
npm start
npm stop
npm run check
```

源码启动时，默认配置和聊天记录保存在 `.local/dsh/dsh-pet/`，不读取原 dsh-pet 的用户配置。`BIGE_PET_HOME` 指定的是源码启动器的 DSH 数据目录，相对路径按本项目根目录解析；配置和聊天数据位于其下的 `dsh-pet/`。这与便携版覆盖整个数据根目录的语义不同。API 密钥保存在本机数据目录，不提交到 Git。

右键桌宠可以点播动作、聊天、打开 AI 设置；系统托盘可以显示/隐藏桌宠。在本机 AI 设置中填写接口地址、模型及 API Key 并开启后，对话和碎碎念才会发送模型请求。可接兼容 OpenAI 的本机或远程接口；不配置 AI 也能正常使用桌宠动作。

## 启动原版 DeepSeek 桌宠

保留相邻的原版目录 `../dsh-pet/dsh-pet/`，双击 **`启动原版DeepSeek桌宠.cmd`**。首次运行会安装原版依赖并构建，之后直接启动原版角色；优先复用本项目已经下载的 Electron。运行期间保留启动窗口。关闭时双击 **`关闭原版DeepSeek桌宠.cmd`**，或在启动窗口按 `Ctrl+C`。

这两个 CMD 也可放在两个项目共同的父目录，或放在原版仓库根目录。原版配置和聊天记录独立保存在本项目 `.local/original-deepseek/dsh/dsh-pet/`，可用 `DEEPSEEK_PET_HOME` 指定其他 DSH 数据目录；不读取比格版的配置。运行 `node scripts/start-bige.mjs --original-deepseek --check` 可检查原版环境。

## 构建便携包

在 Windows x64 上安装 Node.js 22.12 或更新版本，在项目根目录依次运行：

```powershell
npm ci
npm --prefix dsh-pet ci
npm run package:win
node scripts/test-win-package.mjs
```

构建会生成 `dist/比格桌宠-0.1.0-win-x64/`、对应 ZIP 和 `.sha256` 校验文件。首次构建需要联网安装依赖并取得 Electron；重新打包现有素材不需要 Python。测试脚本会将 ZIP 解压到含中文和空格的独立目录，在运行环境中移除 Node/npm 的 PATH，检查 EXE 冷启动、设置页、单实例、退出和再次启动；实际结果见 `docs/VALIDATION.md`。输出目录已存在时，先移走旧包，或用 `npm run package:win -- --name 新包名称` 指定其他名称。

## 功能范围

| 功能                                       | 独立启动               | 作为 DSH 插件                  |
| ------------------------------------------ | ---------------------- | ------------------------------ |
| 比格动画、点击、拖拽甩抛、移动、菜单、多开 | 支持                   | 支持                           |
| 聊天、碎碎念、聊天配图                     | 配置本机 AI 设置后支持 | 使用 DSH 模型/凭据             |
| 余额与额度展示                             | 上游独立模式不提供     | 保留，按服务商接口支持情况显示 |
| DSH 会话工作状态、DSH 系统通知             | 需要 DSH 会话环境      | 保留                           |

本次更新的交互规则：每 60 秒自动随机切换表情；撞到屏幕边缘或地面时切换为“呆滞”，停稳后随机恢复为其他表情。对应行为的测试结果单独记录在 `docs/VALIDATION.md`。

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
