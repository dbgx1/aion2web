import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

// Offline regression suite: each scenario owns its local mock model/game.
// UI scenarios use an installed Playwright, or PLAYWRIGHT_MODULE_PATH.
const checks = [
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['context and durable task instructions', ['scripts/test-ai-context.mjs']],
  ['action lifetime and execution receipts', ['scripts/test-ai-actions.mjs']],
  ['execution receipts in MQTT hook', ['scripts/test-command-receipts-ui.mjs']],
  ['bulk execution receipts and resume', ['scripts/test-ai-bulk-receipts-ui.mjs']],
  ['interactive SDK and history', ['scripts/test-interactive-ai.mjs']],
  ['provider route and serialization', ['scripts/test-ai-provider-failure.mjs']],
  ['interactive errors in React', ['scripts/test-ai-failure-ui.mjs']],
  ['long conversations in React', ['scripts/test-ai-multiturn-ui.mjs']],
  ['recipient and operation scope', ['scripts/test-message-ai-scope.mjs']],
  ['managed SDK recovery', ['scripts/test-managed-ai-recovery.mjs']],
  ['managed task isolation', ['scripts/test-managed-task-isolation.mjs']],
  ['managed scheduler', ['scripts/test-managed-chat.mjs']],
  ['managed reply latency', ['scripts/test-managed-reply-latency.mjs']],
  ['managed presence', ['scripts/test-managed-online.mjs']],
  ['game chat blocking', ['scripts/test-game-chat-block.mjs']],
]
const report = { startedAt: new Date().toISOString(), scope: 'Offline model/game fixtures; no production sends', checks: [] }
for (const [name, args] of checks) {
  console.log('\nChecking: ' + name)
  const started = Date.now()
  const outcome = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 120_000)
    child.once('error', error => { clearTimeout(timer); resolve({ passed: false, error: error.message }) })
    child.once('exit', code => { clearTimeout(timer); resolve({ passed: code === 0 && !timedOut, exitCode: code, timedOut }) })
  })
  report.checks.push({ name, ...outcome, elapsedMs: Date.now() - started })
}
report.completedAt = new Date().toISOString()
report.passed = report.checks.every(check => check.passed)
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
await writeFile(new URL('../artifacts/ai-test-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(`\n${report.checks.filter(check => check.passed).length}/${checks.length} checks passed. Report: artifacts/ai-test-report.json`)
if (!report.passed) process.exitCode = 1
