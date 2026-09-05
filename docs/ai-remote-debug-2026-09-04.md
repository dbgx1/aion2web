# AI 超时远程诊断

## 在线证据

使用用户当前 Edge 登录状态打开独立诊断页；原消息标签页被另一个浏览器控制会话占用，未接管或刷新它。

向生产 `/api/ai/chat` 提交一次最小请求，仅要求回复“连接正常”，不执行客户端工具，不发送游戏消息。响应为 HTTP 200，但 SSE 内容为 `RUN_ERROR`，错误码 `504`，信息 `Provider timed out after 5739ms`，模型 `deepseek/deepseek-chat`，供应商 metadata 标为 timeout。因此截图故障已复现，来源为 OpenRouter 上游；不能只用 HTTP 200 判断 AI 成功。

随后通过浏览器 CDP 临时拦截同一接口，回放已经捕获的错误，未继续请求供应商。复现原页面清空输入、留下空白 AI 气泡的问题。临时拦截已清除。

## 修复

- 消息和控制台 AI 都监听 `useChat.onError`。SDK 在收到流式错误时 `sendMessage()` 仍可能正常 resolve，不能仅依赖 catch 判断成功。失败时保留输入和快捷提示，允许用户手动重新提交。
- 不渲染没有文本、推理或工具内容的空气泡；把供应商超时和限流等错误转为中文提示，区分 AI 服务异常和游戏 MQTT 连接。
- 停止和发送按钮使用不同 key，并阻止停止点击的默认行为，避免 React 替换为 submit 后意外重新提交。
- 当前 OpenRouter SDK 的 HTTP 5xx 默认退避最长 3,600,000 ms。显式 `retryConfig: { strategy: 'none' }`，避免一次用户操作在后台持续产生上游请求；设置 SDK 请求超时 45 秒。这是 SDK 请求层超时，不宣称覆盖整个已开始的 SSE 流。

未切换模型、供应商、套餐或账户额度。OpenRouter 自身的路由与内部失败转移由供应商管理，本次关闭的是应用 SDK 的自动重试；无法保证取消后供应商停止计费。

## 验证

- `test-ai-failure-ui.mjs`：实际 React AI hook 与 SSE，覆盖两个面板的超时输入保留、无空白气泡、手动恢复。
- `test-ai-provider-failure.mjs`：实际路由、TanStack 适配器与 OpenRouter SDK，模拟 HTTP 504，仅一次上游调用，流式错误传递且不泄露测试凭据。
- `test-message-ai-scope.mjs`：角色/筛选/占用范围切换及停止后的旧工具失效。
- TypeScript 检查通过。

来源：[OpenRouter 错误与流式响应说明](https://openrouter.ai/docs/api_reference/errors-and-debugging)、仓库所安装的 `@openrouter/sdk/esm/funcs/chatSend.js`、`@tanstack/ai-client/src/chat-client.ts`。

## 发布

2026-09-04 22:50（北京时间）已发布，版本 `798437c9-a515-4390-bd4d-127a6ce83a7a` 承接 100% 流量，保留线上变量；生产构建通过。

线上 `/messages` 返回 200，入口 `index-GWnfhfhO.js` 及路由 JS 的 SHA-256 与构建一致；未登录 POST `/api/ai/chat` 返回 401。使用远程浏览器加载新版并回放同一错误，确认输入仍保留、显示中文超时提示、没有空白 AI 气泡，手动提交按钮可用。临时拦截已清除，诊断页已关闭。

未以再次付费调用验证供应商恢复，不能宣称 DeepSeek 上游故障已经消失。

## 23:10 再次实测：上游共享池限流

本轮最小生产请求在 2,503 ms 返回完整文本与 RUN_FINISHED；随后实际消息页 UI 提交不含发送指令的诊断请求，返回 RUN_ERROR。其顶层没有 code，`rawEvent.code` 为 429。OpenRouter 记录 StreamLake 的 `limit_source: upstream_provider_shared_pool`，previous_errors 还包含 DeepInfra 的 429。由此确认服务间歇可用，限流发生在上游共享池；不能把它归因于用户点得太快，也不能承诺等待固定秒数便恢复。

前端只读取 Error.code，遗漏 rawEvent.code，因而误用“AI 请求未完成”的通用提示。现兼容顶层、rawEvent 及 rawEvent.error 的错误码，只展示固定中文提示，不回显供应商原始数据。真实 React AI hook + SSE 测试覆盖此次嵌套 429，并继续验证保留输入、无自动重试和手动恢复；TypeScript 通过。未重试用户截图中的 56,566 人群发，也未执行游戏发送。

2026-09-04 23:13（北京时间）发布版本 `3672aa3d-2a6e-4a1b-81b8-132026dc11f8`，部署状态 100%。首次检查处于新旧版本传播窗口，随后线上 `/messages` 已引用 `index-CqeZKYIc.js`；资源返回 200，SHA-256 与本地构建一致。生产构建通过，保留线上变量。此发布修复错误识别，不解除上游限流。
