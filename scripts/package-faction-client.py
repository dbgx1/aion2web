"""Stage and archive the existing frozen runtime with current client modules."""
from pathlib import Path
import shutil
import sys
import json
import hashlib
import zipfile

root = Path(__file__).resolve().parent.parent
source = Path('E:/project/aion2/client')
runtime = root / 'artifacts/client-release/precise-topics-20260914/aion2-client'
stage = root / 'artifacts/client-release/faction-20260917/aion2-client'
output = root / 'artifacts/aion2-client-full-20260917-faction.zip'
modules = ['mitm_ws_message_monitor.py', 'account_switch.py', 'login_bridge.py', 'login_protocol.py']

def allowed(path, rel):
    if any(part in ('__pycache__', '.mitmproxy') for part in rel.parts): return False
    if path.name in ('mqtt.private.local.json', '使用说明.txt', '新版使用说明.txt'): return False
    if path.name.startswith('mitmproxy-ca'): return False
    if path.suffix.lower() in ('.log', '.jsonl', '.sqlite', '.sqlite3', '.db', '.key', '.pem'):
        return rel.as_posix() == '_internal/certifi/cacert.pem'
    if path.name.endswith(('-wal', '-shm', '-journal')): return False
    return True

if '--archive' not in sys.argv:
    assert not stage.exists(), 'Release staging directory already exists; inspect before replacing'
    for path in runtime.rglob('*'):
        rel = path.relative_to(runtime)
        if not path.is_file() or not allowed(path, rel): continue
        target = stage / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    for name in modules:
        content = (source / name).read_bytes()
        compile(content, name, 'exec')
        (stage / '_internal' / name).write_bytes(content)
    for name in ['mqtt.private.example.json', 'LOGIN-IPC-V1.md']:
        shutil.copy2(source / name, stage / name)
    (stage / 'start-dual-process.cmd').write_bytes(b'@echo off\r\nset "AION2_MITM_MODE=local:Aion2.exe,AION2.exe"\r\ncd /d "%~dp0"\r\n"%~dp0aion2-client.exe"\r\n')
    (stage / '使用说明.txt').write_text('''AION2 完整客户端 · 2026-09-17.faction.1

完整解压 aion2-client 文件夹，保留 _internal，无需安装 Python。
退出旧客户端后更新，保留原有 mqtt.private.local.json 和本地运行数据。
运行 start-dual-process.cmd，可同时代理 Aion2.exe 和 AION2.exe。
登录游戏后先在游戏内发送一条消息，采集当前角色身份和 optional。
刷新网页，进入实时消息 → 公频，输入消息并点击“发送阵营消息”。
Enter 发送，Shift+Enter 换行。等待游戏接口回执后才显示成功。
结果未知时请核对游戏记录，不要重复发送。换角色后需要重新采集身份。

保留当前源代码的连接默认设置，本包不包含本机配置、游戏登录记录、
聊天数据、运行日志或个人代理证书。可通过 mqtt.private.local.json 覆盖连接设置。
本次复用已验证的 Windows x64 启动器和依赖，更新外部模块；未重新编译 EXE。
验证使用隔离的本机消息服务，不会向真实游戏发送测试消息。
''', encoding='utf-8-sig')
    print('Staged:', stage)
else:
    for name in modules:
        assert (stage / '_internal' / name).read_bytes() == (source / name).read_bytes()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(stage.rglob('*')):
            rel = path.relative_to(stage)
            if path.is_file() and (allowed(path, rel) or rel.as_posix() == '使用说明.txt'):
                archive.write(path, 'aion2-client/' + rel.as_posix())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        for item in archive.infolist():
            assert archive.read(item.filename) == (stage.parent / item.filename).read_bytes()
        for name in ['aion2-client.exe', '_internal/python312.dll', '_internal/base_library.zip', '_internal/certifi/cacert.pem']:
            assert archive.getinfo('aion2-client/' + name).file_size > 0
        count = len(archive.infolist())
    report = {'path': str(output), 'bytes': output.stat().st_size, 'files': count,
              'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'build': '2026-09-17.faction.1',
              'archiveVerified': True, 'modulesMatchSource': True, 'freshExeBuild': False}
    (root / 'artifacts/client-faction-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
