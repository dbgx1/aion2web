import { useMemo } from 'react'
import type { SelectOption } from '#/components/searchable-select'
import type { CharacterDirectoryServer } from './game-characters'
import { ALL_SERVERS_KEY, NO_LEGION_KEY } from './use-character-directory'

export function useDirectoryOptions(servers: CharacterDirectoryServer[], selectedServerKey: string) {
  // Build each server's choices once per directory response, not per selection.
  const directory = useMemo(() => {
    const collator = new Intl.Collator('zh-CN')
    const legionChoices = (legions: Array<{ legionName: string; memberCount: number }>, unaffiliated: number): SelectOption[] => [
      { value: '', label: '全部军团' },
      { value: NO_LEGION_KEY, label: `未加入军团 (${unaffiliated})` },
      ...[...legions].sort((a, b) => collator.compare(a.legionName, b.legionName))
        .map(legion => ({ value: legion.legionName, label: `${legion.legionName} (${legion.memberCount})` })),
    ]
    const byServer = new Map<string, SelectOption[]>()
    const counts = new Map<string, number>()
    let unaffiliated = 0
    for (const server of servers) {
      byServer.set(server.serverId, legionChoices(server.legions, server.unaffiliatedCount))
      unaffiliated += server.unaffiliatedCount
      for (const legion of server.legions) counts.set(legion.legionName, (counts.get(legion.legionName) || 0) + legion.memberCount)
    }
    byServer.set(ALL_SERVERS_KEY, legionChoices([...counts].map(([legionName, memberCount]) => ({ legionName, memberCount })), unaffiliated))
    const serverOptions: SelectOption[] = [{ value: ALL_SERVERS_KEY, label: '全部区服' }]
    for (const race of [1, 2, 0]) {
      for (const server of servers.filter(item => item.raceId === race)) serverOptions.push({
        value: server.serverId, label: server.serverName,
        group: race === 1 ? '天族区服' : race === 2 ? '魔族区服' : '其他区服',
      })
    }
    return { serverOptions, byServer }
  }, [servers])
  return { serverOptions: directory.serverOptions, legionOptions: directory.byServer.get(selectedServerKey) || directory.byServer.get(ALL_SERVERS_KEY)! }
}
