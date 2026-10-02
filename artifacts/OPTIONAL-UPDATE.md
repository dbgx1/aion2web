# 私聊 optional 更新

版本：2026-09-16.optional.1

- 从游戏发送请求的 gameMessageInfo.optional 以及本角色收到的 jsonData.optional 提取资料。
- optional 必须是包含内容的 JSON 对象字符串；发送时保留采集到的字符串，不再强制置空。
- 其他玩家的 optional 保存在对应 knownUsers 记录中，不用于本账号发送私聊。
- 缺少有效 optional 时，不请求游戏接口，控制台收到 not_sent 和具体原因。先在游戏内发一条聊天消息，再重试。
- 换角色或区服时清除旧 optional 及发送模板，重新采集。

更新包解压到 aion2-client.exe 所在目录，覆盖 _internal/mitm_ws_message_monitor.py。需要退出并重新启动客户端才能加载更新，游戏内发一条消息完成采集。

已完成不联网的提取、发送构造、归属、换号隔离测试。未替用户实际发送游戏私聊。
