import { createFileRoute } from '@tanstack/react-router'
import { parseCharacterUpload } from '#/lib/character-upload'
import { jsonError, verifyBearerToken } from '#/server/api-auth.server'
import { upsertCharacters, uploadToken } from '#/server/characters.server'

const MAX_BODY_BYTES = 1_000_000
const MAX_BATCH_SIZE = 200

export const Route = createFileRoute('/api/characters/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!await verifyBearerToken(request, uploadToken())) {
          return jsonError('上传令牌无效', 401)
        }

        const contentLength = Number(request.headers.get('content-length') || 0)
        if (contentLength > MAX_BODY_BYTES) return jsonError('请求体不能超过 1MB', 413)

        const bodyText = await request.text()
        if (bodyText.length > MAX_BODY_BYTES) return jsonError('请求体不能超过 1MB', 413)

        let body: unknown
        try {
          body = JSON.parse(bodyText)
        } catch {
          return jsonError('请求体必须是合法 JSON', 400)
        }

        const records = Array.isArray(body)
          ? body
          : typeof body === 'object' && body !== null && 'characters' in body
            ? (body as { characters?: unknown }).characters
            : undefined
        if (!Array.isArray(records)) return jsonError('请提供 characters 数组', 400)
        if (records.length === 0) return jsonError('characters 不能为空', 400)
        if (records.length > MAX_BATCH_SIZE) {
          return jsonError(`每批最多上传 ${MAX_BATCH_SIZE} 个角色`, 400)
        }

        const parsed = records.map((record, index) => parseCharacterUpload(record, index))
        const errors = parsed.flatMap((result) => result.ok ? [] : [result.error])
        if (errors.length > 0) return jsonError('角色数据校验失败', 400, errors.slice(0, 20))

        const characters = parsed.flatMap((result) => result.ok ? [result.value] : [])
        const written = await upsertCharacters(characters)
        return Response.json({ ok: true, received: records.length, written })
      },
    },
  },
})
