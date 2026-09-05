// Framework-independent per-turn SDK client. Disposing it bounds AI transcript
// growth; character history is supplied explicitly and never shared across roles.
import { ChatClient, clientTools, fetchServerSentEvents } from '@tanstack/ai-client'
import { managedContextDef, managedHistoryDef, managedPresenceDef, setControlCommandDraftDef,
  setPrivateChatDraftDef, sendPrivateChatDef, setGroupChatDraftDef, sendGroupChatDef } from './console-ai-tools'
import type { ManagedLine, ManagedTurn } from './managed-chat'
import { PRESENCE_TIMEOUT_MS } from './presence-mqtt'

export async function runManagedAiTurn(turn: ManagedTurn, deps: {
  history: () => Promise<ManagedLine[]>
  presence: () => Promise<string>
  controlDraft: (command: Record<string, unknown>) => void
  notice: (message: string) => void
}) {
  const history = await deps.history()
  turn.signal.throwIfAborted()
  let failure: Error | undefined, acted = false, active = true, delivered = false
  let presenceResult: Promise<string> | undefined
  const requireActive = () => { turn.signal.throwIfAborted(); if (!active) throw new Error('本轮托管已结束') }
  const context = { surface: 'managed', agentId: turn.config.agentId, acquiredAt: turn.config.acquiredAt,
    task: turn.config, selectedCharacter: turn.recipient, reason: turn.reason,
    recentPrivateMessages: [...new Map([...history, ...turn.history].map(line => [line.id, line])).values()].slice(-12) }
  const tools = clientTools(
    setControlCommandDraftDef.client(input => { requireActive(); deps.controlDraft(input.command); return { applied: true, message: '控制台草稿已更新' } }),
    setPrivateChatDraftDef.client(input => { requireActive(); deps.notice(`给 ${turn.recipient.name} 的草稿：${input.content}`); return { applied: true, message: '已记录本轮私聊草稿，仍需发送工具发送' } }),
    sendPrivateChatDef.client(async input => {
      requireActive(); const sent = await turn.send(input.content); acted = true
      // The game receipt completes this turn; an extra model summary would hold
      // the scheduler and spend tokens without contributing another reply.
      if (sent) { delivered = true; client.stop() }
      return { sent, message: sent ? '游戏客户端已确认发送成功' : '该操作已处理，或出现了新消息，本次未重复发送' }
    }),
    setGroupChatDraftDef.client(input => { requireActive(); deps.notice(`托管群发草稿：${input.content}`); return { applied: true, message: '群发草稿已记录' } }),
    sendGroupChatDef.client(input => {
      requireActive(); const count = turn.queueGroup(input.content, input.variants); acted = true
      return { sent: false, sentCount: 0, totalCount: count, varied: Boolean(input.variants?.length),
        message: count ? `已排入 ${count} 人的托管发送队列，按频率依次发送；尚未全部送达` : '本任务已安排过群发，请使用私聊工具继续当前角色对话' }
    }),
    managedContextDef.client(() => { requireActive(); return { context: JSON.stringify(context) } }),
    managedHistoryDef.client(() => { requireActive(); return { history: JSON.stringify(context.recentPrivateMessages) } }),
    ...(turn.config.scope === 'single' ? [] : [managedPresenceDef.client(async () => { requireActive(); const result = await (presenceResult ??= deps.presence()); requireActive(); return { result } })]),
  )
  const client = new ChatClient({
    threadId: `managed-${crypto.randomUUID()}`,
    connection: fetchServerSentEvents('/api/ai/chat'), tools,
    onError: error => { failure = error },
  })
  const cancel = () => { active = false; client.stop() }
  turn.signal.addEventListener('abort', cancel, { once: true })
  // Allow a full presence query plus time for the model and send acknowledgement.
  const timeout = setTimeout(() => { failure = new Error('本轮 AI 超时'); cancel() }, PRESENCE_TIMEOUT_MS + 60_000)
  try {
    await client.sendMessage(`持续托管任务：${turn.config.instruction || '自然地与角色保持交流'}。当前只处理 ${turn.recipient.name}，${turn.reason === 'reply' ? '请根据对方新消息自然回复' : '请结合最近聊天主动发起简短交流，避免重复话题'}。使用发送工具完成操作。`, context)
    turn.signal.throwIfAborted()
    if (failure && !delivered) throw failure
    if (!acted) throw new Error('AI 本轮未执行聊天工具，将稍后重试')
  } finally {
    active = false; clearTimeout(timeout); turn.signal.removeEventListener('abort', cancel); client.dispose()
  }
}
