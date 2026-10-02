# 2026-09-10 MQTT-only 客户端更新

通信模块版本：`2026-09-10.mqtt-only`。

## 变更

- 删除 WebRTC 连接、offer/answer、DataChannel、ICE/TURN/STUN 配置和待发送队列。
- 客户端发现、聊天上报、指令和回执统一通过 MQTT。
- 已经通过 MQTT 发布的聊天不再因旧 WebRTC 队列积压而被重新发布。
- 启动前产生的聊天进入 MQTT outbox；现有断线恢复、发布失败重试和 Paho QoS 1 处理保留。
- 删除 aiortc 直接依赖及打包参数。现有 MQTT 房间、客户端 ID、主题前缀保持兼容，网页不需要配套升级。

## 更新已有客户端

1. 正常退出要更新的客户端，备份其 `_internal/mitm_ws_message_monitor.py`。
2. 将补丁中的 `_internal/mitm_ws_message_monitor.py` 覆盖到客户端同名位置。
3. 保留原有配置，重新启动客户端。不要同时运行同一编号的新旧实例。
4. 确认状态或连接日志出现 `build=2026-09-10.mqtt-only`。

这是外置通信模块补丁，不是独立可运行的完整客户端。它复用现有启动器、mitmproxy 和 Paho 2.1.0 环境。旧包中未使用的 WebRTC 库不会被补丁自动删除；从源码重新打包时使用更新后的 requirements.txt 和 README 命令即可。

旧网页使用的 `/signal/agent/all` MQTT 主题保留用于 discover 消息。保留这个历史主题名不表示继续支持 WebRTC，旧 offer 消息不会再建立连接。

## 验证与范围

MQTT 恢复测试包含首次连接失败、断线重连、心跳超时、消息补发、发布时断线、启动前积压，以及去重记录轮换后不重发旧聊天。压力测试运行真实 relay 和控制台通信代码，最终游戏 HTTP 使用本地模拟响应，没有给玩家发消息。

此更新没有改变其他既有行为：离线 outbox 为内存队列，上限 500 条；相同请求编号的指令尚未增加执行前幂等保护。MQTT QoS 1 允许网络层重复投递，接收端仍需按事件编号去重。
