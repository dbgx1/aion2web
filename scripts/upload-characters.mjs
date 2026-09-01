import { readFile } from 'node:fs/promises'

const filePath = process.argv[2] || 'characters.json'
const apiBaseUrl = (process.env.AION_API_URL || 'http://localhost:3000').replace(/\/$/, '')
const uploadToken = process.env.AION_UPLOAD_TOKEN || ''

if (!uploadToken) {
  throw new Error('请先设置环境变量 AION_UPLOAD_TOKEN')
}

const source = JSON.parse(await readFile(filePath, 'utf8'))
const characters = Array.isArray(source) ? source : source.characters
if (!Array.isArray(characters)) {
  throw new Error('JSON 文件必须是角色数组，或包含 characters 数组')
}

let uploaded = 0
for (let offset = 0; offset < characters.length; offset += 200) {
  const batch = characters.slice(offset, offset + 200)
  const response = await fetch(`${apiBaseUrl}/api/characters/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${uploadToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ characters: batch }),
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(`上传失败 (${response.status}): ${JSON.stringify(result)}`)
  }
  uploaded += batch.length
  console.log(`已上传 ${uploaded}/${characters.length}`)
}

console.log(`完成，共上传 ${uploaded} 个角色`)
