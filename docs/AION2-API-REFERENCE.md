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
