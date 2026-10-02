from pathlib import Path
root=Path('E:/project/aion2')
p=root/'client/run_client.py'
s=p.read_text(encoding='utf-8')
old='os.getenv("AION2_MITM_MODE", "local:Aion2.exe").strip() or "local:Aion2.exe"'
new='os.getenv("AION2_MITM_MODE", "local:Aion2.exe,AION2.exe").strip() or "local:Aion2.exe,AION2.exe"'
assert old in s or new in s
s=s.replace(old,new)
compile(s,str(p),'exec')
p.write_text(s,encoding='utf-8')
# The existing frozen launcher reads this per-process environment override.
launcher='@echo off\r\nsetlocal\r\nset "AION2_MITM_MODE=local:Aion2.exe,AION2.exe"\r\n"%~dp0aion2-client.exe" %*\r\nendlocal\r\n'
(root/'build/aion2-client/start-dual-process.cmd').write_bytes(launcher.encode('ascii'))
print('Source defaults and EXE launcher now target local:Aion2.exe,AION2.exe')
