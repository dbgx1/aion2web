# 换号指令与实时状态发布记录

2026-09-16

- 网页：控制台新增管理员“远程换号与实时状态”面板。
- MQTT：定向 switchAccount/status/cancel 指令；QoS 1；拒绝 retained 和广播换号；control_progress 回传。
- 客户端：SQLite 记录 taskId、参数和快照；管道 login.switch；事件 + 查询补偿；重启只查询，不自动重发。
- 安全衔接：换号期间暂停聊天；结束后核对实际当前角色再恢复。
- 协议：E:/project/aion2/client/LOGIN-IPC-V1.md。
- 客户端源代码已更新，已有 EXE 的增量包：E:/project/aion2/build/aion2-account-switch-update-20260916.zip。
- 网页版本：ec3c21da-fda5-48b4-8b59-2801bbfcf24d。

验证：9 项命名管道测试、6 项实际客户端分发与独立模拟进程测试、10 项原聊天可靠性测试、16 项 AI 回归、桌面/手机界面状态测试、构建与 TypeScript 检查均通过。

未对真实游戏发出换号命令。真实登录进程还需要实现 login.switch；旧 EXE 用户需要应用增量包并重启。没有关闭正在运行的客户端或游戏。
