/** Read at most maxBytes of UTF-8 input, including requests without Content-Length. */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return body + decoder.decode()
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        // Stop consuming immediately; cancellation failure must not turn 413 into 500.
        void reader.cancel().catch(() => {})
        return null
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}
