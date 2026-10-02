"""Apply the user's existing MQTT credentials as requested built-in defaults."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
config = json.loads((root / 'artifacts/client-release/private-mqtt-20260912/aion2-client/mqtt.private.local.json').read_text(encoding='utf-8-sig'))
path = Path('E:/project/aion2/client/mitm_ws_message_monitor.py')
source = path.read_text(encoding='utf-8')
for key in ('username', 'password'):
    assert isinstance(config.get(key), str) and config[key].strip(), 'Missing existing credentials'
    before = f"MQTT_{key.upper()} = os.getenv('AION2_MQTT_{key.upper()}') or _mqtt_config.get('{key}', '')"
    after = before + ' or ' + repr(config[key])
    if after in source:
        continue
    assert source.count(before + '\n') == 1, 'Unexpected credential initialization'
    source = source.replace(before + '\n', after + '\n', 1)
source = source.replace('ADDON_BUILD = "2026-09-14.precise-topics.1"', 'ADDON_BUILD = "2026-09-14.precise-topics.2"')
compile(source, str(path), 'exec')
path.write_text(source, encoding='utf-8')
print('Built-in MQTT defaults applied; configuration/environment overrides preserved.')
