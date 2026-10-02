import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import './upload-token-docs.css'

export function UploadTokenDocs() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setToken('')
    setError('')
    setNotice('')
    setLoading(true)
    async function load() {
      try {
        const response = await fetch('/api/admin/upload-token', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json()
        if (!data || typeof data !== 'object') throw new Error('读取上传令牌失败，请重试')
        if (!response.ok || !('ok' in data) || data.ok !== true || !('token' in data) || typeof data.token !== 'string' || !data.token.trim()) {
          throw new Error('error' in data && typeof data.error === 'string' ? data.error : '读取上传令牌失败，请重试')
        }
        if (!controller.signal.aborted) setToken(data.token)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取上传令牌失败，请重试')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt])

  async function copy(header: boolean) {
    try {
      await navigator.clipboard.writeText(header ? `Authorization: Bearer ${token}` : token)
      setNotice(header ? '已复制 Authorization 请求头' : '已复制上传令牌')
    } catch {
      setNotice('无法访问剪贴板，请选中下方令牌手动复制')
    }
  }

  return (
    <section className="data-panel upload-token-docs" aria-labelledby="upload-token-heading">
      <div className="upload-token-docs-heading">
        <div>
          <h3 id="upload-token-heading">上传令牌 · UPLOAD_API_TOKEN</h3>
          <p>当前环境正在使用的完整令牌。上传程序中填写此值，替换示例中的 &lt;UPLOAD_API_TOKEN&gt;。</p>
        </div>
        <span className="docs-role-pill">仅管理员可见</span>
      </div>
      {loading && <p role="status">正在读取上传令牌…</p>}
      {error && <div className="upload-token-docs-error">
        <p role="alert">{error}</p>
        <button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />重新读取</button>
      </div>}
      {token && <>
        <textarea aria-label="UPLOAD_API_TOKEN 完整值" value={token} readOnly rows={3} spellCheck={false} autoComplete="off" />
        <div className="upload-token-docs-actions">
          <button type="button" className="primary-button" onClick={() => void copy(false)}><Copy size={14} aria-hidden="true" />复制令牌</button>
          <button type="button" className="secondary-button" onClick={() => void copy(true)}><Copy size={14} aria-hidden="true" />复制 Authorization 请求头</button>
          {notice && <span role="status">{notice}</span>}
        </div>
        <p>此令牌具有全局访问权限，请仅交给可信的上传程序维护者。</p>
      </>}
    </section>
  )
}
