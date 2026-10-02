# 客户端与控制台：修复后的压力测试报告

日期：2026-09-10。最终客户端版本：`2026-09-10.reliable-mqtt`。

后续已按用户要求完成完整 exe 打包及隔离启动验证，见 [客户端打包结果](client-package-2026-09-10.md)。本文关于“尚未打包”的说明保留为压力测试完成时的状态。

## 修复范围

本轮依据前两份压力测试报告中的实际问题修改了客户端和控制台源码。WebRTC 已删除，通信保持 MQTT-only。

| 已复现问题 | 本轮修复 | 验证方法 |
|---|---|---|
| 同一 requestId 下发两次，游戏执行两次 | SQLite 原子领取指令执行资格，保存结果；处理中不重复执行，完成后返回原结果 | 真实 MQTT 重复下发；50 个同编号并发调用；保存结果后重新加载客户端 |
| 离线提交 600 条，内存队列只剩 500 条 | SQLite 持久化聊天和最终执行结果，PUBACK 后删除 | 600 条离线保存、强制退出进程、重新打开；真实 Paho/broker 补发 600 条 |
| WebRTC 待送队列在 MQTT 去重轮换后重发旧聊天 | 删除 WebRTC 及其待送队列 | 一条聊天加 1,001 条控制结果挤出去重记录后，旧聊天仍只发布一次 |
| 高并发时请求排队，没有明确容量和期限 | 游戏调用并发有上限，执行中加排队默认 128；发送命令默认 30 秒期限 | 队列满、等待超时、已过期指令的拒绝测试，以及多控制台突发负载 |
| 网络中断无法判定游戏是否执行 | 回传 unknown，控制台显示“结果未确认”；不自动重发 | 模拟游戏连接中断、取消执行后重载、网页回执和断线回归 |

为减少持久化开销，中间“已收到”通知及可刷新状态不落盘，聊天和最终结果仍持久化。默认客户端编号由进程号改为安装路径摘要，重启后可找到同一数据库；手工配置的编号保持不变。

优化开发中，真实 MQTT 试跑发现 Paho 内部锁与应用发布锁互相等待。最终版本的网络回调只入队，由通信线程处理确认和数据库；加入回调不等待应用锁的测试，并通过真实 broker 压测。那次被中止的试跑不计入结果。

## 最终实测结果

| 客户端 / 控制台 | 模拟游戏耗时 | 发流时长 | 指令确认 / 总数 | 指令 P95 / P99 | 聊天 P95 | 聊天实收 / 应收 |
|---|---:|---:|---:|---:|---:|---:|
| 1 / 20 | 20ms | 30 秒 | 5,490 / 5,490 | 393.2 / 428.8ms | 273.5ms | 6,000 / 6,000 |
| 200 / 5 | 20ms | 60 秒 | 4,975 / 4,975 | 85.1 / 120.9ms | 22.4ms | 120,000 / 120,000 |
| 1 / 20 | 500ms | 60 秒 | 2,930 / 2,930 | 2,087.9 / 2,190.8ms | 32.3ms | 12,000 / 12,000 |

三档结束时执行中任务和持久化待送事件均为 0，所有客户端仍就绪。最终这三档没有捕获到浏览器错误或超过 50ms 的 Long Task。200 实例档位末尾，五个浏览器的 JS heap 为 29–54MB。

在慢响应档位结束后，另由 20 个控制台各一次提交 10 条指令，共 200 条：128 条确认成功，72 条返回 not_sent，模拟游戏实际执行 128 次，峰值并发 24，结束时执行中为 0。没有 unknown 或 failed。这验证了默认总容量 128 的过载处理；72 条拒绝是明确的保护结果，不计为成功执行或聊天丢失。

每档独立探测均得到：离线提交 600、保留 600；同一指令 MQTT 下发两次、实际执行 1 次；旧聊天跨去重轮换后仍只发布 1 次。17 项客户端回归另覆盖了强制退出进程和真实 broker 补发。

### 与修改前 MQTT-only 版本对照

| 同一负载 | 修改前确认指令数 | 修改后确认指令数 | 修改前指令 P95 | 修改后指令 P95 |
|---|---:|---:|---:|---:|
| 1 客户端 / 20 控制台，20ms，30 秒 | 6,180 | 5,490 | 329.2ms | 393.2ms |
| 200 客户端 / 5 控制台，20ms，60 秒 | 5,160 | 4,975 | 49.0ms | 85.1ms |

主要收益是可靠性：重复执行从 2 次降到 1 次，离线 600 条不再只保留 500 条，并支持进程恢复。持久化有开销：单客户端档位指令 P95 增加约 19%，200 实例档位增加 36.1ms，闭环下完成指令数也有所减少。聊天仍全部收齐。这些是单机单轮测量，存在调度波动，不能据此宣称整体提速或给出精确生产容量。

原始结果：[最终常规负载](../artifacts/optimized-client-console-release.json)、[最终慢响应与突发](../artifacts/optimized-single-client-release-slow.json)、[同负载修改前对照](../artifacts/mqtt-baseline-comparison.json)。开发过程中的 pilot、final 等其他文件是中间版本结果，本表仅采用文件名含 release 的最终验证结果。

## 测试方法与边界

机器为 i7-12700F、20 逻辑处理器、32 GB 内存。broker、浏览器、Python 转发实例共用一台电脑。Aedes 0.51.3 仅监听 127.0.0.1；Python 使用真实 Paho MQTT 2.1.0 和客户端 relay，每个转发实例有独立线程、连接、数据库。200 个实例运行在一个 Python 宿主进程内，不是 200 个完整客户端程序或 200 台机器。

每个控制台是独立 Edge 浏览器上下文，运行真实 useAionConsole、MessageInbox 和 CommandReceipts，显示连接状态及最近 20 条消息。单客户端档位的所有控制台都向 load-0 发指令；200 客户端档位轮流选择客户端。每个控制台最多同时发 5 条指令，每批完成后等 250ms。这是闭环负载，响应变慢时发出速率会下降，不能据此推算固定请求速率下的极限容量。

聊天按设定频率生成并向房间内所有控制台分发；实收数按应用层集合核对。聊天延迟从生成事件到浏览器 React effect 观察到消息；指令延迟从调用发送方法到关联最终回执。P95 表示本轮 95% 的样本不超过这个耗时。发流结束后等待在途任务和聊天收齐，统计窗口会略长于标称发流时长。

mitmproxy 宿主为最小替身；最终游戏 HTTP 是 20ms 或 500ms 固定延迟成功响应。没有连接游戏、没有给玩家发消息。公共 broker、公网 RTT/TLS、正式游戏限流、Cloudflare Worker/D1、消息落库服务、在线查询、AI、账号权限与客户端占用机制、完整控制台 UI 均不在本次并发测量内。已有业务占用限制没有因为底层多控制台测试而放开。

这是一组明确负载下的通信与故障恢复结果，不是生产容量保证，也没有测到系统最大连接数。30–60 秒负载不足以排除长期内存增长；压力发生器和服务共机也会影响耗时。发布后的 HTTP 页面检查仅验证可访问性，不是生产压测。

## 回归验证与更新

- 客户端正式源码回归：恢复测试 7/7、可靠性测试 10/10，通过。记录：[恢复测试](../artifacts/relay-recovery-tests.txt)、[可靠性测试](../artifacts/relay-reliability-tests.txt)。覆盖发布途中断线、启动失败、心跳超时、600 条真实 Paho 补发、强制进程退出、默认身份跨进程稳定、幂等、期限和容量等。
- 控制台实际 React hook 回归通过：请求编号关联，忽略错误客户端及 retained 回执，断线/卸载结算，unknown/not_sent 文案及手动发送默认期限。MQTT 重连竞争、过时回调与历史加载恢复回归通过。
- TypeScript 检查、生产构建和 Wrangler 发布预检通过。构建有已有的大块产物及动态导入提示，无构建错误。记录：[构建](../artifacts/reliable-mqtt-web-build.txt)、[发布预检](../artifacts/reliable-mqtt-deploy-check.txt)。
- 客户端源码 SHA256：`4be70c24b3b44a691265e38b344b458602cacf4424e83ef598f04482e5046df2`。控制台 hook SHA256：`27391468664a9933b77c5aa7defa59781ae8f5b14157580cbcaba0463850a4ed`。最终压力测试 JSON 记录了相同哈希。
- 更新包 8 个文件逐项核对，与 E:\project\aion2\client 的实际源码一致：[文件清单与哈希](../artifacts/reliable-mqtt-source-manifest.json)。

- 控制台发布命令成功，Worker 版本 `bc59d1b8-6996-4978-be23-e68863f9592e`，地址 [aion2web](https://aion2web.cc328496536.workers.dev)。上传了 3 个更新资源，发布记录见 [部署输出](../artifacts/reliable-mqtt-deploy.txt)。
- 线上回访存在验证限制：本机 HTTP 请求（包括受限网络外重试）及 Edge 均连接超时，未能核对线上页面和资源哈希，不能声称线上浏览器验收通过。记录：[HTTP 回访](../artifacts/reliable-mqtt-live-smoke.json)、[浏览器回访](../artifacts/reliable-mqtt-live-smoke-browser.json)。这不改变发布命令成功和本地回归通过的事实。
- 已核对压力测试 Node/Python 子进程数量为 0，没有继续向测试 broker 发流。最终结果审计核对了源码哈希、所有投递数、执行数、队列清空和过载结果：[审计记录](../artifacts/optimized-release-audit.json)。

源码更新包：[aion2-client-reliable-mqtt-source-20260910.zip](../artifacts/aion2-client-reliable-mqtt-source-20260910.zip)。该包包含客户端源码、依赖清单、测试和更新说明，不是完整 exe。新增使用标准库 SQLite，旧 exe 可能缺少运行库，因此需要按新版 README 重新打包；本轮没有验证完整 exe 或真实游戏环境。

存储默认在 `%LOCALAPPDATA%/Aion2Relay/`，可通过 AION2_RELAY_DATA_DIR 指定。不要同时运行同编号新旧实例。默认编号升级后改变一次，需要重新选择客户端；以后同一安装路径重启保持稳定。搬迁安装目录应固定编号并保留数据库。

未确认事件与指令去重记录没有自动清理期限，会持续占用磁盘，需要监控空间。持久化队列保证的是成功提交到本地数据库后的恢复，不能承诺磁盘损坏时零丢失。PUBACK 仅确认 broker 接收；控制台离线后的历史补齐不由此自动保证。游戏执行与本地数据库不是同一事务，中断边界可能只能报告 unknown，不能宣称跨游戏接口的严格 exactly-once。

## 复现

依赖安装和隔离方式沿用 [首轮报告](client-console-stress-2026-09-10.md)。在 E:\project\aion2web 运行，STRESS_PYTHON 和 PLAYWRIGHT_MODULE_PATH 指向本机 Python 与 Playwright。需要 Edge。

```powershell
$env:STRESS_CLIENT_SOURCE = 'E:/project/aion2/client/mitm_ws_message_monitor.py'
$env:STRESS_STAGES = '[[1,20,10,30],[200,5,2,60]]'
$env:STRESS_GAME_DELAY_MS = '20'
$env:STRESS_BURST_PER_CONSOLE = '0'
$env:STRESS_REPORT = 'artifacts/reproduced-fast.json'
node scripts/stress-client-console.mjs

$env:STRESS_STAGES = '[[1,20,10,60]]'
$env:STRESS_GAME_DELAY_MS = '500'
$env:STRESS_BURST_PER_CONSOLE = '10'
$env:STRESS_REPORT = 'artifacts/reproduced-slow.json'
node scripts/stress-client-console.mjs

$env:STRESS_PYTHON_PACKAGES = "$env:TEMP/aion2web-load-python"
& $env:STRESS_PYTHON -B scripts/run-client-tests.py E:/project/aion2/client/test_relay_recovery.py
& $env:STRESS_PYTHON -B scripts/run-client-tests.py E:/project/aion2/client/test_relay_reliability.py
node scripts/test-command-receipts-ui.mjs
node scripts/test-message-reliability.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

对照基线保存于 artifacts/optimization-baseline，版本为最初删除 WebRTC 后的 MQTT-only 客户端。修改前和修改后使用相同负载模型；较早的 WebRTC 报告保留为历史记录，不直接用其差值推断这次持久化修改的性能收益。
