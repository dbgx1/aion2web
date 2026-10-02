# Unified Aion2Pipe query pool

Dispatcher and production MQTT webhook rules are deployed. On 2026-09-30 the preview connected to the real game and completed console-driven single-player and two-player queries, with online/offline results verified in both the UI and D1. Real multi-machine concurrency acceptance remains outstanding.

## Required outcome

- One SQLite-backed Cloudflare Durable Object; no VPS, no region/server pools.
- Preserve existing console presence request/result MQTT topics and 50-player batches.
- Broker-authenticated webhook ingress plus HTTP MQTT publish egress.
- Per-device credentials/ACL, authenticated console requests checked against D1.
- Idle/cooldown-aware round robin, one task per client, >=5 second game send interval.
- Coalesce same player queries, 10-second successful result cache, per-user fairness.
- Finite queue and daily dispatch budget (default 20,000 attempts/day, including retries).
- Persist reservations/outbox before publishing. At-least-once deliveries fenced by attempt ID.
- One retry on another client; never convert timeout/error into offline.
- Client service toggle, MQTT transport, persistent identity and duplicate suppression.
- Confirm actual game response correlation, local/manual queries sharing concurrency limits.
- Real transport integration tests, restart/failure tests, packaged native client, deployed broker rules and live validation.

## Current evidence

- `node scripts/test-query-dispatch-core.mjs` passes state machine scenarios.
- `npx wrangler deploy --config query-dispatch/wrangler.jsonc --dry-run` bundles successfully.
- `core.ts` is transport-independent; `worker.ts` is verified through production EMQX and real single-client game queries (details below).
- Worker deployed at `https://query.mmorpgchat.com`, also available at its workers.dev address. Health reports configured. Domain deployment version on 2026-09-30: `afe585bf-748b-4e68-af14-fec0e713061b` (subsequent code deployments supersede this).
- Core and adapter tests plus actual Miniflare/workerd SQLite DO + D1 roundtrip passed. Persistent device boot/sequence fencing survives node pruning. HTTP publish uses manual redirect handling and requires a successful message ID; EMQX 202/no subscriber is not treated as delivery.
- EMQX API credentials work for client/authentication/authorization APIs. Rules/connectors management APIs return 403; exact service restriction not established. Web UI HTTP connector test to workers.dev failed with `请求目标地址失败`; changing host/SNI to `query.mmorpgchat.com` passed (`连接器可用`) with TLS verification enabled and the same trusted CA. Connector and rule were subsequently saved and production delivery verified.

## Configuration contract

Separate Worker `aion2-query-dispatch`, existing `aion2web-db` binding. No unrelated console source deployment needed for this adapter.
Secrets: `WEBHOOK_TOKEN`, `ADMIN_TOKEN` (independent, >=32 characters), `MQTT_PUBLISH_URL`, `MQTT_API_KEY`, `MQTT_API_SECRET`.
Broker rule POSTs authenticated JSON `{topic,clientid,username,payload}` to `/mqtt/events`. Metadata must be sourced from the broker, never the payload. Do not forward all MQTT traffic: only presence requests and query-worker state/events.
Device username `query-{clientId}`, MQTT client ID `query-{clientId}-{sessionId}`. A device can publish only its own state/events and subscribe only to its own task topic. Browser credentials cannot publish device state/events or subscribe device tasks.
Client persists and increments `boot` for each new service session. Each state change increments `seq`. Periodic readiness refresh at 60 seconds (with jitter); stale after 90 seconds. MQTT protocol keepalive does not go through CF. Need validate reconnect/session fencing under delayed webhooks before release.

State also carries `serverId` as an exact decimal string, or `null` until the game server is known. `ready=true` is valid only with a server ID. The scheduler assigns each target only to a fresh ready node whose `serverId` exactly matches the target; retry alternatives use the same rule. A target without any same-server node remains queued and expires with `当前没有同区服查询客户端`. The native client performs the same equality check again immediately before sending the game request.

Exact-server routing deployed on 2026-10-01 as Worker version `aa996ffb-791c-489e-ac0b-6274dc86b96f`. Release package: `E:/project/Aion2Pipe/dist-integrated-20261001-v6`.

## Remaining work

Remaining acceptance gate: real multi-machine installation/concurrency acceptance. Single-client real-game console roundtrip, persisted status and native UI counts are now verified. User screenshot shows completed=3, failed=0, rejected=0, connected and ready. This screenshot does not establish long-duration gameplay stability. Do not claim actual multi-machine load success from simulated scheduler tests.
Broker topic protection, browser-independent persistence, bounded history cleanup and shutdown notification are implemented. Preview package and operator guide are available.
Do not claim goal complete based on core tests or bundling alone.

## Live integration evidence (2026-09-30)

- User screenshot `codex-clipboard-78d81aaa-c4b4-4919-8594-a17da29984b9.png` confirms native service connected/ready, completed=3, failed=0, duplicate=0, rejected=0, reconnects=0 after the three real queries. Reloading the console preserves the two batch observations. Distribution refreshed with updated guide; 18 entries, no logs/private settings. SHA256 `1416164B8213A4B155482A034CD65F825CE347E73669472FD2E12301653E81BD`.

- Real preview process 25672 connected through the game proxy; live dispatcher node `aion2pipe-local-20260930` reported ready=true. Console request `1c0e3f15-c273-4200-8266-4d64fb238bc4` returned online for character `282882351594482156`. Batch `23ca16d2-7b00-4463-ae3d-83cb3526bb58` returned online for `282882351594210598` at 1790768671123 and offline for `282882351594484277` at 1790768677732 (6.609 seconds apart). Both requests finished=1; authoritative proof rows and character presence match. UI reported zero failed results. Screenshots: `E:/project/Aion2Pipe/artifacts/query-live-single.png`, `E:/project/Aion2Pipe/artifacts/query-live-batch.png`. This verifies one real client, not multiple real machines.

- Native `query_worker_probe --tasks` processed four real MQTT deliveries on an isolated worker session with an empty game proxy: expired task, duplicate of that attempt, stale game-session task, oversized character ID. It verified two rejections, one deduplicated attempt, one malformed-task failure, no busy/complete query, and stopped cleanly. No real game traffic was generated.
- Scheduler load test covers 1000 simulated available clients, eight operators and 400 unique targets. All tasks assigned to distinct idle clients; first cycle serves all operators, restart preserves the shared cache, and cached queries spend no additional dispatch budget. Local run approximately 119 ms; this is state-machine simulation, not 1000 production MQTT connections.
- Native UI adds rejected-task count. Full Release build and 11 CTest suites passed. Preview archive refreshed; per-device credential viewing helper is administrator-only source tooling and is not in the distribution. Operator guide explains per-machine identities and DPAPI portability limits.

- Seven-day request/proof retention: new authenticated requests clean at most 100 expired requests via indexed expiration lookup and FK cascade. Latest character presence is retained. Tests cover 101 old requests draining across two admissions and proof/receipt cascade. No permanent cleanup polling. Index migration 0023 applied; web version `15533745-21fd-45d6-9036-9cf8e780f579`.
- Persisted outbox records track successful D1 result storage; broker retry after no subscriber/restart does not repeat D1 writes. Test verified no additional proof writes after restart and retry. Dispatcher version `eb81a65d-fb28-409d-afef-2c08f24196e4`.
- Native normal stop attempts a final ready=false state with newer sequence, waits at most a short grace period, then cancels network operations. Abrupt network/process loss still relies on 90-second stale-state cutoff. Game proxy is not stopped.

- Global ACL denies MQTT accounts access to `aion2/query-workers/#` and publication to `aion2/presence/aion2web/results/#`; dedicated device allow rules retain their scoped access. Unrelated account received explicit SUBACK rejection, and an isolated dedicated task subscriber received a management API publication. Script `scripts/protect-query-topics.ps1` preserves a backup and unrelated rules. No real game request was sent by these probes.
- Dispatcher now persists canonical character presence and request completion in the same D1 batch as verified evidence, before MQTT publication. Real workerd test proves persistence without browser POST and canonical target name. Deployed dispatcher `a98d0b8c-947c-4948-a99e-920e51693acb`.
- Native preview `E:/project/Aion2Pipe/dist-query-preview/Aion2Pipe.exe` and `Aion2Pipe-query-preview-win64.zip` generated with `docs/QUERY_SERVICE.md`; no private credentials/settings included. User asked to reconnect game through preview and enable 查询服务; reply pending. Existing live proxy was not interrupted.

- EMQX connector `c-od43e177-11ef00`, rule `r-od43e177-1e3dec`, action `a-od43e177-329352` created and enabled through console. HTTPS base `https://query.mmorpgchat.com`, verified TLS/SNI, POST `/mqtt/events`, Bearer webhook credential. Body `${.}` serializes rule outputs. SQL selects only broker topic/clientid/username and payload from the three requested topic filters.
- Running `query_worker_probe` with a dedicated account produced a live `/status` node for `aion2pipe-local-20260930`, ready=false and busy=false. This proves native MQTT -> EMQX rule -> authenticated HTTP -> DO processing. Probe stopped cleanly. It does not prove game-query execution.
- Migration `0022_presence_verified_results.sql` applied remotely. Dispatcher saves immutable result evidence in D1 before publishing results. Web result-saving API checks status and timestamp against that evidence; forged positive/negative results return 409. Browser-local unknown timeouts are display-only. Unknown observations cannot overwrite a previously confirmed observation.
- Worker adapter tests, actual workerd/D1 roundtrip, and five presence tests pass, including missing proof, forged offline, duplicate/stale results and unknown preservation. Web build passed and result verification deployed. Dispatcher version `6b68d40b-5df9-4c14-ae80-e13e66796d62`.
- Screenshot: `E:/project/Aion2Pipe/artifacts/query-dispatch-emqx-enabled.png`. No credentials are included in the screenshot.

## Native integration progress (2026-09-30)

- Broker TLS on port 8883 and MQTT 3.1.1 CONNECT were verified with the supplied account. The probe uses a fresh client ID, sends no application messages, subscribes to no topics, and disconnects cleanly. Credentials are saved locally using current-user DPAPI, outside installation artifacts.
- API credentials were received and stored under current-user DPAPI; dispatcher secrets uploaded separately. Dedicated per-device account/ACL provisioning is implemented in Aion2Pipe `scripts/provision-query-device.ps1`. Local device auth succeeds, unrelated topic subscription is rejected. Webhook delivery remains unverified.
- Native `QueryProxy::requestTracked` now returns an independent, thread-safe receipt. Manual and remote callers share the same admission/cooldown path. Connection views expose query availability and remaining cooldown.
- Receipts preserve terminal results across subsequent UI queries, connection closure, and late replies. Overlapping native queries, timeout, nonzero result codes, and truncated prefixes produce unknown/failure, never offline.
- Native asynchronous WinHTTP WSS MQTT transport, encrypted settings, exclusive local worker lease, duplicate-task records, reconnect logic and 查询服务 UI are implemented. Real MQTT roundtrip and worker probe passed: unavailable without game, duplicate process rejected, keepalive stays connected and cancellation completes promptly. All 11 native CTest suites passed after full Release build.
- Heartbeat phase varies by device ID (55–60 seconds); task history allocation now precedes sending a game query. Native business-task end-to-end, UI visual check, web result trust/ACL hardening, deployment rules and distributable package remain incomplete.

## Fixed query delay removed (2026-09-30)

At the user's request, native manual/remote player queries have no fixed 5-second delay. The native proxy retains one in-flight query per game connection and frame-boundary checks. Scheduler default completion cooldown is zero; it still honors cooldown reported by older clients during rolling upgrade. Updated UI describes serial execution without a fixed interval. Default scheduler test proves same-timestamp redispatch after completion and keeps busy/duplicate fencing; compatibility test covers an older client's reported cooldown. Core, adapter, workerd/D1 tests, strict TypeScript and all 11 native CTest suites passed. Deployed dispatcher version: 5c849d93-c765-49ff-9999-ca470877f716. New package: E:/project/Aion2Pipe/dist-query-fast/Aion2Pipe.exe and Aion2Pipe-query-fast-win64.zip. The running preview was not replaced; real-game throughput with the new binary still requires switching clients and reconnecting.

## Target rejection stalls fixed (2026-10-01)

Live passive capture found ViewChar result 6437 for 1305 / Lynae; the same running connection successfully queried 2201 / wangjw98. The precise meaning of 6437 is not established. The failed target previously disabled the entire node after its newer ready state had already arrived; each following batch target waited about 58 seconds for a heartbeat, and the first target waited until the 180-second request deadline with no alternate node.

Game rejections now preserve node readiness and immediately return unknown if no fresh alternate node can retry. Other protocol/connection failures retain the existing readiness fence. Rejections are never cached as online/offline. Both legacy `game_query_failed` and new `game_query_failed:<code>` are supported; UI completion text includes the returned reason. Native parsing preserves the numeric code and treats missing result fields separately.

Validation: dispatcher core, adapter and real workerd/D1 suites; TypeScript; native 13 CTest suites. Published dispatcher `cd1dffa6-37eb-454d-b964-ad91b484a987` and web `de670d79-99e4-434d-a673-ad8baf9993ff`. Native build at `E:/project/Aion2Pipe/dist-presence-fix-20261001`; running game proxy remains on its original build to preserve the active connection. Evidence: web `artifacts/presence-2201-success.png`, native `artifacts/presence-failure-evidence.json` and passive capture/report.

Post-deployment production evidence: rejected 1305 request `0b9d8152-26bf-4a56-a61d-26a932bc078a` finished in 1.897 seconds versus 180 seconds before; 2201 offline request `35a63809-463e-4183-9834-c281d274fc48` finished in 1.848 seconds. Both are persisted as finished in D1. Live UI shows the rejection explanation and no pending spinner. Saved `artifacts/presence-fix-live-verification.json` and `artifacts/presence-fix-live.png`; original 1305 filter, selected Lynae and 60-second auto-query setting restored.
