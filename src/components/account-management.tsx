import { useEffect, useState, type FormEvent } from 'react'
type User = { id: number; username: string; status: 'active' | 'disabled' }
type Data = { users: User[] }
export function AccountManagement() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  async function refresh() {
    const response = await fetch('/api/admin/accounts', { cache: 'no-store' })
    const result = await response.json() as Data & { error?: string }
    if (!response.ok) throw new Error(result.error || '加载失败')
    setData(result)
  }
  useEffect(() => { void refresh().catch(cause => setError(cause.message)) }, [])
  async function mutate(input: unknown) {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      const result = await response.json() as { error?: string }
      if (!response.ok) { if (response.status === 409) await refresh(); throw new Error(result.error || '保存失败') }
      await refresh(); setNotice('已保存'); return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); return false }
    finally { setBusy(false) }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form)
    if (await mutate({ action: 'create', username: values.get('username'), password: values.get('password') })) form.reset()
  }
  const visibleUsers = data?.users.filter(user => user.username.toLowerCase().includes(accountSearch.trim().toLowerCase())) || []
  return <section className="account-management">
    <header className="account-heading"><div><h2>客服账号管理</h2><p>统一管理客服账号；所有启用的账号均可访问全部区服和在线客户端。</p></div><span className="account-admin-tag">管理员专属</span></header>
    <div className="account-overview">
      <div><span>客服账号</span><strong>{data ? data.users.length : '—'}</strong><small>{data ? `${data.users.filter(user => user.status === 'active').length} 个账号使用中` : '正在读取'}</small></div>
      <div><span>区服范围</span><strong>全部区服</strong><small>所有客服账号统一开放</small></div>
      <div><span>已停用账号</span><strong>{data ? data.users.filter(user => user.status === 'disabled').length : '—'}</strong><small>停用账号无法登录</small></div>
    </div>
    {error && <p className="account-feedback is-error" role="alert">{error}</p>}{notice && <p className="account-feedback" role="status">{notice}</p>}
    <div className="account-top-grid">
      <section className="account-card"><header className="account-card-heading"><div><h3>客服列表 <span>{data?.users.length || 0}</span></h3><p>查看账号状态</p></div><input aria-label="搜索客服账号" value={accountSearch} onChange={event => setAccountSearch(event.target.value)} placeholder="搜索客服账号" /></header>
        <div className="account-roster">
          {!data ? <p className="account-empty">正在加载客服账号…</p> : !visibleUsers.length ? <p className="account-empty">{accountSearch ? '没有找到匹配的客服账号' : '还没有客服账号，请先创建。'}</p> : visibleUsers.map(user => <div className="account-row" key={user.id}>
            <div className="account-identity"><span className="account-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>全部区服</small></div></div>
            <span className={`account-status ${user.status === 'active' ? 'is-active' : ''}`}>{user.status === 'active' ? '正常' : '已停用'}</span>
            <button className="account-state-button" type="button" disabled={busy} onClick={() => void mutate({ action: 'status', userId: user.id, status: user.status === 'active' ? 'disabled' : 'active' })}>{user.status === 'active' ? '停用' : '启用'}</button>
          </div>)}
        </div>
      </section>
      <section className="account-card account-create-card"><header className="account-card-heading"><div><h3>新建客服</h3><p>账号由管理员统一创建</p></div></header>
        <form onSubmit={create} className="account-create">
          <label>客服账号<input name="username" aria-label="客服账号" placeholder="输入登录账号" required minLength={3} maxLength={32} autoComplete="off" /><small>3–32 位字母、数字、下划线、点或短横线</small></label>
          <label>初始密码<input name="password" placeholder="设置至少 8 位密码" type="password" required minLength={8} maxLength={100} autoComplete="new-password" /></label>
          <button className="primary-button" disabled={busy}>{busy ? '正在保存…' : '创建客服'}</button>
          <p className="account-form-note">创建后即可登录并查看全部区服和在线客户端。</p>
        </form>
      </section>
    </div>
  </section>
}
