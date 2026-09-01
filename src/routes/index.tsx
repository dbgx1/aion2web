import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  Globe2,
  Headphones,
  Laptop,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Power,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings2,
  Terminal,
  Unplug,
  UsersRound,
  Wifi,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ConnectionSettings,
  type ConsoleMessage,
  type OnlineAgent,
  useAionConsole,
} from '#/lib/use-aion-console'
import {
  type GameCharacter,
} from '#/lib/game-characters'
import type { ChatMessageUpload, StoredChatMessage } from '#/lib/chat-storage'
import { ALL_SERVERS_KEY, NO_LEGION_KEY, useCharacterDirectory, useServerDirectory } from '#/lib/use-character-directory'
import { aion2ServerName } from '#/lib/aion2-servers'

export const Route = createFileRoute('/')({ component: Home })

const navItems = [
  { id: 'clients', label: '客户端中心', icon: Laptop },
  { id: 'messages', label: '实时消息', icon: MessageSquareText },
  { id: 'console', label: '控制台', icon: Terminal },
  { id: 'settings', label: '连接设置', icon: Settings2 },
] as const

type SectionId = (typeof navItems)[number]['id']

function Home() {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'anonymous'>('loading')

  useEffect(() => {
    let active = true
    void fetch('/api/auth', { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (active) setAuthState(response.ok ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (active) setAuthState('anonymous')
      })
    return () => { active = false }
  }, [])

  if (authState === 'loading') {
    return <main className="auth-shell"><LoaderCircle className="spin" aria-hidden="true" size={28} /><span>正在验证登录状态</span></main>
  }
  if (authState === 'anonymous') {
    return <AdminLogin onAuthenticated={() => setAuthState('authenticated')} />
  }
  return <AuthenticatedHome onLogout={() => setAuthState('anonymous')} />
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!token.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || '登录失败')
      setToken('')
      onAuthenticated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-mark"><LockKeyhole aria-hidden="true" size={22} /></div>
        <p className="eyebrow">AION2 CONTROL PORTAL</p>
        <h1>管理员登录</h1>
        <p>输入部署时配置的上传令牌，进入角色与聊天管理中心。</p>
        <form onSubmit={submit}>
          <label><span>访问令牌</span><input type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} autoFocus /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={!token.trim() || submitting}>
            {submitting ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : <LockKeyhole aria-hidden="true" size={16} />}
            {submitting ? '正在登录' : '登录'}
          </button>
        </form>
      </section>
    </main>
  )
}

function AuthenticatedHome({ onLogout }: { onLogout: () => void }) {
  const consoleApi = useAionConsole()
  const serverDirectory = useServerDirectory()
  const persistedMessageIds = useRef(new Set<string>())
  const syncingMessageIds = useRef(new Set<string>())
  const [activeSection, setActiveSection] = useState<SectionId>('clients')
  const [selectedCharacter, setSelectedCharacter] = useState<GameCharacter>()
  const [characterId, setCharacterId] = useState('')
  const [serverKey, setServerKey] = useState('')
  const [targetName, setTargetName] = useState('')
  const [whisperContent, setWhisperContent] = useState('')
  const [commandText, setCommandText] = useState(JSON.stringify({ type: 'ping' }, null, 2))
  const [actionMessage, setActionMessage] = useState('')

  const selectedAgent = consoleApi.agents.find((agent) => agent.agentId === consoleApi.selectedAgentId)
  const serverNames = useMemo(() => new Map(
    serverDirectory.servers.map((server) => [server.serverId, server.serverName]),
  ), [serverDirectory.servers])
  const agentMessages = useMemo(() => consoleApi.selectedAgentId
    ? consoleApi.messages.filter((message) => message.agentId === consoleApi.selectedAgentId)
    : [], [consoleApi.messages, consoleApi.selectedAgentId])
  const filteredMessages = useMemo(() => {
    if (!selectedCharacter) return []
    return agentMessages.filter((message) => messageBelongsToCharacter(message, selectedCharacter))
  }, [agentMessages, selectedCharacter])

  useEffect(() => {
    if (!selectedCharacter) {
      setCharacterId('')
      setServerKey('')
      setTargetName('')
      return
    }
    setCharacterId(selectedCharacter.characterId)
    setServerKey(selectedCharacter.serverKey)
    setTargetName(selectedCharacter.name)
    setWhisperContent('')
    setActionMessage('')
  }, [selectedCharacter])

  useEffect(() => {
    if (activeSection === 'messages' && !selectedAgent) setActiveSection('clients')
  }, [activeSection, selectedAgent])

  useEffect(() => {
    async function syncMessages() {
      const requestTargets = new Map<string, ReturnType<typeof whisperTargetFromMessage>>()
      for (const message of consoleApi.messages) {
        const requestId = messageRequestId(message)
        const target = whisperTargetFromMessage(message)
        if (requestId && target.serverKey && target.characterId) requestTargets.set(requestId, target)
      }
      const groups = new Map<string, {
        serverId: string
        characterId: string
        sourceMessages: ConsoleMessage[]
        messages: ChatMessageUpload[]
      }>()
      for (const message of consoleApi.messages) {
        if (persistedMessageIds.current.has(message.id) || syncingMessageIds.current.has(message.id)) continue
        const target = whisperTargetFromMessage(message)
        const correlatedTarget = target.serverKey && target.characterId
          ? target
          : requestTargets.get(messageRequestId(message)) || target
        if (!correlatedTarget.serverKey || !correlatedTarget.characterId) continue
        const key = `${correlatedTarget.serverKey}\u0000${correlatedTarget.characterId}`
        const group = groups.get(key) || {
          serverId: correlatedTarget.serverKey,
          characterId: correlatedTarget.characterId,
          sourceMessages: [],
          messages: [],
        }
        group.sourceMessages.push(message)
        group.messages.push(chatUploadFromConsoleMessage(message, correlatedTarget.targetName))
        groups.set(key, group)
        syncingMessageIds.current.add(message.id)
      }

      await Promise.allSettled([...groups.values()].map(async (group) => {
        try {
          for (let offset = 0; offset < group.messages.length; offset += 50) {
            const sourceMessages = group.sourceMessages.slice(offset, offset + 50)
            const response = await fetch('/api/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                serverId: group.serverId,
                characterId: group.characterId,
                messages: group.messages.slice(offset, offset + 50),
              }),
            })
            if (!response.ok) break
            for (const message of sourceMessages) persistedMessageIds.current.add(message.id)
          }
        } finally {
          for (const message of group.sourceMessages) syncingMessageIds.current.delete(message.id)
        }
      }))
    }

    void syncMessages()
    const timer = window.setInterval(() => void syncMessages(), 5000)
    return () => window.clearInterval(timer)
  }, [consoleApi.messages])

  function openAgentMessages(agentId: string) {
    consoleApi.setSelectedAgentId(agentId)
    setActiveSection('messages')
    setActionMessage('')
  }

  function sendWhisper() {
    if (!consoleApi.selectedAgentId || !characterId.trim() || !whisperContent.trim()) {
      setActionMessage('请选择在线客户端，并填写目标角色 ID 和私聊内容。')
      return
    }
    const sent = consoleApi.sendCommand(consoleApi.selectedAgentId, {
      type: 'sendWhisper',
      characterId: characterId.trim(),
      serverKey: serverKey.trim(),
      targetName: targetName.trim(),
      content: whisperContent,
    })
    setActionMessage(sent ? '私聊命令已发送。' : '信令未连接，发送失败。')
    if (sent) setWhisperContent('')
  }

  function sendJsonCommand() {
    if (!consoleApi.selectedAgentId) {
      setActionMessage('请先选择一个在线客户端。')
      return
    }
    try {
      const parsed: unknown = JSON.parse(commandText)
      if (!isRecord(parsed)) throw new Error('命令必须是 JSON 对象')
      const sent = consoleApi.sendCommand(consoleApi.selectedAgentId, parsed)
      setActionMessage(sent ? '控制命令已发送。' : '信令未连接，发送失败。')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'JSON 格式不正确。')
    }
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' }).catch(() => undefined)
    consoleApi.disconnect()
    onLogout()
  }

  return (
    <main className="portal-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand" aria-label="AION Console">
          <div className="brand-mark">A</div>
          <div><strong>AION</strong><span>CONTROL PORTAL</span></div>
        </div>

        <nav className="side-nav">
          <span className="nav-caption">控制中心</span>
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            const requiresAgent = item.id === 'messages' && !selectedAgent
            return (
              <button
                className={`nav-item${isActive ? ' is-active' : ''}`}
                type="button"
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                disabled={requiresAgent}
                title={requiresAgent ? '请先在客户端中心选择一个客户端' : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === 'clients' && consoleApi.agents.length > 0
                  ? <em>{consoleApi.agents.length}</em>
                  : <ChevronRight className="nav-arrow" aria-hidden="true" size={16} />}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className={`connection-mini is-${consoleApi.connectionState}`}>
            <span aria-hidden="true" />
            <div><strong>{connectionTitle(consoleApi.connectionState)}</strong><small>{consoleApi.settings.room}</small></div>
          </div>
          <button type="button" className="utility-link"><Globe2 aria-hidden="true" size={17} />简体中文</button>
          <button type="button" className="utility-link"><Headphones aria-hidden="true" size={17} />使用帮助</button>
          <button type="button" className="utility-link" onClick={() => void logout()}><LogOut aria-hidden="true" size={17} />退出登录</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">AION2 CHAT BRIDGE</p>
            <h1>{activeSection === 'messages' && selectedAgent
              ? `实时消息 · ${selectedAgent.host || selectedAgent.agentId}`
              : navItems.find((item) => item.id === activeSection)?.label}</h1>
          </div>
          <div className="header-actions">
            <div className={`service-state is-${consoleApi.connectionState}`}>
              <span aria-hidden="true" />
              {consoleApi.connectionMessage}
            </div>
            <button className="icon-button" type="button" aria-label="通知" title="通知">
              <Bell aria-hidden="true" size={19} />
            </button>
          </div>
        </header>

        <div className="workspace-content">
          {activeSection === 'clients' && (
            <ClientCenter
              agents={consoleApi.agents}
              serverNames={serverNames}
              selectedAgentId={consoleApi.selectedAgentId}
              connectionState={consoleApi.connectionState}
              onOpenMessages={openAgentMessages}
              onRefresh={consoleApi.publishDiscover}
              onConnect={() => void consoleApi.connect()}
              onDisconnect={consoleApi.disconnect}
            />
          )}
          {activeSection === 'messages' && selectedAgent && (
            <MessageCenter
              agent={selectedAgent}
              selectedCharacter={selectedCharacter}
              agentMessages={agentMessages}
              messages={filteredMessages}
              onCharacterSelect={setSelectedCharacter}
              content={whisperContent}
              onContentChange={setWhisperContent}
              onSend={sendWhisper}
              actionMessage={actionMessage}
              onBack={() => setActiveSection('clients')}
            />
          )}
          {activeSection === 'console' && (
            <CommandConsole
              agents={consoleApi.agents}
              serverNames={serverNames}
              selectedAgentId={consoleApi.selectedAgentId}
              commandText={commandText}
              actionMessage={actionMessage}
              onAgentChange={consoleApi.setSelectedAgentId}
              onCommandChange={setCommandText}
              onSend={sendJsonCommand}
              onQuickCommand={(type) => {
                setCommandText(JSON.stringify({ type }, null, 2))
                if (consoleApi.selectedAgentId) {
                  const sent = consoleApi.sendCommand(consoleApi.selectedAgentId, { type })
                  setActionMessage(sent ? `${type} 已发送。` : '信令未连接，发送失败。')
                }
              }}
            />
          )}
          {activeSection === 'settings' && (
            <ConnectionSettingsPanel
              settings={consoleApi.settings}
              connectionState={consoleApi.connectionState}
              connectionMessage={consoleApi.connectionMessage}
              onReconnect={consoleApi.reconnect}
              onDisconnect={consoleApi.disconnect}
            />
          )}
        </div>
      </section>
    </main>
  )
}

function ClientCenter({
  agents,
  serverNames,
  selectedAgentId,
  connectionState,
  onOpenMessages,
  onRefresh,
  onConnect,
  onDisconnect,
}: {
  agents: OnlineAgent[]
  serverNames: ReadonlyMap<string, string>
  selectedAgentId: string
  connectionState: string
  onOpenMessages: (agentId: string) => void
  onRefresh: () => void
  onConnect: () => void
  onDisconnect: () => void
}) {
  const isConnected = connectionState === 'connected'
  return (
    <div className="page-stack">
      <section className="console-banner">
        <img src="/aion-client-center.png" alt="云海之上的浮空城" />
        <div className="banner-overlay" aria-hidden="true" />
        <div>
          <p className="eyebrow">LIVE AGENTS</p>
          <h2>{agents.length} 个客户端在线</h2>
          <span>房间中的客户端会通过 MQTT 心跳自动出现，15 秒未响应则移出列表。</span>
        </div>
        <UsersRound aria-hidden="true" size={34} />
      </section>

      <section className="data-panel">
        <div className="panel-toolbar">
          <div>
            <h3>在线客户端</h3>
            <p>点击客户端进入它的实时消息，消息会按客户端独立显示。</p>
          </div>
          <div className="toolbar-actions">
            <button className="secondary-button" type="button" onClick={onRefresh} disabled={!isConnected}>
              <RefreshCw aria-hidden="true" size={16} />刷新
            </button>
            {isConnected ? (
              <button className="secondary-button danger" type="button" onClick={onDisconnect}>
                <Unplug aria-hidden="true" size={16} />断开
              </button>
            ) : (
              <button className="primary-button compact" type="button" onClick={onConnect}>
                <Power aria-hidden="true" size={16} />连接信令
              </button>
            )}
          </div>
        </div>

        {agents.length > 0 ? (
          <div className="table-wrap">
            <table className="client-table">
              <thead><tr><th>客户端</th><th>服务器</th><th>房间</th><th>运行时间</th><th>最后心跳</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agentId} className={agent.agentId === selectedAgentId ? 'is-selected' : ''}>
                    <td>
                      <button type="button" onClick={() => onOpenMessages(agent.agentId)}>
                        <span className="client-icon"><Laptop aria-hidden="true" size={17} /></span>
                        <strong title={`客户端标识：${agent.agentId}`}>{agent.host || '未知计算机'}</strong>
                      </button>
                    </td>
                    <td>
                      <span className="server-identity">
                        <strong>{serverNameForAgent(agent, serverNames)}</strong>
                        {agent.serverId && <small>ID {agent.serverId}</small>}
                      </span>
                    </td>
                    <td>{agent.room || '—'}</td>
                    <td>{formatDuration(agent.startedAt)}</td>
                    <td>{relativeTime(agent.time)}</td>
                    <td><span className="online-pill"><i aria-hidden="true" />在线</span></td>
                    <td>
                      <button className="table-action" type="button" onClick={() => onOpenMessages(agent.agentId)}>
                        <MessageSquareText aria-hidden="true" size={15} />查看消息
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            {connectionState === 'connecting' || connectionState === 'reconnecting'
              ? <LoaderCircle className="spin" aria-hidden="true" size={27} />
              : <Server aria-hidden="true" size={27} />}
            <strong>{isConnected ? '暂未发现在线客户端' : '信令尚未连接'}</strong>
            <p>{isConnected ? '请确认 Python 客户端使用相同 Room，并保持 MQTT 心跳运行。' : '连接后将自动发现房间内的客户端。'}</p>
          </div>
        )}
      </section>
    </div>
  )
}

function MessageCenter(props: {
  agent: OnlineAgent
  selectedCharacter?: GameCharacter
  agentMessages: ConsoleMessage[]
  messages: ConsoleMessage[]
  content: string
  actionMessage: string
  onBack: () => void
  onCharacterSelect: (value: GameCharacter | undefined) => void
  onContentChange: (value: string) => void
  onSend: () => void
}) {
  const directory = useCharacterDirectory()
  const historyRequest = useRef(0)
  const [storedMessages, setStoredMessages] = useState<StoredChatMessage[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [messageView, setMessageView] = useState<'private' | 'public'>('private')
  const selectedServer = directory.servers.find((server) => server.serverId === directory.selectedServerKey)
  const serverGroups = [
    { label: '天族区服', servers: directory.servers.filter((server) => server.raceId === 1) },
    { label: '魔族区服', servers: directory.servers.filter((server) => server.raceId === 2) },
    { label: '其他区服', servers: directory.servers.filter((server) => server.raceId === 0) },
  ].filter((group) => group.servers.length > 0)
  const legionOptions = useMemo(() => {
    if (!directory.isAllServers) return selectedServer?.legions || []
    const counts = new Map<string, number>()
    for (const server of directory.servers) {
      for (const legion of server.legions) {
        counts.set(legion.legionName, (counts.get(legion.legionName) || 0) + legion.memberCount)
      }
    }
    return [...counts].map(([legionName, memberCount]) => ({ legionName, memberCount }))
      .sort((left, right) => left.legionName.localeCompare(right.legionName, 'zh-CN'))
  }, [directory.isAllServers, directory.servers, selectedServer])
  const unaffiliatedCount = directory.isAllServers
    ? directory.servers.reduce((total, server) => total + server.unaffiliatedCount, 0)
    : selectedServer?.unaffiliatedCount || 0
  const selectedLegionLabel = directory.selectedLegionName === NO_LEGION_KEY
    ? '未加入军团'
    : directory.selectedLegionName || '全部军团'
  const visibleCharacters = directory.characters
  const sendResults = useMemo(() => {
    const results = new Map<string, { ok: boolean; detail: string }>()
    for (const message of storedMessages) {
      if (message.messageType !== 'control_result' || !message.requestId) continue
      results.set(message.requestId, {
        ok: message.status !== 'failed',
        detail: message.errorMessage,
      })
    }
    for (const message of props.agentMessages) {
      if (message.type !== 'control_result') continue
      const requestId = messageRequestId(message)
      if (requestId) results.set(requestId, controlResultFromMessage(message))
    }
    return results
  }, [props.agentMessages, storedMessages])
  const chronologicalMessages = useMemo(() => {
    const messages = new Map<string, {
      id: string
      content: string
      direction: 'incoming' | 'outgoing' | 'system'
      requestId: string
      time: string
    }>()
    for (const message of storedMessages) {
      if (message.messageType === 'control_ack' || message.messageType === 'control_result') continue
      const key = message.sourceMessageId || message.requestId || `stored:${message.id}`
      messages.set(key, {
        id: key,
        content: message.content,
        direction: message.direction,
        requestId: message.requestId,
        time: new Date(message.sentAt).toISOString(),
      })
    }
    for (const message of props.messages) {
      if (message.type === 'control_ack' || message.type === 'control_result') continue
      messages.set(message.id, {
        id: message.id,
        content: message.content,
        direction: message.type === 'control_sent' ? 'outgoing' : message.type.startsWith('control_') ? 'system' : 'incoming',
        requestId: messageRequestId(message),
        time: message.time,
      })
    }
    return [...messages.values()].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  }, [props.messages, storedMessages])
  const publicMessages = useMemo(() => [...props.agentMessages].sort(
    (left, right) => Date.parse(left.time) - Date.parse(right.time),
  ), [props.agentMessages])

  useEffect(() => {
    const currentStillVisible = visibleCharacters.some((character) => character.id === props.selectedCharacter?.id)
    if (!currentStillVisible) props.onCharacterSelect(visibleCharacters[0])
  }, [props.onCharacterSelect, props.selectedCharacter?.id, visibleCharacters])

  useEffect(() => {
    const character = props.selectedCharacter
    const requestId = ++historyRequest.current
    setStoredMessages([])
    setHistoryCursor(null)
    setHistoryError('')
    if (!character) return
    setHistoryLoading(true)
    const params = new URLSearchParams({
      serverId: character.serverKey,
      characterId: character.characterId,
      limit: '50',
    })
    void fetch(`/api/messages?${params}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json() as {
          error?: string
          messages?: StoredChatMessage[]
          nextCursor?: number | null
        }
        if (!response.ok) throw new Error(result.error || '读取聊天记录失败')
        if (historyRequest.current !== requestId) return
        setStoredMessages(result.messages || [])
        setHistoryCursor(result.nextCursor ?? null)
      })
      .catch((cause) => {
        if (historyRequest.current === requestId) setHistoryError(cause instanceof Error ? cause.message : '读取聊天记录失败')
      })
      .finally(() => {
        if (historyRequest.current === requestId) setHistoryLoading(false)
      })
  }, [props.selectedCharacter?.characterId, props.selectedCharacter?.serverKey])

  async function loadOlderMessages() {
    const character = props.selectedCharacter
    if (!character || historyCursor === null || historyLoading) return
    const requestId = historyRequest.current
    setHistoryLoading(true)
    setHistoryError('')
    const params = new URLSearchParams({
      serverId: character.serverKey,
      characterId: character.characterId,
      before: String(historyCursor),
      limit: '50',
    })
    try {
      const response = await fetch(`/api/messages?${params}`, { headers: { Accept: 'application/json' } })
      const result = await response.json() as {
        error?: string
        messages?: StoredChatMessage[]
        nextCursor?: number | null
      }
      if (!response.ok) throw new Error(result.error || '读取聊天记录失败')
      if (historyRequest.current !== requestId) return
      setStoredMessages((current) => [...current, ...(result.messages || [])])
      setHistoryCursor(result.nextCursor ?? null)
    } catch (cause) {
      if (historyRequest.current === requestId) setHistoryError(cause instanceof Error ? cause.message : '读取聊天记录失败')
    } finally {
      if (historyRequest.current === requestId) setHistoryLoading(false)
    }
  }

  function submitMessage(event: React.FormEvent) {
    event.preventDefault()
    if (props.content.trim()) props.onSend()
  }

  return (
    <section className="data-panel chat-shell">
      <aside className="legion-panel" aria-label="角色过滤">
        <div className="legion-panel-head">
          <button className="icon-button" type="button" onClick={props.onBack} aria-label="返回客户端中心" title="返回客户端中心"><ArrowLeft aria-hidden="true" size={17} /></button>
          <div><h3>过滤</h3><p>区服与军团</p></div>
        </div>
        <div className="filter-controls">
          <label className="server-picker">
            <span>当前区服</span>
            <select value={directory.selectedServerKey} onChange={(event) => directory.selectServer(event.target.value)} aria-label="选择区服" disabled={directory.servers.length === 0}>
              {directory.servers.length === 0 && <option value="">暂无区服</option>}
              {directory.servers.length > 0 && <option value={ALL_SERVERS_KEY}>全部区服</option>}
              {serverGroups.map((group) => (
                <optgroup label={group.label} key={group.label}>
                  {group.servers.map((server) => <option value={server.serverId} key={server.serverId}>{server.serverName}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="server-picker">
            <span>军团</span>
            <select
              value={directory.selectedLegionName || ''}
              onChange={(event) => directory.selectLegion(event.target.value || null)}
              aria-label="选择军团"
            >
              <option value="">全部军团</option>
              <option value={NO_LEGION_KEY}>未加入军团 ({unaffiliatedCount})</option>
              {legionOptions.map(({ legionName, memberCount }) => (
                <option value={legionName} key={legionName}>{legionName} ({memberCount})</option>
              ))}
            </select>
          </label>
        </div>
      </aside>

      <aside className="character-panel" aria-label="游戏角色列表">
        <div className="character-panel-head">
          <div><h3>{selectedLegionLabel}</h3><p>{visibleCharacters.length} 个角色 · {directory.isAllServers ? '全部区服' : selectedServer?.serverName || '暂无数据'}</p></div>
        </div>
        <label className="character-search">
          <Search aria-hidden="true" size={15} />
          <input value={directory.search} onChange={(event) => directory.setSearch(event.target.value)} placeholder="搜索角色或 ID" />
        </label>
        <div className="character-list">
          {visibleCharacters.map((character) => {
            const characterMessages = props.agentMessages.filter((message) =>
              message.type !== 'control_ack'
              && message.type !== 'control_result'
              && messageBelongsToCharacter(message, character),
            )
            const latestMessage = characterMessages[0]
            const isActive = props.selectedCharacter?.id === character.id
            return (
              <button className={isActive ? 'is-active' : ''} type="button" key={character.id} onClick={() => {
                props.onCharacterSelect(character)
                setMessageView('private')
              }}>
                <CharacterAvatar character={character} />
                <span className="character-summary">
                  <span><strong>{character.name}</strong><time>{latestMessage ? formatClock(latestMessage.time) : ''}</time></span>
                  <span><small>{latestMessage?.content || `${character.legionName || '未加入军团'} · ${character.className}`}</small>{characterMessages.length > 0 && <em>{characterMessages.length}</em>}</span>
                </span>
              </button>
            )
          })}
          {directory.loading && visibleCharacters.length === 0 && <div className="character-empty">正在加载角色…</div>}
          {!directory.loading && visibleCharacters.length === 0 && <div className="character-empty">{directory.error || '数据库中暂无角色'}</div>}
          {directory.nextCursor !== null && <button className="character-load-more" type="button" onClick={() => void directory.loadMore()} disabled={directory.loading}>加载更多</button>}
        </div>
      </aside>

      <section className="chat-pane">
        <header className="chat-header">
          {messageView === 'private' && props.selectedCharacter ? (
            <>
              <CharacterAvatar character={props.selectedCharacter} />
              <div><h2>{props.selectedCharacter.name}</h2><p>{props.selectedCharacter.serverName} · {props.selectedCharacter.className} Lv.{props.selectedCharacter.level} · ID {props.selectedCharacter.characterId}</p></div>
            </>
          ) : (
            <>
              <span className="chat-agent-icon"><Laptop aria-hidden="true" size={18} /></span>
              <div><h2>公频消息</h2><p>{props.agent.host || props.agent.agentId} · {publicMessages.length} 条实时消息</p></div>
            </>
          )}
          <div className="chat-view-tabs" role="tablist" aria-label="消息视图">
            <button
              className={messageView === 'private' ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={messageView === 'private'}
              disabled={!props.selectedCharacter}
              onClick={() => setMessageView('private')}
            >私聊</button>
            <button
              className={messageView === 'public' ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={messageView === 'public'}
              onClick={() => setMessageView('public')}
            >公频</button>
          </div>
        </header>

        {messageView === 'public' ? (
          <div className="chat-thread public-message-thread" aria-live="polite">
            {publicMessages.length > 0 ? publicMessages.map((message) => {
              const chatMeta = isRecord(message.raw.chat_meta) ? message.raw.chat_meta : {}
              const outgoing = chatMeta.kind === 'outgoing'
              return (
                <article className={`chat-message stream-message${outgoing ? ' is-outgoing' : ''}`} key={message.id}>
                  {!outgoing && <span className="stream-message-icon"><MessageSquareText aria-hidden="true" size={15} /></span>}
                  <div>
                    <span className="chat-message-meta">
                      {outgoing ? '我' : message.title}
                      <time>{formatClock(message.time)}</time>
                      <em>{message.type}</em>
                    </span>
                    <p>{message.content}</p>
                  </div>
                </article>
              )
            }) : (
              <div className="chat-empty"><MessageSquareText aria-hidden="true" size={28} /><strong>暂无公频消息</strong><p>客户端发送到控制台的所有消息都会实时显示在这里。</p></div>
            )}
          </div>
        ) : props.selectedCharacter ? (
          <>
            <div className="chat-thread" aria-live="polite">
              {historyCursor !== null && (
                <button className="history-load-more" type="button" onClick={() => void loadOlderMessages()} disabled={historyLoading}>
                  {historyLoading ? <LoaderCircle className="spin" aria-hidden="true" size={14} /> : null}
                  {historyLoading ? '正在加载' : '加载更早消息'}
                </button>
              )}
              {historyError && <p className="history-error" role="alert">{historyError}</p>}
              {chronologicalMessages.length > 0 ? chronologicalMessages.map((message) => {
                const outgoing = message.direction === 'outgoing'
                const sendResult = outgoing && message.requestId ? sendResults.get(message.requestId) : undefined
                return (
                  <article className={`chat-message${outgoing ? ' is-outgoing' : ''}`} key={message.id}>
                    {!outgoing && <CharacterAvatar character={props.selectedCharacter!} />}
                    <div>
                      <span className="chat-message-meta">{outgoing ? '我' : props.selectedCharacter!.name}<time>{formatClock(message.time)}</time></span>
                      <p>{message.content}</p>
                      {outgoing && message.requestId && (
                        <div className={`send-result ${sendResult ? sendResult.ok ? 'is-success' : 'is-failed' : 'is-pending'}`} role="status">
                          {sendResult
                            ? sendResult.ok ? <Check aria-hidden="true" size={13} /> : <X aria-hidden="true" size={13} />
                            : <LoaderCircle className="spin" aria-hidden="true" size={12} />}
                          <span>{sendResult ? sendResult.ok ? '发送成功' : '发送失败' : '等待发送结果'}</span>
                          {sendResult && !sendResult.ok && sendResult.detail && <code>{sendResult.detail}</code>}
                        </div>
                      )}
                    </div>
                  </article>
                )
              }) : (
                <div className="chat-empty">
                  {historyLoading ? <LoaderCircle className="spin" aria-hidden="true" size={28} /> : <MessageSquareText aria-hidden="true" size={28} />}
                  <strong>{historyLoading ? '正在读取聊天记录' : `开始与 ${props.selectedCharacter.name} 对话`}</strong>
                  <p>{historyLoading ? '历史消息将与实时消息合并显示。' : '来自该角色的实时消息会自动保存并显示在这里。'}</p>
                </div>
              )}
            </div>

            <form className="chat-composer" onSubmit={submitMessage}>
              <textarea
                value={props.content}
                onChange={(event) => props.onContentChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    if (props.content.trim()) props.onSend()
                  }
                }}
                placeholder={`发送消息给 ${props.selectedCharacter.name}`}
              />
              <div>
                <span>Enter 发送 · Shift + Enter 换行</span>
                {props.actionMessage && <p className="form-feedback" role="status">{props.actionMessage}</p>}
                <button className="primary-button compact" type="submit" disabled={!props.content.trim()}><Send aria-hidden="true" size={16} />发送</button>
              </div>
            </form>
          </>
        ) : (
          <div className="chat-empty"><MessageSquareText aria-hidden="true" size={28} /><strong>请选择游戏角色</strong><p>选择角色进入私聊，或切换到“公频”查看客户端全部消息。</p></div>
        )}
      </section>
    </section>
  )
}

function CharacterAvatar({ character }: { character: GameCharacter }) {
  return (
    <span className="character-avatar" style={{ backgroundColor: character.avatarColor }} aria-hidden="true">
      {character.avatarUrl ? <img src={character.avatarUrl} alt="" /> : character.name.slice(0, 1)}
    </span>
  )
}

function CommandConsole(props: {
  agents: OnlineAgent[]
  serverNames: ReadonlyMap<string, string>
  selectedAgentId: string
  commandText: string
  actionMessage: string
  onAgentChange: (value: string) => void
  onCommandChange: (value: string) => void
  onSend: () => void
  onQuickCommand: (type: string) => void
}) {
  return (
    <div className="command-page">
      <section className="page-intro"><p className="eyebrow">REMOTE CONTROL</p><h2>客户端控制台</h2><p>通过 MQTT 向指定在线客户端发送控制命令。</p></section>
      <section className="data-panel command-panel">
        <div className="field-row"><label><span>目标客户端</span><select value={props.selectedAgentId} onChange={(event) => props.onAgentChange(event.target.value)}><option value="">请选择在线客户端</option>{props.agents.map((agent) => <option value={agent.agentId} key={agent.agentId}>{agent.host || agent.agentId} · {serverNameForAgent(agent, props.serverNames)}{agent.serverId ? ` (ID ${agent.serverId})` : ''}</option>)}</select></label></div>
        <div className="quick-actions"><span>快捷命令</span><button type="button" onClick={() => props.onQuickCommand('ping')}>Ping</button><button type="button" onClick={() => props.onQuickCommand('requestStatus')}>请求状态</button></div>
        <label className="code-field"><span>JSON 命令</span><textarea spellCheck={false} value={props.commandText} onChange={(event) => props.onCommandChange(event.target.value)} /></label>
        {props.actionMessage && <p className="form-feedback" role="status">{props.actionMessage}</p>}
        <button className="primary-button compact" type="button" onClick={props.onSend} disabled={!props.selectedAgentId}><Terminal aria-hidden="true" size={16} />发送控制命令</button>
      </section>
    </div>
  )
}

function ConnectionSettingsPanel(props: {
  settings: ConnectionSettings
  connectionState: string
  connectionMessage: string
  onReconnect: (settings: ConnectionSettings) => void
  onDisconnect: () => void
}) {
  const [draft, setDraft] = useState(props.settings)
  useEffect(() => setDraft(props.settings), [props.settings])

  return (
    <div className="settings-page">
      <section className="page-intro"><p className="eyebrow">SIGNALING</p><h2>连接设置</h2><p>Room、MQTT 地址和 Topic Prefix 必须与 Python 客户端保持一致。</p></section>
      <section className="data-panel settings-panel">
        <div className={`settings-status is-${props.connectionState}`}><Wifi aria-hidden="true" size={20} /><div><strong>{connectionTitle(props.connectionState)}</strong><span>{props.connectionMessage}</span></div></div>
        <div className="form-grid"><label><span>Room</span><input value={draft.room} onChange={(event) => setDraft({ ...draft, room: event.target.value })} /></label><label><span>MQTT WSS</span><input value={draft.mqttUrl} onChange={(event) => setDraft({ ...draft, mqttUrl: event.target.value })} /></label><label><span>Topic Prefix</span><input value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value })} /></label></div>
        <div className="settings-note"><CircleAlert aria-hidden="true" size={18} /><p><strong>当前使用公共 MQTT Broker</strong><span>适合开发测试。正式环境应切换到带身份验证的私有 Broker，并使用独立房间名。</span></p></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={props.onDisconnect}><Unplug aria-hidden="true" size={16} />断开</button><button className="primary-button compact" type="button" onClick={() => props.onReconnect(draft)}><Link2 aria-hidden="true" size={16} />保存并重新连接</button></div>
      </section>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function serverNameForAgent(agent: OnlineAgent, serverNames: ReadonlyMap<string, string>) {
  if (!agent.serverId) return '等待识别'
  return aion2ServerName(agent.serverId) || serverNames.get(agent.serverId) || '未知服务器'
}

function whisperTargetFromMessage(message: ConsoleMessage) {
  const payload = isRecord(message.raw.payload) ? message.raw.payload : message.raw
  const data = isRecord(payload.jsonData) ? payload.jsonData : {}
  const meta = isRecord(message.raw.chat_meta) ? message.raw.chat_meta : {}
  const target = isRecord(message.raw.target) ? message.raw.target : {}
  return {
    characterId: textValue(payload.characterId || target.characterId || meta.senderCharacterId || data.playNcCharId),
    serverKey: textValue(payload.serverKey || target.serverKey || meta.serverId || data.serverId),
    targetName: textValue(payload.targetName || target.targetName || meta.sender || data.userName || data.alias),
  }
}

function messageRequestId(message: ConsoleMessage) {
  const payload = isRecord(message.raw.payload) ? message.raw.payload : message.raw
  return textValue(message.raw.requestId || payload.requestId)
}

function printableResultValue(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value).slice(0, 1200)
  } catch {
    return '无法解析失败响应'
  }
}

function controlResultFromMessage(message: ConsoleMessage) {
  const result = isRecord(message.raw.result) ? message.raw.result : {}
  const ok = message.raw.ok === true
  if (ok) return { ok: true, detail: '' }
  const status = textValue(result.status)
  const error = printableResultValue(result.error || message.raw.error)
  const response = printableResultValue(result.response)
  const detail = [status ? `HTTP ${status}` : '', error, response].filter(Boolean).join(' · ')
  return { ok: false, detail: detail || '客户端未返回失败原因' }
}

function chatUploadFromConsoleMessage(message: ConsoleMessage, targetName: string): ChatMessageUpload {
  const direction = message.type === 'control_sent'
    ? 'outgoing'
    : message.type.startsWith('control_') ? 'system' : 'incoming'
  const controlResult = message.type === 'control_result' ? controlResultFromMessage(message) : undefined
  const sentAt = Date.parse(message.time)
  return {
    sourceMessageId: message.id,
    requestId: messageRequestId(message) || undefined,
    agentId: message.agentId,
    direction,
    messageType: message.type,
    senderName: direction === 'incoming' ? targetName : direction === 'system' ? '系统' : '我',
    content: message.content,
    status: controlResult
      ? controlResult.ok ? 'delivered' : 'failed'
      : direction === 'incoming' ? 'received' : direction === 'outgoing' ? 'sent' : 'delivered',
    errorMessage: controlResult && !controlResult.ok ? controlResult.detail : undefined,
    raw: message.raw,
    sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(),
  }
}

function messageBelongsToCharacter(message: ConsoleMessage, character: GameCharacter) {
  const target = whisperTargetFromMessage(message)
  if (target.characterId) return target.characterId === character.characterId
  return Boolean(target.targetName && target.targetName === character.name)
}

function connectionTitle(state: string) {
  if (state === 'connected') return '信令已连接'
  if (state === 'connecting') return '正在连接'
  if (state === 'reconnecting') return '正在重连'
  if (state === 'error') return '连接异常'
  return '信令未连接'
}

function formatClock(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function relativeTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  return seconds < 2 ? '刚刚' : `${seconds} 秒前`
}

function formatDuration(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`
}
