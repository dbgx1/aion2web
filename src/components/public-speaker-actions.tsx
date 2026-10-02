import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, Search } from 'lucide-react'
import type { ConsoleMessage } from '#/lib/use-aion-console'
import type { GameCharacter } from '#/lib/game-characters'
import { publicSpeaker } from '#/lib/public-speaker'
import { toGameCharacter, type CharacterResponse } from '#/lib/use-character-directory'

export function PublicSpeakerActions({ message, onOpen, onAdded, onQuery }: {
  message: ConsoleMessage
  onOpen: (character: GameCharacter) => void; onAdded: () => void
  onQuery: (character: GameCharacter) => void
}) {
  const speaker = publicSpeaker(message)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(''), [failed, setFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  if (!speaker) return <strong>{message.title}</strong>

  function queryProfile() {
    if (!speaker) return
    setFailed(false); setFeedback('')
    if (!speaker.serverId || !speaker.characterName || speaker.characterName === 'unknown') {
      setFailed(true); setFeedback('公屏消息缺少角色名称或区服，无法查询官网资料。'); return
    }
    onQuery({ ...toGameCharacter({ id: 0, ...speaker, serverName: speaker.serverId, legionName: '', legionPosition: null,
      level: 0, className: '', faction: '', avatarUrl: '', lastSeenAt: Date.parse(message.time) || Date.now() }),
      id: `public:${speaker.serverId}:${speaker.characterId || speaker.characterName}` })
  }

  async function openChat() {
    if (request.current || !speaker) return
    setFailed(false); setFeedback('')
    if (!speaker.serverId || !speaker.characterName || speaker.characterName === 'unknown') {
      setFailed(true); setFeedback('公屏消息缺少角色名称或区服，无法准确识别玩家。'); return
    }
    const controller = new AbortController()
    request.current = controller; setBusy(true)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    try {
      const params = new URLSearchParams({ serverId: speaker.serverId, limit: '2', includeTotal: '0',
        ...(speaker.characterId ? {characterId: speaker.characterId} : {characterName: speaker.characterName}) })
      const response = await fetch(`/api/characters?${params}`, {signal})
      const result = await response.json() as CharacterResponse & {error?: string}
      if (!response.ok || !result.ok) throw new Error(result.error || '角色查询失败，请重试。')
      if (result.characters.length > 1) throw new Error('存在同名角色，且消息没有唯一角色 ID，无法确定玩家。')
      let character = result.characters[0]
      if (!character) {
        if (!speaker.characterId) throw new Error('消息缺少角色 ID，数据库中也未找到该玩家，暂时无法入库并打开私聊。')
        const response = await fetch('/api/characters', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(speaker), signal})
        const result = await response.json() as {ok?:boolean; character?:CharacterResponse['characters'][number]; error?:string}
        if (!response.ok || !result.ok || !result.character) throw new Error(result.error || '加入角色数据库失败，请重试。')
        if (controller.signal.aborted) return
        character = result.character
        onAdded()
      }
      if (!controller.signal.aborted) onOpen(toGameCharacter(character))
    } catch (cause) {
      if (!controller.signal.aborted) { setFailed(true); setFeedback(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : '请求超时，请检查网络后重试。') }
    } finally {
      if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setBusy(false) }
    }
  }
  return <div className="public-speaker-actions">
    <button type="button" className="public-speaker-name" disabled={busy} onClick={() => void openChat()} title={`私聊 ${speaker.characterName}`}>{speaker.characterName}</button>
    <button type="button" disabled={busy} onClick={() => void openChat()} aria-label={`私聊 ${speaker.characterName}`}><MessageSquareText size={13} aria-hidden="true" />{busy ? '正在打开…' : '私聊'}</button>
    <button type="button" onClick={queryProfile} aria-label={`查询角色资料：${speaker.characterName}`}><Search size={13} aria-hidden="true" />查询</button>
    {feedback && <span className={failed ? 'is-error' : ''} role={failed ? 'alert' : 'status'}>{feedback}</span>}
  </div>
}
