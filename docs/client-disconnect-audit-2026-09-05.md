# 客户端掉线审查与修复（2026-09-05）

## 结论与证据

用户日志中的 `MQTT disconnected: 16` 对应当前客户端依赖 Paho MQTT 2.1.0 的 `MQTT_ERR_KEEPALIVE`，即保活超时。本地模拟服务停止响应 PINGREQ 后，成功复现相同断线；单个客户端也出现两次断线回调，不能仅据重复行断定启动了两个实例。

游戏连接的 `server disconnect`、`Closing connection due to inactivity` 与 MQTT 是不同连接。现有日志不能区分网络、代理、远端服务和本机线程阻塞，不能据此认定 Cloudflare 导致断线。客户端 MQTT 默认直连公共 MQTT 服务，不经过 Cloudflare Worker；网页通过 MQTT WebSocket 接收心跳。

审查发现代码确实会放大短暂断线，导致客户端不恢复、页面误判离线或占用被释放，已修复如下。

## 客户端

文件：`E:/project/aion2/client/mitm_ws_message_monitor.py`。

| 问题 | 修复 |
| --- | --- |
| 首次同步 connect 失败会退出通信线程 | connect_async + loop_start，首次失败和后续断线都自动重连，重试间隔 1～15 秒 |
| V1/V2 回调兼容分支存在签名不匹配 | 固定使用项目依赖 Paho 2.1.0 的 VERSION2 回调，显示可读断线原因 |
| 无效 UTF-8、JSON 数组/null 可使网络回调抛异常 | 解析和对象类型校验 |
| 在网络线程回调中发布积压事件、读取状态 | 调度到通信事件循环，缩短网络回调 |
| 断网时积压旧心跳 | 仅连接时发布在线心跳，使用可替代的 QoS 0 保留消息 |
| 提前去重且不检查发送队列结果，失败事件不能重试 | QoS 1 有界队列；队列满保留重试；发送恰好断线时尊重 Paho 内部重传队列，避免应用重复入队 |
| stop 和主循环同时发起清理 | 单一、幂等退出流程，先断开再停止网络线程 |
| 缺少通信日志 | 新增轮转 aion2-relay.log，记录连接、失败原因和模块版本 |

恢复事件缓存仅在内存中，应用队列与 Paho 队列分别最多 500 条；应用队列满时丢弃最旧事件并报警。退出/崩溃后不保证补发。QoS 1 允许网络重复投递，网页仍按消息标识去重。游戏发送命令不因重连自动重发。

## 网页与服务端

- `use-aion-console.ts`：离线阈值由 15 秒改为 45 秒，只在浏览器前台、联网、MQTT 正常并持续观察的情况下计时。后台/断网/休眠后重新给观察窗口，保留选择。
- 实时心跳按接收时刻更新活跃时间，避免客户端时钟偏差导致隐藏；过时的 retained 在线状态不能恢复已离线客户端。
- 标记为 will 的离线消息只作提示，使用持续观察确认；旧保留遗嘱不能删除刚收到心跳的客户端。
- 订阅成功后才发 discover，避免回复先于订阅；回前台/恢复联网主动发现。
- 网页离线或隐藏时不提交离线释放提示，保留原退避与批处理，未新增 D1 轮询。
- `client-locks.server.ts`、`api/client-locks.ts`：离线释放必须匹配登录用户，其他账号的离线推断不能删除当前操作者的锁。
- `routes/index.tsx`：只有本标签页主动获得的同一代占用，关闭页面时才自动释放。读取到同账号占用的旁观标签页关闭时不再误释放。页面直接恢复旧占用但未主动获取时，不注册自动关闭释放；主动退出仍可释放。

## 验证

通过以下真实代码回归：

- Python 三项测试：首次服务器不可达；连接断开与恢复；PINGRESP 缺失导致保活超时后恢复；事件补发；队列满；发送时断线已进入 Paho 队列；无效消息；正常退出。
- `test-message-reliability.mjs`：短暂心跳缺失、超时、时钟偏差、旧 retained 在线/离线消息、隐藏 120 秒后回前台观察窗口、异步连接竞争。
- `test-client-locks.mjs`：所有者隔离、锁代数约束、连续观察。
- `test-client-lock-lifecycle.mjs`：旁观标签页关闭不释放、主动获取后关闭释放，以及暂停恢复、占用变化中止群发、消息保存退避等既有回归。
- `test-unread-retention.mjs`、`test-game-chat-block-ui.mjs`：未读保留、封禁后停止发送与手动恢复。
- `npm run build`、`npx tsc --noEmit` 成功。构建仍有原有大文件体积提示。

测试使用本地模拟 MQTT/HTTP，没有向游戏玩家发送测试消息。客户端包逐文件压缩校验通过，通信模块与测试源码一致，保留原 certifi 根证书包和 Paho 2.1.0 依赖。

## 发布与安装状态

网页/服务端已发布：`efeeb33d-48b2-4c1f-bfca-7fe5345953cf`。

远程新标签页确认生产客户端中心显示 45 秒说明、A3/A4 两个客户端在线且持续有心跳，A4 原占用仍存在。未刷新用户正在进行在线查询的实时消息页。

客户端模块版本：`2026-09-05.heartbeat-recovery`。已生成：

- 完整包：`E:/project/aion2/build/aion2-client-recovery-20260905.zip`
- 小补丁：`E:/project/aion2/build/aion2-client-recovery-patch-20260905.zip`
- 安装说明：`E:/project/aion2/client/RECONNECT-UPDATE.md`

完整包 SHA256：`932591dba73838bf5fdca52ce33da18ca535868895d1ead65a4698ba9f003cf5`。

客户端尚未在运行 A3/A4 的远程电脑替换或重启。此次交付完成代码修复、测试、网页发布和客户端更新包；不能把页面当前恢复在线视为新客户端已安装或外部网络故障已消失。

参考：[Paho 2 回调迁移](https://eclipse.dev/paho/files/paho.mqtt.python/html/migrations.html)、[Paho Client 接口](https://eclipse.dev/paho/files/paho.mqtt.python/html/client.html)。原因码和发送队列行为另核对了实际安装的 Paho 2.1.0 源码。
