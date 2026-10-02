# 客户端与控制台并发测试（2026-09-10）

## 结果

本机隔离链路通过了 200 个客户端转发实例、5 个浏览器控制台、每客户端每秒 2 条聊天事件的 60 秒测试。它不是生产容量认证，也没有测到极限。

| 客户端 | 控制台 | 每客户端消息/秒 | 发流时长 | 事件数 | 控制台实收/应收 | 指令成功/总数 | 聊天 P95 | 回执 P95 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 2 | 1 | 10 秒 | 100 | 200/200 | 360/360 | 4.5 ms | 34.0 ms |
| 50 | 5 | 1 | 15 秒 | 750 | 3,750/3,750 | 1,250/1,250 | 68.0 ms | 90.5 ms |
| 100 | 5 | 2 | 15 秒 | 3,000 | 15,000/15,000 | 1,090/1,090 | 163.3 ms | 251.3 ms |
| 200 | 5 | 2 | 15 秒 | 6,000 | 30,000/30,000 | 885/885 | 337.1 ms | 500.6 ms |
| 200 | 5 | 2 | 60 秒 | 24,000 | 120,000/120,000 | 3,085/3,085 | 401.9 ms | 454.8 ms |

最后一档：聊天 P99 577.1 ms，最长 659.1 ms；指令回执 P99 629.4 ms，最长 744.2 ms；200 个转发实例仍就绪，客户端 outbox 合计为 0。五个浏览器测试页面没有捕获到 JavaScript 错误，也没有观察到超过 50 ms 的 Long Task。

该档末尾浏览器页面报告的 JS heap 为 39～53 MB。未读消息未清理，60 秒不足以证明不存在内存泄漏或长期积压问题。

## 已复现的问题

### 1. 重复指令会重复执行

向同一个客户端连续发送两次完全相同的 sendWhisper 指令（包括相同 requestId），模拟游戏 HTTP 函数的执行计数增加了 2。每一档都复现了这一现象。

客户端 `mitm_ws_message_monitor.py` 的 `_on_mqtt_message`、`_handle_control_message`、`_handle_send_whisper` 链路没有在执行前按 requestId 去重。已有 MQTT 事件去重处理的是回传事件，不能阻止重复游戏操作。

建议优先补充：按客户端和 requestId 记录执行中/已完成请求；执行中的重复请求复用同一任务，已完成请求重放原回执；设置保存时限。涉及重启后的重复投递时，需要持久保存执行记录。

### 2. 断线积压超过 500 条会丢弃较早事件

对一个未连接 MQTT 的真实 WebRtcRelay 实例提交 600 条不同事件，`_mqtt_outbox` 最后只有 500 条。源码在队列达到 500 条时主动移除最早事件，因此这条重放路径丢弃了 100 条。

这是独立的离线队列边界探测，并非上述在线并发阶段丢了 100 条。它也不证明其他日志或存储路径完全没有副本。

建议将需要可靠送达的聊天和执行回执放入可持久化队列，确认送达后删除；队列溢出必须明确告警。单纯增大内存上限只会推迟触发。

## 测试覆盖和限制

- 机器：Intel Core i7-12700F，20 逻辑处理器，32 GB 内存。
- 使用实际客户端源码：`E:/project/aion2/client/mitm_ws_message_monitor.py`。
- 执行实际 WebRtcRelay、Paho MQTT 2.1.0、线程/协程调度、指令接收、sendWhisper 调度、回执发布、事件 outbox 代码。
- 多个客户端实例在一个 Python 进程内，通过独立模块全局变量、各自的 relay 和 Paho 连接隔离。不是 200 个完整客户端程序，也不是 200 台机器。
- 使用实际 `useAionConsole`、`MessageInbox`、`CommandReceipts` 和 MQTT.js，在 2～5 个独立 Edge 浏览器上下文中运行。页面展示连接状态和最近 20 条回复；不是完整消息工作区、账号登录或全部历史列表。
- Aedes 0.51.3 MQTT broker 仅绑定 127.0.0.1，浏览器走 WebSocket，客户端走本地 TCP。未向公共 broker 或生产环境发送负载。
- mitmproxy 宿主被最小替身替代；最终 `_send_whisper_http` 被 20 ms 固定成功响应替代。没有连接真实游戏、真实发送消息、运行 MITM 捕获或 WebRTC。
- 每客户端定期发事件，采用同一时刻批量发出的方式。每个控制台最多同时发 5 条指令，每批完成后等待 250 ms；这是闭环负载，处理变慢时指令发出速率也会下降。
- 五个控制台订阅相同测试房间，因此一条事件应在每个控制台出现一次。实收根据应用未读集合核对；这不测账号隔离，也不等价于统计所有 MQTT 底层重投递。
- 聊天延迟从测试客户端生成事件到浏览器 React effect 观察到该消息；回执延迟从控制台调用到真实回执关联完成。均为同一物理机测量。
- 所有压力发生器、broker、Python 实例和浏览器共用该机器，会相互竞争资源。公网 RTT、TLS、真实游戏接口耗时/限流、Cloudflare Worker/D1、消息落库、在线查询服务、AI、账号权限、客户端锁均未纳入本次并发链路。
- 测试连接和进程已关闭，没有部署任何应用或客户端改动。

另外运行了客户端已有的 `test_relay_recovery.py`，3 项通过：首次连接失败后的自动恢复、断线/心跳超时后恢复和离线事件重放、发布失败后的队列与去重处理。其中 mitmproxy 同样采用宿主替身，MQTT/Paho/relay 为真实代码。

## 复现

新增脚本：

- `scripts/stress-client-console.mjs`：隔离 broker、浏览器、负载协调、统计与清理。
- `scripts/stress-client-relays.py`：加载真实客户端源码；隔离外部网络；模拟游戏 HTTP 边界。

依赖安装在系统临时目录，未修改项目 package.json：

```powershell
npm install --prefix "$env:TEMP/aion2web-load-runtime" --no-audit --no-fund aedes@0.51.3 websocket-stream@5.5.2
# 将以下两个路径设置为本机可用的 Python 和 Playwright 模块路径。
$env:STRESS_PYTHON = '<Python executable>'
$env:PLAYWRIGHT_MODULE_PATH = '<Playwright module directory>'
& $env:STRESS_PYTHON -m pip install --target "$env:TEMP/aion2web-load-python" paho-mqtt==2.1.0
node scripts/stress-client-console.mjs

# 200 客户端 / 5 控制台 / 每客户端 2 消息每秒 / 60 秒
$env:STRESS_STAGES = '[[200,5,2,60]]'
$env:STRESS_REPORT = 'artifacts/client-console-stress-sustained.json'
node scripts/stress-client-console.mjs
```

可通过 STRESS_CLIENT_SOURCE 指定客户端脚本位置。STRESS_NODE_PACKAGES 和 STRESS_PYTHON_PACKAGES 可覆盖测试依赖目录。

原始测量：`artifacts/client-console-stress.json`、`artifacts/client-console-stress-sustained.json`。

下一轮应在私有测试 broker 和独立数据库上，加入完整控制台页面、在线查询与消息落库，再做至少 30 分钟的持续负载、故障恢复和账号争抢验证；真实游戏边界应单独小规模验证。
