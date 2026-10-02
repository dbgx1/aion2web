"""Run relay tests with a minimal mitmproxy host; MQTT/Paho remain real."""
import logging
import os
import runpy
import sys
import types
sys.dont_write_bytecode = True
sys.path.insert(0, os.environ['STRESS_PYTHON_PACKAGES'])
logging.getLogger('aion2.relay').addHandler(logging.NullHandler())
host = types.ModuleType('mitmproxy')
host.ctx = types.SimpleNamespace()
host.http = types.SimpleNamespace(HTTPFlow=object)
utils = types.ModuleType('mitmproxy.utils')
utils.asyncio_utils = types.SimpleNamespace()
sys.modules.update({'mitmproxy':host, 'mitmproxy.utils':utils})
path = sys.argv[1]
sys.argv = [path]
runpy.run_path(path, run_name='__main__')
