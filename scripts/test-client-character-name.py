"""Verify the real status publisher without connecting to a public broker."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

sys.dont_write_bytecode = True
source = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as scratch:
    previous = Path.cwd()
    os.chdir(scratch)
    os.environ['AION2_RELAY_DATA_DIR'] = scratch
    try:
        spec = importlib.util.spec_from_file_location('client_name_test', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        relay = module.MqttRelay(Path(scratch) / 'test.sqlite3')
        published = []
        relay.mqtt = SimpleNamespace(
            is_connected=lambda: True,
            publish=lambda topic, payload, **options: published.append((topic, json.loads(payload), options)),
        )
        try:
            state = module.RuntimeState()
            state.update(characterId='self', serverKey='1001')
            profile_flow = SimpleNamespace(
                request=SimpleNamespace(pretty_url='https://lime-p2-api.global.plaync.com/objects/character.1001.self', raw_content=None, headers={}),
                response=SimpleNamespace(raw_content=json.dumps({'characterName': '资料里的本人'}).encode(), headers={}),
            )
            state.observe_response(profile_flow)
            assert state.client_identity()['characterName'] == '资料里的本人', 'Own profile response must reach heartbeat identity'
            state.remember_user('other', user_name='其他玩家', server_id='1001')
            state.remember_user('self', user_name='另一服同ID玩家', server_id='2001')
            assert state.client_identity()['characterName'] == '资料里的本人', 'Other players must not replace own name'
            state.update(characterId='next', serverKey='1001')
            assert state.client_identity()['characterName'] is None, 'Switching roles must clear stale name'
            state.apply_self_profile({'characterId': 'next', 'serverId': '1001', 'characterName': '新角色'})
            assert state.client_identity()['characterName'] == '新角色', 'Support characterName in self profile'
            state.update(serverKey='2001')
            assert state.client_identity()['characterName'] is None, 'Switching servers must clear stale name'
            early = module.RuntimeState()
            early.remember_user('self', user_name='先收到资料', server_id='1001')
            early.update(characterId='self', serverKey='1001')
            assert early.client_identity()['characterName'] == '先收到资料', 'Profile may arrive before login'
            login = module.RuntimeState()
            login.observe_request(SimpleNamespace(request=SimpleNamespace(
                pretty_url='https://lime-p2-api.global.plaync.com/gameLogin/loginWithToken', headers={},
                raw_content=json.dumps({'characterId': 'login-self', 'serverKey': '1001', 'characterName': '登录角色'}).encode())))
            assert login.client_identity()['characterName'] == '登录角色'
            for name in [None, '角色甲', '角色乙', None]:
                with module.runtime_state.lock:
                    module.runtime_state.data.update(userName=name, serverKey='1001', characterId='test-id')
                relay._publish_status('online')
                topic, payload, options = published[-1]
                assert payload['characterName'] == name
                assert payload['serverId'] == '1001'
                assert 'characterId' not in payload
                assert 'authorization' not in payload
                assert options['retain'] is True
                assert topic == relay.agent_topic
            print('PASS: real heartbeat publisher includes current name, updates names, handles unknown names, and adds no role ID or token')
        finally:
            relay._executor.shutdown(wait=True)
            if relay._db is not None:
                relay._db.close()
    finally:
        os.chdir(previous)
