# 本次验证记录

日期：2026-10-20。

默认角色只使用 `gif/` 中用户提供的八个漫画比格 GIF。原始 GIF 未修改；上游 `D:/pc_pat/dsh-pet` 源仓库无修改。

## 素材

- 八段不同动画，34 个用途独立的播放名称；事件、转向、移动、拖拽和点击名称隔离，保留上游按名称判断动画行为的规则。
- 逐视频验证 640×360、VP9、透明通道、输出时长、帧数；强制 libvpx 解码验证透明形状与边界。
- 原始 GIF、转换文件、静态配图和图标均记录 SHA256。脚本 `scripts/build_bige_assets.py` 可重建。
- 额外使用真实 Electron/Chromium 解码全部 34 个名称，在画布逐像素确认非空角色、有色像素和透明背景。所有视频均通过，渲染无错误提示。
- 真实 Electron 窗口已验证角色加载、右键动作菜单；截图见 `desktop-preview.png`。透明视频没有白底或黑色矩形。
- `呆滞.gif` 原图为 86×86；放大后的低清晰度来自原素材。

## 程序

- 完整构建：`npm run build` 通过，包括宿主、浏览器、独立入口、桌面共享核心和类型声明。
- TypeScript、ESLint、Prettier 检查通过。
- 现有 Node 测试：919 通过、0 失败、1 跳过。
- `scripts/prepack-check.js` 素材/入口健康检查和 OpenAPI 路由检查通过。
- 根目录 `npm run check`、`npm start`、重复启动拒绝、`npm stop` 实际运行通过；正常退出后运行状态与启动锁清理完成。
- 原子启动锁做过八进程竞争、陈旧锁恢复、旧锁释放不误删新所有者验证。
- 相对 `BIGE_PET_HOME` 按项目根目录解析；配置、记忆、密钥、Electron profile、DPI 缓存均隔离到项目数据目录。该目录被 Git 忽略。

## Windows 便携包

本节记录本轮 Windows x64 便携包验证。

### 构成与隔离

- 目标包：`dist/比格桌宠-0.1.0-win-x64.zip`；完整解压后的入口为 `比格桌宠.exe`，目标平台为 Windows 10/11 x64。
- 包内包含 Electron 运行时、`desktop/` 启动器、已构建的桌宠代码、漫画比格素材以及独立安装的生产依赖；使用者无需 Node.js、npm 或 Python。EXE 使用 `asInvoker`，不申请管理员权限。
- 打包按白名单复制应用文件，生产依赖通过 `npm ci --omit=dev --omit=peer --ignore-scripts` 安装；不复制开发目录 `.local/`、Git、个人配置、聊天记录、API Key 或运行 token。打包清单逐文件记录大小与 SHA256，并另生成 ZIP 的 SHA256 文件。
- 便携版默认数据根目录为 `%APPDATA%\BigePet`，`BIGE_PET_HOME` 可覆盖；DSH 数据、Chromium profile 和日志均在包外。源码启动器仍默认使用项目内 `.local/dsh`，其相对 `BIGE_PET_HOME` 按项目根目录解析。
- 启动器在获取单实例锁前识别自家 helper 与 DPI 探测入口；后端使用内置 Node 模式，helper 使用正常 Electron 模式。后端与启动器通过 IPC、父 PID 和心跳关联存活状态。
- 托盘退出优先携带本次本机能力 token 请求后端 `/shutdown`，等待收尾，超时再结束本次后端；设置 URL 和 token 不写入启动器诊断状态文件。
- 分发包保留 Electron `LICENSE`、`LICENSES.chromium.html`、dsh-pet 的 MIT 许可和生产依赖各自的许可文件。

### 实际验证

- 构建命令：根目录 `npm ci`、`npm --prefix dsh-pet ci`、`npm run package:win`。
- 自动验证入口：`node scripts/test-win-package.mjs`；脚本将 ZIP 解压到新的中文/空格路径，并用独立数据目录运行，不读取制作者配置。
- 将实际 ZIP 解压到新的中文和空格路径，子进程 PATH 仅保留 Windows System32；确认 node/npm 均无法执行，EXE 仍可冷启动。
- 验证本机服务健康状态、AI 设置页、AI 默认关闭、重复启动不增加后端实例、再次双击恢复、正常退出、服务端口关闭和再次启动。等待窗口捕获出现有色像素后保存截图，确认漫画角色实际出画；退出后检查无本次 EXE 进程残留。
- 检查实际 ZIP：34 个透明 WebM，完整 Electron 运行时，无 `.local`、Git、个人配置、聊天记录或运行 token 文件；生产依赖独立安装。
- 源码视频检查重新通过：34 个名称均由真实 Electron 解码，逐帧抽样有色像素与透明背景，配置和菜单正常。
- 最终全量 Node 测试 931 通过、0 失败、1 跳过，日志为 `.local/final-tests.log`；类型、ESLint、Prettier、构建、素材入口与 OpenAPI 检查通过。专项测试使用实际渲染类和物理计算，覆盖 60 秒边界、连续碰撞不重载、物理停稳恢复、拖拽/菜单接管。
- 真实打包 EXE 的 helper 验证：短片重复播放 3.3 秒不换表情；仅将 renderer 的时钟推进 60001ms 后，250ms 轮询触发换图；实际抛掷撞右墙时播放“呆滞”，连续反弹只加载一次，物理停稳后换成另一个非呆滞素材。帧抽样 640×360，有色像素 10498、完全透明像素 212697。
- 动画集成脚本及结果：`.local/verify-animation-electron.cjs`、`.local/animation-electron-validation/`；该专项通过开发 mock 提供配置和素材，正式后端的自包含启动由 ZIP 测试单独验证。未实等 60 秒，时间边界由可控时钟和真实 renderer 验证。
- 每分钟按原权重保留随机转向和漫游，期间继续循环同一表情；固定宠物不自主移动。真实 Electron 验证朝向翻转和水平位移，位移前后及短片再次循环后素材名称保持一致。
- 最终包：`dist/比格桌宠-0.1.0-win-x64.zip`，180013339 字节（171.7 MiB）、9315 个文件；SHA256：`c93ff9b426b053a6350e3becf05422bcc3290a5842f0b3e963e3816a0a34598b`。ZIP 校验文件位于相邻 `.zip.sha256`；完整解压后的 EXE 与所需 DLL/素材目录同时保留。

## 验证边界

未使用真实 API Key 调用付费模型，也没有在 DSH 宿主里运行真实会话。聊天/碎碎念沿用上游实现，需用户配置模型；余额、会话工作状态、DSH 系统通知仍需 DSH 宿主。相关入口和状态档位保留，不能把独立模式的测试当作完整 DSH 联动的实测证明。
