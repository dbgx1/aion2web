/** Keep provider failures distinct from the game's MQTT connection. */
export function aiErrorMessage(error: Error) {
  const detail = error as Error & { code?: unknown; rawEvent?: unknown }
  // Some OpenRouter failures retain the HTTP code only in rawEvent. TanStack
  // preserves that object on Error without promoting its code to Error.code.
  const raw = errorRecord(detail.rawEvent)
  const nested = errorRecord(raw.error)
  const code = [detail.code, raw.code, nested.code]
    .find(value => typeof value === 'number' || (typeof value === 'string' && value !== ''))
  const status = String(code ?? '')
  if (['408', '504'].includes(status) || /timeout|timed out/i.test(error.message)) {
    return 'AI 服务响应超时，请稍后手动重试；如涉及发送，请先核对聊天记录。'
  }
  if (status === '429' || /rate.limit/i.test(error.message)) return 'AI 服务商当前限流（429），请稍后手动重试；如涉及发送，请先核对聊天记录。'
  if (status === '402' || /insufficient.*credits/i.test(error.message)) return 'AI 服务余额不足，请联系管理员检查 OpenRouter 额度。'
  return 'AI 请求未完成，请稍后重试；如涉及发送，请先核对聊天记录。'
}

function errorRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}
