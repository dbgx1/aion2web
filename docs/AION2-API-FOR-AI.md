# AION2 接口参考

核对日期：2026-10-01。面向编写上传脚本、角色查询工具和在线状态客户端的开发者及 AI。

站点地址：https://mmorpgchat.com 。本文依据当前项目路由、参数校验、数据库写入逻辑及查询调度器实现核对。包含角色 HTTP 接口、认证、在线查询 MQTT 协议和阵营消息协议；其他控制台内部接口仅在附录列出，不视为完整接入契约。示例均为占位数据，不包含生产密钥。

## 1. 接入前必读

- 游戏角色唯一键是 `serverId + characterId`。`characterId` 必须用字符串保存，避免长整数精度丢失。
- `id` 是本站数据库数字编号；它与游戏 `characterId` 不同，编辑和删除使用 `id`。
- 所有时间戳均为 Unix 毫秒，示例时间不能直接复用。
- 上传令牌只用于明确支持 Bearer 的接口。它不是 MQTT 密码，也不能替代其他接口要求的登录 Cookie。
- `online`、`offline`、`unknown`、`stale` 含义不同：没有结果、超时、错误均不能解释为离线。
- 本文参数示例使用规范字段名。不要将未知字段或未来设想当成已实现功能。

## 2. 认证与令牌

| 接口 | 认证 |
| --- | --- |
| `POST /api/characters/upload` | 管理员 Cookie 或 `Authorization: Bearer <UPLOAD_API_TOKEN>` |
| `GET /api/servers/{serverId}/characters` | 登录 Cookie 或上传令牌；所有有效登录账号可访问全部区服 |
| `GET /api/characters/profile` | 登录 Cookie 或上传令牌；所有有效登录账号可访问全部区服 |
| `GET /api/admin/upload-token` | 仅管理员 Cookie，不能使用 Bearer 换取令牌 |
| 其他本文介绍的站点 HTTP 接口 | 登录 Cookie，管理员专属接口仍校验管理员角色 |

管理员打开 `/docs` 可查看和复制当前 `UPLOAD_API_TOKEN`。下载文件不嵌入真实令牌；由管理员另行提供给获准使用的程序。原始令牌具有全局权限，不要把它当成限制到单个客服或单个区服的凭据。

`GET /api/admin/upload-token` 成功返回 `{ "ok": true, "token": "<UPLOAD_API_TOKEN>" }`。401 未登录、403 非管理员、503 当前环境未配置；响应为 `Cache-Control: private, no-store`。

登录：`POST /api/auth`，JSON `{ "username": "<USERNAME>", "password": "<PASSWORD>" }`。成功返回 `{ok:true,authenticated:true,user}` 并设置 `aion_admin_session` Cookie。客户端应使用 Cookie 容器保存和发送；Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下为 Secure。

`GET /api/auth` 查询当前身份，未登录返回 401；成功包含 `user.userKey`、`username`、`role` 和 `scopeKey`。`DELETE /api/auth` 清除登录 Cookie。登录失败为 401。`UPLOAD_API_TOKEN` 不应放入 URL。

常见错误格式：`{ "ok": false, "error": "错误说明", "details": ["字段错误"] }`，其中 `details` 可省略。MQTT 连接凭据接口的错误只有 `error`，调度器部分错误为纯文本，不能统一假定所有响应都含 `ok`。

## 3. 上传角色

`POST /api/characters/upload`，`Content-Type: application/json`。

请求可以是 `{characters:[...]}` 或直接是角色数组。每批 **1–200** 个角色，请求体上限 **1,000,000 字节**。整批参数校验完成后才写入；任意角色校验失败返回 400。按 `serverId + characterId` 新增或更新。

```json
{
  "characters": [{
    "characterName": "示例角色",
    "characterId": "281756451687386545",
    "serverId": "1001",
    "serverName": "示例区服",
    "legionName": "示例军团",
    "legionPosition": 0,
    "level": 50,
    "combatPower": 123456,
    "equipItemLevel": 3000,
    "gender": 2,
    "className": "剑星",
    "faction": "天族",
    "avatarUrl": "",
    "metadata": null
  }]
}
```

| 字段 | 类型与校验 | 更新规则 |
| --- | --- | --- |
| characterName / characterId / serverId | 必填，文本化、去首尾空白、截断至 100 字符后非空；推荐始终传字符串 | 覆盖；ID 联合定位角色 |
| serverName / legionName / className | 文本，最多 100 字符 | 省略清空 |
| faction / avatarUrl | 文本，最多 50 / 500 字符 | 省略清空 |
| level | 0–999 整数，可转整数的数字字符串也接受 | 省略、null、空字符串写 0 |
| combatPower | 非负安全整数，最大 9007199254740991，接受数字字符串 | 省略、null、空字符串保留旧值；新记录为 null；0 有效 |
| equipItemLevel | 整体装备等级，0–2147483647 整数或纯数字字符串 | 省略或 null 保留旧值，新记录为 null；空字符串不合法 |
| gender | 0 未指定、1 男、2 女；对应数字或数字字符串 | 省略或 null 保留旧值；新记录为 null；0 不等于未知 |
| legionPosition | 0 军团长、1 军团干部、2 军团成员、3 雇佣兵；对应数字或数字字符串 | 省略保留旧值，新记录为 null；显式 null 清空 |
| metadata | 对象或 null；不接受 JSON 字符串、数组 | 省略或 null 清空 |

兼容别名：`character_name` / `name` → characterName，`character_id` → characterId，`server_id` / `serverKey` → serverId，`server_name` → serverName，`legion_name` / `guildName` / `guild_name` → legionName，`legion_position` → legionPosition，`combat_power` → combatPower，`equip_item_level` → equipItemLevel，`class_name` → className，`avatar_url` → avatarUrl，`metadata_json` → metadata（仍须对象）。同一字段提供多个别名时按解析器列出的顺序取第一个非 undefined 值，优先使用规范字段名。

旧字段 `isLegionLeader` / `is_legion_leader` 已停用：未提供 legionPosition 而仅提供旧字段会返回 400；不能把旧布尔值转换成职位 0/1。

成功：`{"ok":true,"received":1,"written":1}`。`written` 是数据库报告的写入数量，不是仅新增数量。400 参数错误；401 无有效令牌或管理员登录态；413 请求体过大。

```sh
curl 'https://mmorpgchat.com/api/characters/upload' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $UPLOAD_API_TOKEN" \
  --data-binary @characters.json
```

## 4. 按区服分页读取角色

`GET /api/servers/{serverId}/characters`。外部脚本优先使用这个接口。

| 参数 | 规则 |
| --- | --- |
| serverId（路径） | 必填；去空白并截断至 100 字符 |
| limit | 默认 200，限制在 1–500 |
| cursor | 首次 0 或省略，随后传 `page.nextCursor` |
| q | 角色名或角色 ID 搜索，最多 100 字符 |
| legionName | 军团名筛选，最多 100 字符 |
| withoutLegion | `1` 仅无军团，优先于 legionName |
| includeTotal | `1` 才统计总数，否则 totalCount 为 null |

```json
{
  "ok": true,
  "server": {"serverId":"1001","serverName":"示例区服","known":true},
  "characters": [{"id":1,"characterId":"281756451687386545","characterName":"示例角色","serverId":"1001","legionPosition":0,"equipItemLevel":3000,"gender":2}],
  "page": {"cursor":0,"limit":200,"nextCursor":null,"hasMore":false},
  "totalCount": null
}
```

角色对象另含 serverName、legionName、level、combatPower、className、faction、avatarUrl、lastSeenAt。combatPower、equipItemLevel、gender、legionPosition 未采集时为 null。列表不返回上传的完整 metadata。

每页都携带认证。以 hasMore=false / nextCursor=null 结束；切换条件后重置游标。401 鉴权失败，400 空 serverId。所有有效登录账号可读取全部区服，无需分配。

```sh
curl 'https://mmorpgchat.com/api/servers/1001/characters?limit=500&cursor=0' \
  -H "Authorization: Bearer $UPLOAD_API_TOKEN"
```

## 5. 通用列表与目录

`GET /api/characters`，仅登录 Cookie。结果限定为当前账号有权访问的区服。

| 参数 | 规则 |
| --- | --- |
| directory | `1` 返回区服军团目录，此时不执行列表筛选 |
| serverId / legionName / withoutLegion / q | 区服、军团、无军团、角色名或 ID 搜索 |
| characterId / characterName | 精确匹配；同时提供以 characterId 为准，推荐带 serverId |
| raceId | 0 全部、1 天族、2 魔族；默认 0 |
| chatStatus | all / chatted / unchatted；默认 all |
| legionLeadersOnly | `1` 筛选 legionPosition=0 |
| sort | default / power_desc / power_asc；未采集战力排最后 |
| cursor | 首次 0，后续原样传顶层 nextCursor；战力排序时是字符串，放入 URL 时编码 |
| limit | 默认 50，普通最大 100；bulk=1 最大 1000 |
| bulk / includeTotal | bulk=1 不统计总数；普通默认统计，includeTotal=0 可关闭 |

列表返回 `{ok:true,characters:[...],nextCursor,hasMore,totalCount}`。此接口分页信息在顶层，不是第 4 节的 page 对象。目录返回 `{ok:true,servers:[...]}`；每个区服含 raceId、serverId、serverName、characterCount、unaffiliatedCount、legions（legionName、memberCount）。401 未登录，400 非法筛选/排序/游标。

### 公屏玩家加入角色数据库

控制台点击公屏玩家名称或“私聊”时，会先确保角色已入库，再打开私聊；已有角色直接复用。入库失败时保留在公屏并提示原因，不自动发送消息。

`POST /api/characters`，仅有效登录 Cookie（管理员和子账号均可），同源请求。请求体不超过 8KB：

```json
{"characterName":"玩家名称","characterId":"619807898717071672","serverId":"2202"}
```

三个字段均为必填字符串，长度 1–100；角色 ID 必须保留为字符串，避免大整数精度丢失。
按 `serverId + characterId` 去重。新增时只保存身份信息与公屏来源；已存在时返回原记录，不覆盖等级、战力、军团等资料。
响应为 `{ok:true,created:true|false,character:{...}}`，角色字段与通用列表一致。400 身份信息无效，401 未登录，403 来源或区服权限无效，413 请求体过大。

## 6. 官网角色资料

`GET /api/characters/profile?serverId=1001&characterName=<精确角色名>`，支持登录 Cookie 或 `Authorization: Bearer <UPLOAD_API_TOKEN>`。所有有效登录账号均可查询全部区服，无需分配。

支持台服和 Steam 国际服。`region=TW|GLOBAL` 可选（不区分大小写），省略按区服 ID 识别；显式地区与区服不匹配返回 400，不会静默改查其他地区。characterName 必填，去首尾空白后 1–100 字符，精确匹配；serverId 必填，为支持的四位区服编号。

国际服区服编号第二位区分区域：1 美东 nae、2 美西 naw、3 欧洲 eu、4 南美 la、5 亚洲 as；第一位 1 天族、2 魔族。例如 2201 为美西 Israphel，1501 为亚洲 Siel，2501 为亚洲 Israphel；1001/2001 属于台服。

```sh
curl 'https://mmorpgchat.com/api/characters/profile?region=GLOBAL&serverId=2201&characterName=wangjw98' \
  -H "Authorization: Bearer $UPLOAD_API_TOKEN"
```

找到返回 `{ok:true,found:true,source:"ncsoft",region:"GLOBAL",subRegion:"naw",partial:false,warnings:[],profile}`；未找到返回 HTTP 200、`{ok:true,found:false}`，不是 404。profile 包含 characterId（官网不透明标识，可能带百分号编码，与上传接口的游戏数字 ID 不同）、name、serverId、serverName、level、className、combatPower、itemLevel、profileImageUrl、profileUrl、region、race、pcId、genderName、raceName、titleName、stats、titles、daevanion、equipment、pet、wing、skills。国际服资料默认为英文。

数据直接从 NCSoft 官网服务读取，不依赖 Shugo.GG 代理。profileUrl：台服为官网页面，国际服为 Shugo.GG 角色页面（仅供浏览）。接口只读，不写入本站角色数据库，不返回数据库职位 legionPosition，也不代表游戏内实时在线状态。

搜索或主资料失败返回错误；装备或技能资料不完整时仍可返回主资料，但标记 `partial:true` 并附 warnings。此时空装备/技能列表不能视为已确认角色没有这些内容。上游搜索索引和详情可能存在同步延迟。每次请求先搜索，再并行读取详情与装备，每个上游请求最长等待 8 秒；请避免批量高频轮询。

400 参数缺失、过长、地区或区服不支持；401 未登录且令牌无效；502 上游连接、格式或角色匹配错误；503 上游搜索或主资料限流，稍后重试。

## 7. 修改与删除角色

`PATCH /api/characters` 和 `DELETE /api/characters` 均仅接受登录 Cookie。所有有效登录账号可操作全部区服，但角色不能被其他客服重点跟踪。携带 Origin 时必须与请求 URL 同源；请求文本上限 8192 字符。

PATCH 必须提供完整可编辑字段：

```json
{"id":1,"name":"示例角色","legionName":"示例军团","className":"剑星","faction":"天族","level":50,"combatPower":123456,"legionPosition":1}
```

`id` 为正安全整数；name、legionName、className、faction 均为最多 100 字符字符串，name 去空白后非空。level 为 0–999 整数；combatPower 为非负安全整数或 null；legionPosition 为 0–3 整数或 null。数值不接受数字字符串。这里 null 清空战力或职位。字段为 `name`，不是上传接口的 characterName；此编辑接口不修改 equipItemLevel 或 gender。

DELETE 请求：`{"id":1,"confirm":true}`。删除角色及关联聊天、跟踪记录；没有撤销接口，后续采集可能重建该角色。

成功 `{ok:true}`；400 参数错误、401 未登录、403 Origin 不匹配、409 不存在/被其他客服跟踪、413 请求过大。

## 8. 阵营消息 MQTT

使用当前管理员确认的 Broker、prefix、room、agentId。默认 prefix 为 `aion2-chat-bridge`，room 为 `aion2-local`。

发布 Topic：`{prefix}/{room}/control/agent/{agentId}`，QoS 0，retain=false。订阅回执：`{prefix}/{room}/events/{agentId}/receipts`。

```json
{
  "type":"sendFactionMessage",
  "requestId":"<唯一请求编号>",
  "serverKey":"2201",
  "content":"<阵营消息内容>",
  "expiresAt":1800000030000,
  "target":"<agentId>",
  "sender":"portal-<唯一请求编号>",
  "sessionId":"portal-<唯一请求编号>",
  "time":"<当前 ISO 8601 时间>"
}
```

expiresAt 实际设为当前毫秒时间加 30000；serverKey 校验当前游戏服务器。客户端使用当前登录角色并调用游戏 WORLD 频道。应先在游戏内发消息采集身份信息。

通过 requestId 匹配 control_result：confirmed 游戏接口确认、failed 游戏接口拒绝、not_sent 未执行、unknown 结果未知。MQTT 发布成功不等于游戏内发送成功；结果未知时核对游戏记录，不自动重发。同一 requestId 供客户端去重。

## 9. 提供给其他 AI 的使用方式

将下载的完整 Markdown 文件作为上下文，并单独提供所需凭据、实际 serverId、目标角色及操作范围。先实现只读查询，再经授权执行上传、修改或删除。不要将生产凭据硬编码到生成代码、日志或版本库。

下方在线查询章节与网站在线查询文档共用同一份协议数据，包含当前调度器流程和 HTTP 保存限制。

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

# 附录：当前站点 HTTP 路由清单

以下由路由源文件生成。正文未展开的 AI、聊天、客服和跟踪接口属于控制台内部功能，不能仅凭路径推测请求字段或权限。此清单不是 OpenAPI 规范；query.mmorpgchat.com 的独立调度器接口见在线查询章节。

| 方法 | 路径 |
| --- | --- |
| GET, POST | `/api/admin/accounts` |
| GET | `/api/admin/cloudflare-usage` |
| GET | `/api/admin/upload-token` |
| POST | `/api/ai/chat` |
| GET, PUT | `/api/ai/persona` |
| GET, POST | `/api/ai/reception` |
| GET, POST, DELETE | `/api/auth` |
| POST | `/api/auth/register` |
| GET, POST | `/api/character-tracking` |
| POST, PATCH, DELETE, GET | `/api/characters` |
| GET | `/api/characters/profile` |
| POST | `/api/characters/upload` |
| GET, POST | `/api/guild-tracking` |
| GET | `/api/intelligence` |
| GET, POST | `/api/messages` |
| GET | `/api/mqtt/connection` |
| POST, DELETE | `/api/presence/requests` |
| POST | `/api/presence/results` |
| POST | `/api/presence/status` |
| GET | `/api/server-access` |
| GET | `/api/servers/{serverId}/characters` |
