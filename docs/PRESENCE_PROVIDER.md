# AION2 在线查询服务接入文档

版本 1.0 · 更新 2026-09-22

适用于第三方查询客户端：订阅 MQTT 请求，使用自己的查询能力查角色，再把结果发布到请求指定的 replyTopic。无需运行聊天客户端，无需网站登录 Cookie 或上传令牌。本文描述当前已实现的手动查询协议。

## 1. 接入步骤

1. 与网站管理员确认 Broker 地址、传输方式、serviceId，以及该 Broker 是否需要账号和 Topic 权限。
2. 建立 MQTT 连接，每个提供方进程使用唯一 clientId；首次连接和每次重连成功后订阅请求 Topic，QoS 1。
3. 收到 presence_query，校验 type、serviceId、requestId、replyTopic、expiresAt 和角色清单。
4. 按 requestId 去重，把查询交给工作线程或异步任务，保持 MQTT 网络循环运行；调用你已有的角色在线查询能力。
5. 逐条或分批发布 presence_result，原样带回 requestId、serverId、characterId，使用 QoS 1、retain=false。
6. 在 expiresAt 前回传本批所有角色的最终状态。网页负责匹配请求、更新列表和保存数据库。

## 2. 连接参数与 Topic

两方必须连接同一个 Broker。请求编号用于业务隔离，不提供 MQTT 身份认证；若需要限制谁能查看或发布消息，必须在 Broker 上配置权限。不要把网站上传令牌当成 MQTT 密码。

| 参数 | 约定 |
| --- | --- |
| 协议 / 编码 | MQTT 3.1.1，UTF-8 JSON。本文示例使用 WSS。 |
| 默认 WSS 地址 | 默认使用网站配置的私有 EMQX Broker（WSS，端口 8084，路径 /mqtt）。请向管理员取得当前地址及提供方专用账号；旧公共 broker.emqx.io 已不再是网页默认连接。两方必须使用同一个 Broker。 |
| MQTT 身份验证 | 网页连接默认私有 Broker 前，通过登录 Cookie 调用 /api/mqtt/connection 获取连接凭据，随后携带 username/password 建立 MQTT 连接。提供方使用管理员另行分配的账号及 Topic ACL，无需网站 Cookie 或上传令牌。自定义 Broker 不会自动收到默认私有 Broker 的凭据。 |
| serviceId | 后端 PRESENCE_SERVICE_ID，默认 aion2web。1-100 个英文字母、数字、下划线或短横线，区分大小写；提供方应使用管理员确认的编号。 |
| 提供方订阅 | aion2/presence/{serviceId}/requests。默认示例：aion2/presence/aion2web/requests。 |
| 提供方发布 | aion2/presence/{serviceId}/results/{requestId}。每次使用收到的 replyTopic，并先检查其确实位于约定 serviceId 下、末尾与 requestId 一致。 |
| QoS / retain | 请求订阅和结果发布均为 QoS 1，结果 retain=false。不要发布保留结果或把请求作为保留消息。 |
| 连接生命周期 | clientId 每进程唯一，建议 keepalive=30 秒；实现自动重连，并在重连后重新订阅。keepalive 是接入建议，不是业务消息字段。 |
| 无关参数 | 不需要 agentId、target、聊天 Room、聊天 Topic Prefix 或网页客服 ID。不要订阅旧 control/agent Topic。 |

## 3. 接收请求 presence_query

MQTT 请求中没有 requestTopic 字段；订阅地址是双方事先约定的。网页内部登记接口返回的 query 对象包含 requestTopic，不能把 HTTP 返回对象与实际 MQTT 消息混为一谈。

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

## 4. 发布结果 presence_result

online 只表示已确认在线；offline 只表示已确认离线。接口报错、权限不足、角色查不到、限流、不支持区服、无法判断，均返回 unknown，可填写具体 error。结果中不需要 serviceId、agentId、客服账号、ok、done 或 complete 字段。

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

1. 可以查完一个角色就发布 results=[该角色结果]，也可以积累若干个后一起发布。一次请求的多条结果消息使用同一个 requestId 和 replyTopic。
2. 每个角色第一次通过校验的结果就是本次查询的最终结果，包括 unknown。不要先发送 unknown 占位再发送 online；后一次会被视为重复而忽略。
3. 网页收齐本批所有角色的结果后自动结束订阅；没有单独的业务完成消息，也不需要发送空 results 或 done=true。
4. QoS 1 允许重复消息。提供方按 requestId 对查询任务去重；完成后可短期缓存原始结果，用于收到同一请求时原样重发。不要因重发而修改 checkedAt。
5. 收到重复请求时，如果正在查询，不重复创建任务；如果已经完成且仍未过期，可以重发缓存结果。请求过期则直接丢弃。
6. MQTT PUBACK 只表示 Broker 确认消息，不代表网页已收到或数据库保存成功；当前没有应用层结果 ACK。
7. 网页在请求有效期内断线重连后，会重新订阅 replyTopic，并使用同一 requestId 重新请求尚未收到结果的角色；提供方必须按 requestId 和角色去重，不能重新执行已完成任务。网页关闭或离开页面会停止等待；无 MQTT 取消消息，以 expiresAt 为停止执行的最晚时间。

## 6. 多客服隔离

同一 requests Topic 会收到多个客服的查询。每个 requestId 对应独立任务及结果 Topic；不要用一个全局变量保存当前 requestId 或 replyTopic，否则并发时容易把甲的结果发给乙。

以 requestId 建立任务上下文，并将该请求的 replyTopic 绑定在上下文中。不同请求即便查同一角色，也必须分别回传到各自的 replyTopic；如复用查询结果，必须保留实际 checkedAt。网页侧尚未实现跨请求自动合并查询。

1. 后台允许每个客服最多 2 批、同一服务最多 8 批同时进行，每批最多 50 个角色。并发额度不是每秒吞吐量保证。
2. 提供方自己控制工作并发和待处理队列，接近截止时间时返回 unknown / 服务繁忙，不要把暂时排队写成 offline。
3. 当前网页在后台登记遇到 429 时提示繁忙并停止本轮后续批次，尚未实现自动排队重试。
4. 同一服务建议只运行一个 requests 订阅实例，在实例内部调度多个工作线程。多个普通订阅实例会各收到一份相同请求；扩容需与管理员约定 Broker 分发方式或跨实例去重。

```text
on_request(message):
    validate(message)
    if now_ms() >= message.expiresAt: return
    if already_running(message.requestId): return
    if cached_result(message.requestId):
        publish(message.replyTopic, original_cached_result, qos=1, retain=false)
        return
    context = register_task(message.requestId, message.replyTopic, message.expiresAt)
    enqueue(context, message.characters)

worker(context, character):
    if now_ms() >= context.expiresAt: return
    result = query_with_deadline(character, context.expiresAt)
    # Return only a final online/offline/unknown status.
    if now_ms() < context.expiresAt:
        publish(context.replyTopic, {
            type: 'presence_result',
            requestId: context.requestId,
            results: [result]
        }, qos=1, retain=false)
```

以上是语言无关的处理流程示意，query_with_deadline 由提供方用自己的查询功能实现，不是可以直接运行的 SDK。异常应转换为 unknown，MQTT 接收线程不得被长时间查询阻塞。

## 7. 时间与无效消息处理

| 情况 | 实际行为 / 处理建议 |
| --- | --- |
| 超过 expiresAt | 网页停止接收本批，缺失角色显示未知。提供方停止未开始的查询，不能依赖迟到回传补写。 |
| 时间戳校验 | checkedAt 必须不晚于接收时当前时间 60 秒；不得早于 expiresAt - 240000。服务端还限制 checkedAt <= expiresAt + 60000。这些是时钟偏差校验，不是延长回传窗口。 |
| 整包格式错误 | JSON 无法解析、results 为空或超过 50 条、任一条缺必填字段或状态非法，会导致整条 MQTT 结果消息被忽略。不会返回 MQTT 错误消息。 |
| 错误 Topic / requestId | 不属于当前订阅或当前请求的消息被忽略。 |
| 角色不匹配 / 重复 | 不在清单中的角色、重复角色结果不会计入查询进度。长 ID 不要用浮点数转换，防止精度丢失。 |
| 重连与缓存 | 重连后重新订阅 requests；本地待执行任务先检查是否过期。当前协议不提供离线任务补领或 HTTP claim。 |
| 网页保存重试窗口 | 网页对已接收结果最多自动尝试保存三次；后台允许到期后 5 分钟内保存。此窗口仅供网页 HTTP 保存，不允许提供方迟发 MQTT。 |

## 8. 联调验收

1. 管理员打开角色数据库或实时聊天页面，筛选测试角色并点击在线查询；当前不会因打开页面就自动向提供方发请求。
2. 提供方确认已订阅正确服务的 requests，能看到真实请求，检查长角色 ID 未变形。
3. 分别返回已确认在线、已确认离线、unknown，确认网页三种状态正确；刷新后仍能读到保存结果。
4. 请求至少 3 个角色，拆成多次回传，确认网页进度逐步增加、收齐后结束。
5. 重复发布同一角色结果，确认进度不增加；不要用重复发布改变本次角色结论。
6. 两位客服同时查询，记录各自 requestId 与 replyTopic，确认结果分别返回，不串任务。
7. 故意不返回一个角色，确认网页到期显示未知；故意返回错误字段，确认不会误显示为离线。
8. 模拟提供方断线重连，确认重新订阅且不执行过期请求；提供方日志建议记录 requestId、Topic、区服、角色 ID、耗时和结果。

## 9. 网页内部接口（提供方无需调用）

网页在页面可见时约每 10 秒读取当前可见角色的缓存；网络失败时退避重试。在线记录默认 180 秒后标为 stale，离线记录继续显示 offline。缓存刷新不触发提供方查询；手动查询按 50 个角色顺序分批，后台并发满额时停止后续批次。自动重查、跨客服请求合并和繁忙自动排队尚未实现。旧 jobs、tasks/claim、tasks/complete 接口已删除。

| 接口 | 用途 / 认证 |
| --- | --- |
| POST /api/presence/requests | 网页使用登录 Cookie，提交 {characters:[...]}，每批 1–50 个角色并校验所有区服权限；后台生成 requestId，登记客服归属及去重后的角色清单，返回 {ok:true,query:{type,requestId,serviceId,requestTopic,replyTopic,expiresAt,characters}}。400 参数错误、401 未登录、403 无区服权限、429 并发满额。 |
| POST /api/presence/results | 网页使用登录 Cookie，提交 presence_result；校验请求归属、角色、状态及时间后保存。返回 {ok:true,saved:N}，重复或较旧结果可能 N=0。401 未登录、403 请求不属于当前客服、400 参数不合法、410 保存期限已过。 |
| DELETE /api/presence/requests | 网页使用登录 Cookie，提交 {requestId:'UUID'}，释放自己的请求并发名额；不是发给提供方的取消消息。 |
| POST /api/presence/status | 使用登录 Cookie 提交 {characters:[{serverId,characterId}],maxAgeMs:180000}，最多 500 个角色，并校验区服权限。返回 {ok:true,statuses:[...]}；每项包含 serverId、characterId、name、online、status、checkedAt、updatedAt、sourceId。无记录为 unknown，online/时间为 null。只有在线记录超过 maxAgeMs 才变为 stale，离线与 unknown 不因超时改变。maxAgeMs 省略时默认 180000。 |
| GET /api/mqtt/connection | 网页连接默认私有 Broker 时使用登录 Cookie 获取 {url,username,password}，不带 ok 字段；响应禁止缓存。401 未登录、503 服务端未配置 MQTT 凭据，错误体为 {error:"错误说明"}。提供方无需调用，应由管理员另行分配 Broker 凭据。 |
