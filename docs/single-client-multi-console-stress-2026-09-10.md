# 单客户端、多控制台压力测试

日期：2026-09-10。环境：i7-12700F / 20 逻辑处理器 / 32 GB 内存，本机隔离 MQTT broker。

## 结论

固定一个真实客户端 WebRtcRelay 实例，增加到 20 个独立浏览器控制台通信实例后，指定负载下所有指令都收到成功回执，应用层聊天接收数量一致。没有测出最大连接数；这不能当作正式游戏、完整网页或生产服务的容量保证。

慢响应场景明显出现排队：模拟游戏 HTTP 每次耗时 500 ms 时，20 控制台的回执 P95 达到 2,087.1 ms。

## 实测数据

所有控制台都操作同一个 `load-0` 客户端。每个控制台最多同时提交 5 条指令，每批完成后等 250 ms 再继续。这是闭环负载，响应变慢时发出速率会下降；不是固定每秒请求数。

客户端在所有档位都每秒生成 10 条聊天事件；所有控制台订阅同一房间。游戏 HTTP 使用固定延迟的本地成功响应，未实际发送游戏消息。

| 控制台数 | 模拟游戏 HTTP 延迟 | 发流时长 | 指令成功/总数 | 回执 P95 | 回执 P99 | 最长回执 | 聊天实收/应收 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 20 ms | 15 秒 | 540/540 | 31.2 ms | 37.3 ms | 47.8 ms | 300/300 |
| 5 | 20 ms | 15 秒 | 1,325/1,325 | 48.5 ms | 55.5 ms | 67.5 ms | 750/750 |
| 10 | 20 ms | 15 秒 | 2,555/2,555 | 62.8 ms | 110.9 ms | 156.2 ms | 1,500/1,500 |
| 20 | 20 ms | 30 秒 | 7,230/7,230 | 296.0 ms | 849.9 ms | 1,373.3 ms | 6,000/6,000 |
| 20 | 500 ms | 60 秒 | 2,930/2,930 | 2,087.1 ms | 2,103.4 ms | 2,759.8 ms | 12,000/12,000 |

计时包含指令传输、客户端调度、模拟 HTTP 执行和回执关联。发流结束后等待在途工作完成，因此最后一档统计窗口约 63.5 秒，而非恰好 60 秒。

20 控制台/500 ms 档位：聊天 P95 17.6 ms；游戏 HTTP 同时执行峰值 24；结束时 active=0、MQTT outbox=0，客户端仍就绪。浏览器页面没有观察到超过 50 ms 的 Long Task，未捕获页面错误。高延迟任务排队与同一客户端执行线程池的并发峰值相符；本次没有直接采集每个任务的排队等待时间，因此不把全部延迟归因于线程池。

## 额外发现：客户端会重新发布旧聊天事件

应用层接收数量正确，但 MQTT 原始发布次数超过生成数量：

| 控制台数 / 模拟延迟 | 原始聊天事件 | broker 收到的聊天发布 |
|---|---:|---:|
| 2 / 20 ms | 150 | 150 |
| 5 / 20 ms | 150 | 247 |
| 10 / 20 ms | 150 | 320 |
| 20 / 20 ms | 300 | 734 |
| 20 / 500 ms | 600 | 666 |

控制台未读集合去重后没有多显示聊天，但额外发布会增加 broker 流量、浏览器解析和后续数据处理负担。

已经通过独立边界探测复现一个确定的重发原因：

1. 调用真实 `_publish_record` 提交一条聊天，MQTT 发布成功。
2. 没有 WebRTC channel 时，`_send_or_queue` 仍将该聊天留在 `pending` 中。
3. 再提交 1,001 条不同控制事件，挤出容量为 1,000 的 MQTT 去重记录。
4. 调用真实 `_publish_pending_mqtt_events`，同一聊天被第二次发布到 MQTT。探测结果为 chatSubmissions=1、chatPublishes=2、webrtcPending=1。

客户端真实心跳循环每约 5 秒会调用 `_publish_pending_mqtt_events`，而该方法同时扫描 `_mqtt_outbox` 与 WebRTC `pending`。该结构可以解释高指令流量下的重发；没有逐条追踪上述每次额外发布，因此不声称所有额外发布均已逐一归因。

建议分别维护 MQTT 待送队列和 WebRTC 待送队列，避免 WebRTC 积压在 MQTT 去重记录过期后重新走 MQTT 发布。补充持续大量控制回执、WebRTC 未连接情况下的事件只发布一次回归验证。

## 仍存在的两个问题

- 同 requestId 的 sendWhisper 连续下发两次，模拟游戏执行计数增加 2：没有执行前幂等保护。
- 未连接 MQTT 的真实 relay 接收 600 条事件，outbox 最后只有 500 条：最早 100 条被移出该重放队列。

以上两项在本轮再次复现；本次只测试和记录，没有修改或发布客户端业务逻辑。

## 范围与正式系统的区别

实际运行客户端 `E:/project/aion2/client/mitm_ws_message_monitor.py` 的 MQTT/Paho、线程、协程调度、指令处理和回执代码，以及网页实际 `useAionConsole`、MessageInbox、CommandReceipts。浏览器展示状态及最近 20 条消息，不是完整控制台 UI。

mitmproxy 宿主为替身；最终游戏 HTTP 为 20 或 500 ms 模拟成功响应；没有连接真实游戏或公共 MQTT，也未压生产数据库、消息持久化、AI、在线查询服务或公网网络。

这次有意在底层通信测试中让多个控制台同时下发命令，没有走业务界面的账号登录和客户端占用检查。正式系统已有客户端占用机制：不同账号不能同时取得同一个客户端的占用权限。测试结果不表示正式产品应允许多人同时操作同一个游戏账号。

已有 `scripts/test-client-locks.mjs` 也已运行通过，覆盖占用归属、另一账号争抢失败、旧操作不能释放新占用等行为；这是独立回归检查，不是客户端锁的生产并发压测。

## 复现和原始记录

沿用 `scripts/stress-client-console.mjs` 与 `scripts/stress-client-relays.py`，依赖配置见前一份 `client-console-stress-2026-09-10.md`。

```powershell
$env:STRESS_STAGES = '[[1,2,10,15],[1,5,10,15],[1,10,10,15],[1,20,10,30]]'
$env:STRESS_GAME_DELAY_MS = '20'
$env:STRESS_REPORT = 'artifacts/single-client-multi-console-stress.json'
node scripts/stress-client-console.mjs

$env:STRESS_STAGES = '[[1,20,10,60]]'
$env:STRESS_GAME_DELAY_MS = '500'
$env:STRESS_REPORT = 'artifacts/single-client-multi-console-slow.json'
node scripts/stress-client-console.mjs
```

原始结果：`artifacts/single-client-multi-console-stress.json`、`artifacts/single-client-multi-console-slow.json`。测试服务和子进程已退出。
