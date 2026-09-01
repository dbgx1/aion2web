const encoder = new TextEncoder()

async function sha256(value: string) {
  return crypto.subtle.digest('SHA-256', encoder.encode(value))
}

export async function verifyBearerToken(request: Request, expectedToken: string) {
  const authorization = request.headers.get('authorization') || ''
  const providedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  const [providedHash, expectedHash] = await Promise.all([
    sha256(providedToken),
    sha256(expectedToken),
  ])
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean
  }
  return subtle.timingSafeEqual(providedHash, expectedHash)
}

export function jsonError(message: string, status: number, details?: string[]) {
  return Response.json({ ok: false, error: message, details }, { status })
}
