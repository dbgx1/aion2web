from pathlib import Path
import hashlib
import shutil
import zipfile
root=Path('E:/project/aion2')
prepared=Path('E:/project/aion2web/artifacts')
source=root/'client/mitm_ws_message_monitor.py'
new=prepared/'mitm_ws_message_monitor.optional.py'
compile(new.read_text(encoding='utf-8'),str(source),'exec')
backup=root/'build/mitm_ws_message_monitor.before-optional.py'
if not backup.exists(): shutil.copy2(source,backup)
shutil.copy2(new,source)
shutil.copy2(prepared/'test_client_optional.py',root/'client/test_client_optional.py')
shutil.copy2(prepared/'OPTIONAL-UPDATE.md',root/'client/OPTIONAL-UPDATE.md')
bundle=root/'build/aion2-client/_internal/mitm_ws_message_monitor.py'
shutil.copy2(source,bundle)
output=root/'build/aion2-optional-update-20260916.zip'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
    z.write(source,'_internal/mitm_ws_message_monitor.py')
    z.write(root/'client/OPTIONAL-UPDATE.md','OPTIONAL-UPDATE.md')
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    assert z.read('_internal/mitm_ws_message_monitor.py')==source.read_bytes()
assert source.read_bytes()==bundle.read_bytes()
print('Updated source and bundled addon; backup:',backup)
print('Update package:',output)
print('SHA256:',hashlib.sha256(source.read_bytes()).hexdigest())
