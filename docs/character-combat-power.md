# 角色战斗力

角色上传接口 `/api/characters/upload` 新增可选字段 `combatPower`，兼容 `combat_power`。支持非负安全整数或对应数字字符串；小数、负数及无效类型会被拒绝。

```json
{"characters":[{"characterName":"角色名","characterId":"123","serverId":"1001","combatPower":123456}]}
```

角色查询接口返回 `combatPower`，角色数据库列表显示“战斗力”列。尚未采集为 `null`，页面显示“—”；实测为零则显示 `0`。

旧上传省略、传 `null` 或空字符串不会清空已有战斗力。新增字段不会自动推算历史角色的战斗力，采集端需上传该字段。

部署顺序：先应用 `0011_character_combat_power.sql` 数据库迁移，再发布应用。该迁移仅新增可空列，旧应用可以继续使用。验证入口：`node scripts/test-character-combat-power.mjs`。

已在生产通过已登录的 D1 控制台应用迁移并写入 `d1_migrations`（CLI D1 权限不足，未扩大令牌权限）。发布版本：`874c6828-a23b-4600-a591-63d01e17f1ef`。线上角色列表加载正常，“战斗力”列可见，历史未采集值显示“—”。校验、SQLite 迁移及兼容更新测试、角色查询回归、类型检查和生产构建均通过。
