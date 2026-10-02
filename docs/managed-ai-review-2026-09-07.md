# AI 托管模型与代码审查

## 修改

- 持续托管的服务端请求固定使用 `deepseek/deepseek-v4-flash-0731`，包括工具续接和无动作纠正请求。旧 `TANSTACK_AI_MODEL` 环境配置不会覆盖托管模型；普通交互助手保留原模型选择逻辑。
- 修复旧任务停止后迟到的发送失败污染新任务：用独立任务代次隔离重试草稿。暂停、显式恢复仍属于原任务，保留既有的未确认消息原文重试行为。
- 修复空白群发内容消耗一次性群发资格：先去除空白、验证内容，再标记已入队；无有效内容明确报错，后续有效群发仍可入队。

## 审查和验证

审查范围包括 AI 服务端路由、客户端工具执行、调度器、历史与在线查询、回执、占用校验、暂停/停止/恢复和错误退避。

通过：

- TypeScript 检查、生产构建、Wrangler 部署预检。
- `test-ai-provider-failure.mjs`：实际 TanStack/OpenRouter SDK 序列化请求使用指定模型；旧控制台模型配置不覆盖托管；越权和过期占用不产生模型调用；504 不自动后台重试。
- `test-managed-task-isolation.mjs`：旧失败不进入新任务、暂停保留原文重试、空白群发拒绝及恢复。
- `test-managed-ai-recovery.mjs`、`test-managed-chat.mjs`、`test-managed-reply-latency.mjs`、`test-managed-online.mjs`、`test-managed-presence-query.mjs`、`test-client-locks.mjs`、`test-game-chat-block.mjs`。
- 本地 Edge 浏览器：`test-managed-ai-tools.mjs`、`test-managed-chat-ui.mjs`，覆盖真实页面/SDK 和模拟 SSE、MQTT、发送回执；未向实际游戏角色发送测试消息。

模型供应商请求通过模拟上游验证，尚未执行真实付费模型请求。已有回执不确定时原文重试策略保留，因此不保证严格恰好发送一次；跨设备托管租约与关闭浏览器后的云端持续运行不在本次改动范围内。

## 发布状态

2026-09-07 14:28（北京时间）已发布到既有 `aion2web` Worker，版本 `143ae07f-208d-4677-913a-9ab3f242b80f` 承接 100% 流量。使用 `--keep-vars` 保留生产变量与已有密钥，不涉及数据库迁移。

线上 `/messages` 返回 200，引用当前 `index-pbRBsgV6.js`。线上资源与本地构建 SHA-256 一致：

- `index-pbRBsgV6.js`：`5C38E5F8FA1A706B785AF4DB9F3F0CE89B32EB64C7637EAA99A2E8AD9B79BC48`。
- `routes--VyrPGPO.js`：`26623B6707227D09461899F33D9FBA3403242ADECDF8B5C4BDF621CBB1DFF4E8`。

发布地址：[实时消息](https://aion2web.cc328496536.workers.dev/messages)。

前端修复需刷新页面加载；刷新会结束旧页面托管，需重新开启。模型选择在服务端，部署后下一次托管 AI 请求即使用新模型。

## 错误详情补充

发布版本 `f483c764-2447-4b59-9208-60f5405b4a3e` 增加上游流式错误诊断。托管 `RUN_ERROR` 保留错误码、错误消息及可用的 `rawEvent` 错误字段，SDK 的通用 `onError` 不再覆盖这些详情。页面注明未提供的错误码，不猜测超时或限流原因。

Cloudflare 日志标记为 `[ai-provider-error]`，浏览器控制台标记为 `[managed-ai-error]`，包含可用的模型、供应商、请求标识和脱敏错误详情。只保留错误字段，过滤请求正文/headers，去除常见密钥和令牌并限制长度、嵌套层数；不是完整 HTTP 抓包。服务端日志仍受现有 Cloudflare 采样配置影响。

实际 SDK 回归覆盖 504 流式错误及服务端请求标识、429 嵌套供应商错误详情、客户端 `onError` 不覆盖详情、敏感字段过滤与缺失错误码。类型检查和生产构建通过。旧截图的错误无法通过本次改动追溯恢复；需要新错误事件判断具体原因。

## 手动聊天远程诊断补充

手动聊天与控制台原 `ai-error.ts` 将未知错误替换成通用提示，隐藏了 SDK 保留的上游详情。现已在所有分类提示后追加脱敏错误码与返回详情。真实 React/SDK/SSE 浏览器测试覆盖超时、嵌套 429、供应商 raw 原因、保留输入和手动重试，类型检查及构建通过。

已发布 `c088a481-2b88-41d0-80a8-37dc7a8deb1a`；生产 `/messages` 返回 200，`index-DeHWUm-K.js` 哈希与构建一致。

远程取证：Wrangler CLI tail 连接超时；使用已有授权通过官方 tail API 和 .NET WebSocket 成功接通。首次窗口观察到两次 AI 路由请求，Worker outcome 为 ok、无错误日志；随后的 180 秒窗口没有捕获 AI 错误。以上不证明模型回答或游戏发送成功，也未复现用户截图的失败。远程浏览器页面读取超时，未代替用户发送最小生产聊天测试。仍需一次新的失败事件确定上游原因。既有监控已改用可连接的只读观察脚本。
