/** Keep task/recipient metadata intact and remove whole, oldest context records. */
export function serializeAiContext(value: unknown, maxChars = 12_000): string {
  if (value === undefined || value === null) return ''
  // Request JSON contains only serializable values. Clone before pruning evidence.
  const context = JSON.parse(JSON.stringify(value))
  let serialized = JSON.stringify(context)
  if (serialized.length <= maxChars) return serialized
  if (typeof context !== 'object' || Array.isArray(context)) throw new AiContextLimitError()
  for (const field of ['recentPublicMessages', 'onlineAgents', 'recentPrivateMessages']) {
    const records = context[field]
    if (!Array.isArray(records)) continue
    // The latest private message may contain the question being answered.
    const minimum = field === 'recentPrivateMessages' ? 1 : 0
    while (records.length > minimum && serialized.length > maxChars) {
      records.shift()
      serialized = JSON.stringify(context)
    }
    if (serialized.length <= maxChars) return serialized
  }
  throw new AiContextLimitError()
}

export class AiContextLimitError extends Error {
  constructor() { super('当前任务或最新聊天内容过长，请缩短任务要求或输入内容后重试。') }
}
