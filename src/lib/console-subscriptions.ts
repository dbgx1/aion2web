import type { MqttClient } from 'mqtt'

export function validAgentId(id: string) {
  return Boolean(id && !/[\u0000/+#]/.test(id))
}

export function agentTopics(base: string, id: string) {
  return validAgentId(id) ? [`${base}/agents/${id}/status`, `${base}/events/${id}/chat`, `${base}/events/${id}/receipts`] : []
}

/** Reconciles subscriptions on selection changes; reconnect starts with a clean session. */
export class ConsoleSubscriptions {
  private topics = new Set<string>()
  private generation = 0
  readyAgent = ''

  reset() {
    ++this.generation
    this.topics.clear()
    this.readyAgent = ''
  }

  update(client: MqttClient, base: string, agentId: string, failed: (message: string) => void) {
    const generation = ++this.generation
    this.readyAgent = ''
    // All clients need continuous liveness updates, even outside discovery.
    // Chat and receipts remain scoped to the selected client.
    const wanted = new Set([`${base}/agents/+/status`, ...agentTopics(base, agentId).slice(1)])
    const removed = [...this.topics].filter(topic => !wanted.has(topic))
    this.topics = wanted
    if (removed.length) client.unsubscribe(removed)
    if (!wanted.size) return
    // Re-subscribe the full desired set so readiness always follows its own SUBACK.
    client.subscribe([...wanted], { qos: 1 }, (error, granted) => {
      if (generation !== this.generation) return
      if (error || !granted || granted.length !== wanted.size
        || [...wanted].some(topic => !granted.some(item => item.topic === topic && [0, 1, 2].includes(item.qos)))) {
        failed(error?.message || '消息服务拒绝了主题订阅')
        return
      }
      this.readyAgent = validAgentId(agentId) ? agentId : ''
    })
  }
}
