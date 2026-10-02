"""Local relay routing regression; no broker or game requests."""
import asyncio
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

sys.dont_write_bytecode = True
host = types.ModuleType('mitmproxy')
host.ctx = types.SimpleNamespace()
host.http = types.SimpleNamespace(HTTPFlow=object)
utils = types.ModuleType('mitmproxy.utils')
utils.asyncio_utils = types.SimpleNamespace()
sys.modules.update({'mitmproxy': host, 'mitmproxy.utils': utils})
spec = importlib.util.spec_from_file_location('relay', Path(r'E:\project\aion2\client\mitm_ws_message_monitor.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / 'relay.sqlite3'
    relay = module.MqttRelay(path)
    # Queue while offline, then reopen: topic routing must also cover old persisted rows.
    for record in [{'type': 'chat_message', 'message_id': 'chat'},
                   {'type': 'control_result', 'requestId': 'result', 'ok': True}]:
        relay.publish_chat(record)
    relay._db.close()
    relay._executor.shutdown()
    relay = module.MqttRelay(path)
    published = []
    def publish(topic, payload, **options):
        published.append((topic, json.loads(payload), options))
        return types.SimpleNamespace(rc=0, mid=len(published))
    relay.mqtt = types.SimpleNamespace(is_connected=lambda: True, publish=publish)
    relay._publish_pending_mqtt_events()
    assert [item[0] for item in published] == [relay.chat_event_topic, relay.receipt_event_topic]
    assert all(item[2]['qos'] == 1 and not item[2]['retain'] for item in published)
    assert relay.pending_event_count() == 2
    asyncio.run(relay._publish_record({'type': 'control_ack', 'requestId': 'ack'}))
    assert published[-1][0] == relay.receipt_event_topic and published[-1][2]['qos'] == 0
    for mid in (1, 2):
        relay._on_mqtt_publish(None, None, mid)
    assert relay.pending_event_count() == 0
    asyncio.run(relay._handle_control_message(json.dumps({'type': 'requestStatus'})))
    assert published[-1][0] == relay.agent_topic
    assert published[-1][1]['type'] == 'agent_status' and 'serverId' in published[-1][1]
    relay._db.close()
    relay._executor.shutdown()
print('PASS: chat/receipt/status separation, persisted replay and PUBACK deletion')
