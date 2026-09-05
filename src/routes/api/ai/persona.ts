import { createFileRoute } from '@tanstack/react-router'
import type { AiPersonaPayload } from '#/lib/ai-persona'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { jsonError } from '#/server/api-auth.server'
import { getAiPersona, saveAiPersona } from '#/server/ai-persona.server'

const MAX_BODY_BYTES = 32 * 1024

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function parsePersonaPayload(value: unknown): AiPersonaPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  return {
    name: text(input.name),
    systemPrompt: text(input.systemPrompt),
    stylePrompt: text(input.stylePrompt),
    goalPrompt: text(input.goalPrompt),
    forbiddenPrompt: text(input.forbiddenPrompt),
    examplePrompt: text(input.examplePrompt),
  }
}

export const Route = createFileRoute('/api/ai/persona')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        return Response.json({ ok: true, persona: await getAiPersona(principal) }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
      PUT: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        const contentLength = Number(request.headers.get('content-length') || 0)
        if (contentLength > MAX_BODY_BYTES) return jsonError('请求体过大', 413)

        let rawBody = ''
        try {
          rawBody = await request.text()
        } catch {
          return jsonError('无法读取请求体', 400)
        }
        if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return jsonError('请求体过大', 413)

        let body: unknown
        try {
          body = JSON.parse(rawBody)
        } catch {
          return jsonError('请求体必须是合法 JSON', 400)
        }
        const payload = parsePersonaPayload(body)
        if (!payload) return jsonError('人设配置格式无效', 400)

        const result = await saveAiPersona(principal, payload)
        if (!result.ok) return jsonError(result.error, 400)
        return Response.json({ ok: true, persona: result.persona }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
