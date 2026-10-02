# 实时消息精确订阅与回执分流

2026-09-14。网页和 `E:\project\aion2\client\mitm_ws_message_monitor.py` 源码已更新。客户端完整包为 `artifacts/aion2-client-20260914-precise-topics.zip`，通信版本 `2026-09-14.precise-topics.1`，已通过打包后 EXE 验证；未替用户重启正在使用的客户端。

网站已于 2026-09-14 发布到 https://aion2web.cc328496536.workers.dev ，版本 `bb324622-722a-4aca-ba73-94c8e14088ea`，正式流量 100%。包括本次精确订阅、回执分流和消息完整日期显示。首页及消息页返回 200，未登录 MQTT 凭据接口返回 401，线上主要 JS/CSS 与本地构建哈希一致。验证记录为 `artifacts/precise-topics-date-live-check.json`；未进行登录后的真实游戏发送验证。

## 订阅范围

选中客户端后，网页持续订阅以下三个主题（`base` 为现有前缀和房间）：

- `base/agents/{agentId}/status`
- `base/events/{agentId}/chat`
- `base/events/{agentId}/receipts`

不再订阅 `events/+/chat`。切换客户端会立即过滤旧客户端消息，取消旧主题订阅，并将尚未完成的指令等待结束为“结果未确认”。新主题收到订阅确认后才允许发送命令；订阅拒绝不会被当作就绪。重连按当前选择重新订阅，不恢复旧客户端主题。

连接、窗口唤醒和手动刷新列表时，打开 5 秒的 `agents/+/status` 发现窗口，用于保留现有客户端列表入口；窗口结束后只保留当前客户端状态订阅。发现窗口不订阅其他客户端聊天或回执。其他客户端的列表状态会按已有在线超时策略过期，需要刷新列表重新发现。

该修改减少消息分发，不替代 broker ACL。发现窗口仍能接收同房间客户端状态，界面继续使用现有区服权限筛选；严格传输权限隔离需要另行配置设备身份和主题权限。

## 客户端路由

`control_ack` 和 `control_result` 发送到 `receipts`；聊天继续发送到 `chat`。`requestStatus` 使用完整的标准状态上报，发送到 `status`。中间确认仍使用 QoS 0，最终结果仍通过 SQLite 队列使用 QoS 1，收到 PUBACK 后清理。旧数据库中的待发记录在重放时也按类型路由，无需迁移 SQLite。

## 更新顺序

先发布新网页并让使用者刷新，再更新、重启本地客户端。新网页兼容旧客户端在 `chat` 主题返回回执；新客户端只向 `receipts` 返回回执，不做双主题广播，所以旧网页不能完整接收新客户端回执。打包 EXE 用户需要重新打包后更新，源码修改不会自动更新运行中的进程或 EXE。

## 验证

- `scripts/test-console-subscriptions.mjs`：精确主题、切换退订、过期订阅确认、订阅拒绝和重连。
- `scripts/test-command-receipts-ui.mjs`：真实 React hook、Edge 浏览器，模拟 MQTT；验证新旧回执、切换、错误客户端消息、发现窗口关闭及断线恢复。
- `scripts/test-relay-receipt-topics.py`：真实客户端路由，验证离线记录恢复、回执分流、状态主题及 PUBACK 清理，无游戏请求。
- 客户端 `test_relay_reliability.py` 10 项、`test_relay_recovery.py` 7 项通过；后者含本机真实 Paho 通信。
- TypeScript 检查和生产构建通过。发布前的 dry-run 检查通过，线上版本和资源核对通过；未进行生产 broker ACL 验证。
