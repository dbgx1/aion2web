from pathlib import Path
import hashlib
import zipfile

root = Path('E:/project/aion2')
runtime = root / 'build/aion2-client'
source = root / 'client'
output = root / 'build/aion2-client-full-20260917-dual-process.zip'
modules = ['mitm_ws_message_monitor.py', 'account_switch.py', 'login_bridge.py', 'login_protocol.py']
overrides = {f'_internal/{name}': source / name for name in modules}
for name in modules:
    compile((source/name).read_text(encoding='utf-8'), name, 'exec')
assert '"optional": optional' in (source/modules[0]).read_text(encoding='utf-8')
assert (runtime/'aion2-client.exe').is_file()
notes = '''AION2 完整客户端 — 2026-09-17 双进程版

1. 解压整个 aion2-client 文件夹，保留 _internal 目录，不要只取出 EXE。
2. 更新已有安装时先退出旧客户端，再覆盖程序文件；保留原来的本地配置和运行数据。
3. 双击 start-dual-process.cmd 启动，同时代理 Aion2.exe 和 AION2.exe。登录游戏后在游戏内发一条消息，采集 optional。
4. 控制台发送私聊时会携带已采集的 optional。尚未采集时会提示未发送；换角色或区服后需重新采集。

本包包含启动程序、依赖运行库、最新私聊 optional 逻辑及换号通信模块。
沿用现有启动程序，更新其加载的外部 Python 模块，无需单独安装 Python。
没有打入本地抓包、日志、聊天队列、个人代理证书或本地配置文件。
换号功能仍需另一个登录进程实现协议，说明见 LOGIN-IPC-V1.md。
'''
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for file in sorted(runtime.rglob('*')):
        if not file.is_file(): continue
        rel = file.relative_to(runtime).as_posix()
        if rel in overrides or '__pycache__' in file.parts or file.name in {'使用说明.txt', '新版使用说明.txt'}: continue
        if '.mitmproxy' in file.parts or file.name=='mqtt.private.local.json': continue
        if file.suffix.lower() in {'.log','.jsonl','.sqlite','.sqlite3','.db','.key','.pem'} and rel!='_internal/certifi/cacert.pem': continue
        z.write(file,'aion2-client/'+rel)
    for rel,file in overrides.items(): z.write(file,'aion2-client/'+rel)
    for name in ['OPTIONAL-UPDATE.md','LOGIN-IPC-V1.md','mqtt.private.example.json']:
        z.write(source/name,'aion2-client/'+name)
    z.writestr('aion2-client/新版使用说明.txt',notes)
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    for rel,file in overrides.items(): assert z.read('aion2-client/'+rel)==file.read_bytes()
    for name in ['aion2-client.exe','_internal/python312.dll','_internal/base_library.zip','_internal/certifi/cacert.pem']:
        assert z.getinfo('aion2-client/'+name).file_size>0, name
    assert b'local:Aion2.exe,AION2.exe' in z.read('aion2-client/start-dual-process.cmd')
    count=len(z.namelist())
print(output)
print(f'{output.stat().st_size/1024/1024:.1f} MiB; {count} files; integrity and latest modules verified')
print('SHA256',hashlib.sha256(output.read_bytes()).hexdigest())

