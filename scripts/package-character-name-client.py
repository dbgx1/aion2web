"""Build a full client archive from the verified runtime and current addon."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

root = Path(__file__).resolve().parent.parent
base = Path('E:/project/aion2/build/aion2-client-20260910.zip')
source = Path('E:/project/aion2/client/mitm_ws_message_monitor.py')
output = root / 'artifacts/aion2-client-20260911-character-name-v2.zip'
stage = root / 'artifacts/client-release/character-name-20260911-v2'
addon_name = 'aion2-client/_internal/mitm_ws_message_monitor.py'
addon = source.read_bytes()
compile(addon, str(source), 'exec')
readme = '''完整客户端：角色名识别修正版（2026-09-11.character-name.2）

完整解压后运行 aion2-client.exe，保留旁边的 _internal 文件夹。
不需要另外安装 Python。更新前先退出旧客户端。
如需保留原有默认客户端标识，建议覆盖到原安装目录；保留你自己的配置和本地运行数据。

本版心跳包含区服 ID 和当前角色名。尚未识别角色时，请重新登录游戏角色，让客户端捕获登录信息。
已修复本人角色资料未同步到心跳的问题，兼容 characterName，并在切换角色或区服时清除旧名字。
网页客户端列表的角色名随心跳更新。未获取时显示“未识别角色”。

本次沿用已验证的 Windows x64 启动器及运行库，只更新外置通信模块。
默认使用公共 MQTT 服务；普通状态心跳新增角色名，不新增角色 ID。
初次安装与证书操作参见原“使用说明.txt”。
'''
with zipfile.ZipFile(base) as old, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as new:
    assert old.testzip() is None
    for item in old.infolist():
        path = PurePosixPath(item.filename)
        assert not path.is_absolute() and '..' not in path.parts
        assert path.parts[0] == 'aion2-client'
        new.writestr(item.filename, addon if item.filename == addon_name else old.read(item.filename))
    new.writestr('aion2-client/角色名更新说明.txt', readme.encode('utf-8-sig'))

with zipfile.ZipFile(base) as old, zipfile.ZipFile(output) as new:
    assert new.testzip() is None
    assert new.read(addon_name) == addon
    for name in old.namelist():
        if name != addon_name:
            assert new.read(name) == old.read(name), name
    stage.mkdir(parents=True, exist_ok=True)
    for item in new.infolist():
        target = (stage / item.filename).resolve()
        assert target.is_relative_to(stage.resolve()), item.filename
    new.extractall(stage)
    count = len(new.namelist())
report = {'file': str(output), 'bytes': output.stat().st_size,
          'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'files': count,
          'unchangedRuntimeVerified': True, 'addonMatchesSource': True,
          'testExecutable': str(stage / 'aion2-client/aion2-client.exe')}
(root / 'artifacts/client-character-name-v2-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
