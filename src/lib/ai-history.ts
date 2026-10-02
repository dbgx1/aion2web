import { convertMessagesToModelMessages } from '@tanstack/ai/client'
import type { ModelMessage, UIMessage } from '@tanstack/ai/client'

export const AI_HISTORY_TURNS = 12
export const AI_HISTORY_BYTES = 64_000
const malformedText = '上一轮 AI 输出了异常工具格式，此文字不代表操作已执行。请依据真实聊天记录判断结果，不要自动重发。'
const unknownResult = JSON.stringify({ status: 'unknown', error: '上一轮工具调用中断，没有可用执行结果。不能据此判断发送成功或失败；不要自动重试发送，请先核对真实聊天记录。' })

export class AiHistoryLimitError extends Error {
  readonly code = 'AI_HISTORY_LIMIT'
  constructor() { super('当前这一轮内容过长，请缩短输入或清空 AI 对话后重新提问。') }
}

/** Narrowly identify leaked native tool syntax; ordinary JSON/prose is valid. */
export function hasMalformedToolText(text: string) {
  return /function\s*<[|｜]\s*tool[_▁]sep\s*[|｜]>|<[|｜]tool[_▁]calls?[_▁]begin[|｜]>/.test(text)
}

function bytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength }

/** A turn includes its user message and ALL assistant/tool continuations. */
export function recentAiTurns<T extends { role: string }>(messages: T[], maxTurns: number, maxBytes: number) {
  const starts = messages.flatMap((message, index) => message.role === 'user' ? [index] : [])
  if (!starts.length) return { messages: [] as T[], droppedTurns: 0 }
  let start = starts.length - 1
  let used = bytes(messages.slice(starts[start]))
  // Never truncate a pending action or the current administrator instruction.
  if (used > maxBytes) throw new AiHistoryLimitError()
  while (start > 0 && starts.length - start < maxTurns) {
    const size = bytes(messages.slice(starts[start - 1], starts[start]))
    if (used + size > maxBytes) break
    used += size
    start--
  }
  return { messages: messages.slice(starts[start]), droppedTurns: start }
}

export function trimAiUiHistory<T extends UIMessage>(messages: T[], nextInput: string): T[] {
  // Include the new user turn when budgeting: an oversized failed OLD turn
  // must not prevent a short new question from recovering the conversation.
  const next: UIMessage = { id: 'history-budget-only', role: 'user', parts: [{ type: 'text', content: nextInput }] }
  const kept = recentAiTurns([...messages, next], 40, 192_000).messages.length - 1
  return messages.slice(messages.length - kept)
}

/** Repair only the provider projection. Never mutate UI evidence or run tools. */
export function prepareAiHistory(input: Array<UIMessage | ModelMessage>) {
  const converted = convertMessagesToModelMessages(input)
  const output: ModelMessage[] = []
  let repairedCalls = 0, malformedTexts = 0, orphanResults = 0
  for (let index = 0; index < converted.length; index++) {
    const message = converted[index]
    if (message.role === 'tool') { orphanResults++; continue }
    let content = message.content
    const text = typeof content === 'string' ? content : (content ?? []).flatMap(part => part.type === 'text' ? [part.content] : []).join('')
    if (message.role === 'assistant' && hasMalformedToolText(text)) {
      content = typeof content === 'string' ? malformedText : [
        { type: 'text', content: malformedText }, ...(content ?? []).filter(part => part.type !== 'text'),
      ]
      malformedTexts++
    }
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      output.push({ ...message, content })
      continue
    }
    // Results belong to this batch only; never attach a later turn's result.
    const results = new Map<string, ModelMessage>()
    while (converted[index + 1]?.role === 'tool') {
      const result = converted[++index]
      if (result.toolCallId && !results.has(result.toolCallId)) results.set(result.toolCallId, result)
      else orphanResults++
    }
    const calls: NonNullable<ModelMessage['toolCalls']> = []
    const paired: ModelMessage[] = []
    const seen = new Set<string>()
    let invalidCalls = 0
    const preservedResults: ModelMessage[] = []
    for (const call of message.toolCalls) {
      let valid = Boolean(call && typeof call.id === 'string' && call.id &&
        typeof call.function?.name === 'string' && call.function.name && !seen.has(call.id))
      try {
        const args = JSON.parse(call.function.arguments)
        valid &&= args !== null && typeof args === 'object' && !Array.isArray(args)
      } catch { valid = false }
      if (!valid) {
        invalidCalls++; repairedCalls++
        // Even if arguments were corrupted, a recorded result is evidence.
        // Preserve it as data instead of erasing a possibly completed send.
        const result = call && results.get(call.id)
        if (result) { preservedResults.push(result); results.delete(call.id) }
        continue
      }
      seen.add(call.id)
      calls.push(call)
      const result = results.get(call.id)
      if (result) { paired.push(result); results.delete(call.id) }
      else {
        repairedCalls++
        paired.push({ role: 'tool', toolCallId: call.id, content: unknownResult, error: 'unknown_execution_result' })
      }
    }
    orphanResults += results.size
    if (invalidCalls) {
      // Incomplete JSON is not a valid provider call even with an error result.
      // Preserve an uncertainty note instead of inventing valid arguments.
      const note = '上一轮存在格式不完整的工具调用，执行结果不可确认，不要自动重发。'
      content = typeof content === 'string' ? `${content}\n${note}` : [...(content ?? []), { type: 'text', content: note }]
    }
    output.push({ ...message, content, toolCalls: calls.length ? calls : undefined }, ...paired)
    if (preservedResults.length) output.push({ role: 'assistant', content:
      `历史工具结果原文（对应调用参数损坏，仅保留记录，不要重复执行）：${JSON.stringify(preservedResults.map(result => ({ name: result.name, content: result.content, error: result.error })))}` })
  }
  const window = recentAiTurns(output, AI_HISTORY_TURNS, AI_HISTORY_BYTES)
  return { ...window, repairedCalls, malformedTexts, orphanResults }
}
