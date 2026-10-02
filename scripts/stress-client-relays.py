"""Load real client relays; replace only mitmproxy hosting and game HTTP execution."""
import sys, os, json, time, threading, types, logging, socket
import inspect
import tempfile
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, os.environ['STRESS_PYTHON_PACKAGES'])
storage = tempfile.TemporaryDirectory(prefix='aion2-relay-stress-')
os.environ['AION2_RELAY_DATA_DIR'] = storage.name
source = Path(sys.argv[1]).read_text(encoding='utf-8-sig')
port, count = int(sys.argv[2]), int(sys.argv[3])
original_connect = socket.socket.connect
def local_connect(sock, address):
    if isinstance(address, tuple) and address[0] not in ('127.0.0.1', 'localhost', '::1'):
        raise RuntimeError('Stress harness blocks non-loopback connections')
    return original_connect(sock, address)
socket.socket.connect = local_connect
mitm = types.ModuleType('mitmproxy')
mitm.ctx = types.SimpleNamespace()
mitm.http = types.SimpleNamespace(HTTPFlow=object)
utils = types.ModuleType('mitmproxy.utils')
utils.asyncio_utils = types.SimpleNamespace()
sys.modules.update({'mitmproxy': mitm, 'mitmproxy.utils': utils})
logging.getLogger('aion2.relay').addHandler(logging.NullHandler())
logging.disable(logging.CRITICAL)
modules, relays = [], []
executed = 0
active = 0
max_active = 0
game_delay = float(os.environ.get('STRESS_GAME_DELAY_MS', '20')) / 1000
lock = threading.Lock()
resource_samples = []
resource_stop = threading.Event()
def monitor_resources():
    import ctypes
    class Counters(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_ulong), ('faults', ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in
            ('peakWorkingSet', 'workingSet', 'peakPagedPool', 'pagedPool', 'peakNonPagedPool', 'nonPagedPool', 'pagefile', 'peakPagefile')]
    previous_cpu, previous_wall = time.process_time(), time.monotonic()
    while not resource_stop.wait(1):
        current_cpu, current_wall = time.process_time(), time.monotonic()
        memory = Counters(); memory.cb = ctypes.sizeof(memory)
        rss = None
        if os.name == 'nt' and ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(-1), ctypes.byref(memory), memory.cb):
            rss = round(memory.workingSet / 2**20, 1)
        resource_samples.append({'at':round(time.time()*1000), 'cpuOneCorePercent':round((current_cpu-previous_cpu)/(current_wall-previous_wall)*100,1),
            'rssMB':rss, 'activeCommandsObserved':sum(len(getattr(r, '_active_commands', ())) for r in relays)})
        previous_cpu, previous_wall = current_cpu, current_wall
threading.Thread(target=monitor_resources, daemon=True).start()
def fake_game(*args):
    global executed, active, max_active
    with lock:
        active += 1
        max_active = max(max_active, active)
    time.sleep(game_delay)
    with lock:
        executed += 1
        active -= 1
    return {'ok': True, 'status': 200, 'simulated': True}
def emit(value):
    print(json.dumps(value), flush=True)
def pending_count(relay):
    return relay.pending_event_count() if hasattr(relay, 'pending_event_count') else len(relay._mqtt_outbox)
def make_probe():
    return relay_class(':memory:') if 'storage_path' in inspect.signature(relay_class).parameters else relay_class()
def acknowledge_probe(probe):
    if hasattr(probe, '_inflight'):
        for mid in list(probe._inflight): probe._on_mqtt_publish(None, None, mid)
try:
    for i in range(count):
        module = types.ModuleType('stress_relay_' + str(i))
        exec(compile(source, sys.argv[1], 'exec'), module.__dict__)
        module.print = lambda *a, **k: None
        module.MQTT_HOST, module.MQTT_PORT = '127.0.0.1', port
        module.AGENT_ID = f'load-{i}'
        module.MQTT_PREFIX = module.SIGNAL_PREFIX = 'stress'
        module.MQTT_ROOM = module.SIGNAL_ROOM = 'isolated'
        module._send_whisper_http = fake_game
        modules.append(module)
        relay_class = getattr(module, 'MqttRelay', None) or module.WebRtcRelay
        relay = relay_class()
        relays.append(relay)
        relay.start()
    until = time.monotonic() + 30
    while not all(r.ready.is_set() for r in relays) and time.monotonic() < until:
        time.sleep(.05)
    emit({'ready': sum(r.ready.is_set() for r in relays)})
    for line in sys.stdin:
        request = json.loads(line)
        if request['action'] == 'traffic':
            rate, seconds = request['rate'], request['seconds']
            started = time.monotonic()
            sent = 0
            stage = request.get('stage')
            sample_content = request.get('content')
            for tick in range(round(rate * seconds)):
                delay = started + tick / rate - time.monotonic()
                if delay > 0: time.sleep(delay)
                for i, relay in enumerate(relays):
                    now = time.time() * 1000
                    content = sample_content or f'load-{tick}-{i}'
                    relay.publish_chat({'type': 'chat_message', 'agentId': f'load-{i}',
                        'message_id': f'{stage}-{tick}-{i}' if stage else f'{tick}-{i}', 'time': modules[i].datetime.now(modules[i].timezone.utc).isoformat(),
                        'content': content, 'loadSentAt': now,
                        **({'loadStage': stage, 'loadIndex': tick} if stage else {}),
                        'chat_meta': {'kind': 'private', 'sender': f'role-{i}', 'content': content}})
                    sent += 1
            emit({'traffic': sent, 'generationMs': round((time.monotonic()-started)*1000)})
        elif request['action'] == 'stats':
            emit({'executed': executed, 'active': active, 'maxActiveGameCalls': max_active, 'gameDelayMs': game_delay * 1000, 'ready': sum(r.ready.is_set() for r in relays),
                  'outbox': sum(pending_count(r) for r in relays), 'resourceSamples': list(resource_samples)})
        elif request['action'] == 'offline_probe':
            probe = make_probe()
            for i in range(600):
                probe._publish_mqtt_event({'type':'chat_message', 'message_id':str(i), 'time':str(i), 'content':str(i)})
            emit({'offlineSubmitted':600,'offlineRetained':pending_count(probe)})
        elif request['action'] == 'replay_probe':
            import asyncio
            probe = make_probe()
            published = []
            def capture(topic, payload, **kwargs):
                published.append(json.loads(payload))
                return types.SimpleNamespace(rc=0, mid=len(published))
            probe.mqtt = types.SimpleNamespace(is_connected=lambda:True, publish=capture)
            asyncio.run(probe._publish_record({'type':'chat_message','message_id':'retained-chat','time':'test'}))
            acknowledge_probe(probe)
            for i in range(1001):
                probe._publish_mqtt_event({'type':'control_result','requestId':f'probe-{i}','time':'test','ok':True})
                acknowledge_probe(probe)
            probe._publish_pending_mqtt_events()
            emit({'chatSubmissions':1,'chatPublishes':sum(p.get('message_id')=='retained-chat' for p in published),'webrtcPending':len(getattr(probe, 'pending', []))})
        elif request['action'] == 'stop': break
finally:
    resource_stop.set()
    for relay in relays: relay.stop()
    for relay in relays:
        if relay.thread: relay.thread.join(timeout=3)
    storage.cleanup()
