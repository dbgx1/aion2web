import { createFileRoute } from '@tanstack/react-router'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { uploadToken } from '#/server/characters.server'

const headers = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
}

export const Route = createFileRoute('/api/admin/upload-token')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const principal = await currentAdminPrincipal(request)
        if (!principal) return Response.json({ ok: false, error: '请先登录管理员账号' }, { status: 401, headers })
        if (principal.role !== 'admin') return Response.json({ ok: false, error: '仅管理员可查看上传令牌' }, { status: 403, headers })

        const token = uploadToken()
        if (!token?.trim()) return Response.json({ ok: false, error: '当前环境尚未配置上传令牌' }, { status: 503, headers })
        return Response.json({ ok: true, token }, { headers })
      },
    },
  },
})
