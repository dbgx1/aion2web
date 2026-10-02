import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { currentAdminPrincipal } from '#/server/admin-auth.server'
import { PRIVATE_MQTT_URL } from '#/lib/private-mqtt'

export const Route = createFileRoute('/api/mqtt/connection')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = { 'Cache-Control': 'no-store', 'Vary': 'Cookie' }
        if (!await currentAdminPrincipal(request)) {
          return Response.json({ error: '未登录' }, { status: 401, headers })
        }
        const config = env as unknown as Record<string, string | undefined>
        if (!config.MQTT_USERNAME || !config.MQTT_PASSWORD) {
          return Response.json({ error: '私有消息服务尚未配置' }, { status: 503, headers })
        }
        return Response.json({ url: PRIVATE_MQTT_URL, username: config.MQTT_USERNAME, password: config.MQTT_PASSWORD }, { headers })
      },
    },
  },
})
