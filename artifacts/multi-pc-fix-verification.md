# Multi-computer query and server identity fix — 2026-10-01

The portable release embeds client ID `aion2pipe-local-20260930`. Previously the scheduler and durable fence keyed every installation by this ID and compared machine-local boot counters. A computer with a smaller counter could remain MQTT-connected and locally ready while its state was ignored.

The dispatcher now isolates this shared portable credential by authenticated MQTT session. Dedicated device credentials retain their original boot fence. Session ordering, job reservations, result correlation, retries, expiration and existing-state migration are covered by regression tests. Portable session fences survive scheduler node pruning and DO restart, and are retained for 24 hours. Broker identity checks and topic ACLs are unchanged.

The native game connection and Python chat component previously learned server identity independently. v13.2 publishes a bounded local game-server status file every two seconds and passes its path to the chat child. Heartbeats read its server ID without modifying chat authentication. Missing, stale, disconnected or ambiguous game status clears the advertised server. A mismatching previous character name is not advertised.

Validation:

- Dispatcher core and Worker adapter tests passed, including two computers with different servers and boot counters sharing the portable credential.
- Real workerd / SQLite Durable Object / D1 integration passed.
- TypeScript check passed.
- Native Release build and all 13 CTest suites passed.
- Chat bridge 39 tests passed, including server switching, expiration, malformed status and standalone compatibility.
- Clean v13.1 archive used as package base; updated native executable, external Python addon and query documentation. No runtime logs or chat history copied. ZIP integrity and replaced file contents verified.

Production dispatcher: `f02a9f8d-4370-4b06-8fe3-a8146c62f7aa`, `https://query.mmorpgchat.com`.
After deployment, production status showed two separately registered portable sessions (one unready with no server, one ready on 2301). This confirms registration separation; it does not prove a successful 2305 game query or verify the other computer's UI after upgrading.

Client package: `E:/project/Aion2Pipe/release/Aion2Pipe-2026.10.01-v13.2-win64-portable.zip`.
SHA-256: `1357446196695544b4031ab8c5424e06ca002146ba05f1ec9c2d175515431bd0`.
The running game process and old proxy were not replaced or restarted.
