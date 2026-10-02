import { createFileRoute } from '@tanstack/react-router'
import { jsonError } from '#/server/api-auth.server'

// Old clients receive an explicit closure; only admin/accounts can create users.
export const Route = createFileRoute('/api/auth/register')({
  server: { handlers: {
    POST: () => jsonError('注册已关闭，请联系管理员创建账号', 410),
  } },
})
