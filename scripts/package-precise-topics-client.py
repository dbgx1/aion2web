"""Archive the freshly built and smoke-tested Windows client."""
import hashlib
import json
import os
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
embedded = os.environ.get('EMBEDDED_MQTT_DEFAULTS') == '1'
release = 'default-config' if embedded else 'precise-topics'
version = '2026-09-14.precise-topics.2' if embedded else '2026-09-14.precise-topics.1'
client = root / f'artifacts/client-release/{release}-20260914/aion2-client'
source = Path('E:/project/aion2/client')
output = root / f'artifacts/aion2-client-20260914-{release}.zip'
assert (client / 'aion2-client.exe').is_file()
addon = (source / 'mitm_ws_message_monitor.py').read_bytes()
assert (client / '_internal/mitm_ws_message_monitor.py').read_bytes() == addon
assert version.encode() in addon
smoke = json.loads((root / f'artifacts/client-{release}-smoke.json').read_text())
assert smoke['passed'] and smoke['build'] == version
if embedded:
    assert smoke['builtInCredentialsVerified']

(client / 'mqtt.private.example.json').write_bytes((source / 'mqtt.private.example.json').read_bytes())
readme = '''AION2 完整客户端 · BUILD_VERSION

Windows x64；不需要另装 Python。
完整解压后运行 aion2-client.exe，必须保留同目录的 _internal 文件夹。

更新：
1. 先更新网页并刷新页面，再退出旧客户端。
2. 将本目录内容覆盖到原安装目录，保留原来的 mqtt.private.local.json。
3. 启动 aion2-client.exe。保持原安装路径或固定 AION2_AGENT_ID，以沿用客户端编号和持久化记录。

首次配置：
将 mqtt.private.example.json 复制为 mqtt.private.local.json，填写自己的 MQTT 账号和密码。
已有配置或环境变量仍有效。本压缩包不包含私有连接密码。
默认私有 MQTT 使用 TLS 8883；区服识别、角色名上报、SQLite 离线队列和指令去重保持有效。

本版将聊天和执行回执拆为独立主题；旧网页无法接收新回执，请先更新网页。
源码说明见项目 docs/precise-mqtt-subscriptions.md。

运行：
默认使用 local:Aion2.exe 模式，通常需要以管理员身份运行。
首次运行时会提示安装本机生成的代理证书；不要复制其他电脑的证书和私钥。
启动异常可查看同目录 aion2-client.log。

验证范围：
已运行打包后的 EXE，验证本机 MQTT、mitmweb 页面及静态资源、过期指令去重、回执分流和持久队列清理。
未接入真实游戏，未测试生产消息服务权限；网站部署与客户端打包是独立步骤。
'''.replace('BUILD_VERSION', version)
if embedded:
    readme = readme.replace('将 mqtt.private.example.json 复制为 mqtt.private.local.json，填写自己的 MQTT 账号和密码。\n已有配置或环境变量仍有效。本压缩包不包含私有连接密码。',
                           '已按用户授权在通信模块内置私有 MQTT 账号密码，直接启动即可，无需另填配置。\n环境变量优先，其次为 mqtt.private.local.json，最后使用代码内置默认值。\n本包包含私有连接凭据。')
    readme = readme.replace('保留原来的 mqtt.private.local.json。', '如需覆盖内置配置，可保留原来的 mqtt.private.local.json。')
(client / '使用说明.txt').write_text(readme, encoding='utf-8-sig')

with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(client.rglob('*')):
        if not path.is_file():
            continue
        assert path.resolve().is_relative_to(client.resolve())
        if path.suffix in ('.log', '.sqlite3', '.db') or path.name == 'mqtt.private.local.json':
            continue
        assert not path.name.startswith('mitmproxy-ca'), path
        archive.write(path, Path('aion2-client') / path.relative_to(client))

with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert archive.read('aion2-client/_internal/mitm_ws_message_monitor.py') == addon
    for item in archive.infolist():
        assert archive.read(item.filename) == (client.parent / item.filename).read_bytes()
    count = len(archive.infolist())
report = {'file': str(output), 'bytes': output.stat().st_size, 'files': count,
          'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
          'build': version, 'freshPyInstallerBuild': True,
          'addonMatchesSource': True, 'crcAndFileComparisonPassed': True,
          'includesPrivateCredentials': embedded, 'executable': str(client / 'aion2-client.exe')}
(root / f'artifacts/client-{release}-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
