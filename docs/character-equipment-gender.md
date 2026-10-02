# 角色装备等级与性别

`POST /api/characters/upload` 新增两个可选字段：

| 字段 | 来源与含义 | 接受值 |
| --- | --- | --- |
| `equipItemLevel` | 当前查询结果 `PlayerInfo.equipItemLevel`，角色整体装备等级 | 0–2147483647 的整数、纯数字字符串或 null；兼容 `equip_item_level` |
| `gender` | 当前查询结果 `PlayerInfo.gender`，SDK EGender 原始值 | 0 未指定、1 男、2 女；接受对应数字字符串或 null |

装备等级不是 `equipment[].itemLevel`（单件等级），也不是 `enchantLevel`（强化与突破合计）。示例装备等级仅用于演示，不代表实际角色。

```json
{"characters":[{"characterName":"角色名","characterId":"282882351594449880","serverId":"1005","equipItemLevel":3000,"gender":2}]}
```

字段省略或传 null：新角色保存 null，已有角色保留原值。0 是有效值，不能按空值处理。空字符串、布尔值、小数、负数、对象和越界值均返回 400，整批不写入。角色 ID 请保持字符串，避免 JavaScript 大整数精度丢失。

`GET /api/characters` 和 `GET /api/servers/:serverId/characters` 的角色对象均返回 `equipItemLevel`、`gender`；旧数据为 null。上传接口成功响应仍为 `{ok, received, written}`。官网实时 profile 接口不属于此数据库字段扩展。

先应用 `migrations/0021_character_equipment_gender.sql`，再发布应用；迁移仅新增可空列。此次修改不自动向网站上传游戏数据，也不修改采集端。

验证：`node scripts/test-character-equipment-gender.mjs`。
