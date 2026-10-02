/** Local lifetime of ONE explicit administrator submission, across tool continuations. */
export class AiInteraction {
  private generation = 0
  private current?: AiInteractionRun

  get active() { return this.current !== undefined }

  begin() {
    this.stop()
    const run = new AiInteractionRun(++this.generation)
    this.current = run
    return run
  }

  isCurrent(run: AiInteractionRun) { return this.current === run && !run.signal.aborted }

  stop() {
    this.current?.controller.abort()
    this.current = undefined
  }

  finish(run: AiInteractionRun) { if (this.isCurrent(run)) this.stop() }

  fail() { if (this.current) this.current.failed = true }

  beforeRequest() {
    if (!this.current) throw new Error('AI 操作已取消，请重新提问。')
    if (++this.current.requests > 8) throw new Error('AI 本轮工具步骤过多，已停止继续请求；请核对已执行操作后重新提问。')
  }

  registerTool(id: string, name: string) { this.current?.tools.set(id, name) }

  requireTool(id: string | undefined, name: string) {
    const run = this.current
    if (!run || !id || run.tools.get(id) !== name || run.signal.aborted) {
      throw new Error('AI 操作已取消或已过期，请重新发起请求。')
    }
    return run
  }
}

export class AiInteractionRun {
  readonly controller = new AbortController()
  readonly signal = this.controller.signal
  readonly tools = new Map<string, string>()
  private actions = new Map<string, Promise<unknown>>()
  failed = false
  requests = 0
  constructor(readonly id: number) {}

  /** Repeated model calls in this submission reuse the original result, including failure. */
  once<T>(key: string, action: () => T | Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    if (this.actions.has(key)) return this.actions.get(key) as Promise<T>
    const result = Promise.resolve().then(() => { this.signal.throwIfAborted(); return action() })
    this.actions.set(key, result)
    return result
  }
}
