import { useRef, useState } from 'react'
import type { GameCharacter } from '#/lib/game-characters'

export function CharacterActions({ character, onSaved }: { character: GameCharacter; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    const data = new FormData(event.currentTarget)
    locked.current = true; setBusy(true); setError('')
    try {
      const response = await fetch('/api/characters', {
        method: mode === 'delete' ? 'DELETE' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'delete' ? { id: Number(character.id), confirm: true } : {
          id: Number(character.id), name: data.get('name'), legionName: data.get('legionName'), className: data.get('className'), faction: data.get('faction'),
          level: Number(data.get('level')), combatPower: data.get('combatPower') === '' ? null : Number(data.get('combatPower')), legionPosition: data.get('legionPosition') === '' ? null : Number(data.get('legionPosition')),
        }),
      })
      const result = await response.json() as { ok: boolean; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || '操作失败')
      window.dispatchEvent(new Event('aion:characters-changed'))
      setMode(null)
      await onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试') }
    finally { locked.current = false; setBusy(false) }
  }
  return <>
    <div className="toolbar-actions"><button type="button" className="secondary-button" onClick={() => { setError(''); setMode('edit') }}>修改</button><button type="button" className="secondary-button character-delete" onClick={() => { setError(''); setMode('delete') }}>删除</button></div>
    {mode && <div className="character-action-overlay" onKeyDown={event => { if (event.key === 'Escape' && !busy) setMode(null) }}>
      <section role="dialog" aria-modal="true" aria-label={mode === 'edit' ? '修改角色' : '删除角色'} className="character-action-dialog">
        <h3>{mode === 'edit' ? '修改角色资料' : '删除角色'}</h3>
        <p>{character.name} · {character.serverName} · ID {character.characterId}</p>
        <form onSubmit={event => void submit(event)}>
          {mode === 'edit' ? <div className="character-edit-fields">
            {([['name', '角色名称', character.name], ['legionName', '军团', character.legionName], ['className', '职业', character.className], ['faction', '阵营', character.faction]] as const).map(([name, label, value]) => <label key={name}>{label}<input autoFocus={name === 'name'} name={name} defaultValue={value} maxLength={100} required={name === 'name'} disabled={busy} /></label>)}
            <label>等级<input name="level" type="number" min="0" max="999" step="1" defaultValue={character.level} required disabled={busy} /></label>
            <label>战斗力（留空为未知）<input name="combatPower" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={character.combatPower ?? ''} disabled={busy} /></label>
            <label>军团职位<select name="legionPosition" defaultValue={character.legionPosition ?? ''} disabled={busy}><option value="">未知</option><option value="0">0 · 军团长</option><option value="1">1 · 军团干部</option><option value="2">2 · 军团成员</option><option value="3">3 · 雇佣兵</option></select></label>
            <p>修改对同区服客服可见；后续重新采集或导入可能覆盖资料。</p>
          </div> : <p className="character-delete">确定删除这个角色？该角色所有客服的关联聊天、消息和跟踪备注也会永久删除，无法撤销。后续重新采集或导入可能再次创建角色。</p>}
          {error && <p role="alert">{error}</p>}
          <div className="toolbar-actions"><button autoFocus={mode === 'delete'} className="secondary-button" type="button" disabled={busy} onClick={() => setMode(null)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? '处理中…' : mode === 'edit' ? '保存修改' : '确认删除'}</button></div>
        </form>
      </section>
    </div>}
  </>
}
