# 上游与素材来源

本地比格桌宠基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。

- 上游版本：0.3.7。
- 导入提交：`cf3ed3c4dd6829b252f352d4c61a18db6fdb26d4`。
- 上游代码使用 MIT License，原版权与许可保留于根目录 `LICENSE` 和 `dsh-pet/LICENSE`。
- `dsh-pet/` 是普通源码副本，可在本项目内独立修改。
- 本地修改：替换默认角色、人设、动画池、聊天配图、通知/托盘图标，增加素材转换工具和本地启动入口。内部协议、路由和插件名称保留以兼容 DSH。
- `gif/` 内八个 GIF 为用户提供的素材；原文件保持不变。该目录及由其转换的素材不因本项目的 MIT 代码许可而获得新的第三方授权，作者和来源待补充。
- `docs/upstream-README.md` 保留上游完整说明。上游原角色的播放视频、预览图和表情包未导入。

素材转换来源和参数见 `dsh-pet/assets/bige-manifest.json`。

## Windows 便携包运行时与依赖

便携包使用 [Electron](https://www.electronjs.org/) 提供的 Windows x64 运行时，包含 Chromium、Node.js 及其第三方组件。Electron 官方运行时原有的 `LICENSE` 和 `LICENSES.chromium.html` 随包保留，具体组件的版权和许可见这些文件。便携包顶层的 `LICENSE` 属于 Electron 运行时；dsh-pet 的 MIT 许可另保留为 `LICENSE.dsh-pet.txt`，后端源码副本中也保留 `resources/app/backend/LICENSE`。

后端生产依赖包含 OpenAI SDK、Anthropic SDK、Zod、Electron 下载与解压工具及其传递依赖。打包时从锁定清单独立安装生产依赖，并保留 `resources/app/backend/node_modules/` 中各依赖自带的许可、版权和说明文件；这些依赖各自适用其原有许可，不统一改为本项目的 MIT 许可。具体依赖版本见包内各 `package.json`，文件清单和哈希见包内 `package-manifest.json`。

便携启动器和打包脚本为本地新增代码，不改变上游代码及漫画素材的权利归属。分发 ZIP 不包含开发者的用户配置、API Key、聊天记录或 Chromium 个人数据。
