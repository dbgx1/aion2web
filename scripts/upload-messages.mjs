import { readFile } from 'node:fs/promises'

const filePath = process.argv[2] || 'messages.json'
const apiBaseUrl = (process.env.AION_API_URL || 'http://localhost:3000').replace(/\/$/, '')
const username = process.env.AION_USERNAME || process.env.ADMIN_USERNAME || ''
const password = process.env.AION_PASSWORD || process.env.ADMIN_PASSWORD || ''
const sessionCookie = process.env.AION_SESSION_COOKIE || ''

if (!sessionCookie && (!username || !password)) {
  throw new Error('请先设置 AION_USERNAME/AION_PASSWORD，或设置 AION_SESSION_COOKIE')
}

const source = JSON.parse(await readFile(filePath, 'utf8'))
const serverId = String(source.serverId || source.server_id || '').trim()
const characterId = String(source.characterId || source.character_id || '').trim()
const messages = source.messages
if (!serverId || !characterId || !Array.isArray(messages)) {
  throw new Error('JSON 必须包含 serverId、characterId 和 messages 数组')
}

const cookie = sessionCookie || await login()
let uploaded = 0
for (let offset = 0; offset < messages.length; offset += 50) {
  const batch = messages.slice(offset, offset + 50)
  const response = await fetch(`${apiBaseUrl}/api/messages`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ serverId, characterId, messages: batch }),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(`上传失败 (${response.status}): ${JSON.stringify(result)}`)
  }
  uploaded += result.inserted || 0
  console.log(`已处理 ${Math.min(offset + batch.length, messages.length)}/${messages.length}，新增 ${result.inserted || 0} 条`)
}

console.log(`完成，共新增 ${uploaded} 条聊天消息`)

async function login() {
  const response = await fetch(`${apiBaseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`登录失败 (${response.status}): ${JSON.stringify(result)}`)
  }
  const setCookie = response.headers.get('set-cookie') || ''
  const cookie = setCookie.split(';')[0]
  if (!cookie) throw new Error('登录成功但没有收到会话 Cookie')
  return cookie
}
