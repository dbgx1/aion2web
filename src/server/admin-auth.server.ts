import { env } from 'cloudflare:workers'
import { type AdminPrincipal, verifyRegisteredAdminCredentials } from '#/server/admin-users.server'
import { uploadToken } from '#/server/characters.server'

const COOKIE_NAME = 'aion_admin_session'
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60
const encoder = new TextEncoder()
const DEFAULT_ADMIN_USERNAME = 'admin'

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const binary = String.fromCharCode(...view)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlText(value: string) {
  return base64Url(encoder.encode(value))
}

function base64UrlToText(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
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

export async function verifyAdminCredentials(username: string, password: string) {
  const [registeredMatches, fallbackMatches] = await Promise.all([
    verifyRegisteredAdminCredentials(username, password),
    verifyFallbackAdminCredentials(username, password),
  ])
  return registeredMatches || fallbackMatches
}

async function verifyFallbackAdminCredentials(username: string, password: string) {
  const [usernameMatches, passwordMatches] = await Promise.all([
    constantTimeEqual(username.trim(), adminUsername()),
    constantTimeEqual(password, adminPassword()),
  ])
  return usernameMatches && passwordMatches ? fallbackPrincipal() : null
}

function adminUsername() {
  const username = optionalEnv('ADMIN_USERNAME')?.trim()
  return username || DEFAULT_ADMIN_USERNAME
}

function adminPassword() {
  return optionalEnv('ADMIN_PASSWORD') || uploadToken()
}

function optionalEnv(key: string) {
  return (env as unknown as Record<string, string | undefined>)[key]
}

function fallbackPrincipal(): AdminPrincipal {
  return { userKey: 'env:admin', username: adminUsername(), role: 'admin' }
}

function normalizePrincipal(value: unknown): AdminPrincipal | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const userKey = typeof record.userKey === 'string' ? record.userKey : ''
  const username = typeof record.username === 'string' ? record.username : ''
  const role = record.role === 'admin' || record.role === 'agent' ? record.role : 'agent'
  if (!userKey || !username) return null
  return { userKey, username, role }
}

export async function createAdminSession(principal: AdminPrincipal = fallbackPrincipal()) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
  const encodedPrincipal = base64UrlText(JSON.stringify(principal))
  const payload = `v2:${expiresAt}:${encodedPrincipal}`
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
  return Boolean(await currentAdminPrincipal(request))
}

export async function currentAdminPrincipal(request: Request): Promise<AdminPrincipal | null> {
  const value = cookieValue(request)
  const separator = value.lastIndexOf('.')
  if (separator < 1) return null
  const payload = value.slice(0, separator)
  const providedSignature = value.slice(separator + 1)
  const [version, expiresText, encodedPrincipal] = payload.split(':')
  const expiresAt = Number(expiresText)
  if ((version !== 'v1' && version !== 'v2') || !Number.isInteger(expiresAt) || expiresAt <= Date.now() / 1000) return null
  if (!await constantTimeEqual(providedSignature, await signature(payload))) return null
  if (version === 'v1') return fallbackPrincipal()
  try {
    return normalizePrincipal(JSON.parse(base64UrlToText(encodedPrincipal || '')))
  } catch {
    return null
  }
}

export function sessionCookie(request: Request, value: string, maxAge = SESSION_DURATION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}
