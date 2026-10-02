# 完整客户端打包结果

通信模块版本：`2026-09-10.reliable-mqtt`。Windows x64，PyInstaller onedir。

产物：`E:\project\aion2\build\aion2-client-20260910.zip`，29,175,577 字节（约 27.8 MiB），包含 538 个文件。

解压后运行 `aion2-client/aion2-client.exe`，保留旁边的 `_internal`。项目内也已放置可直接运行的 `E:\project\aion2\build\aion2-client\aion2-client.exe`。

使用 Python 3.12.14、PyInstaller 6.22.2、mitmproxy 11.0.2、Paho MQTT 2.1.0 构建，包含 SQLite 原生库及 Windows redirector 组件。完整依赖版本见 [构建依赖](../artifacts/client-package-versions.txt)。不需要用户另装 Python。

已实际运行打包后的 exe，使用独立临时配置、常规代理模式和本机 MQTT broker：mitmweb 页面与静态资源返回 200；通信模块版本正确；同一条过期指令提交两次，均返回“未执行”，数据库只保存一条指令记录，最终待送事件为 0。打包的通信模块与客户端源码逐字节一致。没有安装受信任证书、接入游戏或发送实际消息；未验证真实游戏抓包和 local 模式驱动加载。

验证记录：[启动检查](../artifacts/client-package-smoke.json)、[压缩包校验](../artifacts/client-package-manifest.json)、[构建日志](../artifacts/client-package-build.log)。压缩包逐文件比对和 CRC 检查通过，没有包含测试产生的私钥、数据库或运行日志；保留了 HTTPS 所需的 certifi 公共 CA 集合。

SHA256：`e55ea57390920e6ae43a5529339ad65b60b0235ea9f2421ff02a949b5e794f6b`。

先退出旧客户端再更新。默认 local:Aion2.exe 模式通常需要以管理员身份运行。保持安装目录固定或设置固定 AION2_AGENT_ID，以便重启后继续使用原来的持久化记录。更多说明随包附带。
