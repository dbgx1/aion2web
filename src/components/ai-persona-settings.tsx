import { useEffect, useState } from 'react'
import { defaultAiPersona, type AiPersona, type AiPersonaPayload } from '#/lib/ai-persona'

const fields = [
  { key: 'systemPrompt', label: 'AI 应该是谁', limit: 3000 },
  { key: 'stylePrompt', label: '说话风格', limit: 3000 },
  { key: 'goalPrompt', label: '聊天目标', limit: 3000 },
  { key: 'forbiddenPrompt', label: '禁止内容', limit: 3000 },
  { key: 'examplePrompt', label: '示例话术', limit: 6000 },
] as const

function payload(persona: AiPersona): AiPersonaPayload {
  const { updatedAt: _, ...values } = persona
  return values
}

export function AiPersonaSettings() {
  const [draft, setDraft] = useState<AiPersona>(defaultAiPersona)
  const [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void fetch('/api/ai/persona', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        const data = await response.json() as { persona?: AiPersona; error?: string }
        if (!response.ok || !data.persona) throw new Error(data.error || '读取通用人设失败')
        if (controller.signal.aborted) return
        setDraft(data.persona); setSaved(JSON.stringify(payload(data.persona))); setLoaded(true)
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取通用人设失败') })
    return () => controller.abort()
  }, [attempt])
  const dirty = loaded && JSON.stringify(payload(draft)) !== saved
  async function save() {
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/ai/persona', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(draft)), signal: AbortSignal.timeout(15000) })
      const data = await response.json() as { persona?: AiPersona; error?: string }
      if (!response.ok || !data.persona) throw new Error(data.error || '保存通用人设失败')
      setDraft(data.persona); setSaved(JSON.stringify(payload(data.persona)))
      setNotice('通用人设已保存，AI 助手、自由托管和智能接待的下一次回复都会使用。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存通用人设失败') }
    finally { setSaving(false) }
  }
  return <section className="reception-card reception-library" aria-label="通用人设">
    <div className="reception-toolbar"><div><h3>通用人设与聊天风格</h3><p className="reception-muted">当前账号的 AI 助手、自由托管、智能接待共用。原有的人设已保留。</p></div>
      <button type="button" className="primary-button compact" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存通用人设'}</button></div>
    {!loaded && <p>{error ? '暂时无法读取已有配置。' : '正在读取通用人设…'}{error && <button type="button" onClick={() => setAttempt(value => value + 1)}>重试读取人设</button>}</p>}
    <fieldset disabled={!loaded || saving} className="reception-persona-fields">
      <label>人设名称<input maxLength={60} value={draft.name} onChange={e => { setDraft({ ...draft, name: e.target.value }); setNotice('') }} /></label>
      <div className="reception-columns">{fields.map(field => <label key={field.key}>{field.label}<textarea aria-label={field.label} rows={4} maxLength={field.limit} value={draft[field.key]} onChange={e => { setDraft({ ...draft, [field.key]: e.target.value }); setNotice('') }} /></label>)}</div>
    </fieldset>
    {dirty && <p className="reception-muted">通用人设有未保存修改，请点击“保存通用人设”。</p>}
    {error && <p className="reception-alert" role="alert">{error}</p>}{notice && <p className="reception-notice" role="status">{notice}</p>}
  </section>
}
