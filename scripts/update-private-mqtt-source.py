from pathlib import Path

root = Path('E:/project/aion2')
source = root / 'client/mitm_ws_message_monitor.py'
addon = source.read_text(encoding='utf-8')
assert 'MQTT_USERNAME' not in addon, 'Already updated; inspect instead of overwriting'
addon = addon.replace('import socket\n', 'import socket\nimport sys\n', 1)
addon = addon.replace('ADDON_BUILD = "2026-09-11.character-name.2"', 'ADDON_BUILD = "2026-09-12.private-mqtt.1"', 1)
config = '''
def _load_mqtt_configuration():
    directory = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
    filename = Path(os.getenv('AION2_MQTT_CONFIG', str(directory / 'mqtt.private.local.json')))
    if not filename.is_file():
        return {}
    value = json.loads(filename.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict):
        raise ValueError('MQTT configuration must be a JSON object')
    return value


_mqtt_config = _load_mqtt_configuration()
for _key, _env in [('host', 'AION2_MQTT_HOST'), ('port', 'AION2_MQTT_PORT'), ('room', 'AION2_RELAY_ROOM'), ('prefix', 'AION2_SIGNAL_PREFIX')]:
    if _key in _mqtt_config:
        os.environ.setdefault(_env, str(_mqtt_config[_key]))
MQTT_USERNAME = os.getenv('AION2_MQTT_USERNAME') or _mqtt_config.get('username', '')
MQTT_PASSWORD = os.getenv('AION2_MQTT_PASSWORD') or _mqtt_config.get('password', '')
'''
addon = addon.replace('MQTT_PREFIX = ', config + '\nMQTT_PREFIX = ', 1)
addon = addon.replace('"AION2_MQTT_HOST", "broker.emqx.io"', '"AION2_MQTT_HOST", "od43e177.ala.cn-shenzhen.emqxsl.cn"', 1)
addon = addon.replace('        client_id = f"aion2-agent-', '''        if MQTT_HOST.endswith('.emqxsl.cn') and (not MQTT_USERNAME or not MQTT_PASSWORD):
            print('[RELAY] 私有 MQTT 尚未配置账号，请填写 mqtt.private.local.json 后重启客户端', flush=True)
            return

        client_id = f"aion2-agent-''', 1)
addon = addon.replace('        self.mqtt.reconnect_delay_set(min_delay=1, max_delay=15)', '''        if MQTT_USERNAME:
            self.mqtt.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        self.mqtt.reconnect_delay_set(min_delay=1, max_delay=60)''', 1)
compile(addon, str(source), 'exec')
source.write_text(addon, encoding='utf-8')
ignore = root / '.gitignore'
ignore.write_text(ignore.read_text(encoding='utf-8').rstrip() + '\n*.private.local.json\n', encoding='utf-8')
(root / 'client/mqtt.private.example.json').write_text('''{
  "host": "od43e177.ala.cn-shenzhen.emqxsl.cn",
  "port": 8883,
  "username": "aion2-private",
  "password": "",
  "room": "aion2-local",
  "prefix": "aion2-chat-bridge"
}
''', encoding='utf-8')
(root / 'client/PRIVATE-MQTT.md').write_text('''# 私有 MQTT 接入

默认连接 `od43e177.ala.cn-shenzhen.emqxsl.cn:8883`，使用 TLS 和 MQTT 用户名/密码。
部署 App ID / App Secret 仅用于管理 API，不能当成 MQTT 账号。

源码运行时，把 `mqtt.private.example.json` 复制为本目录的 `mqtt.private.local.json`，填写 MQTT 密码。
打包客户端把配置放在 `aion2-client.exe` 旁边。更新前关闭旧客户端，完整解压后启动。
配置已被 Git 忽略，不要公开上传包含配置的客户端包。

可用 `AION2_MQTT_CONFIG` 指定配置路径；`AION2_MQTT_HOST`、`AION2_MQTT_PORT`、
`AION2_MQTT_USERNAME`、`AION2_MQTT_PASSWORD`、`AION2_RELAY_ROOM`、`AION2_SIGNAL_PREFIX`
环境变量优先于配置文件。缺少私有实例密码时不会反复匿名重连，也不会退回公共服务。
''', encoding='utf-8')
print('Updated client source, ignored private configuration, and added setup guide')
