# Game chat restriction handling

The portal recognizes error `2011200` / `NET_ERR_GAME_CHAT_BLOCKED` in `control_result` receipts, including nested objects and the bridge's `HTTP 403 · {JSON}` string. A generic HTTP 403 or chat message containing the text does not activate this guard.

Before updating the chat timeline, the MQTT hook records the restriction for the event topic's client. A synchronous listener aborts that client's active bulk loop, including recipient loading or the interval wait. Every `sendWhisper` publish also checks the guard directly, covering manual messages, AI tools and JSON commands before React has rendered the alert. Non-chat commands and other clients are unaffected.

The UI shows the game-reported reason and expiration converted to Beijing time, disables chat and bulk resume, and retains the remaining in-memory bulk task. Expiration only enables manual continuation; it never schedules a retry or resumes a task. Published commands are not rolled back or replayed. A restriction without an expiration stays blocked; ordinary successful commands do not clear it. Already-expired receipts are ignored.

Unexpired restrictions are stored locally, scoped to MQTT broker/prefix/room and client, and propagated to other tabs through storage events. Refresh and reconnect retain them; clearing the timeline does not remove them. This is a portal-side guard, not a game-server unban or a remote queue cancellation. Commands already delivered to the client's queue cannot be recalled, and other browsers/devices only know restrictions they have received themselves. The existing bulk task remains in memory and does not survive reload. Browser storage failures still leave the current session protected.

Validation:

- `node scripts/test-game-chat-block.mjs`: supplied error/timezone, nested and escaped JSON, generic-error/chat-content isolation, expired receipt handling, synchronous notification, persistence, client/room isolation, cross-tab extension.
- `node scripts/test-game-chat-block-ui.mjs`: actual portal and MQTT hook with a local fake transport; one command submitted, ban receipt immediately blocks the next publish and stops the bulk loop, resume disabled, another mount restores the ban, expiration sends nothing, explicit resume submits remaining recipients without replaying the first command. No real game messages are sent by this test.
