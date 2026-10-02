"""Prepare the existing verified client runtime for authenticated MQTT.

Credentials are read from mqtt.private.local.json alongside the executable.
No deployment management API credentials are included.
"""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
source = Path('E:/project/aion2/client/mitm_ws_message_monitor.py')
stage = root / 'artifacts/client-release/private-mqtt-20260912'
base = root / 'artifacts/aion2-client-20260911-character-name-v2.zip'
addon = source.read_text(encoding='utf-8')
assert 'self.mqtt.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)' in addon
compile(addon, 'private-mqtt-addon.py', 'exec')
with zipfile.ZipFile(base) as archive:
    for item in archive.infolist():
        target = (stage / item.filename).resolve()
        assert target.is_relative_to(stage.resolve())
    archive.extractall(stage)
target = stage / 'aion2-client/_internal/mitm_ws_message_monitor.py'
target.write_text(addon, encoding='utf-8')
readme = stage / 'aion2-client/私有消息服务说明.txt'
readme.write_text('私有 MQTT 客户端（2026-09-12）\n\n关闭旧客户端后，将完整目录解压到原客户端目录，再运行 aion2-client.exe。\n必须保留 _internal 文件夹和 mqtt.private.local.json。\n配置文件包含专属 MQTT 连接密码，请勿公开上传或分享给无关人员。\n默认连接深圳 EMQX 私有实例，TLS 8883；房间和主题前缀与网页一致。\n不需要安装 Python。首次运行的证书配置沿用原使用说明。\n', encoding='utf-8-sig')
print('Prepared private MQTT client:', stage)
