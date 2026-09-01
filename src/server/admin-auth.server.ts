import { uploadToken } from '#/server/characters.server'

const COOKIE_NAME = 'aion_admin_session'
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60
const encoder = new TextEncoder()

function base64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(uploadToken()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

async function constantTimeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(first: ArrayBuffer, second: ArrayBuffer): boolean
  }
  return subtle.timingSafeEqual(leftHash, rightHash)
}

export async function verifyAdminToken(token: string) {
  return constantTimeEqual(token, uploadToken())
}

export async function createAdminSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
  const payload = `v1:${expiresAt}`
  return `${payload}.${await signature(payload)}`
}

function cookieValue(request: Request) {
  const cookies = request.headers.get('cookie') || ''
  for (const part of cookies.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE_NAME) return value.join('=')
  }
  return ''
}

export async function isAdminRequest(request: Request) {
  const value = cookieValue(request)
  const separator = value.lastIndexOf('.')
  if (separator < 1) return false
  const payload = value.slice(0, separator)
  const providedSignature = value.slice(separator + 1)
  const [version, expiresText] = payload.split(':')
  const expiresAt = Number(expiresText)
  if (version !== 'v1' || !Number.isInteger(expiresAt) || expiresAt <= Date.now() / 1000) return false
  return constantTimeEqual(providedSignature, await signature(payload))
}

export function sessionCookie(request: Request, value: string, maxAge = SESSION_DURATION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}
