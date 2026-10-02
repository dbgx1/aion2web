import { fetchServerSentEvents } from '@tanstack/ai-react'
import type { ConnectConnectionAdapter } from '@tanstack/ai-react'
import { EventType } from '@tanstack/ai/client'
import { hasMalformedToolText, prepareAiHistory } from './ai-history'
import { aiErrorDetails } from './ai-error-details'

export class AiStreamError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

/** One bounded network request, including streamed body time, per connection. */
export function interactiveAiConnection(options: { timeoutMs?: number; beforeRequest?: () => void } = {}): ConnectConnectionAdapter {
  const transport = fetchServerSentEvents('/api/ai/chat')
  return {
    async *connect(messages, data, abortSignal, runContext) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
      const signal = abortSignal ? AbortSignal.any([abortSignal, controller.signal]) : controller.signal
      const texts = new Map<string, string>()
      let terminal = false
      try {
        options.beforeRequest?.()
        const prepared = prepareAiHistory(messages)
        for await (const chunk of transport.connect(prepared.messages, data, signal, runContext)) {
          if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
            // Only a small suffix is needed to detect markers split across chunks.
            const text = (texts.get(chunk.messageId) ?? '') + chunk.delta
            if (hasMalformedToolText(text)) throw new AiStreamError('AI_TOOL_FORMAT', 'AI 返回了异常工具格式，本轮已停止；请核对聊天记录后重新提问。')
            texts.set(chunk.messageId, text.slice(-256))
          }
          if (chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR') terminal = true
          yield chunk
        }
        if (!abortSignal?.aborted && controller.signal.aborted) throw new AiStreamError('AI_STREAM_TIMEOUT', 'AI 响应超过等待时间，本轮已停止。')
        if (!abortSignal?.aborted && !terminal) throw new AiStreamError('AI_STREAM_INCOMPLETE', 'AI 响应中途断开，未收到完成结果。')
      } catch (error) {
        if (abortSignal?.aborted) return
        const failure = controller.signal.aborted
          ? new AiStreamError('AI_STREAM_TIMEOUT', 'AI 响应超过等待时间，本轮已停止。') : error
        const detail = aiErrorDetails(failure)
        // Deliver request failures as terminal events. Throwing through the
        // SDK's connect→subscribe bridge also kills its shared subscription,
        // which can report the old error again during the next user turn.
        yield { type: EventType.RUN_ERROR, timestamp: Date.now(), runId: runContext?.runId,
          threadId: runContext?.threadId, code: typeof detail.code === 'string' ? detail.code : undefined,
          message: failure instanceof Error ? failure.message : 'AI 请求失败', rawEvent: detail }
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
    },
  }
}
