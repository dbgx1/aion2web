import { env } from 'cloudflare:workers'
import type { AdminPrincipal } from './admin-users.server'

// Routes authenticate and refresh active account status before calling this helper.
// All authenticated accounts share every server; legacy assignments are ignored.
export async function allowedServerIds(_principal: AdminPrincipal): Promise<string[] | null> {
  return null
}

export async function canAccessServer(principal: AdminPrincipal, serverId: string) {
  const allowed = await allowedServerIds(principal)
  return allowed === null || allowed.includes(serverId)
}

export async function canAccessServers(principal: AdminPrincipal, serverIds: string[]) {
  const allowed = await allowedServerIds(principal)
  return allowed === null || serverIds.every(id => allowed.includes(id))
}

export async function canAccessCharacter(principal: AdminPrincipal, id: number) {
  const row = await env.DB.prepare('SELECT server_id FROM game_characters WHERE id = ?')
    .bind(id).first<{ server_id: string }>()
  return Boolean(row && await canAccessServer(principal, row.server_id))
}
