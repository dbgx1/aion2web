export type CommandSendResult = {
  sent: boolean
  status: 'confirmed' | 'failed' | 'unknown' | 'not_sent'
  requestId?: string
  message: string
}

/** Correlates an execution result with this connection's exact agent + request. */
export class CommandReceipts {
  private pending = new Map<string, { agentId: string; finish: (result: CommandSendResult) => void }>()

  get size() { return this.pending.size }

  send(agentId: string, publish: (requestId: string) => boolean, signal?: AbortSignal, timeoutMs = 45_000): Promise<CommandSendResult> {
    const requestId = crypto.randomUUID()
    const outcome = (status: CommandSendResult['status'], message: string): CommandSendResult => ({ sent: status === 'confirmed', status, requestId, message })
    if (signal?.aborted) return Promise.resolve(outcome('not_sent', '操作已取消，未提交发送命令。'))
    return new Promise(resolve => {
      const finish = (result: CommandSendResult) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        this.pending.delete(requestId)
        resolve(result)
      }
      const cancel = () => finish(outcome('unknown', '已停止等待，发送结果未确认；请核对聊天记录，不要自动重发。'))
      const timer = setTimeout(() => finish(outcome('unknown', '等待游戏客户端回执超时，发送结果未确认；请核对聊天记录，不要自动重发。')), timeoutMs)
      this.pending.set(requestId, { agentId, finish })
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        if (!publish(requestId)) finish(outcome('not_sent', '客户端未连接或命令被拒绝，未提交发送。'))
      } catch {
        finish(outcome('unknown', '提交命令时连接异常，发送结果未确认；请先核对聊天记录。'))
      }
    })
  }

  accept(agentId: string, value: unknown, retained = false) {
    if (retained || !value || typeof value !== 'object') return
    const receipt = value as Record<string, unknown>
    if (receipt.type !== 'control_result' || typeof receipt.requestId !== 'string'
      || (receipt.agentId !== undefined && receipt.agentId !== agentId)) return
    const pending = this.pending.get(receipt.requestId)
    if (!pending || pending.agentId !== agentId || typeof receipt.ok !== 'boolean') return
    const status = receipt.status === 'unknown' || receipt.status === 'not_sent'
      ? receipt.status : receipt.ok ? 'confirmed' : 'failed'
    pending.finish({ requestId: receipt.requestId, sent: status === 'confirmed', status,
      message: status === 'confirmed' ? '游戏客户端已确认发送成功。'
        : typeof receipt.error === 'string' && receipt.error ? receipt.error
        : status === 'unknown' ? '游戏请求结果未确认，请核对聊天记录，不要自动重发。'
        : status === 'not_sent' ? '客户端未执行该指令。' : '游戏客户端报告发送失败，请核对聊天记录。' })
  }

  disconnect() {
    for (const [requestId, entry] of this.pending) entry.finish({ sent: false, status: 'unknown', requestId,
      message: '连接已断开，发送结果未确认；请核对聊天记录，不要自动重发。' })
  }
}
