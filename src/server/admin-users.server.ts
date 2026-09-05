import { env } from 'cloudflare:workers'

const encoder = new TextEncoder()
const PASSWORD_ITERATIONS = 100_000
const PASSWORD_HASH_BYTES = 32
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/
const DUMMY_SALT = new Uint8Array(PASSWORD_HASH_BYTES)

type AdminUserRow = {
  id: number
  username: string
  username_normalized: string
  password_hash: string
  password_salt: string
  password_iterations: number
  role?: 'admin' | 'agent'
  display_name?: string | null
  status?: 'active' | 'disabled'
}

export type AdminPrincipal = {
  userKey: string
  username: string
  role: 'admin' | 'agent'
}

export type RegisterAdminUserResult =
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; error: string }

function database() {
  return env.DB
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase()
}

function base64Url(bytes: Uint8Array | ArrayBuffer) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function arrayBufferFor(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: arrayBufferFor(salt), iterations, hash: 'SHA-256' },
    key,
    PASSWORD_HASH_BYTES * 8,
  )
  return new Uint8Array(bits)
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(first: ArrayBuffer, second: ArrayBuffer): boolean
  }
  return subtle.timingSafeEqual(arrayBufferFor(left), arrayBufferFor(right))
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_HASH_BYTES))
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS)
  return {
    hash: base64Url(hash),
    salt: base64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  }
}

async function findAdminUser(username: string) {
  try {
    return await database().prepare(`
      SELECT id, username, username_normalized, password_hash, password_salt,
        password_iterations, role, display_name, status
      FROM admin_users
      WHERE username_normalized = ?
    `).bind(normalizeUsername(username)).first<AdminUserRow>()
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such column')) {
      return await database().prepare(`
        SELECT id, username, username_normalized, password_hash, password_salt, password_iterations
        FROM admin_users
        WHERE username_normalized = ?
      `).bind(normalizeUsername(username)).first<AdminUserRow>()
    }
    if (cause instanceof Error && cause.message.includes('no such table')) return null
    throw cause
  }
}

async function verifyPassword(row: AdminUserRow | null, password: string) {
  const salt = row ? base64UrlToBytes(row.password_salt) : DUMMY_SALT
  const iterations = row?.password_iterations || PASSWORD_ITERATIONS
  const expected = row ? base64UrlToBytes(row.password_hash) : new Uint8Array(PASSWORD_HASH_BYTES)
  const actual = await derivePasswordHash(password, salt, iterations)
  return Boolean(row) && timingSafeEqual(actual, expected)
}

export function validateRegistrationInput(username: string, password: string) {
  const cleanUsername = username.trim()
  if (!USERNAME_PATTERN.test(cleanUsername)) {
    return '账号需要 3-32 位，只能使用字母、数字、下划线、点和短横线。'
  }
  if (password.length < 8 || password.length > 100) {
    return '密码需要 8-100 位。'
  }
  return ''
}

export async function registerAdminUser(username: string, password: string): Promise<RegisterAdminUserResult> {
  const cleanUsername = username.trim()
  const error = validateRegistrationInput(cleanUsername, password)
  if (error) return { ok: false, error }

  const existing = await findAdminUser(cleanUsername)
  if (existing) return { ok: false, error: '账号已存在，请换一个账号。' }

  const now = Date.now()
  const currentUserCount = await countRegisteredAdminUsers()
  const role: AdminPrincipal['role'] = currentUserCount === 0 ? 'admin' : 'agent'
  const passwordHash = await hashPassword(password)
  try {
    await database().prepare(`
      INSERT INTO admin_users (
        username, username_normalized, password_hash, password_salt,
        password_iterations, role, display_name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      cleanUsername,
      normalizeUsername(cleanUsername),
      passwordHash.hash,
      passwordHash.salt,
      passwordHash.iterations,
      role,
      cleanUsername,
      'active',
      now,
      now,
    ).run()
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE')) {
      return { ok: false, error: '账号已存在，请换一个账号。' }
    }
    if (cause instanceof Error && cause.message.includes('no such table')) {
      return { ok: false, error: '账号表尚未初始化，请先执行数据库迁移。' }
    }
    throw cause
  }

  const user = await findAdminUser(cleanUsername)
  return {
    ok: true,
    principal: userPrincipal(user || {
      id: 0,
      username: cleanUsername,
      username_normalized: normalizeUsername(cleanUsername),
      password_hash: '',
      password_salt: '',
      password_iterations: PASSWORD_ITERATIONS,
      role,
      display_name: cleanUsername,
      status: 'active',
    }),
  }
}

export async function countRegisteredAdminUsers() {
  try {
    const row = await database().prepare(`
      SELECT COUNT(*) AS total_count FROM admin_users
    `).first<{ total_count: number }>()
    return Number(row?.total_count || 0)
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table')) return 0
    throw cause
  }
}

function userPrincipal(user: AdminUserRow): AdminPrincipal {
  return {
    userKey: `user:${user.id}`,
    username: user.display_name || user.username,
    role: user.role || 'agent',
  }
}

export async function verifyRegisteredAdminCredentials(username: string, password: string) {
  const user = await findAdminUser(username)
  const valid = await verifyPassword(user, password)
  if (valid && user && (user.status || 'active') === 'active') {
    await database().prepare(`
      UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?
    `).bind(Date.now(), Date.now(), user.id).run()
    return userPrincipal(user)
  }
  return null
}
