# AION2 在线查询与调度器接入文档

版本 1.1 · 更新 2026-09-30

当前线上使用统一查询调度器：网页登记请求，经 MQTT 交给调度器，调度器分配给已认证查询设备，先保存可信结果再发布回执。普通第三方不能直接向结果 Topic 发布并取得持久化确认。本文区分网页协议、查询设备协议和内部 Broker Webhook。

## 1. 接入步骤

1. 角色上传脚本使用网站 UPLOAD_API_TOKEN；在线查询设备使用管理员分配的独立 MQTT 凭据，两者不能互换。
2. 网页使用登录 Cookie 调用 POST /api/presence/requests，登记 1–50 个角色，取得 requestId、requestTopic、replyTopic、expiresAt。
3. 网页先订阅 replyTopic 并等待 SUBACK，再向 requestTopic 发布 presence_query，QoS 1、retain=false。
4. Broker 将请求转交调度器；调度器以 D1 中已登记的角色清单和客服归属为准，不信任 MQTT 载荷替换清单。
5. 查询设备使用专用账号连接，发布包含当前 serverId 的本设备 state、订阅本设备 task；调度器只向相同 serverId 的设备派发，并按 taskId / attemptId / gameSessionId 校验执行，再发布 events。
6. 调度器先写入可信结果、角色在线状态和完成记录，再发布 presence_result；网页关闭也不会阻止这一步持久化。
7. 网页接收结果并更新显示；兼容 HTTP 保存只接受与调度器确认一致的结果。仅发布 MQTT 结果不能替代可信确认。

## 2. 网页请求与结果 Topic

两方必须使用管理员确认的 Broker。生产 Broker 的 ACL 限制 query-workers 主题和结果发布；不要把上传令牌当成 MQTT 密码。新设备须完成专用账号及 ACL 配置，不能只凭请求 Topic 接入。

| 参数 | 约定 |
| --- | --- |
| 协议 / 编码 | MQTT 3.1.1，UTF-8 JSON。本文示例使用 WSS。 |
| 默认 WSS 地址 | 默认使用网站配置的私有 EMQX Broker（WSS，端口 8084，路径 /mqtt）。请向管理员取得当前地址及提供方专用账号；旧公共 broker.emqx.io 已不再是网页默认连接。两方必须使用同一个 Broker。 |
| MQTT 身份验证 | 网页经登录 Cookie 调用 /api/mqtt/connection 获取 {url,username,password}。查询设备由管理员分配独立账号和 Topic ACL，不能复用网页账号。 |
| serviceId | 后端 PRESENCE_SERVICE_ID，默认 aion2web。1-100 个英文字母、数字、下划线或短横线，区分大小写；提供方应使用管理员确认的编号。 |
| 调度器接收请求 | aion2/presence/{serviceId}/requests。默认 serviceId=aion2web；由 Broker 规则转交调度器。 |
| 调度器发布结果 | aion2/presence/{serviceId}/results/{requestId}。网页订阅请求指定的 replyTopic；普通客户端不能直接发布。 |
| QoS / retain | 请求订阅和结果发布均为 QoS 1，结果 retain=false。不要发布保留结果或把请求作为保留消息。 |
| 连接生命周期 | clientId 每进程唯一，建议 keepalive=30 秒；实现自动重连，并在重连后重新订阅。keepalive 是接入建议，不是业务消息字段。 |
| 角色查询与聊天隔离 | 在线查询不使用聊天 agentId、target、room 或 prefix。查询设备另有自己的 clientId、sessionId、gameSessionId，见设备协议。 |

## 3. 网页发布 presence_query

MQTT 请求中没有 requestTopic 字段；订阅地址是双方事先约定的。网页内部登记接口返回的 query 对象包含 requestTopic，不能把 HTTP 返回对象与实际 MQTT 消息混为一谈。

调度器实际查询要求 serverId 为 1–65535 的十进制字符串，characterId 为 1–9223372036854775807 的十进制字符串，不带前导零。HTTP 文本参数校验更宽，但接入真实调度器时应满足这些约束。

| 字段 | 类型 / 必填 | 说明 |
| --- | --- | --- |
| type | string / 是 | 固定为 presence_query。 |
| requestId | string / 是 | 后台生成的 UUID，每批唯一。保存并在回传时原样返回，不要自行生成新的编号。 |
| serviceId | string / 是 | 必须与本提供方约定的服务编号一致。 |
| replyTopic | string / 是 | 这次查询的结果发布地址。与当前 serviceId 和 requestId 对应。 |
| expiresAt | integer / 是 | Unix 毫秒；本批有效期 180 秒，从后台登记时开始计时，不是从提供方收到时计时。 |
| characters | array / 是 | 1-50 个角色。业务唯一键是 serverId + characterId，不能只按名称或 characterId 匹配。 |
| characters[].serverId | string / 是 | 去掉首尾空白后 1-200 个字符。回传保持一致。 |
| characters[].characterId | string / 是 | 去掉首尾空白后 1-200 个字符。长 ID 必须保持字符串，不能转换为 JavaScript number。 |
| characters[].name | string / 否 | 最多 200 个字符，辅助查询用；缺少时按 ID 查询或返回 unknown，不能当成离线。 |

### 一批包含三个角色的请求（示例 UUID、时间，联调时以实际收到的消息为准）

```json
{
  "type": "presence_query",
  "requestId": "77a90183-bcb2-49a5-af54-17bf90295c2c",
  "serviceId": "aion2web",
  "replyTopic": "aion2/presence/aion2web/results/77a90183-bcb2-49a5-af54-17bf90295c2c",
  "expiresAt": 1788510600000,
  "characters": [
    {
      "serverId": "1001",
      "characterId": "281756451687386545",
      "name": "太白"
    },
    {
      "serverId": "1001",
      "characterId": "281756451687619142",
      "name": "看客户jn"
    },
    {
      "serverId": "1014",
      "characterId": "285415626384849587",
      "name": "青雨花梦"
    }
  ]
}
```

## 4. 网页接收 presence_result

online 只表示已确认在线；offline 只表示已确认离线。接口报错、权限不足、角色查不到、限流、不支持区服、无法判断，均返回 unknown，可填写具体 error。结果中不需要 serviceId、agentId、客服账号、ok、done 或 complete 字段。

此消息由调度器发布。设备应上报 events 而不是自己构造 presence_result。checkedAt 由调度器给出；网页 HTTP 重试保存时必须原样保留状态和 checkedAt。

| 字段 | 类型 / 必填 | 说明 |
| --- | --- | --- |
| type | string / 是 | 固定为 presence_result。 |
| requestId | string / 是 | 与收到的请求完全一致。 |
| results | array / 是 | 每条 MQTT 消息包含 1-50 条结果；只能包含本次请求的角色，不能把不同 requestId 的结果混在一起。 |
| results[].serverId | string / 是 | 原样返回请求中的 serverId。 |
| results[].characterId | string / 是 | 原样返回请求中的 characterId。 |
| results[].status | string / 是 | 只接受 online、offline、unknown，区分大小写。不要发送 true、false、0、1 或 stale 代替 status。 |
| results[].checkedAt | integer / 是 | 每个角色本次实际查询或失败发生的 Unix 毫秒时间，必须为正整数。不要返回 ISO 日期字符串或秒级时间戳。 |
| results[].error | string / 否 | 仅 status=unknown 时可提供；去掉首尾空白后 1-500 字符。不需要时省略，不要发送空字符串或 null。 |
| results[].name | string / 否 | 最多 200 字符，可省略。网页及数据库以原请求的角色名称为准。 |

### 一次回传在线、离线、查询失败三种结果

```json
{
  "type": "presence_result",
  "requestId": "77a90183-bcb2-49a5-af54-17bf90295c2c",
  "results": [
    {
      "serverId": "1001",
      "characterId": "281756451687386545",
      "status": "online",
      "checkedAt": 1788510548359
    },
    {
      "serverId": "1001",
      "characterId": "281756451687619142",
      "status": "offline",
      "checkedAt": 1788510549360
    },
    {
      "serverId": "1014",
      "characterId": "285415626384849587",
      "status": "unknown",
      "checkedAt": 1788510550360,
      "error": "查询服务未响应"
    }
  ]
}
```

## 5. 分批回传、去重和结束

1. 结果可以分批发布，每个请求使用自己的 requestId 和 replyTopic；每条结果消息 1–50 条。
2. 每个角色第一次有效结果是本次最终结果，包括 unknown；不要先发布 unknown 占位再试图覆盖。
3. 网页收齐后结束订阅；无单独 done 消息，不发送空 results。
4. QoS 1 可能重复。调度器和设备按请求及 attempt 标识去重，过期任务不得继续执行；不能因消息重发而重复发游戏查询。
5. 同角色并发查询由调度器合并，并分别回传各请求；成功结果可复用 10 秒缓存，保留原始 checkedAt。
6. MQTT PUBACK 不代表业务完成。调度器在发布结果前先完成 D1 保存；网页 HTTP saved=0 可能是已保存、重复或旧结果，不代表离线。
7. 网页断线重连后重新订阅同一 replyTopic，并用同一 requestId 请求剩余角色；关闭页面停止本页等待，但调度器仍可在期限内完成并保存结果。

## 6. 多客服隔离

HTTP 请求登记限制为每个客服最多 2 个未完成有效请求、每个 serviceId 最多 8 个；超限返回 429。网页按 50 个角色顺序分批。

调度器按客服公平分配任务，合并同角色请求；每台可用设备同时一个任务，并遵守设备上报的 cooldownMs。当前代码默认 leaseMs=25000、节点过期时间 90000ms、成功缓存 10000ms、日派发上限 20000 次（可由 DAILY_QUERY_LIMIT 配置）。这些是调度器默认值，不是游戏允许的查询速率承诺。

没有心跳有效的同区服查询设备时，立即返回 unknown 并说明缺少对应区服客户端；同区服设备忙碌时继续排队。失败或未知任务最多再换另一设备重试一次；超时不能改成 offline。网页自身没有自动重查 stale 状态的功能。旧 jobs、tasks/claim、tasks/complete HTTP 接口已删除。

1. 后台允许每个客服最多 2 批、同一服务最多 8 批同时进行，每批最多 50 个角色。并发额度不是每秒吞吐量保证。
2. 提供方自己控制工作并发和待处理队列，接近截止时间时返回 unknown / 服务繁忙，不要把暂时排队写成 offline。
3. 当前网页在后台登记遇到 429 时提示繁忙并停止本轮后续批次，尚未实现自动排队重试。
4. 同一服务建议只运行一个 requests 订阅实例，在实例内部调度多个工作线程。多个普通订阅实例会各收到一份相同请求；扩容需与管理员约定 Broker 分发方式或跨实例去重。

```text
设备连接成功：订阅 aion2/query-workers/{clientId}/{sessionId}/task
发布 state（含当前 serverId、递增 boot、seq 和 ready）
收到 task：校验目标 serverId 与实时游戏连接一致，再校验 expiresAt、gameSessionId、attemptId，按 attempt 去重
有能力执行才回传 accepted / sent；实际查询完成后发送 completed + status
失败发送 failed 或 rejected；不得把超时当成 offline
切服后先报告 ready=false / serverId=null，重新识别后再就绪；程序退出前尽力报告 ready=false
```

查询设备消息的精确字段见下方设备协议；此流程不能替代对真实游戏返回结果的关联校验。

## 7. 时间与无效消息处理

| 情况 | 实际行为 / 处理建议 |
| --- | --- |
| 超过 expiresAt | 网页停止接收该批，缺失角色显示未知。设备同时遵守 task 自己的 expiresAt（租约），不能把网页 180 秒期限当作设备租约。 |
| 时间戳校验 | checkedAt 必须不晚于接收时当前时间 60 秒；不得早于 expiresAt - 240000。服务端还限制 checkedAt <= expiresAt + 60000。这些是时钟偏差校验，不是延长回传窗口。 |
| 整包格式错误 | JSON 无法解析、results 为空或超过 50 条、任一条缺必填字段或状态非法，会导致整条 MQTT 结果消息被忽略。不会返回 MQTT 错误消息。 |
| 错误 Topic / requestId | 不属于当前订阅或当前请求的消息被忽略。 |
| 角色不匹配 / 重复 | 不在清单中的角色、重复角色结果不会计入查询进度。长 ID 不要用浮点数转换，防止精度丢失。 |
| 重连与缓存 | 网页重订阅 replyTopic；设备重订阅自己的 task。调度器合并并发并复用短期成功缓存，没有旧 HTTP claim 接口。 |
| 网页保存重试窗口 | 网页对已接收结果最多自动尝试保存三次；后台允许到期后 5 分钟内保存。此窗口仅供网页 HTTP 保存，不允许提供方迟发 MQTT。 |
| HTTP 保存返回 409 | 结果缺少调度器可信记录，或 status / checkedAt 与可信结果不一致。不能通过修改时间或伪造结果解决。 |

## 8. 联调验收

1. 先验证角色上传及只读分页，不要混用上传令牌、网页 Cookie 和 MQTT 设备凭据。
2. 管理员确认设备专用账号、ACL、clientId/sessionId 与 Broker 元数据一致，设备 state 显示正确的 serverId 和 ready。
3. 网页登记单个测试角色并发布请求，设备仅接收自己的 task，核对长角色 ID 无精度变化。
4. 关联 taskId/attemptId/gameSessionId 执行查询，分别验证 online、offline、unknown，超时保持 unknown。
5. 确认结果写入后刷新网页仍可读取；关闭网页不会使调度器已完成结果丢失。
6. 重复和过期任务不能重复执行；错账号不能发布其他设备 state/events 或订阅其他设备 task。
7. 多客服查询按 requestId 隔离；真实多设备并发需单独联调，不能仅凭单设备成功宣称通过。

## 9. 网页内部接口（提供方无需调用）

可见页面约每 10 秒读取可见角色的缓存；缓存刷新不触发游戏查询。online 和 offline 观测均在 180 秒后标 stale，unknown 不变。调度器负责可信结果持久化，网页保存只作兼容重试。新请求顺带清理过期超过 7 天的登记记录（每次最多 100 条）及关联证明，保留最近角色状态。

| 接口 | 用途 / 认证 |
| --- | --- |
| POST /api/presence/requests | 网页使用登录 Cookie，提交 {characters:[...]}，每批 1–50 个角色并校验所有区服权限；后台生成 requestId，登记客服归属及去重后的角色清单，返回 {ok:true,query:{type,requestId,serviceId,requestTopic,replyTopic,expiresAt,characters}}。400 参数错误、401 未登录、403 无区服权限、429 并发满额。 |
| POST /api/presence/results | 登录 Cookie，提交 presence_result；校验请求归属、角色、时间及调度器可信结果。返回 {ok:true,saved:N}；已保存或旧结果可为 0。无可信记录的 unknown 仅显示、不写数据库。400 参数错误、401 未登录、403 归属错误、409 未确认或不匹配、410 超过 expiresAt 后 5 分钟保存窗口。 |
| DELETE /api/presence/requests | 网页使用登录 Cookie，提交 {requestId:'UUID'}，释放自己的请求并发名额；不是发给提供方的取消消息。 |
| POST /api/presence/status | 登录 Cookie，提交 {characters:[{serverId,characterId}],maxAgeMs:180000}，最多 500 个，所有有效登录账号可查询全部区服。返回 {ok:true,statuses:[...]}，每项 serverId、characterId、name、online、status、checkedAt、updatedAt、sourceId。无记录时 unknown、online/时间为 null。online 与 offline 记录超过 maxAgeMs 均变 stale，online 布尔值仍代表旧观测，不能按它判断当前在线；unknown 保持 unknown。默认 maxAgeMs=180000。 |
| GET /api/mqtt/connection | 网页连接默认私有 Broker 时使用登录 Cookie 获取 {url,username,password}，不带 ok 字段；响应禁止缓存。401 未登录、503 服务端未配置 MQTT 凭据，错误体为 {error:"错误说明"}。提供方无需调用，应由管理员另行分配 Broker 凭据。 |

## 10. 查询设备协议

仅用于接入统一调度器的受信任设备。标识 clientId/sessionId/gameSessionId/taskId/attemptId 均为 1–100 位字母、数字、下划线或短横线。设备用户名 query-{clientId}，MQTT client ID 为 query-{clientId}-{sessionId}。state/events 不允许额外字段。

| 通道 | 载荷 |
| --- | --- |
| 发布 aion2/query-workers/{clientId}/{sessionId}/state | {clientId,sessionId,gameSessionId,serverId,boot,seq,ready,cooldownMs}。serverId 是 1–65535 的十进制字符串，尚未识别时为 null；ready=true 时不能为 null。boot 为持久化递增正安全整数，seq 为递增非负安全整数，ready 为 boolean，cooldownMs 为 0–60000 数字。旧 boot 或同 boot 旧 seq 被忽略。 |
| 订阅 aion2/query-workers/{clientId}/{sessionId}/task | {type:"query_player_online",taskId,attemptId,gameSessionId,serverId,characterId,expiresAt}。不得执行过期、其他游戏会话或 serverId 与实时游戏连接不一致的任务。 |
| 发布 aion2/query-workers/{clientId}/{sessionId}/events | {taskId,attemptId,gameSessionId,type,status?,error?}。type 为 accepted/sent/completed/failed/rejected；completed 必须带 online/offline/unknown，error 最多 500 字符。 |
| 内部 HTTP https://query.mmorpgchat.com/mqtt/events | POST，由 Broker 配置调用，Bearer WEBHOOK_TOKEN。载荷 {topic,clientid,username,payload} 的前三项必须来自 Broker 认证元数据；普通接入方不应伪造调用。不是使用 UPLOAD_API_TOKEN 的接口。 |
| 运维 https://query.mmorpgchat.com/status | GET，独立 Bearer ADMIN_TOKEN，返回 nodes、queued、deliveries、dispatchedToday、dailyLimit；不是网站登录 Cookie。 |
| 健康 https://query.mmorpgchat.com/health | GET，无认证，返回 {ok:true,service:"query-dispatch",configured:boolean}。健康不代表有可用游戏设备。 |
