export class ClientOfflineMonitor {
  private heartbeats = new Map<string, number>()
  private connectedSince = 0
  private lastSweep = 0

  constructor(private ttlMs: number) {}

  observe(agentId: string, now: number) {
    this.heartbeats.set(agentId, now)
  }

  forget(agentId: string) {
    this.heartbeats.delete(agentId)
  }

  sweep(connected: boolean, now: number) {
    // A disconnected or suspended browser is not evidence that the game client is offline.
    if (!connected || !this.connectedSince || now - this.lastSweep > 6_000) this.connectedSince = now
    this.lastSweep = now
    if (!connected) return []
    const expired: string[] = []
    for (const [agentId, lastSeenAt] of this.heartbeats) {
      if (now - Math.max(lastSeenAt, this.connectedSince) > this.ttlMs) {
        expired.push(agentId)
        this.heartbeats.delete(agentId)
      }
    }
    return expired
  }
}
