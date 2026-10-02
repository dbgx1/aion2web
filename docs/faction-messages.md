# 阵营消息发送

控制端在“实时消息 → 公频”提供独立输入框。Enter 发送，Shift+Enter 换行；等待回执期间禁用重复提交，成功后清空输入，失败或结果未知时保留内容。

MQTT 主题沿用所选客户端的 `control/agent/{agentId}`，新增指令：

```json
{"type":"sendFactionMessage","requestId":"unique-id","serverKey":"2201","content":"消息内容","expiresAt":1800000030000}
```

`expiresAt` 必须使用当前毫秒时间戳加 30000；示例时间戳不可直接复用。`serverKey` 校验客户端当前服务器，不允许指定其他服务器。客户端读取当前登录身份、optional、授权和已采集的受信任游戏 API 域名，将 `gameRoomKeyInfo` 设置为 `WORLD`，serverKey 与 roomKey 均为当前服务器，调用 `/gameClient/sendMessage`。

沿用持久化去重、过期拒绝、换号暂停、队列容量和回执机制。回执 command 为 `sendFactionMessage`，通过 requestId 关联，status 为 confirmed / failed / not_sent / unknown。HTTP 成功但响应明确报告业务错误时不能记为成功。超时和未知结果不自动重发。

客户端源文件及两个 build 目录的 `_internal/mitm_ws_message_monitor.py` 已同步为 `2026-09-17.faction.1`。启动器加载外部脚本，无需重新生成 EXE；需要退出并重新启动客户端。缺少登录身份时，先在游戏内发送一条聊天消息再使用控制端。

验证：请求构造与身份隔离、防重复及过期测试；10 项原有可靠性回归；optional 身份回归；桌面/手机模拟发送、键盘和私聊回归；TypeScript 检查与生产构建。没有发送真实游戏消息。
