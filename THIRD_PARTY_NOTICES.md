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
