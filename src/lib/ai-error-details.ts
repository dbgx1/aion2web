// Only error fields are retained; never log request messages, tool arguments,
// headers or an entire SDK response object. Provider raw JSON is filtered too.
const fields = new Set(['error', 'message', 'code', 'status', 'statusCode', 'type', 'param',
  'detail', 'details', 'reason', 'metadata', 'raw', 'rawEvent', 'provider_name', 'provider',
  'request_id', 'requestId', 'runId', 'model', 'error_description'])

function redact(value: string) {
  return value.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[\w-]+/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|cookie)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi, '$1[REDACTED]')
    .slice(0, 1500)
}

function clean(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]'
  if (typeof value === 'string') {
    // Parse before truncating so credential fields in encoded raw errors can
    // be removed instead of accidentally retained as free-form text.
    if (value.length > 32000) return '[oversized error detail omitted]'
    if (/^[\s]*[\[{]/.test(value)) {
      try { return clean(JSON.parse(value), depth + 1) } catch { /* plain text */ }
    }
    return redact(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 5).map(item => clean(item, depth + 1))
  if (!value || typeof value !== 'object') return undefined
  const result: Record<string, unknown> = {}
  for (const key of fields) {
    const item = (value as Record<string, unknown>)[key]
    if (item !== undefined) result[key] = clean(item, depth + 1)
  }
  return result
}

export function aiErrorDetails(value: unknown): Record<string, unknown> {
  const result = clean(value)
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {}
}

export function aiErrorMessage(value: unknown) {
  const details = aiErrorDetails(value)
  const error = details.error as Record<string, unknown> | undefined
  const code = details.code ?? error?.code ?? '未提供'
  return `AI 上游请求失败（错误码：${code}）：${JSON.stringify(details).slice(0, 6000)}`
}
