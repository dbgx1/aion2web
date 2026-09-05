import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { acquireClientLock, listClientLocks, releaseClientLock, releaseOfflineClientLock } from '#/server/client-locks.server'
import { jsonError } from '#/server/api-auth.server'

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, maxLength) : ''
}

async function requestLockPayload(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { agentId: '', action: '', acquiredAt: 0, offlineAt: 0 }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { agentId: '', action: '', acquiredAt: 0, offlineAt: 0 }
  const record = body as Record<string, unknown>
  return {
    agentId: text(record.agentId, 200),
    action: text(record.action, 40),
    acquiredAt: typeof record.acquiredAt === 'number' ? record.acquiredAt : 0,
    offlineAt: typeof record.offlineAt === 'number' ? record.offlineAt : 0,
  }
}

export const Route = createFileRoute('/api/client-locks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        return Response.json({ ok: true, user: principal, locks: await listClientLocks() }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
      POST: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        const { agentId, action, offlineAt, acquiredAt } = await requestLockPayload(request)
        if (action === 'page_exit') {
          if (!agentId || !acquiredAt) return jsonError('缺少占用信息', 400)
          // Old tabs still send this beacon. Browser navigation does not end the
          // account's shared ownership: another tab may be actively managing it.
          return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
        }
        if (action === 'offline') {
          if (!agentId || !offlineAt) return jsonError('缺少客户端离线信息', 400)
          await releaseOfflineClientLock(agentId, offlineAt, principal)
          return Response.json({ ok: true }, {
            headers: { 'Cache-Control': 'no-store' },
          })
        }
        if (action && action !== 'acquire') return jsonError('请在实时消息页面主动退出客户端', 400)
        const result = await acquireClientLock(agentId, principal)
        if (!result.ok) return jsonError(result.error, result.lock ? 409 : 400)
        return Response.json({ ok: true, lock: result.lock }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
      DELETE: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return jsonError('未登录', 401)
        const { agentId, action, acquiredAt } = await requestLockPayload(request)
        if (action !== 'manual_exit' || !agentId || !acquiredAt) return jsonError('请在实时消息页面主动退出客户端', 400)
        await releaseClientLock(agentId, principal, acquiredAt)
        return Response.json({ ok: true }, {
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
