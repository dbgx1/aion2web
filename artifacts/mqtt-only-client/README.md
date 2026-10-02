# Client

Python 客户端负责运行 mitmproxy addon：

- 监听 AION2 WebSocket/STOMP `MESSAGE`。
- 解析聊天 JSON。
- 自动缓存 Bearer、本地角色、服务器、用户名、目标玩家等运行时信息。
- 接收控制台命令并调用 `sendWhisper`。

## 通信方式

客户端仅使用 MQTT 接收指令、上报聊天和执行回执，不再建立 WebRTC 连接，也不再需要 aiortc 或 TURN/STUN 配置。现有房间、客户端 ID 和 AION2_SIGNAL_PREFIX 环境变量保持兼容；旧的 signal/agent/all 主题仅用于 MQTT 客户端发现。

## 安装

在项目根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r .\client\requirements.txt
```

## 启动

```powershell
$env:AION2_RELAY_ROOM="aion2-local"
.\.venv\Scripts\python.exe .\client\run_client.py
```

默认启动 mitmweb 抓包 UI，并使用 Windows `local` redirector 按进程名代理 AION2：

```text
--mode local:Aion2.exe
```

抓包 UI 页面默认会自动打开：

```text
http://127.0.0.1:8081/
```

这种模式不需要给 AION2 配置代理地址，mitmproxy 会尝试只接管 `Aion2.exe` 进程的连接。

首次启动时，客户端会在当前电脑的 `%USERPROFILE%\.mitmproxy` 目录生成独立 CA，检查其是否已受 Windows 信任，并在未安装时弹出一次确认窗口。确认后证书会安装到当前用户的“受信任的根证书颁发机构”；以后启动不会重复安装。

可选环境变量：

```powershell
$env:AION2_MITM_HOST="127.0.0.1"        # 代理监听地址
$env:AION2_MITM_PORT="8080"             # 代理监听端口
$env:AION2_MITM_MODE="local:Aion2.exe"  # mitmproxy 模式
$env:AION2_MITM_TOOL="mitmweb"          # mitmweb 或 mitmdump
$env:AION2_WEB_PORT="8081"              # mitmweb 页面端口
$env:AION2_WEB_OPEN_BROWSER="1"         # 1 自动打开抓包 UI，0 不自动打开
$env:AION2_AUTO_INSTALL_CERT="1"        # 1 无人值守安装，0 不检查/安装；不设置则首次弹窗确认
$env:AION2_CERT_STORE="user"            # user 当前用户（默认），machine 本机（需要管理员）
$env:AION2_MITM_CONFDIR="$env:USERPROFILE\.mitmproxy" # CA 与 mitmproxy 配置目录
```

每台电脑必须生成自己的 CA。分发客户端时不要复制 `.mitmproxy` 目录，也不要分发包含私钥的 `mitmproxy-ca.pem`。

如果你要只开命令行、不显示抓包页面：

```powershell
$env:AION2_MITM_TOOL="mitmdump"
$env:AION2_MITM_MODE="regular"
$env:AION2_MITM_PORT="8080"
.\.venv\Scripts\python.exe .\client\run_client.py
```

如果要切回普通代理服务器模式：

```powershell
$env:AION2_MITM_TOOL="mitmweb"
$env:AION2_MITM_MODE="regular"
$env:AION2_MITM_HOST="127.0.0.1"
$env:AION2_MITM_PORT="8080"
.\.venv\Scripts\python.exe .\client\run_client.py
```

## 编译 exe

在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe -m pip install pyinstaller
.\.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --name aion2-client --distpath .\build --workpath .\.pyinstaller-work --specpath .\.pyinstaller-spec --add-data "E:\project\aion2\client\mitm_ws_message_monitor.py;." --collect-all mitmproxy --collect-all mitmproxy_rs --collect-all aioquic --collect-all paho --collect-submodules mitmproxy --collect-submodules aioquic --collect-submodules paho .\client\run_client.py
```

产物位置：

```text
build\aion2-client\aion2-client.exe
```

这是 PyInstaller `onedir` 产物，运行时需要保留同目录下的 `_internal` 文件夹。

复制到其它电脑时，需要复制整个目录：

```text
build\aion2-client\
```

不要只复制 `aion2-client.exe`。如果启动后闪退，查看 exe 同目录下的 `aion2-client.log`；local 模式通常需要右键“以管理员身份运行”。
