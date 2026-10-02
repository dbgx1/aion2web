"""Split relay receipts without changing durable event keys or SQLite schema."""
from pathlib import Path

path = Path(r'E:\project\aion2\client\mitm_ws_message_monitor.py')
source = path.read_text(encoding='utf-8')
changes = [
    ('    @property\n    def control_topic(self) -> str:',
     '''    @property
    def receipt_event_topic(self) -> str:
        return f"{MQTT_PREFIX}/{MQTT_ROOM}/events/{AGENT_ID}/receipts"

    def _event_topic(self, record: dict[str, Any]) -> str:
        if record.get('type') in ('control_ack', 'control_result'):
            return self.receipt_event_topic
        if record.get('type') == 'agent_status':
            return self.agent_topic
        return self.chat_event_topic

    @property
    def control_topic(self) -> str:'''),
    ('info = self.mqtt.publish(self.chat_event_topic, payload, qos=1, retain=False)',
     'info = self.mqtt.publish(self._event_topic(json.loads(payload)), payload, qos=1, retain=False)'),
    ('self.mqtt.publish(self.chat_event_topic, json.dumps(record, ensure_ascii=False), qos=0, retain=False)',
     'self.mqtt.publish(self._event_topic(record), json.dumps(record, ensure_ascii=False), qos=0, retain=False)'),
    ('''            await self._publish_record({'type': 'agent_status', 'agentId': AGENT_ID,
                'status': 'online', 'time': datetime.now(timezone.utc).isoformat(),
                'state': runtime_state.snapshot(redact=True)})''',
     '''            self._publish_status('online')'''),
]
for before, after in changes:
    if after in source:
        continue
    if source.count(before) != 1:
        raise RuntimeError('Unexpected relay source; refusing a partial update')
    source = source.replace(before, after, 1)
path.write_text(source, encoding='utf-8')
print('Updated relay receipt routing:', path)
