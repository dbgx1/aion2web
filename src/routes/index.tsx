import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { PlayerIntelligence } from '#/components/player-intelligence'
import { CharacterActions } from '#/components/character-actions'
import { PublicSpeakerActions } from '#/components/public-speaker-actions'
import { ChatScrollNotice } from '#/components/chat-scroll-notice'
import { useChatScroll } from '#/lib/use-chat-scroll'
import { TrackingProvider, TrackingButton, TrackingStar } from '#/components/character-tracking'
import {
  ArrowLeft,
  Bell,
  BookOpenText,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  Eraser,
  ExternalLink,
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
  Sparkles,
  Square,
  Terminal,
  Unplug,
  Upload,

  UsersRound,
  Wifi,
  X,
} from 'lucide-react'
import { useChat, type UIMessage } from '@tanstack/ai-react'
import { clientTools } from '@tanstack/ai-client'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  type ConnectionSettings,
  type ConsoleMessage,
  type OnlineAgent,
  useAionConsole,
} from '#/lib/use-aion-console'
import {
  type GameCharacter,
} from '#/lib/game-characters'
import type { ChatMessageUpload } from '#/lib/chat-storage'
import { messageSyncBody, packMessageSync } from '#/lib/message-sync'
import { useChatHistory } from '#/lib/use-chat-history'
import { gameMessageIdFromRaw, mergePrivateChatTimeline } from '#/lib/chat-timeline'
import { isOutgoingChatPayload, isPrivateChatPayload } from '#/lib/chat-channel'
import { aiErrorMessage } from '#/lib/ai-error'
import { interactiveAiConnection } from '#/lib/interactive-ai-connection'
import type { CommandSendResult } from '#/lib/command-receipts'
import { AccountSwitchPanel } from '#/components/account-switch-panel'
import { trimAiUiHistory } from '#/lib/ai-history'
import { AiInteraction } from '#/lib/ai-interaction'
import { ALL_SERVERS_KEY, NO_LEGION_KEY, RACE_OPTIONS, useCharacterDirectory, useServerDirectory } from '#/lib/use-character-directory'
import { targetMatchesCharacter, useUnreadCharacters } from '#/lib/use-unread-characters'
import { useCharacterWindow } from '#/lib/use-character-window'
import { LegionOptions } from '#/components/legion-options'
import { AccountManagement } from '#/components/account-management'
import { resetDirectoryResource } from '#/lib/use-directory-resource'
import { SearchableSelect } from '#/components/searchable-select'
import { useDirectoryOptions } from '#/lib/use-directory-options'
import { aion2ServerName, aion2ServerRaceId } from '#/lib/aion2-servers'
import { PRESENCE_BATCH_SIZE, type QueryPresence } from '#/lib/presence-mqtt'
import { usePresenceQuery, type CharacterPresence } from '#/lib/use-presence-query'
import { useCurrentPresence } from '#/lib/use-current-presence'
import { PresenceApiDocs } from '#/components/presence-api-docs'
import { UploadTokenDocs } from '#/components/upload-token-docs'
import { ApiDocsDownload } from '#/components/api-docs-download'
import { CloudflareUsagePage } from '#/components/cloudflare-usage-page'
import { gameChatBlockMessage } from '#/lib/game-chat-block'
import { isIncomingCharacterReply } from '#/lib/message-inbox'
import { useManagedChat, type ManagedChatController } from '#/lib/use-managed-chat'
import { ManagedChatSetup, ManagedChatStatus } from '#/components/managed-chat-controls'
import { ReceptionPanel } from '#/components/reception-panel'
import { sendGroupChatDef, sendPrivateChatDef, setControlCommandDraftDef, setGroupChatDraftDef, setPrivateChatDraftDef } from '#/lib/console-ai-tools'

export const Route = createFileRoute('/')({ component: Home })

const navItems = [
  { id: 'clients', label: '客户端中心', icon: Laptop, to: '/clients', adminOnly: false },
  { id: 'messages', label: '实时消息', icon: MessageSquareText, to: '/messages', adminOnly: false },
  { id: 'characters', label: '角色数据库', icon: Database, to: '/characters', adminOnly: false },
  { id: 'intelligence', label: '玩家情报', icon: UsersRound, to: '/intelligence', adminOnly: false },
  { id: 'console', label: '控制台', icon: Terminal, to: '/console', adminOnly: true },
  { id: 'settings', label: '连接设置', icon: Settings2, to: '/settings', adminOnly: false },
  { id: 'reception', label: 'AI 接待台', icon: UsersRound, to: '/reception', adminOnly: false },
  { id: 'docs', label: '接口文档', icon: BookOpenText, to: '/docs', adminOnly: true },
  { id: 'accounts', label: '客服账号管理', icon: UsersRound, to: '/accounts', adminOnly: true },
  { id: 'usage', label: '费用统计', icon: Database, to: '/usage', adminOnly: true },
] as const

export type SectionId = (typeof navItems)[number]['id']
type MessageView = 'private' | 'public'
type RecipientMode = 'single' | 'all'
type CharacterListMode = 'all' | 'unread'

type BulkIntervalRangeMs = {
  min: number
  max: number
}

type BulkSendResult = {
  sent: boolean
  status?: 'confirmed' | 'partial' | 'unknown' | 'not_sent'
  confirmedCount?: number
  failedCount?: number
  unknownCount?: number
  sentCount: number
  totalCount: number
  varied: boolean
  message: string
}

type BulkSendOptions = {
  content?: string
  requireReceipts?: boolean
  signal?: AbortSignal
  messageForCharacter?: (character: GameCharacter, index: number, recipients: GameCharacter[]) => string
}

type BulkSendTask = {
  agentId: string
  agentName: string
  content: string
  messageForCharacter?: BulkSendOptions['messageForCharacter']
  loadRecipients: (signal?: AbortSignal) => Promise<GameCharacter[]>
  recipients: GameCharacter[] | null
  nextIndex: number
  sentCount: number
  delivery?: { confirmedCount: number; failedCount: number; unknownCount: number }
  pendingContent?: string
  intervalRangeMs: BulkIntervalRangeMs
}

type BulkSendProgress = Pick<BulkSendTask, 'agentId' | 'agentName' | 'content' | 'sentCount'> & {
  totalCount: number | null
  remainingCount: number | null
}


type CharacterUploadFeedback = {
  tone: 'success' | 'error' | 'neutral'
  message: string
  details?: string[]
}

type AuthUser = {
  scopeKey?: string
  userKey: string
  username: string
  role: 'admin' | 'agent'
}


const DEFAULT_BULK_INTERVAL_RANGE_MS: BulkIntervalRangeMs = {
  min: 2_200,
  max: 4_500,
}
const BULK_INTERVAL_MIN_STORAGE_KEY = 'aion2-bulk-interval-min-ms'
const BULK_INTERVAL_MAX_STORAGE_KEY = 'aion2-bulk-interval-max-ms'
const MIN_BULK_INTERVAL_MS = 1_000
const MAX_BULK_INTERVAL_MS = 60_000

type OfficialCharacterProfile = {
  warnings?: string[]
  characterId: string
  name: string
  race: number
  pcId: number
  level: number
  serverId: string
  serverName: string
  profileImageUrl: string
  region: string
  profileUrl: string
  className: string
  combatPower: number
  genderName: string
  raceName: string
  titleName: string
  itemLevel: number
  stats: Array<{ name: string; type: string; value: number; details: string[] }>
  titles: {
    ownedCount: number
    totalCount: number
    categories: Array<{ category: string; ownedCount: number; totalCount: number }>
  }
  daevanion: Array<{
    id: number
    name: string
    icon: string
    open: boolean
    openNodeCount: number
    totalNodeCount: number
  }>
  equipment: Array<{
    id: number
    name: string
    icon: string
    grade: string
    enchantLevel: number
    exceedLevel: number
    slot: string
  }>
  pet: { id: number; name: string; icon: string; level: number } | null
  wing: { id: number; name: string; icon: string; grade: string; enchantLevel: number } | null
  skills: Array<{
    id: number
    name: string
    icon: string
    category: string
    acquired: boolean
    equipped: boolean
    needLevel: number
    skillLevel: number
  }>
}

type OfficialProfileState = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'

function Home() {
  return <AionPortal section="clients" />
}

export function sectionFromPortalPath(pathname: string): SectionId {
  if (pathname.startsWith('/intelligence')) return 'intelligence'
  if (pathname.startsWith('/messages')) return 'messages'
  if (pathname.startsWith('/characters')) return 'characters'
  if (pathname.startsWith('/console')) return 'console'
  if (pathname.startsWith('/accounts')) return 'accounts'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/ai-persona')) return 'reception'
  if (pathname.startsWith('/reception')) return 'reception'
  if (pathname.startsWith('/docs')) return 'docs'
  if (pathname.startsWith('/usage')) return 'usage'
  return 'clients'
}

export function AionPortal({ section = 'clients' }: { section?: SectionId }) {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'anonymous'>('loading')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let active = true
    let previousScope = ''
    let checking = false
    const check = () => {
      if (checking) return
      checking = true
      void fetch('/api/auth', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10000) })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { user?: AuthUser }
        if (!active) return
        const scope = JSON.stringify(result.user || null)
        if (scope !== previousScope) { resetDirectoryResource(); previousScope = scope }
        setAuthUser(response.ok && result.user ? result.user : null)
        setAuthState(response.ok ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (active) {
          setAuthUser(null)
          setAuthState('anonymous')
        }
      })
      .finally(() => { checking = false })
    }
    check()
    const timer = window.setInterval(check, 5000)
    window.addEventListener('focus', check)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check) }
  }, [])

  if (authState === 'loading') {
    return <main className="auth-shell"><LoaderCircle className="spin" aria-hidden="true" size={28} /><span>正在验证登录状态</span></main>
  }
  if (authState === 'anonymous') {
    return <AdminLogin onAuthenticated={(user) => {
      resetDirectoryResource()
      setAuthUser(user)
      setAuthState('authenticated')
    }} />
  }
  return <AuthenticatedHome section={section} user={authUser || { userKey: 'env:admin', username: 'admin', role: 'admin' }} onLogout={() => {
    resetDirectoryResource()
    setAuthUser(null)
    setAuthState('anonymous')
  }} />
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canSubmit = Boolean(username.trim() && password && !submitting)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const result = await response.json() as { error?: string; user?: AuthUser }
      if (!response.ok || !result.user) throw new Error(result.error || '登录失败')
      setPassword('')
      onAuthenticated(result.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。')
    } finally { setSubmitting(false) }
  }
  return <main className="auth-shell"><section className="auth-panel">
    <div className="auth-mark"><LockKeyhole aria-hidden="true" size={22} /></div>
    <p className="eyebrow">AION2 CONTROL PORTAL</p>
    <h1>账号登录</h1><p>使用管理员分配的账号和密码登录。</p>
    <form onSubmit={submit}>
      <label><span>账号</span><input type="text" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} autoFocus /></label>
      <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={!canSubmit}>
        {submitting ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : <LockKeyhole aria-hidden="true" size={16} />}
        {submitting ? '正在登录' : '登录'}
      </button>
    </form><p>客服账号由管理员统一创建，登录后可访问全部区服。</p>
  </section></main>
}
function AuthenticatedHome({ section, user, onLogout }: { section: SectionId; user: AuthUser; onLogout: () => void }) {
  return <TrackingProvider key={`${user.userKey}:${user.role}:${user.scopeKey}`}><AuthenticatedHomeContent section={section} user={user} onLogout={onLogout} /></TrackingProvider>
}

function useClientCharacter(agentId: string, serverId?: string) {
  const scope = JSON.stringify([agentId, serverId || ''])
  const [selection, setSelection] = useState<{ scope: string; character?: GameCharacter }>({ scope })
  // Reset before rendering children so their effects cannot query the previous
  // client's role, including when this client changes servers in place.
  if (selection.scope !== scope) setSelection({ scope })
  const select = useCallback((character: GameCharacter | undefined, target?: { agentId: string; serverId?: string }) => {
    setSelection({ scope: target ? JSON.stringify([target.agentId, target.serverId || '']) : scope, character })
  }, [scope])
  return [selection.scope === scope ? selection.character : undefined, select] as const
}

function AuthenticatedHomeContent({ section, user, onLogout }: { section: SectionId; user: AuthUser; onLogout: () => void }) {
  const connectionApi = useAionConsole()
  const navigate = useNavigate()
  const serverDirectory = useServerDirectory()
  const { agents, messages, inboxMessages } = connectionApi
  const canSend = useCallback((agentId: string, command: Record<string, unknown>) =>
    agents.some(agent => agent.agentId === agentId) &&
    (!['switchAccount', 'switchAccountStatus', 'cancelSwitchAccount', 'resumeAccountChat'].includes(String(command.type)) || user.role === 'admin'), [agents, user.role])
  const sendCommand = useCallback((agentId: string, command: Record<string, unknown>) => canSend(agentId, command) && connectionApi.sendCommand(agentId, command), [connectionApi.sendCommand, canSend])
  const sendCommandWithReceipt = useCallback((agentId: string, command: Record<string, unknown>, signal?: AbortSignal): Promise<CommandSendResult> =>
    canSend(agentId, command) ? connectionApi.sendCommandWithReceipt(agentId, command, signal)
      : Promise.resolve({ sent: false, status: 'not_sent', message: '客户端不在线或当前账号无权执行该操作。' }), [connectionApi.sendCommandWithReceipt, canSend])
  const consoleApi = useMemo(() => ({ ...connectionApi, agents, messages, inboxMessages, sendCommand, sendCommandWithReceipt }), [connectionApi, agents, messages, inboxMessages, sendCommand, sendCommandWithReceipt])
  const persistedMessageIds = useRef(new Set<string>())
  const syncingMessageIds = useRef(new Set<string>())
  const messageSyncInFlight = useRef(false)
  const messageSyncRetryAt = useRef(0)
  const messageSyncFailures = useRef(0)
  const rejectedMessageIds = useRef(new Set<string>())
  const messageSyncPaused = useRef(false)
  const messageSyncController = useRef<AbortController | null>(null)
  const [messageSyncError, setMessageSyncError] = useState('')
  const bulkAbortControllerRef = useRef<AbortController | null>(null)
  const bulkTaskRef = useRef<BulkSendTask | null>(null)
  const [bulkProgress, setBulkProgress] = useState<BulkSendProgress | null>(null)
  const consoleDenied = section === 'console' && user.role !== 'admin'
  const activeSection = consoleDenied ? 'clients' : section
  useEffect(() => {
    if (consoleDenied) void navigate({ to: '/clients', replace: true })
  }, [consoleDenied, navigate])
  const [characterId, setCharacterId] = useState('')
  const [serverKey, setServerKey] = useState('')
  const [targetName, setTargetName] = useState('')
  const [whisperContent, setWhisperContent] = useState('')
  const [commandText, setCommandText] = useState(JSON.stringify({ type: 'ping' }, null, 2))
  const [actionMessage, setActionMessage] = useState('')
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkIntervalRangeMs, setBulkIntervalRangeMs] = useState<BulkIntervalRangeMs>(DEFAULT_BULK_INTERVAL_RANGE_MS)
  const { readMessageIds, markMessagesRead } = consoleApi
  const selectedAgent = consoleApi.agents.find((agent) => agent.agentId === consoleApi.selectedAgentId)
  const [selectedCharacter, setSelectedCharacter] = useClientCharacter(consoleApi.selectedAgentId, selectedAgent?.serverId)
  const selectedChatBlock = consoleApi.chatGuard?.get(consoleApi.selectedAgentId)
  const chatBlockNotice = selectedChatBlock ? gameChatBlockMessage(selectedChatBlock) : ''
  useEffect(() => {
    let stoppedForBan = false
    return consoleApi.chatGuard?.subscribe(() => {
      const task = bulkTaskRef.current
      const block = task && consoleApi.chatGuard.get(task.agentId)
      if (!block) {
        if (stoppedForBan && task) setActionMessage('游戏返回的限制时段已结束。请确认游戏端已解禁后，手动继续剩余群发。')
        stoppedForBan = false
        return
      }
      stoppedForBan = true
      const message = gameChatBlockMessage(block)
      bulkAbortControllerRef.current?.abort(message)
      setActionMessage(message)
    })
  }, [consoleApi.chatGuard])
  const managedMessages = useMemo(() => [...new Map([...consoleApi.inboxMessages, ...consoleApi.messages].map(message => [message.id, message])).values()]
    .sort((left, right) => Date.parse(right.time) - Date.parse(left.time)), [consoleApi.inboxMessages, consoleApi.messages])
  const managedChat = useManagedChat({
    settings: consoleApi.settings, connectionState: consoleApi.connectionState,
    agents: consoleApi.agents, allowedServerIds: null, messages: managedMessages, chatGuard: consoleApi.chatGuard,
    bulkSending, sendCommand: consoleApi.sendCommand, queryPresence: consoleApi.queryPresence,
    controlDraft: command => setCommandText(JSON.stringify(command, null, 2)),
    resolve: message => {
      if (message.type !== 'control_sent' && !isPrivateChatPayload(message.raw)) return null
      return { ...whisperTargetFromMessage(message), direction: messageDirection(message) }
    },
  })
  const visibleNavItems = useMemo(() => navItems.filter((item) => !item.adminOnly || user.role === 'admin'), [user.role])
  const serverNames = useMemo(() => new Map(
    serverDirectory.servers.map((server) => [server.serverId, server.serverName]),
  ), [serverDirectory.servers])
  const agentMessages = useMemo(() => consoleApi.selectedAgentId
    ? [...new Map([...consoleApi.inboxMessages, ...consoleApi.messages]
      .filter((message) => message.agentId === consoleApi.selectedAgentId)
      .map(message => [message.id, message])).values()]
      .sort((left, right) => Date.parse(right.time) - Date.parse(left.time))
    : [], [consoleApi.messages, consoleApi.inboxMessages, consoleApi.selectedAgentId])
  const filteredMessages = useMemo(() => {
    if (!selectedCharacter) return []
    return agentMessages.filter((message) => messageBelongsToCharacter(message, selectedCharacter))
  }, [agentMessages, selectedCharacter])
  const unreadMessageCount = useMemo(() => consoleApi.inboxMessages
    .filter((message) => message.agentId === consoleApi.selectedAgentId
      && isUnreadIncomingMessage(message, readMessageIds))
    .length, [consoleApi.inboxMessages, consoleApi.selectedAgentId, readMessageIds])


  useEffect(() => {
    const storedMin = Number.parseInt(localStorage.getItem(BULK_INTERVAL_MIN_STORAGE_KEY) || '', 10)
    const storedMax = Number.parseInt(localStorage.getItem(BULK_INTERVAL_MAX_STORAGE_KEY) || '', 10)
    if (Number.isFinite(storedMin) || Number.isFinite(storedMax)) {
      setBulkIntervalRangeMs(normalizeBulkIntervalRangeMs({
        min: Number.isFinite(storedMin) ? storedMin : DEFAULT_BULK_INTERVAL_RANGE_MS.min,
        max: Number.isFinite(storedMax) ? storedMax : DEFAULT_BULK_INTERVAL_RANGE_MS.max,
      }))
    }
  }, [])

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

  const syncMessages = useEffectEvent(async () => {
    const controller = messageSyncController.current
    if (!controller || controller.signal.aborted || messageSyncPaused.current
      || messageSyncInFlight.current || Date.now() < messageSyncRetryAt.current || !navigator.onLine) return
    messageSyncInFlight.current = true
    let failed = false
    try {
      const requestTargets = new Map<string, ReturnType<typeof whisperTargetFromMessage>>()
      for (const message of managedMessages) {
        const requestId = messageRequestId(message)
        const target = whisperTargetFromMessage(message)
        const requestKey = JSON.stringify([message.agentId, requestId])
        if (requestId && target.serverKey && target.characterId && !requestTargets.has(requestKey)) requestTargets.set(requestKey, target)
      }
      const groups = new Map<string, {
        serverId: string
        characterId: string
        sourceMessages: ConsoleMessage[]
        messages: ChatMessageUpload[]
      }>()
      for (const message of managedMessages) {
        if (persistedMessageIds.current.has(message.id) || rejectedMessageIds.current.has(message.id)
          || syncingMessageIds.current.has(message.id)) continue
        if (message.type === 'chat_message' && !isPrivateChatPayload(message.raw)) continue
        const target = whisperTargetFromMessage(message)
        const correlatedTarget = target.serverKey && target.characterId
          ? target
          : requestTargets.get(JSON.stringify([message.agentId, messageRequestId(message)])) || target
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

      const { chunks, rejected } = packMessageSync([...groups.values()])
      for (const message of rejected) rejectedMessageIds.current.add(message.id)
      if (rejected.length) setMessageSyncError('部分消息过大，尚未保存；已停止自动重试这些消息，请联系管理员。')

      // Drain sequentially: a failing service must not receive the entire backlog.
      for (const chunk of chunks) {
        if (controller.signal.aborted) break
        const markProcessed = (entry: typeof chunk[number]) => {
          for (const message of entry.sourceMessages) persistedMessageIds.current.add(message.id)
        }
        const rejectEntry = (entry: typeof chunk[number]) => {
          for (const message of entry.sourceMessages) rejectedMessageIds.current.add(message.id)
          setMessageSyncError('部分消息未保存，服务器拒绝了上传；已暂停这些消息的自动重试，请检查后重试。')
        }

        try {
          const response = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
            body: messageSyncBody(chunk),
          })
          if (!response.ok) {
            if (response.status === 401) {
              messageSyncPaused.current = true
              setMessageSyncError('登录已失效，消息保存已暂停，请重新登录。')
              break
            } else if ([400, 403, 404, 413, 422].includes(response.status)) {
              for (const entry of chunk) rejectEntry(entry)
            } else failed = true
            if (failed) break
            continue
          }

          const result = await response.json().catch(() => ({})) as {
            ok?: boolean
            conversations?: Array<{ ok?: boolean; status?: number; serverId?: string; characterId?: string; received?: number }>
          }
          if (!result.ok || !Array.isArray(result.conversations) || result.conversations.length !== chunk.length) {
            failed = true
            break
          }
          result.conversations.forEach((conversation, index) => {
            const entry = chunk[index]
            if (!conversation || conversation.serverId !== entry.serverId || conversation.characterId !== entry.characterId
              || conversation.received !== entry.messages.length) {
              failed = true
              return
            }
            if (conversation.ok === true) {
              markProcessed(entry)
              window.dispatchEvent(new Event('aion:chat-history-saved'))
            }
            else if ([400, 403, 404, 413, 422].includes(conversation.status || 0)) rejectEntry(entry)
            else failed = true
          })
        } catch {
          if (!controller.signal.aborted) failed = true
        }
        if (failed) break
      }
    } finally {
      syncingMessageIds.current.clear()
      messageSyncInFlight.current = false
      if (failed) {
        messageSyncRetryAt.current = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(messageSyncFailures.current++, 6))
        setMessageSyncError('消息暂未保存，稍后会自动重试；请保持页面打开。')
      } else {
        messageSyncFailures.current = 0
        messageSyncRetryAt.current = 0
        if (!controller.signal.aborted && !messageSyncPaused.current && !rejectedMessageIds.current.size) setMessageSyncError('')
      }
    }
  })

  useEffect(() => {
    const controller = new AbortController()
    messageSyncController.current = controller
    // Fixed batching window: incoming MQTT events cannot restart or bypass it.
    const timer = window.setInterval(() => void syncMessages(), 5000)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [])

  async function openAgentMessages(agentId: string) {
    if (!consoleApi.agents.some(agent => agent.agentId === agentId)) return
    consoleApi.setSelectedAgentId(agentId)
    void navigate({ to: '/messages' })
    setActionMessage('')
  }

  async function leaveAgentMessages() {
    setActionMessage('')
    void navigate({ to: '/clients' })
  }

  function canOperateSelectedAgent() {
    if (!consoleApi.selectedAgentId) {
      setActionMessage('请先选择一个在线客户端。')
      return false
    }
    if (!selectedAgent || consoleApi.connectionState !== 'connected') {
      setActionMessage('客户端或信令已断开，请等待重新连接。')
      return false
    }
    return true
  }

  // A running loop captures its starting render. Cancel it when the committed
  // client/permission/page changes, instead of continuing with that stale permission.
  useEffect(() => () => {
    bulkAbortControllerRef.current?.abort()
  }, [activeSection, consoleApi.selectedAgentId, selectedAgent?.agentId,
    user.scopeKey, selectedAgent?.serverId, consoleApi.connectionState])

  function sendWhisperContent(contentValue = whisperContent) {
    const block = consoleApi.chatGuard?.get(consoleApi.selectedAgentId)
    if (block) { setActionMessage(gameChatBlockMessage(block)); return false }
    if (bulkAbortControllerRef.current) {
      setActionMessage('群发正在进行中，请先停止群发。')
      return false
    }
    const content = contentValue.trim()
    if (!consoleApi.selectedAgentId || !characterId.trim() || !content) {
      setActionMessage('请选择在线客户端，并填写目标角色 ID 和私聊内容。')
      return false
    }
    if (!canOperateSelectedAgent()) return false
    const sent = consoleApi.sendCommand(consoleApi.selectedAgentId, {
      type: 'sendWhisper',
      characterId: characterId.trim(),
      serverKey: serverKey.trim(),
      targetName: targetName.trim(),
      content,
    })
    setActionMessage(sent ? '私聊命令已发送。' : '信令未连接，发送失败。')
    if (sent) setWhisperContent('')
    return sent
  }

  function sendWhisper() {
    sendWhisperContent()
  }

  async function sendAiWhisperContent(contentValue: string, signal: AbortSignal): Promise<CommandSendResult> {
    const rejected = (message: string): CommandSendResult => ({ sent: false, status: 'not_sent', message })
    if (signal.aborted) return rejected('操作已取消，未提交发送。')
    const block = consoleApi.chatGuard?.get(consoleApi.selectedAgentId)
    if (block) return rejected(gameChatBlockMessage(block))
    if (bulkAbortControllerRef.current) return rejected('群发正在进行中，请先停止群发。')
    const content = contentValue.trim()
    if (!consoleApi.selectedAgentId || !characterId.trim() || !content) return rejected('请选择在线客户端、目标角色并填写私聊内容。')
    if (!canOperateSelectedAgent()) return rejected('当前没有操作该客户端的权限，或客户端未连接。')
    return consoleApi.sendCommandWithReceipt(consoleApi.selectedAgentId, {
      type: 'sendWhisper', characterId: characterId.trim(), serverKey: serverKey.trim(),
      targetName: targetName.trim(), content,
    }, signal)
  }

  function stopBulkSend() {
    if (!bulkAbortControllerRef.current) return
    bulkAbortControllerRef.current?.abort()
    setActionMessage('正在停止群发…')
  }

  function updateBulkProgress(task: BulkSendTask) {
    setBulkProgress({ agentId: task.agentId, agentName: task.agentName, content: task.content,
      sentCount: task.sentCount, totalCount: task.recipients?.length ?? null,
      remainingCount: task.recipients ? task.recipients.length - task.nextIndex : null })
  }

  function discardBulkSend() {
    if (bulkAbortControllerRef.current) return
    bulkTaskRef.current = null
    setBulkProgress(null)
    setActionMessage('已结束剩余群发任务，已发出的消息不会撤回。')
  }

  async function resumeBulkSend() {
    const task = bulkTaskRef.current
    if (!task || bulkAbortControllerRef.current) return
    if (consoleApi.selectedAgentId !== task.agentId) {
      setActionMessage(`请先切换到客户端 ${task.agentName}，再继续原任务。`)
      return
    }
    await sendWhisperToAll(task.loadRecipients, { content: task.content, messageForCharacter: task.messageForCharacter }, task)
  }

  async function sendWhisperToAll(loadRecipients: (signal?: AbortSignal) => Promise<GameCharacter[]>, options: BulkSendOptions = {}, resumeTask?: BulkSendTask): Promise<BulkSendResult> {
    if (options.signal?.aborted) return { sent: false, sentCount: 0, totalCount: 0, varied: Boolean(options.messageForCharacter), message: '操作已取消，未开始群发。' }
    const content = (options.content ?? whisperContent).trim()
    const varied = Boolean(options.messageForCharacter)
    const block = consoleApi.chatGuard?.get(consoleApi.selectedAgentId)
    if (block) {
      const message = gameChatBlockMessage(block)
      setActionMessage(message)
      return { sent: false, sentCount: resumeTask?.sentCount ?? 0, totalCount: resumeTask?.recipients?.length ?? 0, varied, message }
    }
    if (bulkAbortControllerRef.current) {
      const message = '群发正在进行中。'
      setActionMessage(message)
      return { sent: false, sentCount: 0, totalCount: 0, varied, message }
    }
    if (bulkTaskRef.current && bulkTaskRef.current !== resumeTask) {
      const message = '已有暂停的群发任务，请点击“继续群发”，或先结束原任务再开始新群发。'
      setActionMessage(message)
      return { sent: false, sentCount: bulkTaskRef.current.sentCount, totalCount: bulkTaskRef.current.recipients?.length ?? 0, varied, message }
    }
    if (!consoleApi.selectedAgentId || (!content && !options.messageForCharacter)) {
      const message = '请选择在线客户端，并填写群发内容。'
      setActionMessage(message)
      return { sent: false, sentCount: 0, totalCount: 0, varied, message }
    }
    if (!canOperateSelectedAgent()) {
      const message = '请选择在线客户端。'
      return { sent: false, sentCount: 0, totalCount: 0, varied, message }
    }

    const task: BulkSendTask = resumeTask ?? {
      agentId: consoleApi.selectedAgentId, agentName: selectedAgent?.host || consoleApi.selectedAgentId,
      content, messageForCharacter: options.messageForCharacter, loadRecipients,
      recipients: null, nextIndex: 0, sentCount: 0,
      delivery: options.requireReceipts ? { confirmedCount: 0, failedCount: 0, unknownCount: 0 } : undefined,
      intervalRangeMs: normalizeBulkIntervalRangeMs(bulkIntervalRangeMs),
    }
    bulkTaskRef.current = task
    updateBulkProgress(task)
    const abortController = new AbortController()
    const cancelFromAi = () => abortController.abort()
    options.signal?.addEventListener('abort', cancelFromAi, { once: true })
    bulkAbortControllerRef.current = abortController
    setBulkSending(true)
    let totalCount = task.recipients?.length ?? 0
    const withDelivery = (result: BulkSendResult): BulkSendResult => {
      if (!task.delivery) return result
      const { confirmedCount, failedCount, unknownCount } = task.delivery
      const confirmed = totalCount > 0 && confirmedCount === totalCount
      return { ...result, ...task.delivery, sent: confirmed,
        status: confirmed ? 'confirmed' : unknownCount > 0 ? 'unknown' : task.sentCount > 0 ? 'partial' : 'not_sent',
        message: `群发${confirmed ? '已确认完成' : '未全部确认成功'}：已提交 ${task.sentCount} / ${totalCount}，确认成功 ${confirmedCount}，失败 ${failedCount}，结果未确认 ${unknownCount}。${confirmed ? '' : '请核对聊天记录；继续任务只处理尚未提交的角色，不会重发已提交的消息。'}` }
    }
    try {
      if (!task.recipients) {
        setActionMessage('正在读取筛选后的全部角色…')
        const characters = await task.loadRecipients(abortController.signal)
        abortController.signal.throwIfAborted()
        task.recipients = [...new Map(characters.map((character) => [
          `${character.serverKey}\u0000${character.characterId}`, { ...character },
        ])).values()]
      }
      const recipients = task.recipients
      totalCount = recipients.length
      updateBulkProgress(task)
      if (recipients.length === 0) {
        const message = '当前筛选条件下没有可发送的角色。'
        setActionMessage(message)
        return { sent: false, sentCount: 0, totalCount, varied, message }
      }

      while (task.nextIndex < recipients.length) {
        if (abortController.signal.aborted) break
        const character = recipients[task.nextIndex]
        const privateContent = task.pendingContent ?? (task.messageForCharacter?.(character, task.nextIndex, recipients) ?? task.content).trim()
        task.pendingContent = privateContent
        if (!privateContent) { task.nextIndex += 1; task.pendingContent = undefined; continue }
        const command = {
          type: 'sendWhisper',
          characterId: character.characterId,
          serverKey: character.serverKey,
          targetName: character.name,
          content: privateContent,
        }
        let receipt: CommandSendResult | undefined
        if (task.delivery) {
          setActionMessage(`正在等待 ${character.name} 的发送回执…`)
          receipt = await consoleApi.sendCommandWithReceipt(task.agentId, command, abortController.signal)
          if (receipt.status === 'not_sent') break
          if (receipt.status === 'confirmed') task.delivery.confirmedCount += 1
          else if (receipt.status === 'failed') task.delivery.failedCount += 1
          else task.delivery.unknownCount += 1
        } else if (!consoleApi.sendCommand(task.agentId, command)) break
        // An uncertain execution is still attempted. Resume must never replay it.
        task.sentCount += 1
        task.nextIndex += 1
        task.pendingContent = undefined
        updateBulkProgress(task)
        if (receipt && receipt.status !== 'confirmed') break
        if (task.nextIndex < recipients.length) {
          const nextDelayMs = randomBulkIntervalMs(task.intervalRangeMs)
          setActionMessage(`${varied ? '正在差异化群发' : '正在群发'} ${task.sentCount} / ${recipients.length} · 下次间隔 ${nextDelayMs} ms`)
          await delay(nextDelayMs, abortController.signal)
        }
      }
      const stopped = abortController.signal.aborted
      const sentCount = task.sentCount
      const message = typeof abortController.signal.reason === 'string' ? abortController.signal.reason : sentCount === recipients.length
        ? `${varied ? '差异化群发' : '群发'}命令已发送给 ${sentCount} 个角色。`
        : stopped
          ? `${varied ? '差异化群发' : '群发'}已停止：已发送 ${sentCount} / ${recipients.length}。`
        : `${varied ? '差异化群发' : '群发'}中断：已发送 ${sentCount} / ${recipients.length}。`
      const result = withDelivery({ sent: sentCount === recipients.length && !stopped, sentCount, totalCount, varied, message })
      setActionMessage(result.message)
      if (task.nextIndex === recipients.length) setWhisperContent('')
      return result
    } catch (caught) {
      const sentCount = task.sentCount
      const message = typeof abortController.signal.reason === 'string' ? abortController.signal.reason : abortController.signal.aborted
        ? `群发已停止：已发送 ${sentCount} / ${totalCount}。`
        : caught instanceof Error ? caught.message : '全部角色加载失败。'
      const result = withDelivery({ sent: false, sentCount, totalCount, varied, message })
      setActionMessage(result.message)
      return result
    } finally {
      options.signal?.removeEventListener('abort', cancelFromAi)
      if (task.recipients && task.nextIndex >= task.recipients.length) {
        bulkTaskRef.current = null
        setBulkProgress(null)
      } else updateBulkProgress(task)
      if (bulkAbortControllerRef.current === abortController) bulkAbortControllerRef.current = null
      setBulkSending(false)
    }
  }

  function sendJsonCommand() {
    if (!canOperateSelectedAgent()) return
    try {
      const parsed: unknown = JSON.parse(commandText)
      if (!isRecord(parsed)) throw new Error('命令必须是 JSON 对象')
      const block = consoleApi.chatGuard?.get(consoleApi.selectedAgentId)
      if (parsed.type === 'sendWhisper' && block) { setActionMessage(gameChatBlockMessage(block)); return }
      const sent = consoleApi.sendCommand(consoleApi.selectedAgentId, parsed)
      setActionMessage(sent ? '控制命令已发送。' : '信令未连接，发送失败。')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'JSON 格式不正确。')
    }
  }

  async function logout() {
    bulkAbortControllerRef.current?.abort()
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
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            const requiresAgent = item.id === 'messages' && !selectedAgent
            const itemBadgeCount = item.id === 'clients'
              ? consoleApi.agents.length
              : item.id === 'messages' ? unreadMessageCount : 0
            const itemBadge = itemBadgeCount > 0 ? formatBadgeCount(itemBadgeCount) : ''
            const itemBadgeClassName = item.id === 'messages' ? 'is-danger' : undefined
            return (
              requiresAgent
                ? (
                  <button
                    className="nav-item"
                    type="button"
                    key={item.id}
                    disabled
                    title="请先在客户端中心选择一个客户端"
                  >
                    <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    {itemBadge
                      ? <em className={itemBadgeClassName}>{itemBadge}</em>
                      : <ChevronRight className="nav-arrow" aria-hidden="true" size={16} />}
                  </button>
                )
                : (
                  <Link
                    className={`nav-item${isActive ? ' is-active' : ''}`}
                    to={item.to}
                    key={item.id}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.id === 'messages' ? '当前客户端的全部未读消息（包含筛选范围外）' : undefined}
                  >
                    <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    {itemBadge
                      ? <em className={itemBadgeClassName}>{itemBadge}</em>
                      : <ChevronRight className="nav-arrow" aria-hidden="true" size={16} />}
                  </Link>
                )
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className={`connection-mini is-${consoleApi.connectionState}`}>
            <span aria-hidden="true" />
            <div><strong>{connectionTitle(consoleApi.connectionState)}</strong><small>{consoleApi.settings.room}</small></div>
          </div>
          <button type="button" className="utility-link"><Globe2 aria-hidden="true" size={17} />简体中文</button>
          <button type="button" className="utility-link"><UsersRound aria-hidden="true" size={17} />{user.username}</button>
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

        {chatBlockNotice && <div className="message-sync-warning" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{selectedAgent?.host || consoleApi.selectedAgentId}：{chatBlockNotice}</span></div>}
        <ManagedChatStatus controller={managedChat} />
        {messageSyncError && (
          <div className="message-sync-warning" role="alert">
            {messageSyncError}
            <button type="button" className="utility-link" onClick={() => {
              rejectedMessageIds.current.clear()
              messageSyncPaused.current = false
              messageSyncFailures.current = 0
              messageSyncRetryAt.current = 0
              setMessageSyncError('等待重新保存当前页面中的消息…')
            }}>重试保存</button>
          </div>
        )}

        <div className={`workspace-content${activeSection === 'messages' ? ' messages-workspace' : ''}`}>
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
              key={JSON.stringify([selectedAgent.agentId, selectedAgent.serverId])}
              managedChat={managedChat}
              filterStorageKey={`aion:directory-filters:v1:${user.userKey}:messages`}
              agent={selectedAgent}
              selectedCharacter={selectedCharacter}
              agentMessages={agentMessages}
              messages={filteredMessages}
              onCharacterSelect={setSelectedCharacter}
              content={whisperContent}
              onContentChange={setWhisperContent}
              onSend={sendWhisper}
              onSendFaction={async (content) => {
                if (!canOperateSelectedAgent()) return { sent: false, status: 'not_sent', message: '客户端未连接或没有操作权限。' }
                const block = consoleApi.chatGuard?.get(consoleApi.selectedAgentId)
                if (block) return { sent: false, status: 'not_sent', message: gameChatBlockMessage(block) }
                return consoleApi.sendCommandWithReceipt(consoleApi.selectedAgentId, {
                  type: 'sendFactionMessage', content: content.trim(), serverKey: selectedAgent?.serverId,
                })
              }}
              onSendPrivateChat={sendAiWhisperContent}
              onSendAll={(characters, options) => sendWhisperToAll(characters, options)}
              onStopBulkSend={stopBulkSend}
              bulkProgress={bulkProgress}
              onResumeBulkSend={() => void resumeBulkSend()}
              onDiscardBulkSend={discardBulkSend}
              onQueryPresence={consoleApi.queryPresence}
              presenceConnected={consoleApi.connectionState === 'connected'}
              bulkSending={bulkSending}
              bulkIntervalRangeMs={bulkIntervalRangeMs}
              onBulkIntervalRangeChange={(value) => {
                const normalized = normalizeBulkIntervalRangeMs(value)
                setBulkIntervalRangeMs(normalized)
                localStorage.setItem(BULK_INTERVAL_MIN_STORAGE_KEY, String(normalized.min))
                localStorage.setItem(BULK_INTERVAL_MAX_STORAGE_KEY, String(normalized.max))
              }}
              readMessageIds={readMessageIds}
              onMessagesRead={markMessagesRead}
              actionMessage={actionMessage}
              onBack={() => void leaveAgentMessages()}
              canOperate={consoleApi.connectionState === 'connected'}
              chatBlockMessage={chatBlockNotice}
              operationKey={JSON.stringify([user.scopeKey, selectedAgent.serverId, consoleApi.connectionState, chatBlockNotice])}
            />
          )}
          {activeSection === 'messages' && !selectedAgent && (
            <section className="data-panel route-empty-state">
              {['connecting', 'reconnecting'].includes(consoleApi.connectionState)
                ? <LoaderCircle className="spin" aria-hidden="true" size={22} />
                : <Laptop aria-hidden="true" size={22} />}
              <div>
                <h2>{consoleApi.connectionState !== 'connected' ? '信令尚未连接'
                    : consoleApi.selectedAgentId ? '所选客户端未在线' : '尚未选择客户端'}</h2>
                <p>{(consoleApi.connectionState !== 'connected' ? consoleApi.connectionMessage
                  : consoleApi.selectedAgentId ? `${consoleApi.selectedAgentId}：请确认客户端在线并保持心跳连接。`
                    : '请先在客户端中心选择在线客户端。')}</p>
              </div>
              {consoleApi.connectionState === 'connected' && <button className="secondary-button" type="button" onClick={() => {
                consoleApi.publishDiscover()
              }}><RefreshCw aria-hidden="true" size={16} />刷新客户端状态</button>}
              <Link className="secondary-button" to="/clients">
                <Laptop aria-hidden="true" size={16} />返回客户端中心
              </Link>
            </section>
          )}
          {activeSection === 'characters' && <CharacterDatabase filterStorageKey={`aion:directory-filters:v1:${user.userKey}:characters`} onQueryPresence={consoleApi.queryPresence} presenceConnected={consoleApi.connectionState === 'connected'} />}
          {activeSection === 'intelligence' && <PlayerIntelligence key={user.scopeKey} storageKey={`aion:intelligence:v1:${user.scopeKey}`} onChat={character => {
            if (!selectedAgent || String(selectedAgent.serverId) !== character.serverKey) {
              window.alert('请先在客户端中心选择该角色所在区服的客户端，再打开私聊。')
              return
            }
            setSelectedCharacter(character)
            void navigate({ to: '/messages' })
          }} />}
          {activeSection === 'console' && (
            <>
            <CommandConsole
              agents={consoleApi.agents}
              serverNames={serverNames}
              selectedAgentId={consoleApi.selectedAgentId}
              commandText={commandText}
              actionMessage={actionMessage}
              onAgentChange={(agentId) => {
                if (!agentId) {
                  consoleApi.setSelectedAgentId('')
                  return
                }
                if (consoleApi.agents.some(agent => agent.agentId === agentId)) consoleApi.setSelectedAgentId(agentId)
              }}
              onCommandChange={setCommandText}
              onSend={sendJsonCommand}
              onQuickCommand={(type) => {
                setCommandText(JSON.stringify({ type }, null, 2))
                if (canOperateSelectedAgent()) {
                  const sent = consoleApi.sendCommand(consoleApi.selectedAgentId, { type })
                  setActionMessage(sent ? `${type} 已发送。` : '信令未连接，发送失败。')
                }
              }}
            />
            {user.role === 'admin' && <AccountSwitchPanel key={`${user.userKey}:${consoleApi.selectedAgentId}`}
              agentId={consoleApi.selectedAgentId} connected={consoleApi.connectionState === 'connected'} messages={consoleApi.messages}
              supported={consoleApi.agents.find(agent => agent.agentId === consoleApi.selectedAgentId)?.accountSwitchProtocol === 1}
              storageKey={`aion:account-switch:v1:${user.userKey}`} onSend={consoleApi.sendCommand} />}
            </>
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
          {activeSection === 'reception' && <ReceptionPanel onOpenConversation={profile => {
            const agent = consoleApi.agents.find(item => item.serverId === profile.serverId)
            if (!agent) { setActionMessage('该区服暂无已连接客户端，请先连接客户端。'); return }
            consoleApi.setSelectedAgentId(agent.agentId)
            setSelectedCharacter({ id: `reception:${profile.characterId}`, characterId: profile.characterId, name: profile.characterName,
              serverKey: profile.serverId, serverName: profile.serverId, legionName: '', legionPosition: null, className: '', level: 0,
              avatarColor: '#176454', avatarUrl: '', faction: '', lastSeenAt: profile.updatedAt }, agent)
            void navigate({ to: '/messages' })
          }} />}
          {activeSection === 'docs' && <ApiDocsPage currentUser={user} />}
          {activeSection === 'accounts' && user.role === 'admin' && <AccountManagement />}
          {activeSection === 'usage' && <CloudflareUsagePage isAdmin={user.role === 'admin'} />}
        </div>
      </section>
    </main>
  )
}

function ApiDocsPage({ currentUser }: { currentUser: AuthUser }) {
  if (currentUser.role !== 'admin') {
    return (
      <section className="data-panel route-empty-state">
        <CircleAlert aria-hidden="true" size={24} />
        <div>
          <h2>仅管理员可查看接口文档</h2>
          <p>当前账号没有接口文档权限，请切换管理员账号后再访问。</p>
        </div>
      </section>
    )
  }

  return (
    <div className="settings-page docs-page">
      <section className="data-panel docs-hero">
        <div>
          <p className="eyebrow">HTTP API REFERENCE</p>
          <h2>角色数据库接口文档</h2>
          <p>角色读取、导入、修改与删除，以及 MQTT 在线查询和阵营消息协议。示例中的令牌、角色 ID 和时间戳请替换为实际值。</p>
        </div>
        <ApiDocsDownload />
      </section>

      <section className="data-panel" id="faction-message">
        <h3>阵营消息发送 · sendFactionMessage</h3>
        <p>向当前客户端的控制主题发送 JSON 指令。客户端使用当前登录角色及服务器调用游戏 sendMessage 接口，频道为 WORLD。请先更新客户端，并在游戏内发送一条消息以采集身份信息。</p>
        <pre>{JSON.stringify({ type: 'sendFactionMessage', requestId: '唯一请求编号', serverKey: '2201', content: '阵营消息内容', expiresAt: 1800000030000 }, null, 2)}</pre>
        <p>控制主题为 <code>{'{prefix}/{room}/control/agent/{agentId}'}</code>，回执主题为 <code>{'{prefix}/{room}/events/{agentId}/receipts'}</code>。默认 prefix 为 aion2-chat-bridge，room 为 aion2-local；以实际连接设置为准。网页发布此指令时使用 QoS 0、retain=false。</p>
        <p>上面为指令业务字段；网页发送时还补充 target（agentId）、sender 和 sessionId（均为 portal- 加 requestId），以及 ISO 格式的 time。serverKey 用于校验当前服务器；expiresAt 应设为当前毫秒时间戳加 30000，不能复用示例时间。通过 requestId 关联 control_result：confirmed 表示游戏接口确认，failed 表示接口拒绝，not_sent 表示未执行，unknown 表示结果未知。结果未知时请核对游戏记录，不要自动重发。同一 requestId 用于客户端去重。</p>
      </section>
      <section className="data-panel docs-overview">
        <div>
          <span>Base URL</span>
          <code>https://mmorpgchat.com</code>
        </div>
        <div>
          <span>Format</span>
          <code>application/json; charset=utf-8</code>
        </div>
        <div>
          <span>Auth</span>
          <code>Cookie: aion_admin_session</code>
        </div>
        <div>
          <span>Upload / Server Characters Auth</span>
          <code>Authorization: Bearer &lt;UPLOAD_API_TOKEN&gt;</code>
        </div>
        <div>
          <span>Presence Service</span>
          <code>PRESENCE_SERVICE_ID</code>
        </div>
      </section>

      <UploadTokenDocs key={currentUser.username} />

      <div className="docs-layout">
        <aside className="data-panel docs-toc" aria-label="接口目录">
          <strong>接口目录</strong>
          <a href="#server-characters">按服务读取角色</a>
          <a href="#characters-list">角色列表与目录</a>
          <a href="#character-profile">角色详情</a>
          <a href="#characters-upload">上传角色数据</a>
          <a href="#characters-edit">修改与删除角色</a>
          <a href="#presence-mqtt">MQTT 在线查询</a>
          <a href="#faction-message">阵营消息发送</a>
        </aside>

        <div className="docs-reference">
          <section className="data-panel docs-endpoint-card" id="server-characters">
            <div className="docs-endpoint-head">
              <div className="docs-endpoint">
                <span className="docs-method">GET</span>
                <code>/api/servers/:serverId/characters</code>
              </div>
              <p>按服务 ID 分页返回角色表。大量角色数据优先使用这个接口，避免一次性返回几万条。</p>
            </div>

            <div className="docs-spec-block">
              <h3>Authentication</h3>
              <p>支持登录 Cookie（<code>aion_admin_session</code>）或 <code>Authorization: Bearer &lt;UPLOAD_API_TOKEN&gt;</code>，任选一种。查询电脑直接使用上传令牌，无需先登录。</p>
              <p>每次分页请求都需要携带鉴权；独立在线查询服务直接接收 MQTT 角色清单，无需调用此接口。</p>
              <p>所有有效登录账号均可读取全部区服；使用上传令牌时也可按 serverId 读取。通用列表仅支持登录 Cookie，官网详情支持登录 Cookie 或上传令牌。</p>
            </div>

            <div className="docs-spec-block">
              <h3>Path Params</h3>
              <table className="docs-table">
                <tbody>
                  <tr><th>serverId</th><td>string</td><td>必填。游戏服务 ID，例如 <code>1001</code>。</td></tr>
                </tbody>
              </table>
            </div>

            <div className="docs-spec-block">
              <h3>Query Params</h3>
              <table className="docs-table">
                <tbody>
                  <tr><th>limit</th><td>number</td><td>可选。默认 200，最大 500。</td></tr>
                  <tr><th>cursor</th><td>number</td><td>可选。第一页传 0 或不传；下一页传响应里的 <code>page.nextCursor</code>。</td></tr>
                  <tr><th>q</th><td>string</td><td>可选。按角色名或角色 ID 搜索。</td></tr>
                  <tr><th>legionName</th><td>string</td><td>可选。按军团名筛选。</td></tr>
                  <tr><th>withoutLegion</th><td>0 | 1</td><td>可选。传 1 时只返回未加入军团的角色。</td></tr>
                  <tr><th>includeTotal</th><td>0 | 1</td><td>可选。传 1 时额外返回 totalCount；大数据默认不统计总数。</td></tr>
                </tbody>
              </table>
            </div>

            <div className="docs-spec-block">
              <h3>Response 200</h3>
              <pre className="docs-code"><code>{`{
  "ok": true,
  "server": { "serverId": "1001", "serverName": "埃雷修兰塔", "known": true },
  "characters": [
    { "id": 200, "characterId": "123", "characterName": "ASUKA", "serverId": "1001", "legionName": "示例军团", "legionPosition": 0, "level": 50, "combatPower": 123456 }
  ],
  "page": { "cursor": 0, "limit": 200, "nextCursor": 200, "hasMore": true },
  "totalCount": null
}`}</code></pre>
              <p><code>characters[].legionPosition</code> 为职位原始值：0 军团长、1 军团干部、2 军团成员、3 雇佣兵；null 表示未知。历史军团长迁移为 0，其余旧记录需重新采集职位。</p>
              <p>角色对象还包含 serverName、className、faction、avatarUrl 和 lastSeenAt（Unix 毫秒）。id 是本站数据库数字编号，characterId 是游戏角色字符串 ID，两者不能混用。combatPower、equipItemLevel 为数字或 null；gender 为 0（未指定）、1（男）、2（女）或 null（未采集）。没有更多数据时 page.nextCursor 为 null、page.hasMore 为 false。</p>
            </div>

            <div className="docs-spec-grid">
              <div className="docs-spec-block">
                <h3>Status Codes</h3>
                <ul className="docs-status-list">
                  <li><code>200</code><span>请求成功。</span></li>
                  <li><code>401</code><span>没有有效登录 Cookie，且 Bearer 令牌缺失或无效。</span></li>
                  <li><code>400</code><span>区服 ID 为空。</span></li>
                  <li><code>403</code><span>登录账号无权读取该区服。</span></li>
                </ul>
              </div>
              <div className="docs-spec-block">
                <h3>Example</h3>
                <pre className="docs-code"><code>{`curl "https://mmorpgchat.com/api/servers/1001/characters?limit=500&cursor=0" \\
  -H "Accept: application/json" \\
  -H "Authorization: Bearer <UPLOAD_API_TOKEN>"`}</code></pre>
              </div>
            </div>
          </section>

          <section className="data-panel docs-endpoint-card" id="characters-list">
            <div className="docs-endpoint-head">
              <div className="docs-endpoint">
                <span className="docs-method">GET</span>
                <code>/api/characters</code>
              </div>
              <p>角色数据库页面使用的通用列表接口，需要有效登录 Cookie，支持目录、跨区服筛选和 cursor 分页。</p>
            </div>

            <div className="docs-spec-block">
              <h3>Query Params</h3>
              <table className="docs-table">
                <tbody>
                  <tr><th>directory</th><td>0 | 1</td><td>传 1 时返回区服和军团目录。</td></tr>
                  <tr><th>serverId</th><td>string</td><td>可选。筛选单个区服。</td></tr>
                  <tr><th>raceId</th><td>0 | 1 | 2</td><td>默认 0 全部；1 天族、2 魔族。按区服所属阵营筛选。</td></tr>
                  <tr><th>legionName / withoutLegion</th><td>string / 0 | 1</td><td>按军团名筛选；withoutLegion=1 仅返回无军团角色，优先于 legionName。</td></tr>
                  <tr><th>characterId / characterName</th><td>string</td><td>精确匹配角色 ID 或名称；两者同时提供时以 characterId 为准。建议同时提供 serverId，避免跨区服同名或同 ID。</td></tr>
                  <tr><th>chatStatus</th><td>all | chatted | unchatted</td><td>默认 all；按是否存在收发聊天记录筛选。</td></tr>
                  <tr><th>legionLeadersOnly</th><td>0 | 1</td><td>可选。传 1 时仅返回 <code>legionPosition = 0</code>（军团长）的角色；传 0 或省略不限制职位。可与区服、军团和搜索条件组合。此筛选开关与职位原始值不同。</td></tr>
                  <tr><th>sort</th><td>string</td><td>可选。default 为默认顺序，power_desc 为战力降序，power_asc 为战力升序；未采集战力排在最后。排序时 nextCursor 为字符串，下一页请原样传回 cursor。</td></tr>
                  <tr><th>q</th><td>string</td><td>可选。搜索角色名或角色 ID。</td></tr>
                  <tr><th>cursor</th><td>number | string</td><td>第一页传 0 或省略；后续原样传顶层 nextCursor，放入 URL 时编码。默认排序返回数字，战力排序返回字符串；切换筛选或排序后从 0 开始。null 表示没有下一页。</td></tr>
                  <tr><th>limit</th><td>number</td><td>可选。默认 50，最大 100；显式传 bulk=1 时最大 1000。</td></tr>
                  <tr><th>bulk / includeTotal</th><td>0 | 1</td><td>bulk=1 开启批量读取且不统计总数；普通请求默认统计总数，includeTotal=0 可关闭。关闭时 totalCount 为 null。</td></tr>
                </tbody>
              </table>
            </div>

            <pre className="docs-code"><code>{`GET /api/characters?directory=1
GET /api/characters?serverId=1001&cursor=0&limit=50
GET /api/characters?serverId=1001&q=ASUKA&cursor=0&limit=50`}</code></pre>
            <p>角色列表中的 <code>legionPosition</code> 返回 0–3 的职位原始值或 null，与按服务读取角色接口一致；同时返回装备等级 equipItemLevel 和性别 gender，未采集为 null；<code>directory=1</code> 返回目录，不包含角色字段。</p>
            <p>列表响应为 <code>{'{ok:true,characters:[...],nextCursor,hasMore,totalCount}'}</code>；目录响应为 <code>{'{ok:true,servers:[...]}'}</code>，每个区服包含 raceId、serverId、serverName、characterCount、unaffiliatedCount 和 legions（legionName、memberCount）。两种响应都限定在当前账号可访问的区服内。directory=1 时不执行列表筛选。</p>
            <p>状态码：200 成功；400 阵营、聊天状态、排序或排序游标无效；401 未登录。错误响应统一为 <code>{'{ok:false,error:"错误说明",details?:["字段错误"]}'}</code>。</p>
          </section>

          <section className="data-panel docs-endpoint-card" id="character-profile">
            <div className="docs-endpoint-head">
              <div className="docs-endpoint">
                <span className="docs-method">GET</span>
                <code>/api/characters/profile</code>
              </div>
              <p>返回单个角色的官网资料、装备、技能和属性信息。</p>
              <p>支持登录 Cookie 或上传令牌 Bearer；所有有效登录账号均可查询全部区服。支持台服及 Steam 国际服，characterName 为精确角色名。</p>
            </div>

            <div className="docs-spec-block">
              <h3>Query Params</h3>
              <table className="docs-table">
                <tbody>
                  <tr><th>serverId</th><td>string</td><td>必填。游戏服务 ID。</td></tr>
                  <tr><th>characterName</th><td>string</td><td>必填。角色名。</td></tr>
                  <tr><th>region</th><td>TW | GLOBAL</td><td>可选。默认按区服 ID 识别；2201 为国际服美西，2501 为国际服亚洲。</td></tr>
                </tbody>
              </table>
            </div>

            <div className="docs-spec-grid">
              <div className="docs-spec-block">
                <h3>Status Codes</h3>
                <ul className="docs-status-list">
                  <li><code>200</code><span>找到时返回 ok:true、found:true、profile；未找到时返回 ok:true、found:false，不返回 404。</span></li>
                  <li><code>400</code><span>缺少角色名或区服 ID，或区服不支持官网查询。</span></li>
                  <li><code>401 / 403</code><span>未登录且令牌无效 / 无权访问该区服。</span></li>
                  <li><code>502 / 503</code><span>官网搜索或详情失败 / 上游限流，请稍后重试。</span></li>
                </ul>
              </div>
              <div className="docs-spec-block">
                <h3>Example</h3>
                <pre className="docs-code"><code>{`GET /api/characters/profile?serverId=1001&characterName=ASUKA
GET /api/characters/profile?region=GLOBAL&serverId=2201&characterName=wangjw98
Authorization: Bearer <UPLOAD_API_TOKEN>`}</code></pre>
              </div>
            </div>
            <p>数据直接来自 NCSoft。profile 包含身份、职业、战力、头像、角色页面链接，以及 stats、titles、daevanion、equipment、pet、wing、skills；国际服页面链接指向 Shugo.GG。装备或技能资料不完整时返回 partial:true 和 warnings，空列表不代表角色没有装备或技能。此接口不会写入角色数据库，也不返回数据库职位 legionPosition。</p>
          </section>

          <section className="data-panel docs-endpoint-card" id="characters-upload">
            <div className="docs-endpoint">
              <span className="docs-method is-post">POST</span>
              <code>/api/characters/upload</code>
            </div>
            <p>上传或更新角色数据。管理员登录态可直接调用；外部采集脚本使用 Bearer Token。</p>

            <div className="docs-spec-grid">
              <div className="docs-spec-block">
                <h3>Headers</h3>
                <table className="docs-table">
                  <tbody>
                    <tr><th>Content-Type</th><td>string</td><td><code>application/json</code></td></tr>
                    <tr><th>Authorization</th><td>string</td><td>外部脚本使用 <code>Bearer &lt;UPLOAD_API_TOKEN&gt;</code>。</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="docs-spec-block">
                <h3>Limits</h3>
                <ul className="docs-status-list">
                  <li><code>1MB</code><span>请求体最大大小。</span></li>
                  <li><code>200</code><span>单批最多角色数。</span></li>
                </ul>
              </div>
            </div>

            <div className="docs-spec-block">
              <h3>Request Body</h3>
              <p>接受 <code>{'{characters:[...]}'}</code> 或直接传角色数组，每批 1–200 条；按 serverId + characterId 新增或更新。整批先校验，任一角色字段无效则整批返回 400，不写入。</p>
              <pre className="docs-code"><code>{`{
  "characters": [
    {
      "characterName": "ASUKA",
      "characterId": "123",
      "serverId": "1001",
      "legionName": "示例军团",
      "legionPosition": 0,
      "level": 50,
      "combatPower": 123456,
      "equipItemLevel": 3000,
      "gender": 2
    }
  ]
}`}</code></pre>
              <table className="docs-table">
                <tbody>
                  <tr><th>characterName / characterId / serverId</th><td>string</td><td>必填。角色名称、游戏角色 ID、区服 ID；去掉首尾空白，最多保留 100 字符。长 ID 请使用字符串。兼容 character_name / character_id / server_id，名称另可用 name，区服另可用 serverKey。</td></tr>
                  <tr><th>serverName / legionName / className</th><td>string</td><td>可选，最多保留 100 字符；省略会清空已有内容。兼容对应 snake_case 字段，军团另可用 guildName / guild_name。</td></tr>
                  <tr><th>level</th><td>integer</td><td>0–999，接受可转为整数的数字字符串；省略、null 或空字符串按 0 保存。</td></tr>
                  <tr><th>combatPower</th><td>integer | null</td><td>非负安全整数，接受数字字符串及别名 combat_power。0 为有效战力；省略、null 或空字符串保留已有战力，新角色为 null。</td></tr>
                  <tr><th>equipItemLevel</th><td>integer | null</td><td>角色整体装备等级，来自查询结果 equipItemLevel，范围 0–2147483647；兼容 equip_item_level 和纯数字字符串。不是单件装备等级或强化等级。省略或 null 保留已有值，新角色为 null；0 为有效值。</td></tr>
                  <tr><th>gender</th><td>0 | 1 | 2 | null</td><td>性别原始值：0 未指定、1 男、2 女；接受对应数字字符串。省略或 null 保留已有值，新角色为 null。0 与未采集的 null 不同。</td></tr>
                  <tr><th>faction / avatarUrl</th><td>string</td><td>可选，分别最多保留 50 / 500 字符；省略会清空。头像另可用 avatar_url。</td></tr>
                  <tr><th>metadata</th><td>object | null</td><td>可选，兼容 metadata_json，但必须传对象，不能传 JSON 字符串或数组。省略或 null 会清空。</td></tr>
                  <tr><th>legionPosition</th><td>0 | 1 | 2 | 3 | null</td><td>可选。职位原始值，兼容字段名 <code>legion_position</code>；接受数字及对应数字字符串。0 军团长、1 军团干部、2 军团成员、3 雇佣兵。省略保留已有职位，null 清空为未知。</td></tr>
                </tbody>
              </table>
              <p>新角色省略该字段时保存为 <code>null</code>（未知）；更新已有角色时，省略字段保留原职位，显式传 <code>null</code> 清空为未知。数值 <code>0</code> 表示军团长，必须按有效职位处理，不能当作空值。</p>
              <table className="docs-table">
                <thead><tr><th>原始值</th><th>职位</th></tr></thead>
                <tbody>
                  <tr><td><code>0</code></td><td>军团长</td></tr>
                  <tr><td><code>1</code></td><td>军团干部</td></tr>
                  <tr><td><code>2</code></td><td>军团成员</td></tr>
                  <tr><td><code>3</code></td><td>雇佣兵</td></tr>
                  <tr><td><code>null</code></td><td>未知或未采集</td></tr>
                </tbody>
              </table>
              <p>上传也接受字符串 <code>"0"</code>、<code>"1"</code>、<code>"2"</code>、<code>"3"</code>，读取接口统一返回数字或 <code>null</code>。布尔值、空字符串、小数及范围外数值均返回 400，错误 <code>details</code> 会指出对应角色字段。</p>
              <p>旧字段 <code>isLegionLeader</code> / <code>is_legion_leader</code> 已停用；仅上传旧字段会返回 400 并提示改用 <code>legionPosition</code>。采集端应上传真实职位，不能把旧布尔值直接转换成 0/1。历史军团长已转为 0，其余旧记录为 null，需重新采集。</p>
            </div>

            <div className="docs-spec-block">
              <h3>Response 200</h3>
              <pre className="docs-code"><code>{`{
  "ok": true,
  "received": 1,
  "written": 1
}`}</code></pre>
            </div>

            <div className="docs-spec-grid">
              <div className="docs-spec-block">
                <h3>Status Codes</h3>
                <ul className="docs-status-list">
                  <li><code>200</code><span>上传成功。</span></li>
                  <li><code>400</code><span>JSON 格式或字段校验失败。</span></li>
                  <li><code>401</code><span>上传令牌无效或未登录。</span></li>
                  <li><code>413</code><span>请求体超过 1MB。</span></li>
                </ul>
              </div>
              <div className="docs-spec-block">
                <h3>Example</h3>
                <pre className="docs-code"><code>{`curl -X POST "https://mmorpgchat.com/api/characters/upload" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <UPLOAD_API_TOKEN>" \\
  --data '{"characters":[{"characterName":"ASUKA","characterId":"123","serverId":"1001","legionName":"示例军团","legionPosition":0}]}'`}</code></pre>
              </div>
            </div>

            <div className="docs-tip">
              <strong>批量同步建议</strong>
              <span>上传按 200 条一批；读取优先使用 <code>/api/servers/:serverId/characters</code> 的 cursor 分页。只有需要进度条或总量展示时，再请求 includeTotal=1。</span>
            </div>
          </section>

          <section className="data-panel docs-endpoint-card" id="characters-edit">
            <h3>修改与删除角色 · /api/characters</h3>
            <p>两个操作都要求有效登录 Cookie；上传令牌不能替代登录。角色不能被其他客服重点跟踪。若携带 Origin，必须与请求地址同源。请求体最多 8192 字符。</p>
            <div className="docs-spec-block">
              <div className="docs-endpoint"><span className="docs-method">PATCH</span><code>/api/characters</code></div>
              <p>提交完整可编辑资料，以下字段均须提供。id 是角色列表返回的本站数据库编号，不能使用游戏 characterId。此接口字段名为 name；不使用上传接口的 characterName，也不接受 snake_case 别名。</p>
              <pre className="docs-code"><code>{JSON.stringify({ id: 200, name: 'ASUKA', legionName: '示例军团', className: '剑星', faction: '天族', level: 50, combatPower: 123456, legionPosition: 1 }, null, 2)}</code></pre>
              <p>name、legionName、className、faction 必须为最多 100 字符的字符串，name 不可为空。level 为 0–999 的整数；combatPower 为非负安全整数或 null；legionPosition 为 0–3 的整数或 null。数值字段不接受数字字符串。这里 null 会清空战力或职位。</p>
            </div>
            <div className="docs-spec-block">
              <div className="docs-endpoint"><span className="docs-method">DELETE</span><code>/api/characters</code></div>
              <pre className="docs-code"><code>{JSON.stringify({ id: 200, confirm: true }, null, 2)}</code></pre>
              <p>confirm 必须为 true。删除角色及关联聊天、跟踪记录，无法通过接口撤销；后续采集或导入可能再次创建该角色。</p>
            </div>
            <p>成功返回 <code>{'{ok:true}'}</code>。400 参数或 JSON 错误；401 未登录；403 Origin 不匹配；409 角色不存在或被其他客服跟踪；413 请求体过大。失败返回 <code>{'{ok:false,error:"错误说明"}'}</code>。</p>
          </section>

          <PresenceApiDocs />
        </div>
      </div>
    </div>
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
  onOpenMessages: (agentId: string) => void | Promise<void>
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
          <span>房间中的客户端会通过 MQTT 心跳自动出现；网页连接正常时，连续 45 秒未收到心跳才判定离线。</span>
        </div>
        <UsersRound aria-hidden="true" size={34} />
      </section>

      <section className="data-panel">
        <div className="panel-toolbar">
          <div>
            <h3>在线客户端</h3>
            <p>显示全部区服的在线客户端，点击进入即可操作。</p>
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
                {agents.map((agent) => {
                  return (
                  <tr key={agent.agentId} className={agent.agentId === selectedAgentId ? 'is-selected' : ''}>
                    <td>
                      <button type="button" onClick={() => void onOpenMessages(agent.agentId)} disabled={!isConnected}>
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
                      <button className="table-action" type="button" onClick={() => void onOpenMessages(agent.agentId)} disabled={!isConnected}>
                        <MessageSquareText aria-hidden="true" size={15} />进入操作
                      </button>
                    </td>
                  </tr>
                  )
                })}
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

function CharacterDatabase(props: { filterStorageKey: string; onQueryPresence: QueryPresence; presenceConnected: boolean }) {
  const directory = useCharacterDirectory(props.filterStorageKey)
  const lookups = useMemo(() => presenceTargets(directory.characters), [directory.characters])
  const { presenceByCharacter, presenceQueueing, presenceMessage, presenceError, runQuery, stopQuery } = usePresenceQuery(props.onQueryPresence, lookups)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadText, setUploadText] = useState('')
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadFeedback, setUploadFeedback] = useState<CharacterUploadFeedback>({
    tone: 'neutral',
    message: '支持数组，或包含 characters 数组的 JSON 对象。单次最多 200 个角色。',
  })
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
  const resultSummary = `已加载 ${directory.characters.length} / ${directory.totalCount} 个角色`

  async function handleUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadFileName(file.name)
    if (file.size > 1_000_000) {
      setUploadFeedback({ tone: 'error', message: '文件不能超过 1MB。' })
      return
    }
    try {
      setUploadText(await file.text())
      setUploadFeedback({ tone: 'neutral', message: `已载入 ${file.name}，检查无误后点击上传。` })
    } catch {
      setUploadFeedback({ tone: 'error', message: '文件读取失败，请重新选择。' })
    }
  }

  async function handleManualUpload(event: FormEvent) {
    event.preventDefault()
    if (uploading) return

    const bodyText = uploadText.trim()
    if (!bodyText) {
      setUploadFeedback({ tone: 'error', message: '请先选择 JSON 文件，或粘贴角色 JSON。' })
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(bodyText)
    } catch {
      setUploadFeedback({ tone: 'error', message: 'JSON 格式不正确，请检查括号、逗号和引号。' })
      return
    }

    const records = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.characters)
        ? payload.characters
        : null
    if (!records) {
      setUploadFeedback({ tone: 'error', message: 'JSON 必须是角色数组，或 { "characters": [...] }。' })
      return
    }
    if (records.length === 0) {
      setUploadFeedback({ tone: 'error', message: 'characters 不能为空。' })
      return
    }
    if (records.length > 200) {
      setUploadFeedback({ tone: 'error', message: '单次最多上传 200 个角色，请拆分后再上传。' })
      return
    }

    setUploading(true)
    setUploadFeedback({ tone: 'neutral', message: `正在上传 ${records.length} 个角色...` })
    try {
      const response = await fetch('/api/characters/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText,
      })
      const result = await response.json().catch(() => ({})) as {
        received?: number
        written?: number
        error?: string
        details?: string[]
      }
      if (!response.ok) {
        setUploadFeedback({
          tone: 'error',
          message: result.error || `上传失败 (${response.status})`,
          details: result.details,
        })
        return
      }

      setUploadText('')
      setUploadFileName('')
      setUploadFeedback({
        tone: 'success',
        message: `上传完成：接收 ${result.received ?? records.length} 个角色，写入/更新 ${result.written ?? 0} 条。`,
      })
      await directory.refresh()
    } catch (caught) {
      setUploadFeedback({
        tone: 'error',
        message: caught instanceof Error ? caught.message : '上传失败，请稍后重试。',
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="page-stack character-database-page">
      <section className="data-panel">
        <div className="panel-toolbar database-toolbar">
          <div>
            <h3>角色资料</h3>
            <p>{resultSummary}，数据来自 Cloudflare D1。</p>
            <TrackingButton />
          </div>
          <div className="toolbar-actions">
            <button className="icon-button" type="button" title={presenceQueueing ? '停止在线查询' : '查询当前筛选角色在线状态'} aria-label={presenceQueueing ? '停止在线查询' : '查询当前筛选角色在线状态'}
              disabled={!presenceQueueing && (!props.presenceConnected || !directory.characters.length)}
              onClick={() => presenceQueueing ? stopQuery() : void runQuery(async signal => (async function* () {
                for await (const page of directory.streamAll(signal, PRESENCE_BATCH_SIZE)) yield presenceTargets(page)
              })())}>
              {presenceQueueing ? <Square size={16} /> : <Wifi size={16} />}
            </button>
            <button className="secondary-button" type="button" onClick={() => setUploadOpen((value) => !value)} aria-expanded={uploadOpen}>
              <Upload aria-hidden="true" size={16} />{uploadOpen ? '收起导入' : '导入角色'}
            </button>
            <button className="secondary-button" type="button" onClick={() => void directory.refresh()} disabled={directory.loading}>
              <RefreshCw className={directory.loading ? 'spin' : undefined} aria-hidden="true" size={16} />刷新
            </button>
          </div>
        </div>

        {presenceMessage && <p className={`presence-message${presenceError ? ' is-error' : ''}`} role={presenceError ? 'alert' : 'status'}>{presenceMessage}</p>}
        {uploadOpen && (
          <form className="manual-upload-panel" onSubmit={handleManualUpload}>
            <div className="manual-upload-copy">
              <h4>手动上传角色 JSON</h4>
              <p>字段至少需要 characterName、characterId、serverId；职位可传 legionPosition（0 军团长、1 军团干部、2 军团成员、3 雇佣兵）。</p>
            </div>
            <label className="manual-file-picker">
              <input type="file" accept=".json,application/json" onChange={(event) => void handleUploadFileChange(event)} disabled={uploading} />
              <Upload aria-hidden="true" size={17} />
              <span>{uploadFileName || '选择 JSON 文件'}</span>
            </label>
            <label className="manual-json-editor">
              <span>JSON 内容</span>
              <textarea
                value={uploadText}
                onChange={(event) => setUploadText(event.target.value)}
                placeholder={'{\n  "characters": [\n    { "characterName": "角色名", "characterId": "123", "serverId": "server1", "legionPosition": 2, "level": 50 }\n  ]\n}'}
                disabled={uploading}
              />
            </label>
            <div className="manual-upload-actions">
              <p className={`upload-feedback ${uploadFeedback.tone}`}>
                {uploadFeedback.message}
              </p>
              <button className="primary-button" type="submit" disabled={uploading || !uploadText.trim()}>
                {uploading ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : <Upload aria-hidden="true" size={16} />}
                上传到数据库
              </button>
            </div>
            {uploadFeedback.details && uploadFeedback.details.length > 0 && (
              <ul className="upload-error-list">
                {uploadFeedback.details.map((detail, index) => <li key={`${index}-${detail}`}>{detail}</li>)}
              </ul>
            )}
          </form>
        )}

        <div className="database-filters">
          <label className="database-search">
            <span>搜索角色</span>
            <span className="input-with-icon"><Search aria-hidden="true" size={15} /><input value={directory.search} onChange={(event) => directory.setSearch(event.target.value)} placeholder="角色名或 Character ID" /></span>
          </label>
          <label>
            <span>区服</span>
            <select value={directory.selectedServerKey} onChange={(event) => directory.selectServer(event.target.value)} disabled={directory.servers.length === 0}>
              <option value={ALL_SERVERS_KEY}>全部区服</option>
              {serverGroups.map((group) => (
                <optgroup label={group.label} key={group.label}>
                  {group.servers.map((server) => <option value={server.serverId} key={server.serverId}>{server.serverName} · {server.serverId} ({server.characterCount})</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>军团</span>
            <select value={directory.selectedLegionName || ''} onChange={(event) => directory.selectLegion(event.target.value || null)}>
              <option value="">全部军团</option>
              <option value={NO_LEGION_KEY}>未加入军团 ({unaffiliatedCount})</option>
              <LegionOptions legions={legionOptions} />
            </select>
          </label>
          <label>
            <span>军团长</span>
            <select value={directory.legionLeadersOnly ? '1' : '0'} onChange={(event) => directory.setLegionLeadersOnly(event.target.value === '1')}>
              <option value="0">全部角色</option>
              <option value="1">仅军团长</option>
            </select>
          </label>
          <label>
            <span>战力排序</span>
            <select aria-label="战力排序" value={directory.sort} onChange={(event) => directory.setSort(event.target.value === 'power_desc' ? 'power_desc' : event.target.value === 'power_asc' ? 'power_asc' : 'default')}>
              <option value="default">默认顺序</option>
              <option value="power_desc">战力从高到低</option>
              <option value="power_asc">战力从低到高</option>
            </select>
          </label>
        </div>

        {directory.error ? (
          <div className="empty-state compact">
            <CircleAlert aria-hidden="true" size={27} />
            <strong>角色数据加载失败</strong>
            <p>{directory.error}</p>
          </div>
        ) : directory.loading && directory.characters.length === 0 ? (
          <div className="empty-state compact">
            <LoaderCircle className="spin" aria-hidden="true" size={27} />
            <strong>正在读取角色数据库</strong>
          </div>
        ) : directory.characters.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="client-table character-database-table">
                <thead><tr><th>角色</th><th>在线状态</th><th>Character ID</th><th>区服</th><th>阵营</th><th>军团</th><th>军团职位</th><th>职业</th><th>等级</th><th>战斗力</th><th>最后采集</th><th>操作</th></tr></thead>
                <tbody>
                  {directory.characters.map((character) => (
                    <tr key={character.id}>
                      <td>
                        <span className="database-character">
                          <TrackingStar character={character} />
                          <CharacterAvatar character={character} />
                          <span><strong>{character.name}</strong><small>DB #{character.id}</small></span>
                        </span>
                      </td>
                      <td>{presenceLabel(presenceByCharacter.get(presenceKey(character.serverKey, character.characterId)))}</td>
                      <td><code>{character.characterId}</code></td>
                      <td><span className="server-identity"><strong>{character.serverName}</strong><small>ID {character.serverKey}</small></span></td>
                      <td>{formatFaction(character.faction)}</td>
                      <td>{character.legionName || '未加入军团'}</td>
                      <td>{character.legionPosition == null ? '未知' : `${character.legionPosition} · ${['军团长', '军团干部', '军团成员', '雇佣兵'][character.legionPosition]}`}</td>
                      <td>{character.className || '—'}</td>
                      <td><strong>{character.level || '—'}</strong></td>
                      <td>{character.combatPower == null ? '—' : formatNumber(character.combatPower)}</td>
                      <td><span className="database-time"><strong>{formatDatabaseTime(character.lastSeenAt)}</strong><small>{relativeTime(character.lastSeenAt)}</small></span></td>
                      <td><CharacterActions character={character} onSaved={directory.refresh} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="database-footer">
              <span>{resultSummary}</span>
              {directory.nextCursor !== null && (
                <button className="secondary-button" type="button" onClick={() => void directory.loadMore()} disabled={directory.loading}>
                  {directory.loading && <LoaderCircle className="spin" aria-hidden="true" size={15} />}
                  加载更多
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state compact">
            <Database aria-hidden="true" size={27} />
            <strong>没有符合条件的角色</strong>
            <p>可以调整区服、军团或搜索关键词。</p>
          </div>
        )}
      </section>
    </div>
  )
}

function MessageCenter(props: {
  onSendFaction: (content: string) => Promise<CommandSendResult>
  managedChat?: ManagedChatController
  filterStorageKey?: string
  chatBlockMessage?: string
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
  onSendPrivateChat: (content: string, signal: AbortSignal) => Promise<CommandSendResult>
  onSendAll: (loadRecipients: (signal?: AbortSignal) => Promise<GameCharacter[]>, options?: BulkSendOptions) => Promise<BulkSendResult>
  onStopBulkSend: () => void
  bulkProgress?: BulkSendProgress | null
  onResumeBulkSend?: () => void
  onDiscardBulkSend?: () => void
  onQueryPresence: QueryPresence
  presenceConnected: boolean
  bulkSending: boolean
  canOperate: boolean
  operationKey?: string
  bulkIntervalRangeMs: BulkIntervalRangeMs
  onBulkIntervalRangeChange: (value: BulkIntervalRangeMs) => void
  readMessageIds: ReadonlySet<string>
  onMessagesRead: (messageIds: string[]) => void
}) {
  const directory = useCharacterDirectory(props.filterStorageKey, { key: props.agent.agentId, serverId: props.agent.serverId })
  const canChat = props.canOperate && !props.chatBlockMessage
  const characterLoadInFlight = useRef(false)
  const { messages: storedMessages, cursor: historyCursor, loading: historyLoading, error: historyError,
    loadOlder: loadOlderMessages, retry: retryHistory } = useChatHistory(props.selectedCharacter?.serverKey, props.selectedCharacter?.characterId)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list')
  const [messageView, setMessageView] = useState<MessageView>('private')
  const [factionContent, setFactionContent] = useState('')
  const [factionFeedback, setFactionFeedback] = useState('')
  const [factionSending, setFactionSending] = useState(false)
  const factionSendingRef = useRef(false)
  const factionScope = `${props.agent.agentId}:${props.agent.serverId}:${props.operationKey}`
  const factionScopeRef = useRef(factionScope)
  factionScopeRef.current = factionScope
  useEffect(() => { setFactionContent(''); setFactionFeedback('') }, [factionScope])
  async function sendFactionMessage() {
    const content = factionContent.trim()
    if (!canChat || !content || factionSendingRef.current) return
    publicScroll.jumpToLatest()
    const scope = factionScope
    factionSendingRef.current = true
    setFactionSending(true)
    setFactionFeedback('正在等待客户端发送回执…')
    try {
      const result = await props.onSendFaction(content)
      if (scope !== factionScopeRef.current) return
      setFactionFeedback(result.message)
      if (result.status === 'confirmed') setFactionContent('')
    } catch {
      if (scope === factionScopeRef.current) setFactionFeedback('发送结果未确认，请核对游戏聊天记录，勿重复发送。')
    } finally {
      factionSendingRef.current = false
      setFactionSending(false)
    }
  }
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('single')
  const [characterListMode, setCharacterListMode] = useState<CharacterListMode>('all')
  const [readIdsAtUnreadEntry, setReadIdsAtUnreadEntry] = useState<ReadonlySet<string>>(() => new Set())
  const [openedConversation, setOpenedConversation] = useState('')
  const conversationKey = JSON.stringify([props.agent.agentId, props.selectedCharacter?.serverKey, props.selectedCharacter?.characterId])
  const privateThreadRef = useRef<HTMLDivElement>(null)
  const publicThreadRef = useRef<HTMLDivElement>(null)
  const [openedFromPublic, setOpenedFromPublic] = useState(false)
  const privateComposerRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (openedFromPublic && messageView === 'private') privateComposerRef.current?.focus()
  }, [openedFromPublic, messageView, props.selectedCharacter?.characterId])
  const officialProfileCache = useRef(new Map<string, OfficialCharacterProfile | null>())
  const [profilePopoverCharacter, setProfilePopoverCharacter] = useState<GameCharacter | null>(null)
  const [profilePopover, setProfilePopover] = useState<OfficialCharacterProfile | null>(null)
  const [profilePopoverState, setProfilePopoverState] = useState<OfficialProfileState>('idle')
  const [profilePopoverError, setProfilePopoverError] = useState('')
  const [profilePopoverRefreshKey, setProfilePopoverRefreshKey] = useState(0)
  const selectedServer = directory.servers.find((server) => server.serverId === directory.selectedServerKey)
  const { serverOptions, legionOptions } = useDirectoryOptions(directory.servers, directory.selectedServerKey)
  const selectedLegionLabel = directory.selectedLegionName === NO_LEGION_KEY
    ? '未加入军团'
    : directory.selectedLegionName || '全部军团'
  const visibleCharacters = directory.characters
  const replyTargets = useMemo(() => props.agentMessages
    .filter((message) => isIncomingCharacterReply(message)
      && !(characterListMode === 'unread' ? readIdsAtUnreadEntry : props.readMessageIds).has(message.id))
    .map((message) => {
      const target = whisperTargetFromMessage(message)
      return { ...target, serverKey: target.serverKey || props.agent.serverId }
    })
    .filter((target) => target.characterId || target.targetName), [props.agentMessages, props.agent.serverId, props.readMessageIds, characterListMode, readIdsAtUnreadEntry])
  const unreadTargets = useMemo(() => props.agentMessages
    .filter((message) => isUnreadIncomingMessage(message, props.readMessageIds))
    .map((message) => {
      const target = whisperTargetFromMessage(message)
      return { ...target, serverKey: target.serverKey || props.agent.serverId }
    })
    .filter((target) => target.characterId || target.targetName), [props.agentMessages, props.readMessageIds, props.agent.serverId])
  const unreadDirectory = useUnreadCharacters(replyTargets, visibleCharacters)
  const characterUnreadCount = useCallback((character: GameCharacter) => unreadTargets
    .filter((target) => targetMatchesCharacter(target, character)).length, [unreadTargets])
  const unreadCharacters = useMemo(() => unreadDirectory.characters.filter((character) => {
    if (directory.legionLeadersOnly && character.legionPosition !== 0) return false
    if (directory.selectedRaceId !== '0' && String(aion2ServerRaceId(character.serverKey)) !== directory.selectedRaceId) return false
    if (!directory.isAllServers && character.serverKey !== directory.selectedServerKey) return false
    if (directory.selectedLegionName === NO_LEGION_KEY) {
      if (character.id.startsWith('unread:') || character.legionName) return false
    } else if (directory.selectedLegionName && character.legionName !== directory.selectedLegionName) return false
    const search = directory.search.trim()
    return !search || character.name.includes(search) || character.characterId.includes(search)
  }), [unreadDirectory.characters, directory.isAllServers, directory.selectedServerKey, directory.selectedLegionName, directory.search, directory.selectedRaceId, directory.legionLeadersOnly])
  const unreadMessageCount = useMemo(() => unreadTargets.filter((target) => unreadCharacters
    .some((character) => targetMatchesCharacter(target, character))).length, [unreadTargets, unreadCharacters])
  const { presenceByCharacter, presenceLoading, presenceQueueing, presenceMessage, presenceError, currentQueryMessage, currentQueryError, refreshVisiblePresence, runQuery, runCurrentQuery, stopQuery, setVisiblePresenceLookups } = usePresenceQuery(props.onQueryPresence)
  const [presenceIntervalMs, setPresenceIntervalMs] = useState(60_000)
  const currentPresenceMessage = useCurrentPresence({
    target: props.selectedCharacter ? { serverId: props.selectedCharacter.serverKey, characterId: props.selectedCharacter.characterId, name: props.selectedCharacter.name } : undefined,
    contextKey: JSON.stringify([props.agent.agentId, props.operationKey]),
    active: messageView === 'private' && recipientMode === 'single',
    connected: props.presenceConnected,
    intervalMs: presenceIntervalMs,
    runQuery: runCurrentQuery,
  })
  const currentPresence = props.selectedCharacter
    ? presenceByCharacter.get(presenceKey(props.selectedCharacter.serverKey, props.selectedCharacter.characterId)) : undefined
  const presenceFilterKey = JSON.stringify([
    directory.chatStatus,
    directory.chatRevision,
    directory.sort,
    props.agent.agentId, directory.selectedServerKey, directory.selectedLegionName, directory.search, directory.selectedRaceId, directory.legionLeadersOnly,
  ])
  const [queriedDirectory, setQueriedDirectory] = useState<{ key: string; characters: GameCharacter[] } | null>(null)
  const hasQueriedDirectory = queriedDirectory?.key === presenceFilterKey
  const listCharacters = characterListMode === 'unread' ? unreadCharacters
    : hasQueriedDirectory ? queriedDirectory.characters : visibleCharacters
  const displayedCharacters = useMemo(() => {
    if (directory.sort !== 'default') {
      return [...listCharacters].sort((left, right) => {
        if (left.combatPower == null) return right.combatPower == null ? Number(left.id) - Number(right.id) : 1
        if (right.combatPower == null) return -1
        const difference = left.combatPower - right.combatPower
        return (directory.sort === 'power_asc' ? difference : -difference) || Number(left.id) - Number(right.id)
      })
    }
    const online: GameCharacter[] = [], expired: GameCharacter[] = [], remaining: GameCharacter[] = []
    for (const character of listCharacters) {
      const status = presenceByCharacter.get(presenceKey(character.serverKey, character.characterId))
      if (status?.status === 'online') online.push(character)
      else if (status?.status === 'stale' && status.online === true) expired.push(character)
      else remaining.push(character)
    }
    // Expired offline results stay in the remaining group; only previously online
    // roles get priority. Newer confirmations also expire later.
    const newestFirst = (left: GameCharacter, right: GameCharacter) =>
      (presenceByCharacter.get(presenceKey(right.serverKey, right.characterId))?.checkedAt || 0)
      - (presenceByCharacter.get(presenceKey(left.serverKey, left.characterId))?.checkedAt || 0)
    online.sort(newestFirst)
    expired.sort(newestFirst)
    return [...online, ...expired, ...remaining]
  }, [listCharacters, presenceByCharacter, directory.sort])
  const characterWindow = useCharacterWindow(displayedCharacters, JSON.stringify([characterListMode, presenceFilterKey]))
  const visiblePresenceLookups = useMemo(() => [...characterWindow.items, ...(props.selectedCharacter ? [props.selectedCharacter] : [])].filter((character) => character.serverKey && character.characterId).map((character) => ({
    serverId: character.serverKey,
    characterId: character.characterId,
  })), [characterWindow.items, props.selectedCharacter])
  useEffect(() => setVisiblePresenceLookups(visiblePresenceLookups), [visiblePresenceLookups, setVisiblePresenceLookups])
  const characterPreviews = useMemo(() => {
    const candidates = props.agentMessages
      .filter(message => message.type !== 'control_ack' && message.type !== 'control_result'
        && (message.type !== 'chat_message' || isPrivateChatPayload(message.raw)))
      .map(message => ({ message, target: whisperTargetFromMessage(message) }))
    return new Map(characterWindow.items.map(character => [character.id, {
      latestMessage: candidates.find(({ target }) => targetMatchesCharacter(target, character))?.message,
      unreadCount: characterUnreadCount(character),
    }]))
  }, [characterWindow.items, props.agentMessages, characterUnreadCount])
  const sendResults = useMemo(() => {
    const results = new Map<string, { ok: boolean; uncertain?: boolean; detail: string }>()
    for (const message of [...storedMessages].reverse()) {
      if (!message.requestId || (message.messageType !== 'control_result'
        && !(message.messageType === 'control_sent' && ['delivered', 'failed', 'pending'].includes(message.status)))) continue
      results.set(JSON.stringify([message.agentId, message.requestId]), {
        ok: ['delivered', 'sent', 'received'].includes(message.status),
        uncertain: message.status === 'pending',
        detail: message.errorMessage,
      })
    }
    for (const message of [...props.agentMessages].reverse()) {
      if (message.type !== 'control_result') continue
      const requestId = messageRequestId(message)
      if (requestId) results.set(JSON.stringify([message.agentId, requestId]), controlResultFromMessage(message))
    }
    return results
  }, [props.agentMessages, storedMessages])
  const chronologicalMessages = useMemo(() => mergePrivateChatTimeline([
      ...storedMessages.map((message) => ({
        id: message.sourceMessageId || `stored:${message.id}`,
        agentId: message.agentId,
        messageType: message.messageType,
        gameMessageId: message.gameMessageId,
        content: message.content,
        direction: message.direction,
        requestId: message.requestId,
        time: new Date(message.sentAt).toISOString(),
      })),
      // Receipts may omit the recipient; correlate only by the selected command's request ID.
      ...[...props.messages, ...props.agentMessages.filter(message => message.type === 'control_result')].map((message) => ({
        id: message.id,
        agentId: message.agentId,
        messageType: message.type,
        gameMessageId: gameMessageIdFromRaw(message.raw),
        content: message.content,
        direction: messageDirection(message),
        requestId: messageRequestId(message),
        time: message.time,
      })),
    ]), [props.messages, props.agentMessages, storedMessages])
  const publicMessages = useMemo(() => [...props.agentMessages].sort(
    (left, right) => Date.parse(left.time) - Date.parse(right.time),
  ), [props.agentMessages])

  const privateScroll = useChatScroll(privateThreadRef, conversationKey,
    messageView === 'private' && recipientMode === 'single' && Boolean(props.selectedCharacter), chronologicalMessages)
  const publicScroll = useChatScroll(publicThreadRef, props.agent.agentId,
    messageView === 'public', publicMessages.filter(message => message.type === 'chat_message'))

  useEffect(() => {
    const character = profilePopoverCharacter
    if (!character) {
      setProfilePopover(null)
      setProfilePopoverState('idle')
      setProfilePopoverError('')
      return
    }

    const key = `${character.serverKey}\u0000${character.name}`
    if (officialProfileCache.current.has(key)) {
      const cached = officialProfileCache.current.get(key) || null
      setProfilePopover(cached)
      setProfilePopoverState(cached ? 'ready' : 'not-found')
      setProfilePopoverError('')
      return
    }

    const controller = new AbortController()
    setProfilePopover(null)
    setProfilePopoverState('loading')
    setProfilePopoverError('')
    const params = new URLSearchParams({
      serverId: character.serverKey,
      characterName: character.name,
    })
    void fetch(`/api/characters/profile?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json() as {
          error?: string
          found?: boolean
          profile?: OfficialCharacterProfile
          warnings?: string[]
        }
        if (!response.ok) throw new Error(result.error || '官网角色查询失败')
        if (!result.found || !result.profile) {
          officialProfileCache.current.set(key, null)
          setProfilePopover(null)
          setProfilePopoverState('not-found')
          return
        }
        const profile = { ...result.profile, warnings: result.warnings }
        if (!result.warnings?.length) officialProfileCache.current.set(key, profile)
        setProfilePopover(profile)
        setProfilePopoverState('ready')
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setProfilePopover(null)
        setProfilePopoverState('error')
        setProfilePopoverError(cause instanceof Error ? cause.message : '官网角色查询失败')
      })
    return () => controller.abort()
  }, [profilePopoverCharacter?.name, profilePopoverCharacter?.serverKey, profilePopoverRefreshKey])

  useEffect(() => {
    if (!profilePopoverCharacter) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setProfilePopoverCharacter(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [profilePopoverCharacter])

  useEffect(() => {
    if (!props.selectedCharacter && characterListMode === 'all' && visibleCharacters[0]) {
      props.onCharacterSelect(visibleCharacters[0])
    }
  }, [props.onCharacterSelect, props.selectedCharacter, visibleCharacters, characterListMode])

  const markVisibleMessagesRead = useEffectEvent(() => {
    const thread = privateThreadRef.current
    if (!thread || !document.hasFocus() || document.visibilityState !== 'visible'
      || openedConversation !== conversationKey || messageView !== 'private'
      || recipientMode !== 'single' || !props.selectedCharacter) return
    const bounds = thread.getBoundingClientRect()
    const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom)
    const left = Math.max(0, bounds.left), right = Math.min(window.innerWidth, bounds.right)
    const visibleIds = new Set<string>()
    for (const element of thread.querySelectorAll<HTMLElement>('[data-incoming-ids]')) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right) continue
      for (const id of JSON.parse(element.dataset.incomingIds!) as string[]) visibleIds.add(id)
    }
    props.onMessagesRead(props.agentMessages
      .filter((message) => isUnreadIncomingMessage(message, props.readMessageIds)
        && messageBelongsToCharacter(message, props.selectedCharacter!)
        && visibleIds.has(message.id))
      .map((message) => message.id))
  })
  useEffect(() => {
    const thread = privateThreadRef.current
    markVisibleMessagesRead()
    const onVisibility = () => markVisibleMessagesRead()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    thread?.addEventListener('scroll', onVisibility, { passive: true })
    const observer = new IntersectionObserver(onVisibility, { root: thread })
    thread?.querySelectorAll('[data-incoming-ids]').forEach(element => observer.observe(element))
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      thread?.removeEventListener('scroll', onVisibility)
      observer.disconnect()
    }
  }, [chronologicalMessages, props.selectedCharacter, recipientMode, messageView, openedConversation, conversationKey])

  function submitMessage(event: React.FormEvent) {
    event.preventDefault()
    if (props.bulkSending || !canChat) return
    if (!props.content.trim()) return
    if (recipientMode === 'all') {
      if (!props.bulkProgress && directory.totalCount > 0) props.onSendAll(directory.loadAll)
    }
    else { privateScroll.jumpToLatest(); props.onSend() }
  }

  async function queryCharacterPresence() {
    if (!props.presenceConnected) return
    if (characterWindow.listRef.current) {
      characterWindow.listRef.current.scrollTop = 0
      characterWindow.onScroll(characterWindow.listRef.current)
    }
    await runQuery(async (signal) => {
      if (characterListMode === 'unread') return presenceTargets(unreadCharacters)
      return (async function* () {
        const characters: GameCharacter[] = []
        for await (const page of directory.streamAll(signal, PRESENCE_BATCH_SIZE)) {
          signal.throwIfAborted()
          characters.push(...page)
          // Show results as each page is queried, without first downloading the
          // entire directory (which can contain hundreds of thousands of rows).
          setQueriedDirectory({ key: presenceFilterKey, characters: [...characters] })
          yield presenceTargets(page)
        }
      })()
    })
  }

  function loadNextCharacters() {
    if (hasQueriedDirectory || directory.loading || directory.nextCursor === null || characterLoadInFlight.current) return
    characterLoadInFlight.current = true
    void directory.loadMore().finally(() => {
      characterLoadInFlight.current = false
    })
  }

  function handleCharacterListScroll(event: React.UIEvent<HTMLDivElement>) {
    characterWindow.onScroll(event.currentTarget)
    if (characterListMode === 'unread') return
    const list = event.currentTarget
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    if (distanceToBottom <= 120) loadNextCharacters()
  }

  function openProfilePopover(character: GameCharacter) {
    setProfilePopoverCharacter(character)
  }

  return (
    <div className={`message-workbench message-workbench-v2 mobile-${mobilePane}${assistantOpen ? ' assistant-open' : ''}`}>
      <div className="message-workspace-toolbar">
        <button className="icon-button" type="button" onClick={props.onBack} aria-label="返回客户端中心" title="返回客户端中心"><ArrowLeft size={17} /></button>
        <div className="message-workspace-identity"><strong>{props.agent.host || props.agent.agentId}</strong><span>{canChat ? '可发送消息' : props.chatBlockMessage ? '聊天暂不可用' : '客户端未连接'}</span></div>
        <button className="secondary-button message-list-toggle" type="button" onClick={() => { setMobilePane(mobilePane === 'list' ? 'chat' : 'list'); setAssistantOpen(false) }}>{mobilePane === 'list' ? '查看对话' : '角色列表'}</button>
        <button className="secondary-button message-assistant-toggle" type="button" aria-expanded={assistantOpen} aria-controls="message-assistant-slot" onClick={() => setAssistantOpen(!assistantOpen)}><Sparkles size={16} />{assistantOpen ? '收起 AI 助手' : 'AI 助手'}{assistantBusy && <span className="assistant-running">生成中</span>}{props.managedChat?.state.status === 'running' && <span className="assistant-running">托管中</span>}</button>
      </div>
        <details className="message-directory-filters"><summary><span>筛选角色</span><small>{directory.isAllServers ? '全部区服' : selectedServer?.serverName || '区服'} · {selectedLegionLabel}{directory.legionLeadersOnly ? ' · 仅军团长' : ''}</small></summary>
        <div className="filter-controls">
          <div className="server-picker">
            <span>种族</span>
            <SearchableSelect label="选择种族" value={directory.selectedRaceId} options={RACE_OPTIONS} onChange={directory.selectRace} />
          </div>
          <div className="server-picker">
            <span>当前区服</span>
            <SearchableSelect label="选择区服" value={directory.selectedServerKey} options={serverOptions}
              onChange={directory.selectServer} disabled={directory.servers.length === 0} />
          </div>
          <div className="server-picker">
            <span>军团</span>
            <SearchableSelect key={`${directory.selectedRaceId}-${directory.selectedServerKey}`} label="选择军团" value={directory.selectedLegionName || ''}
              options={legionOptions} onChange={directory.selectLegion} disabled={directory.servers.length === 0} />
          </div>
          <div className="server-picker">
            <span>军团长</span>
            <SearchableSelect label="筛选军团长" value={directory.legionLeadersOnly ? '1' : '0'}
              options={[{ value: '0', label: '全部角色' }, { value: '1', label: '仅军团长' }]}
              onChange={(value) => directory.setLegionLeadersOnly(value === '1')} />
          </div>
        </div>

        </details>
      <section className="data-panel chat-shell">
      <aside className="character-panel" aria-label="游戏角色列表">
        <div className="character-panel-head">
          <div><p>共 {directory.totalCount} 个角色 · 已加载 {visibleCharacters.length} · {directory.isAllServers ? '全部区服' : selectedServer?.serverName || '暂无数据'}</p></div>
          <div className="presence-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => presenceQueueing ? stopQuery() : void queryCharacterPresence()}
              disabled={!presenceQueueing && (!props.presenceConnected || displayedCharacters.length === 0)}
              aria-label={presenceQueueing ? '停止在线查询' : '查询当前筛选角色在线状态'}
              title={presenceQueueing ? '停止在线查询' : '查询当前筛选角色在线状态'}
            >
              {presenceQueueing ? <Square aria-hidden="true" size={15} /> : <Wifi aria-hidden="true" size={15} />}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void refreshVisiblePresence()}
              disabled={presenceLoading || visiblePresenceLookups.length === 0}
              aria-label="刷新可见角色在线状态"
              title="刷新可见角色在线状态"
            >
              <RefreshCw className={presenceLoading ? 'spin' : undefined} aria-hidden="true" size={15} />
            </button>
          </div>
        </div>
        <label className="character-search">
          <Search aria-hidden="true" size={15} />
          <input value={directory.search} onChange={(event) => directory.setSearch(event.target.value)} placeholder="搜索角色或 ID" />
        </label>
        <label className="character-sort">
          <span>战力排序</span>
          <select aria-label="角色列表战力排序" value={directory.sort}
            onChange={event => directory.setSort(event.target.value === 'power_desc' ? 'power_desc' : event.target.value === 'power_asc' ? 'power_asc' : 'default')}>
            <option value="default">默认排序</option>
            <option value="power_desc">战力从高到低</option>
            <option value="power_asc">战力从低到高</option>
          </select>
        </label>
        <div className="character-message-tabs" role="tablist" aria-label="角色消息过滤">
          <button
            className={characterListMode === 'all' && directory.chatStatus === 'all' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={characterListMode === 'all' && directory.chatStatus === 'all'}
            onClick={() => { directory.setChatStatus('all'); setCharacterListMode('all') }}
          >
            <span>全部角色</span>
            {unreadMessageCount > 0 && <em>{formatBadgeCount(unreadMessageCount)}</em>}
          </button>
          {(['chatted', 'unchatted'] as const).map(status => (
            <button key={status} type="button" role="tab"
              className={characterListMode === 'all' && directory.chatStatus === status ? 'is-active' : ''}
              aria-selected={characterListMode === 'all' && directory.chatStatus === status}
              onClick={() => { directory.setChatStatus(status); setCharacterListMode('all') }}>
              {status === 'chatted' ? '已聊' : '未聊天'}
            </button>
          ))}
          <button
            className={characterListMode === 'unread' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={characterListMode === 'unread'}
            onClick={() => {
              directory.setChatStatus('all')
              if (characterListMode !== 'unread') setReadIdsAtUnreadEntry(new Set(props.readMessageIds))
              setCharacterListMode('unread')
            }}
          >
            <span>未读</span>
            <em>{formatBadgeCount(unreadMessageCount)}</em>
          </button>
        </div>
        <div className="presence-feedback" aria-live="polite">
          {presenceMessage && <p className={`presence-message${presenceError ? ' is-error' : ''}`} role={presenceError ? 'alert' : 'status'}>{presenceMessage}</p>}
        </div>
        <div className="message-shortcuts">
          {directory.totalCount > 0 && characterListMode === 'all' && (
            <button className={`broadcast-character${recipientMode === 'all' ? ' is-active' : ''}`} type="button" onClick={() => {
              setMobilePane('chat')
              setOpenedConversation('')
              setRecipientMode('all')
              setMessageView('private')
            }}>
              <span className="broadcast-character-icon"><UsersRound aria-hidden="true" size={18} /></span>
              <span className="character-summary">
                <span><strong>@全体</strong></span>
                <span><small>筛选结果 · {directory.totalCount} 个角色</small></span>
              </span>
            </button>
          )}
          <TrackingButton onSelect={character => {
            setOpenedConversation(JSON.stringify([props.agent.agentId, character.serverKey, character.characterId]))
            setMobilePane('chat')
            setRecipientMode('single')
            props.onCharacterSelect(character)
            setMessageView('private')
          }} />
        </div>
        <div className="character-list" ref={characterWindow.listRef} onScroll={handleCharacterListScroll}>
          <div aria-hidden="true" style={{ height: characterWindow.paddingTop }} />
          {characterWindow.items.map((character) => {
            const presence = presenceByCharacter.get(presenceKey(character.serverKey, character.characterId))
            const { latestMessage, unreadCount = 0 } = characterPreviews.get(character.id) || {}
            const isActive = recipientMode === 'single' && props.selectedCharacter?.id === character.id
            return (
              <div className={`character-card${isActive ? ' is-active' : ''}`} key={character.id}>
                <button className="character-select-button" type="button" onClick={() => {
                  setOpenedConversation(JSON.stringify([props.agent.agentId, character.serverKey, character.characterId]))
                  setMobilePane('chat')
                  setRecipientMode('single')
                  props.onCharacterSelect(character)
                  setMessageView('private')
                }}>
                  <span className="character-avatar-presence">
                    <CharacterAvatar character={character} />
                    <span
                      className={`presence-dot is-${presence?.status || 'unknown'}`}
                      aria-label={presenceLabel(presence)}
                      title={presenceLabel(presence)}
                    />
                  </span>
                  <span className="character-summary">
                    <span><strong>{character.name}</strong><time>{latestMessage ? formatClock(latestMessage.time) : ''}</time></span>
                    <span><small>{latestMessage?.content || `${character.legionName || '未加入军团'} · ${character.className}`}</small>{unreadCount > 0 && <em aria-label={`${unreadCount} 条未读消息`}>{unreadCount > 99 ? '99+' : unreadCount}</em>}</span>
                  </span>
                </button>
                <button
                  className="character-profile-chip"
                  type="button"
                  onClick={() => openProfilePopover(character)}
                  aria-haspopup="dialog"
                  aria-expanded={profilePopoverCharacter?.id === character.id}
                  title="查看角色资料"
                >
                  <Database aria-hidden="true" size={13} />角色资料
                </button>
                <TrackingStar character={character} />
              </div>
            )
          })}
          <div aria-hidden="true" style={{ height: characterWindow.paddingBottom }} />
          {characterListMode === 'unread' && unreadDirectory.loading && <div className="character-empty">正在加载未读会话…</div>}
          {characterListMode === 'unread' && unreadDirectory.error && (
            <div className="character-empty" role="alert">
              {unreadDirectory.error}
              <button className="icon-button" type="button" onClick={unreadDirectory.retry} aria-label="重试加载未读角色" title="重试加载未读角色"><RefreshCw size={16} /></button>
            </div>
          )}
          {characterListMode === 'all' && directory.loading && visibleCharacters.length === 0 && <div className="character-empty">正在加载角色…</div>}
          {!(characterListMode === 'unread' ? unreadDirectory.loading || unreadDirectory.error : directory.loading) && displayedCharacters.length === 0 && (
            <div className="character-empty">
              {characterListMode === 'unread'
                ? '当前筛选条件下暂无未读消息'
                : directory.error || '数据库中暂无角色'}
            </div>
          )}
          {characterListMode === 'all' && !hasQueriedDirectory && directory.nextCursor !== null && (
            <button className="character-load-more" type="button" onClick={loadNextCharacters} disabled={directory.loading}>
              {directory.loading ? '正在加载更多…' : `继续向下滚动 (${visibleCharacters.length}/${directory.totalCount})`}
            </button>
          )}
        </div>
      </aside>

      {profilePopoverCharacter && (
        <div
          className="character-profile-popover-layer"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProfilePopoverCharacter(null)
          }}
        >
          <OfficialCharacterPanel
            character={profilePopoverCharacter}
            profile={profilePopover}
            state={profilePopoverState}
            error={profilePopoverError}
            collapsed={false}
            variant="popover"
            onClose={() => setProfilePopoverCharacter(null)}
            onCollapsedChange={() => setProfilePopoverCharacter(null)}
            onRetry={() => {
              officialProfileCache.current.delete(`${profilePopoverCharacter.serverKey}\u0000${profilePopoverCharacter.name}`)
              setProfilePopoverRefreshKey((value) => value + 1)
            }}
          />
        </div>
      )}

      <section className={`chat-pane${props.bulkProgress ? ' has-bulk-task' : ''}`}>
        {props.bulkProgress && (
          <div className="bulk-task-panel" role="region" aria-label="本次群发任务">
            <strong>{props.bulkSending ? '群发进行中' : '群发已暂停'} · {props.bulkProgress.agentName}</strong>
            <span>已提交 {props.bulkProgress.sentCount} / {props.bulkProgress.totalCount ?? '读取中'} 条
              {props.bulkProgress.remainingCount !== null && ` · 剩余 ${props.bulkProgress.remainingCount} 条`}</span>
            <p title={props.bulkProgress.content}>原文案：{props.bulkProgress.content || '逐人差异化文案'}</p>
            <small>继续使用本次名单和文案，跳过已提交的角色。进度仅保留在本页，刷新或关闭后无法恢复。</small>
            {props.bulkSending && <button type="button" className="secondary-button compact" onClick={props.onStopBulkSend}>暂停群发</button>}
            {!props.bulkSending && <div>
              <button type="button" className="primary-button compact" onClick={props.onResumeBulkSend}
                disabled={!canChat || props.bulkProgress.agentId !== props.agent.agentId}>继续群发</button>
              <button type="button" className="secondary-button compact" onClick={props.onDiscardBulkSend}>结束本次任务</button>
              {props.bulkProgress.agentId !== props.agent.agentId && <span>请切换到 {props.bulkProgress.agentName} 继续。</span>}
            </div>}
          </div>
        )}
        <header className="chat-header">
          {messageView === 'private' && recipientMode === 'all' ? (
            <>
              <span className="chat-agent-icon"><UsersRound aria-hidden="true" size={18} /></span>
              <div><h2>@全体</h2><p>当前筛选结果 · {directory.totalCount} 个收件人</p></div>
            </>
          ) : messageView === 'private' && props.selectedCharacter ? (
            <>
              <CharacterAvatar character={props.selectedCharacter} />
              <TrackingStar character={props.selectedCharacter} />
              <div><h2>{props.selectedCharacter.name}</h2><p>{props.selectedCharacter.serverName} · {props.selectedCharacter.className} Lv.{props.selectedCharacter.level} · ID {props.selectedCharacter.characterId}</p></div>
            </>
          ) : (
            <>
              <span className="chat-agent-icon"><Laptop aria-hidden="true" size={18} /></span>
              <div><h2>公频消息</h2><p>{props.agent.host || props.agent.agentId} · {publicMessages.length} 条实时消息</p></div>
            </>
          )}
          {openedFromPublic && messageView === 'private' && <button type="button" className="secondary-button compact" onClick={() => setMessageView('public')}><ArrowLeft size={14} aria-hidden="true" />返回公屏</button>}
          <div className="chat-view-tabs" role="tablist" aria-label="消息视图">
            <button
              className={messageView === 'private' ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={messageView === 'private'}
              disabled={recipientMode === 'single' && !props.selectedCharacter}
              onClick={() => setMessageView('private')}
            >{recipientMode === 'all' ? '群发' : '私聊'}</button>
            <button
              className={messageView === 'public' ? 'is-active' : ''}
              type="button"
              role="tab"
              aria-selected={messageView === 'public'}
              onClick={() => setMessageView('public')}
            >公频</button>
          </div>
          {messageView === 'private' && recipientMode === 'single' && props.selectedCharacter && (
            <div className="conversation-presence">
              <span className="conversation-presence-status" role="status">
                <span className={`presence-dot is-${currentPresence?.status || 'unknown'}`} aria-hidden="true" />
                {presenceLabel(currentPresence)}
              </span>
              <label>定时查询
                <select aria-label="当前角色在线查询间隔" value={presenceIntervalMs} onChange={event => setPresenceIntervalMs(Number(event.target.value))}>
                  <option value={0}>关闭</option>
                  <option value={30_000}>30 秒</option>
                  <option value={60_000}>60 秒</option>
                  <option value={120_000}>2 分钟</option>
                  <option value={300_000}>5 分钟</option>
                </select>
              </label>
              <small role="status">{currentPresenceMessage}</small>
              {currentQueryMessage && <small className={`current-query-feedback${currentQueryError ? ' is-error' : ''}`} role={currentQueryError ? 'alert' : 'status'}>{currentQueryMessage}</small>}
            </div>
          )}
        </header>

        {messageView === 'public' ? (
          <>
          <div className="chat-thread-viewport">
          <div className="chat-thread public-message-thread" aria-label="公屏消息记录" tabIndex={0} aria-live={publicScroll.paused ? 'off' : 'polite'} ref={publicThreadRef}>
            {publicMessages.length > 0 ? publicMessages.map((message) => {
              const channel = publicChatChannel(message)
              return (
                <article className={`game-chat-line is-${channel}`} key={message.id} data-chat-id={message.id}>
                  <div className="game-chat-heading">
                    <PublicSpeakerActions message={message}
                      onQuery={setProfilePopoverCharacter}
                      onAdded={() => { setQueriedDirectory(null); void directory.refresh() }}
                      onOpen={character => {
                        setOpenedFromPublic(true)
                        setOpenedConversation(JSON.stringify([props.agent.agentId, character.serverKey, character.characterId]))
                        props.onCharacterSelect(character)
                        setRecipientMode('single'); setMessageView('private'); setMobilePane('chat')
                      }} />
                    <span className="game-chat-meta">
                      <time dateTime={message.time}>{formatChatTimestamp(message.time)}</time>
                      <em>{publicChatChannelLabel(channel)}</em>
                    </span>
                  </div>
                  <p>{renderGameChatContent(message.content)}</p>
                </article>
              )
            }) : (
              <div className="chat-empty"><MessageSquareText aria-hidden="true" size={28} /><strong>暂无公频消息</strong><p>客户端发送到控制台的所有消息都会实时显示在这里。</p></div>
            )}
          </div>
          <ChatScrollNotice paused={publicScroll.paused} unread={publicScroll.unread} onLatest={publicScroll.jumpToLatest} />
          </div>
          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendFactionMessage() }}>
            <textarea aria-label="阵营消息" placeholder="发送到当前角色所在服务器的阵营频道"
              value={factionContent} onChange={(event) => setFactionContent(event.target.value)}
              disabled={!canChat || factionSending}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault(); void sendFactionMessage()
                }
              }} />
            <div>
              <span>{props.chatBlockMessage || '阵营频道 · Enter 发送 · Shift + Enter 换行'}</span>
              {factionFeedback && <p className="form-feedback" role="status">{factionFeedback}</p>}
              <button type="submit" className="primary-button compact" disabled={!canChat || !factionContent.trim() || factionSending}>
                <Send aria-hidden="true" size={16} />{factionSending ? '等待回执…' : '发送阵营消息'}
              </button>
            </div>
          </form>
          </>
        ) : recipientMode === 'all' ? (
          <>
            <div className="chat-thread" aria-live="polite">
              <div className="chat-empty broadcast-empty">
                <UsersRound aria-hidden="true" size={30} />
                <strong>@全体 · {directory.totalCount} 个角色</strong>
                <p>消息将发送给当前区服、军团和搜索条件匹配的全部角色。</p>
              </div>
            </div>
            <form className="chat-composer" onSubmit={submitMessage}>
              <textarea
                value={props.content}
                onChange={(event) => props.onContentChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (props.content.trim() && !props.bulkSending && !props.bulkProgress && directory.totalCount > 0 && canChat) props.onSendAll(directory.loadAll)
                  }
                }}
                placeholder={`发送给筛选结果中的 ${directory.totalCount} 个角色`}
                disabled={props.bulkSending || !props.canOperate}
              />
              <div>
                <label className="bulk-interval-field">
                  <span>群发间隔</span>
                  <input
                    type="number"
                    min={MIN_BULK_INTERVAL_MS}
                    max={MAX_BULK_INTERVAL_MS}
                    step={100}
                    value={props.bulkIntervalRangeMs.min}
                    onChange={(event) => props.onBulkIntervalRangeChange({ ...props.bulkIntervalRangeMs, min: event.target.valueAsNumber })}
                    disabled={props.bulkSending || !props.canOperate}
                    aria-label="群发间隔最小毫秒"
                  />
                  <em>至</em>
                  <input
                    type="number"
                    min={MIN_BULK_INTERVAL_MS}
                    max={MAX_BULK_INTERVAL_MS}
                    step={100}
                    value={props.bulkIntervalRangeMs.max}
                    onChange={(event) => props.onBulkIntervalRangeChange({ ...props.bulkIntervalRangeMs, max: event.target.valueAsNumber })}
                    disabled={props.bulkSending || !props.canOperate}
                    aria-label="群发间隔最大毫秒"
                  />
                  <em>毫秒</em>
                </label>
                <span>{props.chatBlockMessage ? '聊天封禁中，发送已暂停' : props.canOperate ? 'Ctrl / ⌘ + Enter 群发 · Enter 换行' : '客户端未连接，请等待连接恢复。'}</span>
                {props.actionMessage && <p className="form-feedback" role="status">{props.actionMessage}</p>}
                {props.bulkSending ? (
                  <button key="stop-bulk" className="secondary-button compact" type="button" onClick={(event) => {
                    event.preventDefault()
                    props.onStopBulkSend()
                  }}>
                    <Square aria-hidden="true" size={15} />停止群发
                  </button>
                ) : (
                  <button key="start-bulk" className="primary-button compact" type="submit" disabled={Boolean(props.bulkProgress) || !canChat || !props.content.trim() || directory.totalCount === 0}>
                    <Send aria-hidden="true" size={16} />发送给 {directory.totalCount} 人
                  </button>
                )}
              </div>
            </form>
          </>
        ) : props.selectedCharacter ? (
          <>
            <div className="chat-thread-viewport">
            <div className="chat-thread" aria-label="私聊消息记录" tabIndex={0} aria-live={privateScroll.paused ? 'off' : 'polite'} ref={privateThreadRef}>
              {historyCursor !== null && (
                <button className="history-load-more" type="button" onClick={() => { privateScroll.pause(); void loadOlderMessages() }} disabled={historyLoading}>
                  {historyLoading ? <LoaderCircle className="spin" aria-hidden="true" size={14} /> : null}
                  {historyLoading ? '正在加载' : '加载更早消息'}
                </button>
              )}
              {historyError && <p className="history-error" role="alert">{historyError}<button type="button" onClick={() => void retryHistory()} disabled={historyLoading}>重试</button></p>}
              {chronologicalMessages.length > 0 ? chronologicalMessages.map((message) => {
                const outgoing = message.direction === 'outgoing'
                const sendResult = outgoing && message.requestId ? sendResults.get(JSON.stringify([message.agentId, message.requestId])) : undefined
                return (
                  <article className={`chat-message${outgoing ? ' is-outgoing' : ''}`} key={message.id} data-chat-id={message.id}
                    data-incoming-ids={message.direction === 'incoming' ? JSON.stringify(message.sourceMessageIds) : undefined}>
                    {!outgoing && <CharacterAvatar character={props.selectedCharacter!} />}
                    <div>
                      <span className="chat-message-meta">{outgoing ? '我' : props.selectedCharacter!.name}<time dateTime={message.time}>{formatChatTimestamp(message.time)}</time></span>
                      <p>{message.content}</p>
                      {outgoing && message.requestId && (
                        <div className={`send-result ${!sendResult || sendResult.uncertain ? 'is-pending' : sendResult.ok ? 'is-success' : 'is-failed'}`} role="status">
                          {sendResult
                            ? sendResult.uncertain ? <CircleAlert aria-hidden="true" size={13} /> : sendResult.ok ? <Check aria-hidden="true" size={13} /> : <X aria-hidden="true" size={13} />
                            : <LoaderCircle className="spin" aria-hidden="true" size={12} />}
                          <span>{sendResult ? sendResult.uncertain ? '发送结果未确认' : sendResult.ok ? '发送成功' : '发送失败' : '等待发送结果'}</span>
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
            <ChatScrollNotice paused={privateScroll.paused} unread={privateScroll.unread} onLatest={privateScroll.jumpToLatest} />
            </div>

            <form className="chat-composer" onSubmit={submitMessage}>
              <textarea
                value={props.content}
                onChange={(event) => props.onContentChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    if (props.content.trim() && !props.bulkSending && canChat) { privateScroll.jumpToLatest(); props.onSend() }
                  }
                }}
                ref={privateComposerRef}
                placeholder={`发送消息给 ${props.selectedCharacter.name}`}
                disabled={props.bulkSending || !props.canOperate}
              />
              <div>
                <span>{props.chatBlockMessage ? '聊天封禁中，发送已暂停' : props.canOperate ? 'Enter 发送 · Shift + Enter 换行' : '客户端未连接，请等待连接恢复。'}</span>
                {props.actionMessage && <p className="form-feedback" role="status">{props.actionMessage}</p>}
                <button className="primary-button compact" type="submit" disabled={!canChat || !props.content.trim() || props.bulkSending}><Send aria-hidden="true" size={16} />发送</button>
              </div>
            </form>
          </>
        ) : (
          <div className="chat-empty"><MessageSquareText aria-hidden="true" size={28} /><strong>请选择游戏角色</strong><p>选择角色进入私聊，或切换到“公频”查看客户端全部消息。</p></div>
        )}
        </section>
        <div id="message-assistant-slot" className="message-assistant-slot" hidden={!assistantOpen}>
        <MessageAiAssistant
          onBusyChange={setAssistantBusy}
          managedControls={props.managedChat && <ManagedChatSetup controller={props.managedChat} canStart={Boolean(canChat && props.presenceConnected && props.agent.serverId)} selected={props.selectedCharacter} count={directory.totalCount}
            start={(scope, instruction, intervalMs, proactiveMs, reception) => {
              const selected = props.selectedCharacter
              void props.managedChat!.start({ agentId: props.agent.agentId, agentName: props.agent.host || props.agent.agentId,
                room: props.agent.room, serverId: props.agent.serverId || '', scope, instruction, intervalMs, proactiveMs, reception,
                label: scope === 'single' ? selected?.name || '当前会话' : `${selectedLegionLabel} · ${scope === 'online' ? '在线角色' : '全体成员'}`,
              }, async signal => {
                if (scope === 'single') return selected ? [selected] : []
                const characters = await directory.loadAll(signal)
                signal.throwIfAborted()
                if (scope === 'online') setQueriedDirectory({ key: presenceFilterKey, characters })
                return characters
              })
            }} />}
          key={JSON.stringify([props.agent.agentId, props.selectedCharacter?.serverKey, props.selectedCharacter?.characterId,
            props.selectedCharacter?.name, directory.selectedRaceId, directory.selectedServerKey,
            directory.selectedLegionName, directory.legionLeadersOnly, directory.chatStatus, directory.sort, directory.search.trim(), props.canOperate, props.operationKey])}
          agent={props.agent}
          selectedCharacter={props.selectedCharacter}
          recipientMode={recipientMode}
          selectedFilterLabel={selectedLegionLabel}
          recipientCount={directory.totalCount}
          content={props.content}
          chronologicalMessages={chronologicalMessages}
          publicMessages={publicMessages}
          bulkIntervalRangeMs={props.bulkIntervalRangeMs}
          onContentChange={props.onContentChange}
          onSendPrivateChat={props.onSendPrivateChat}
          onSendGroupChat={(options) => props.onSendAll(directory.loadAll, options)}
          onRecipientModeChange={setRecipientMode}
          onMessageViewChange={setMessageView}
        />
        </div>
      </section>
    </div>
  )
}

function MessageAiAssistant(props: {
  onBusyChange?: (busy: boolean) => void
  managedControls?: ReactNode
  agent: OnlineAgent
  selectedCharacter?: GameCharacter
  recipientMode: RecipientMode
  selectedFilterLabel: string
  recipientCount: number
  content: string
  chronologicalMessages: Array<{
    content: string
    direction: 'incoming' | 'outgoing' | 'system'
    requestId: string
    time: string
  }>
  publicMessages: ConsoleMessage[]
  bulkIntervalRangeMs: BulkIntervalRangeMs
  onContentChange: (value: string) => void
  onSendPrivateChat: (content: string, signal: AbortSignal) => Promise<CommandSendResult>
  onSendGroupChat: (options: BulkSendOptions) => Promise<BulkSendResult>
  onRecipientModeChange: (value: RecipientMode) => void
  onMessageViewChange: (value: MessageView) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const [interaction] = useState(() => new AiInteraction())
  const aiConnection = useMemo(() => interactiveAiConnection({ beforeRequest: () => interaction.beforeRequest() }), [interaction])
  const aiTools = useMemo(() => clientTools(
    setPrivateChatDraftDef.client((input, context) => {
      interaction.requireTool(context?.toolCallId, 'set_private_chat_draft')
      if (!props.selectedCharacter) {
        const message = '当前没有选中的私聊角色。'
        setNotice(message)
        return { applied: false, message }
      }
      props.onRecipientModeChange('single')
      props.onMessageViewChange('private')
      props.onContentChange(input.content)
      const message = `已填入给 ${props.selectedCharacter.name} 的私聊草稿。`
      setNotice(message)
      return { applied: true, message }
    }),
    sendPrivateChatDef.client((input, context) => {
      const run = interaction.requireTool(context?.toolCallId, 'send_private_chat')
      return run.once(JSON.stringify(['private', input.content.trim()]), async () => {
        if (!props.selectedCharacter) {
          const message = '当前没有选中的私聊角色。'
          setNotice(message)
          return { sent: false, status: 'not_sent' as const, message }
        }
        props.onRecipientModeChange('single')
        props.onMessageViewChange('private')
        props.onContentChange(input.content)
        const result = await props.onSendPrivateChat(input.content, run.signal)
        if (interaction.isCurrent(run)) setNotice(result.message)
        return result
      })
    }),
    setGroupChatDraftDef.client((input, context) => {
      interaction.requireTool(context?.toolCallId, 'set_group_chat_draft')
      props.onRecipientModeChange('all')
      props.onMessageViewChange('private')
      props.onContentChange(input.content)
      const message = props.recipientCount > 0
        ? `已填入 ${props.recipientCount} 个收件人的群发草稿。`
        : '已填入群发草稿，当前筛选结果为空。'
      setNotice(message)
      return { applied: true, message }
    }),
    sendGroupChatDef.client((input, context) => {
      const run = interaction.requireTool(context?.toolCallId, 'send_group_chat')
      return run.once(JSON.stringify(['group', input.content.trim(), input.variants]), async () => {
        props.onRecipientModeChange('all')
        props.onMessageViewChange('private')
        props.onContentChange(input.content)
        const messageForCharacter = createVariedBulkMessageFactory(input.content, input.variants)
        const result = await props.onSendGroupChat({ content: input.content, messageForCharacter, signal: run.signal, requireReceipts: true })
        if (interaction.isCurrent(run)) setNotice(result.message)
        return result
      })
    }),
  ), [
    props.onContentChange,
    props.onMessageViewChange,
    props.onRecipientModeChange,
    props.onSendGroupChat,
    props.onSendPrivateChat,
    props.recipientCount,
    props.selectedCharacter,
    interaction,
  ])
  const chat = useChat({
    threadId: 'aion2-message-ai',
    connection: aiConnection,
    tools: aiTools,
    queue: 'interrupt',
    onError: () => interaction.fail(),
    onChunk: chunk => { if (chunk.type === 'TOOL_CALL_START') interaction.registerTool(chunk.toolCallId, chunk.toolCallName) },
  })
  // Invalidate tools synchronously on scope unmount; SDK disposal is deferred.
  useLayoutEffect(() => () => interaction.stop(), [interaction])
  useEffect(() => () => chat.stop(), [chat.stop])
  const quickPrompts = useMemo(() => [
    props.selectedCharacter
      ? `根据最近聊天，帮我回复 ${props.selectedCharacter.name}`
      : '写一条自然的私聊开场白',
    props.content.trim() ? '润色当前输入内容' : '写一条简短礼貌的私聊内容',
    props.selectedCharacter
      ? `直接发送一条简短问候给 ${props.selectedCharacter.name}`
      : '选择角色后再让 AI 发送私聊',
    `给当前筛选的 ${props.recipientCount} 个角色自动群发一条通知`,
  ], [props.content, props.recipientCount, props.selectedCharacter])

  async function sendAiPrompt(value: string) {
    const content = value.trim()
    if (!content || chat.isLoading || interaction.active) return
    const run = interaction.begin()
    setPrompt(content)
    setNotice('')
    try {
      const recent = trimAiUiHistory(chat.messages, content)
      if (recent.length !== chat.messages.length) chat.setMessages(recent)
      await chat.sendMessage(content, {
        body: messageAiRequestContext(props),
      })
      // sendMessage resolves on streamed RUN_ERROR; catch alone misses it.
      if (!run.failed && interaction.isCurrent(run)) setPrompt('')
    } catch (caught) {
      if (interaction.isCurrent(run)) setNotice(aiErrorMessage(caught instanceof Error ? caught : new Error('AI 请求失败')))
    } finally {
      interaction.finish(run)
    }
  }

  useEffect(() => { props.onBusyChange?.(chat.isLoading) }, [chat.isLoading, props.onBusyChange])
  useEffect(() => () => props.onBusyChange?.(false), [props.onBusyChange])

  function submitPrompt(event: FormEvent) {
    event.preventDefault()
    void sendAiPrompt(prompt)
  }

  return (
    <aside className="console-ai-panel message-ai-panel" aria-label="AI 聊天助手">
      <header className="console-ai-header">
        <span><Sparkles aria-hidden="true" size={18} /></span>
        <div><h3>AI 聊天助手</h3><p>优先参考最近 12 轮 · 切换目标会重置对话</p></div>
        <small>{chat.isLoading ? '输出中' : chat.error ? 'AI 服务异常' : '就绪'}</small>
      </header>

      {props.managedControls}
      <div className="console-ai-thread" aria-live="polite">
        {chat.messages.length > 0 ? chat.messages.map((message) => (
          <ConsoleAiMessage message={message} key={message.id} />
        )) : (
          <div className="console-ai-empty">
            <MessageSquareText aria-hidden="true" size={28} />
            <strong>让 AI 自动处理聊天</strong>
            <div className="console-ai-prompts">
              {quickPrompts.map((item) => <button type="button" onClick={() => void sendAiPrompt(item)} disabled={chat.isLoading} key={item}>{item}</button>)}
            </div>
          </div>
        )}
      </div>

      {(chat.error || notice) && (
        <p className={`console-ai-feedback${chat.error ? ' is-error' : ''}`} role="status">
          {chat.error ? aiErrorMessage(chat.error) : notice}
        </p>
      )}

      <form className="console-ai-composer" onSubmit={submitPrompt}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void sendAiPrompt(prompt)
            }
          }}
          placeholder="让 AI 写消息、私聊发送、自动群发或润色当前内容"
          disabled={chat.isLoading}
        />
        <div>
          <button className="secondary-button" type="button" onClick={() => {
            interaction.stop()
            chat.stop()
            chat.clear()
            setPrompt('')
            setNotice('')
          }} disabled={chat.messages.length === 0 && !prompt}><Eraser aria-hidden="true" size={15} />清空</button>
          {chat.isLoading ? (
            <button key="stop" className="secondary-button" type="button" onClick={event => { event.preventDefault(); interaction.stop(); chat.stop() }}><Square aria-hidden="true" size={14} />停止</button>
          ) : (
            <button key="send" className="primary-button compact" type="submit" disabled={!prompt.trim()}><Sparkles aria-hidden="true" size={15} />询问 AI</button>
          )}
        </div>
      </form>
    </aside>
  )
}

function OfficialCharacterPanel({
  character,
  profile,
  state,
  error,
  collapsed,
  variant = 'panel',
  onClose,
  onCollapsedChange,
  onRetry,
}: {
  character?: GameCharacter
  profile: OfficialCharacterProfile | null
  state: OfficialProfileState
  error: string
  collapsed: boolean
  variant?: 'panel' | 'popover'
  onClose?: () => void
  onCollapsedChange: (value: boolean) => void
  onRetry: () => void
}) {
  const [profileTab, setProfileTab] = useState<'overview' | 'equipment' | 'skills'>('overview')
  useEffect(() => setProfileTab('overview'), [profile?.characterId])
  const summary = profile
    ? `${profile.name} · Lv. ${profile.level} · ${aion2ServerName(profile.serverId) || profile.serverName}`
    : character
      ? `${character.name} · ${character.serverName}`
      : '未选择角色'

  return (
    <aside
      className={`data-panel official-profile-panel${collapsed ? ' is-collapsed' : ''}${variant === 'popover' ? ' official-profile-popover-panel' : ''}`}
      aria-label="NCSoft 官网角色资料"
      role={variant === 'popover' ? 'dialog' : undefined}
      aria-modal={variant === 'popover' ? 'false' : undefined}
    >
      <header className="official-profile-header">
        <span className="official-profile-mark"><Search aria-hidden="true" size={17} /></span>
        <div><h3>官网角色资料</h3><p>NCSoft 角色资讯室</p></div>
        {variant === 'popover' ? (
          <button
            className="icon-button official-profile-toggle"
            type="button"
            onClick={onClose}
            aria-label="关闭角色资料"
            title="关闭"
          >
            <X aria-hidden="true" size={16} />
          </button>
        ) : (
          <button
            className="icon-button official-profile-toggle"
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? '展开官网角色资料' : '折叠官网角色资料'}
            title={collapsed ? '展开' : '折叠'}
          >
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        )}
      </header>

      {collapsed ? (
        <button className="official-profile-collapsed" type="button" onClick={() => onCollapsedChange(false)}>
          <strong>{summary}</strong>
          <span>{state === 'loading' ? '正在查询' : profile ? '点击展开查看装备、技能和属性' : '点击展开查看官网资料'}</span>
        </button>
      ) : !character || state === 'idle' ? (
        <div className="official-profile-empty">
          <Database aria-hidden="true" size={27} />
          <strong>尚未选择角色</strong>
        </div>
      ) : state === 'loading' ? (
        <div className="official-profile-empty">
          <LoaderCircle className="spin" aria-hidden="true" size={27} />
          <strong>正在查询 {character.name}</strong>
          <span>{character.serverName}</span>
        </div>
      ) : state === 'error' ? (
        <div className="official-profile-empty is-error">
          <CircleAlert aria-hidden="true" size={27} />
          <strong>官网查询失败</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw aria-hidden="true" size={15} />重新查询</button>
        </div>
      ) : state === 'not-found' || !profile ? (
        <div className="official-profile-empty">
          <Search aria-hidden="true" size={27} />
          <strong>官网未找到该角色</strong>
          <span>{character.name} · {character.serverName}</span>
          <button className="secondary-button" type="button" onClick={onRetry}><RefreshCw aria-hidden="true" size={15} />重新查询</button>
        </div>
      ) : (
        <div className="official-profile-content">
          {profile.warnings?.map(warning => <p role="status" key={warning}>{warning}</p>)}
          <div className="official-profile-identity">
            <div className="official-profile-portrait">
              {profile.profileImageUrl
                ? <img src={profile.profileImageUrl} alt={`${profile.name} 的官网头像`} />
                : <span style={{ backgroundColor: character.avatarColor }}>{profile.name.slice(0, 1)}</span>}
            </div>
            <div>
              <span className="official-source">AION2 OFFICIAL</span>
              <h2>{profile.name}</h2>
              <p>{aion2ServerName(profile.serverId) || profile.serverName} · {profile.raceName || formatFaction(String(profile.race))} · {profile.className || character.className}</p>
              <span className="official-level">Lv. {profile.level}</span>
              {profile.titleName && <span className="official-title">{profile.titleName}</span>}
            </div>
          </div>

          <div className="official-profile-tabs" role="tablist" aria-label="官网角色资料视图">
            <button className={profileTab === 'overview' ? 'is-active' : ''} type="button" role="tab" aria-selected={profileTab === 'overview'} onClick={() => setProfileTab('overview')}>概览</button>
            <button className={profileTab === 'equipment' ? 'is-active' : ''} type="button" role="tab" aria-selected={profileTab === 'equipment'} onClick={() => setProfileTab('equipment')}>装备</button>
            <button className={profileTab === 'skills' ? 'is-active' : ''} type="button" role="tab" aria-selected={profileTab === 'skills'} onClick={() => setProfileTab('skills')}>技能</button>
          </div>

          {profileTab === 'overview' && (
            <div className="official-tab-content">
              <div className="official-summary-metrics">
                <div><span>战斗力</span><strong>{formatNumber(profile.combatPower)}</strong></div>
                <div><span>道具等级</span><strong>{formatNumber(profile.itemLevel)}</strong></div>
                <div><span>称号收集</span><strong>{profile.titles.ownedCount} / {profile.titles.totalCount}</strong></div>
              </div>

              <section className="official-profile-section">
                <h4>角色资料</h4>
                <dl className="official-profile-fields">
                  <div><dt>角色名</dt><dd>{profile.name}</dd></div>
                  <div><dt>等级</dt><dd>{profile.level}</dd></div>
                  <div><dt>区服</dt><dd>{aion2ServerName(profile.serverId) || profile.serverName} · {profile.serverId}</dd></div>
                  <div><dt>区服 ID</dt><dd>{profile.serverId}</dd></div>
                  <div><dt>阵营</dt><dd>{profile.raceName || formatFaction(String(profile.race))}</dd></div>
                  <div><dt>职业</dt><dd>{profile.className || character.className || `编号 ${profile.pcId}`}</dd></div>
                  <div><dt>性别</dt><dd>{profile.genderName || '—'}</dd></div>
                  <div><dt>地区</dt><dd>{profile.region || '—'}</dd></div>
                </dl>
              </section>

              {profile.stats.length > 0 && (
                <section className="official-profile-section">
                  <h4>角色属性</h4>
                  <div className="official-stat-list">
                    {profile.stats.filter((stat) => stat.type !== 'ItemLevel').map((stat) => (
                      <div key={stat.type}>
                        <span>{stat.name}</span>
                        <strong>{formatNumber(stat.value)}</strong>
                        {stat.details.length > 0 && <small>{stat.details.join(' · ')}</small>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {profile.daevanion.length > 0 && (
                <section className="official-profile-section">
                  <h4>守护神板</h4>
                  <div className="official-board-list">
                    {profile.daevanion.map((board) => {
                      const progress = board.totalNodeCount > 0 ? Math.round(board.openNodeCount / board.totalNodeCount * 100) : 0
                      return (
                        <div key={board.id}>
                          <img src={board.icon} alt="" />
                          <span><strong>{board.name}</strong><small>{board.openNodeCount} / {board.totalNodeCount}</small></span>
                          <i><b style={{ width: `${progress}%` }} /></i>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section className="official-profile-section local-snapshot">
                <h4>本地数据库</h4>
                <dl className="official-profile-fields">
                  <div><dt>Character ID</dt><dd><code>{character.characterId}</code></dd></div>
                  <div><dt>军团</dt><dd>{character.legionName || '未加入军团'}</dd></div>
                  <div><dt>最后采集</dt><dd>{formatDatabaseTime(character.lastSeenAt)}</dd></div>
                </dl>
              </section>
            </div>
          )}

          {profileTab === 'equipment' && (
            <div className="official-tab-content">
              {(profile.pet || profile.wing) && (
                <section className="official-profile-section companion-section">
                  <h4>宠物与翅膀</h4>
                  <div className="official-companions">
                    {profile.pet && <OfficialAssetItem icon={profile.pet.icon} name={profile.pet.name} detail={`Lv. ${profile.pet.level}`} />}
                    {profile.wing && <OfficialAssetItem icon={profile.wing.icon} name={profile.wing.name} detail={`${officialGradeLabel(profile.wing.grade)}${profile.wing.enchantLevel ? ` · +${profile.wing.enchantLevel}` : ''}`} />}
                  </div>
                </section>
              )}
              <section className="official-profile-section">
                <h4>当前装备 · {profile.equipment.length}</h4>
                {profile.equipment.length > 0 ? (
                  <div className="official-asset-grid">
                    {profile.equipment.map((item) => (
                      <OfficialAssetItem
                        key={`${item.slot}:${item.id}`}
                        icon={item.icon}
                        name={item.name}
                        grade={item.grade}
                        detail={`${officialSlotLabel(item.slot)}${item.enchantLevel ? ` · +${item.enchantLevel}` : ''}`}
                      />
                    ))}
                  </div>
                ) : <p className="official-section-empty">官网未公开装备资料</p>}
              </section>
            </div>
          )}

          {profileTab === 'skills' && (
            <div className="official-tab-content">
              <section className="official-profile-section">
                <h4>技能 · {profile.skills.length}</h4>
                {profile.skills.length > 0 ? (
                  <div className="official-skill-list">
                    {profile.skills.map((skillItem) => (
                      <div className={skillItem.acquired ? '' : 'is-locked'} key={skillItem.id}>
                        <img src={skillItem.icon} alt="" />
                        <span><strong>{skillItem.name}</strong><small>{skillCategoryLabel(skillItem.category)} · Lv. {skillItem.skillLevel || skillItem.needLevel}</small></span>
                        <em>{skillItem.equipped ? '已装备' : skillItem.acquired ? '已习得' : `${skillItem.needLevel}级`}</em>
                      </div>
                    ))}
                  </div>
                ) : <p className="official-section-empty">官网未公开技能资料</p>}
              </section>
            </div>
          )}

          <footer className="official-profile-footer">
            <code title={profile.characterId}>{profile.characterId}</code>
            <a className="primary-button official-profile-link" href={profile.profileUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" size={16} />查看角色页面
            </a>
          </footer>
        </div>
      )}
    </aside>
  )
}

function OfficialAssetItem({
  icon,
  name,
  detail,
  grade = '',
}: {
  icon: string
  name: string
  detail: string
  grade?: string
}) {
  return (
    <div className="official-asset-item" data-grade={grade.toLowerCase()}>
      <span>{icon ? <img src={icon} alt="" /> : name.slice(0, 1)}</span>
      <div><strong>{name}</strong><small>{detail}</small></div>
      {grade && <em>{officialGradeLabel(grade)}</em>}
    </div>
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
  onAgentChange: (value: string) => void | Promise<void>
  onCommandChange: (value: string) => void
  onSend: () => void
  onQuickCommand: (type: string) => void
}) {
  const selectedAgent = props.agents.find((agent) => agent.agentId === props.selectedAgentId)
  const canOperate = Boolean(selectedAgent)

  return (
    <div className="command-page">
      <section className="page-intro"><p className="eyebrow">REMOTE CONTROL</p><h2>客户端控制台</h2><p>通过 MQTT 向指定在线客户端发送控制命令。</p></section>
      <div className="command-workbench">
        <section className="data-panel command-panel">
          <div className="field-row"><label><span>目标客户端</span><select value={props.selectedAgentId} onChange={(event) => void props.onAgentChange(event.target.value)}><option value="">请选择在线客户端</option>{props.agents.map((agent) => {
            const label = `${agent.host || agent.agentId} · ${serverNameForAgent(agent, props.serverNames)}${agent.serverId ? ` (ID ${agent.serverId})` : ''}`
            return <option value={agent.agentId} key={agent.agentId}>{label}</option>
          })}</select></label></div>
          <div className="quick-actions"><span>快捷命令</span><button type="button" onClick={() => props.onQuickCommand('ping')}>Ping</button><button type="button" onClick={() => props.onQuickCommand('requestStatus')}>请求状态</button></div>
          <label className="code-field"><span>JSON 命令</span><textarea spellCheck={false} value={props.commandText} onChange={(event) => props.onCommandChange(event.target.value)} /></label>
          {props.actionMessage && <p className="form-feedback" role="status">{props.actionMessage}</p>}
          <button className="primary-button compact" type="button" onClick={props.onSend} disabled={!props.selectedAgentId || !canOperate}><Terminal aria-hidden="true" size={16} />发送控制命令</button>
        </section>
        <ConsoleAiAssistant
          key={JSON.stringify([props.selectedAgentId, selectedAgent?.serverId])}
          agents={props.agents}
          commandText={props.commandText}
          selectedAgent={selectedAgent}
          serverNames={props.serverNames}
          onApplyCommand={props.onCommandChange}
        />
      </div>
    </div>
  )
}

function ConsoleAiAssistant(props: {
  agents: OnlineAgent[]
  selectedAgent?: OnlineAgent
  serverNames: ReadonlyMap<string, string>
  commandText: string
  onApplyCommand: (value: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const [interaction] = useState(() => new AiInteraction())
  const aiConnection = useMemo(() => interactiveAiConnection({ beforeRequest: () => interaction.beforeRequest() }), [interaction])
  const aiTools = useMemo(() => clientTools(
    setControlCommandDraftDef.client((input, context) => {
      interaction.requireTool(context?.toolCallId, 'set_control_command_draft')
      props.onApplyCommand(JSON.stringify(input.command, null, 2))
      setNotice('已填入 JSON 命令。')
      return { applied: true, message: '已填入控制命令草稿。' }
    }),
  ), [props.onApplyCommand, interaction])
  const chat = useChat({
    threadId: 'aion2-console-ai',
    connection: aiConnection,
    tools: aiTools,
    queue: 'interrupt',
    onError: () => interaction.fail(),
    onChunk: chunk => { if (chunk.type === 'TOOL_CALL_START') interaction.registerTool(chunk.toolCallId, chunk.toolCallName) },
  })
  useLayoutEffect(() => () => interaction.stop(), [interaction])
  useEffect(() => () => chat.stop(), [chat.stop])
  const quickPrompts = useMemo(() => [
    '检查当前 JSON 命令是否可以发送',
    '生成一个 requestStatus 命令',
    props.selectedAgent
      ? `给 ${props.selectedAgent.host || props.selectedAgent.agentId} 生成 ping 命令`
      : '生成一个 ping 命令',
  ], [props.selectedAgent])

  async function sendAiPrompt(value: string) {
    const content = value.trim()
    if (!content || chat.isLoading || interaction.active) return
    const run = interaction.begin()
    setPrompt(content)
    setNotice('')
    try {
      const recent = trimAiUiHistory(chat.messages, content)
      if (recent.length !== chat.messages.length) chat.setMessages(recent)
      await chat.sendMessage(content, {
        body: consoleAiRequestContext(props),
      })
      if (!run.failed && interaction.isCurrent(run)) setPrompt('')
    } catch (caught) {
      if (interaction.isCurrent(run)) setNotice(aiErrorMessage(caught instanceof Error ? caught : new Error('AI 请求失败')))
    } finally {
      interaction.finish(run)
    }
  }

  function submitPrompt(event: FormEvent) {
    event.preventDefault()
    void sendAiPrompt(prompt)
  }

  function applyCommand(value: string) {
    props.onApplyCommand(value)
    setNotice('已填入 JSON 命令。')
  }

  return (
    <section className="data-panel console-ai-panel">
      <header className="console-ai-header">
        <span><Bot aria-hidden="true" size={18} /></span>
        <div><h3>TanStack AI</h3><p>OpenRouter · DeepSeek · 优先参考最近 12 轮</p></div>
        <small>{chat.isLoading ? '输出中' : chat.error ? 'AI 服务异常' : '就绪'}</small>
      </header>

      <div className="console-ai-thread" aria-live="polite">
        {chat.messages.length > 0 ? chat.messages.map((message) => (
          <ConsoleAiMessage message={message} onApplyCommand={applyCommand} key={message.id} />
        )) : (
          <div className="console-ai-empty">
            <Bot aria-hidden="true" size={28} />
            <strong>AI 命令助手</strong>
            <div className="console-ai-prompts">
              {quickPrompts.map((item) => <button type="button" onClick={() => void sendAiPrompt(item)} disabled={chat.isLoading} key={item}>{item}</button>)}
            </div>
          </div>
        )}
      </div>

      {(chat.error || notice) && (
        <p className={`console-ai-feedback${chat.error ? ' is-error' : ''}`} role="status">
          {chat.error ? aiErrorMessage(chat.error) : notice}
        </p>
      )}

      <form className="console-ai-composer" onSubmit={submitPrompt}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void sendAiPrompt(prompt)
            }
          }}
          placeholder="让 AI 生成、检查或解释控制命令"
          disabled={chat.isLoading}
        />
        <div>
          <button className="secondary-button" type="button" onClick={() => {
            interaction.stop()
            chat.stop()
            chat.clear()
            setPrompt('')
            setNotice('')
          }} disabled={chat.messages.length === 0 && !prompt}><Eraser aria-hidden="true" size={15} />清空</button>
          {chat.isLoading ? (
            <button key="stop" className="secondary-button" type="button" onClick={event => { event.preventDefault(); interaction.stop(); chat.stop() }}><Square aria-hidden="true" size={14} />停止</button>
          ) : (
            <button key="send" className="primary-button compact" type="submit" disabled={!prompt.trim()}><Sparkles aria-hidden="true" size={15} />询问 AI</button>
          )}
        </div>
      </form>
    </section>
  )
}

function ConsoleAiMessage({
  message,
  onApplyCommand,
}: {
  message: UIMessage
  onApplyCommand?: (value: string) => void
}) {
  const messageText = consoleAiMessageText(message)
  const jsonCommand = message.role === 'assistant' && onApplyCommand ? extractJsonCommand(messageText) : ''

  if (!message.parts.some(part => (part.type === 'text' || part.type === 'thinking')
    ? Boolean(part.content) : part.type === 'tool-call' || part.type === 'tool-result')) return null

  return (
    <article className={`console-ai-message is-${message.role}`}>
      <span>{message.role === 'user' ? '你' : 'AI'}</span>
      <div>
        {message.parts.map((part, index) => {
          if (part.type === 'text' && part.content) return <p key={index}>{part.content}</p>
          if (part.type === 'thinking' && part.content) {
            return <details key={index}><summary>推理</summary><pre>{part.content}</pre></details>
          }
          if (part.type === 'tool-call') {
            return <small key={part.id}>工具调用：{part.name} · {part.state}{part.output ? ` · ${consoleAiToolOutputText(part.output)}` : ''}</small>
          }
          if (part.type === 'tool-result') {
            return <small key={part.toolCallId}>工具结果：{part.name || part.toolCallId} · {part.state}</small>
          }
          return null
        })}
        {jsonCommand && onApplyCommand && (
          <button className="secondary-button console-ai-apply" type="button" onClick={() => onApplyCommand(jsonCommand)}>
            <Copy aria-hidden="true" size={14} />填入命令
          </button>
        )}
      </div>
    </article>
  )
}

function consoleAiRequestContext({
  agents,
  selectedAgent,
  serverNames,
  commandText,
}: {
  agents: OnlineAgent[]
  selectedAgent?: OnlineAgent
  serverNames: ReadonlyMap<string, string>
  commandText: string
}) {
  return {
    surface: 'control-console',
    selectedAgent: selectedAgent ? consoleAiAgentContext(selectedAgent, serverNames) : null,
    onlineAgents: agents.slice(0, 30).map((agent) => consoleAiAgentContext(agent, serverNames)),
    commandText: trimConsoleAiContext(commandText, 6_000),
  }
}

function messageAiRequestContext({
  agent,
  selectedCharacter,
  recipientMode,
  selectedFilterLabel,
  recipientCount,
  content,
  chronologicalMessages,
  publicMessages,
  bulkIntervalRangeMs,
}: {
  agent: OnlineAgent
  selectedCharacter?: GameCharacter
  recipientMode: RecipientMode
  selectedFilterLabel: string
  recipientCount: number
  content: string
  chronologicalMessages: Array<{
    content: string
    direction: 'incoming' | 'outgoing' | 'system'
    requestId: string
    time: string
  }>
  publicMessages: ConsoleMessage[]
  bulkIntervalRangeMs: BulkIntervalRangeMs
}) {
  return {
    surface: 'messages',
    agent: {
      agentId: agent.agentId,
      host: agent.host,
      room: agent.room,
      serverId: agent.serverId,
      status: agent.status,
    },
    mode: recipientMode,
    selectedCharacter: selectedCharacter ? {
      characterId: selectedCharacter.characterId,
      serverKey: selectedCharacter.serverKey,
      name: selectedCharacter.name,
      serverName: selectedCharacter.serverName,
      className: selectedCharacter.className,
      level: selectedCharacter.level,
      legionName: selectedCharacter.legionName,
    } : null,
    groupRecipients: {
      filterLabel: selectedFilterLabel,
      count: recipientCount,
      intervalMs: normalizeBulkIntervalRangeMs(bulkIntervalRangeMs),
    },
    draftContent: trimConsoleAiContext(content, 3_000),
    recentPrivateMessages: chronologicalMessages.slice(-12).map((message) => ({
      direction: message.direction,
      content: trimConsoleAiContext(message.content, 600),
      time: message.time,
    })),
    recentPublicMessages: publicMessages.slice(-10).map((message) => ({
      title: message.title,
      type: message.type,
      content: trimConsoleAiContext(message.content, 600),
      time: message.time,
    })),
  }
}

function consoleAiAgentContext(agent: OnlineAgent, serverNames: ReadonlyMap<string, string>) {
  return {
    agentId: agent.agentId,
    host: agent.host,
    room: agent.room,
    serverId: agent.serverId,
    serverName: serverNameForAgent(agent, serverNames),
    status: agent.status,
    startedAt: agent.startedAt,
    time: agent.time,
    lastSeenAt: agent.lastSeenAt,
  }
}

function trimConsoleAiContext(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value
}

function consoleAiMessageText(message: UIMessage) {
  return message.parts
    .map((part) => part.type === 'text' ? part.content : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function consoleAiToolOutputText(value: unknown) {
  if (!isRecord(value)) return ''
  return textValue(value.message) || (value.applied === true ? '已应用' : '')
}

function extractJsonCommand(value: string) {
  const codeBlocks = [...value.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (const match of codeBlocks) {
    const normalized = normalizeJsonCommand(match[1])
    if (normalized) return normalized
  }

  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return normalizeJsonCommand(value.slice(firstBrace, lastBrace + 1))
  return ''
}

function normalizeJsonCommand(value: string) {
  try {
    const parsed = JSON.parse(value.trim())
    return isRecord(parsed) ? JSON.stringify(parsed, null, 2) : ''
  } catch {
    return ''
  }
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
        <div className="settings-note"><CircleAlert aria-hidden="true" size={18} /><p><strong>默认使用私有消息服务</strong><span>登录后自动获取连接凭据。客户端需要使用同一私有实例的 MQTT 账号；管理 API 密钥不能用于客户端连接。</span></p></div>
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

type PublicChatChannel = 'faction' | 'normal' | 'system' | 'party' | 'guild' | 'whisper' | 'shout'

function publicChatChannel(message: ConsoleMessage): PublicChatChannel {
  const raw = message.raw
  const payload = isRecord(raw.payload) ? raw.payload : raw
  const data = isRecord(payload.jsonData) ? payload.jsonData : {}
  const meta = isRecord(raw.chat_meta) ? raw.chat_meta : {}
  const room = isRecord(data.gameRoomKeyInfo) ? data.gameRoomKeyInfo : {}
  const values = [
    meta.kind, meta.roomType, meta.type, meta.subType, payload.kind, payload.roomType,
    payload.type, payload.subType, data.kind, data.roomType, data.type, data.subType,
    room.type, room.subType,
  ].map(textValue).join(' ').toLowerCase()

  if (/system|notice|announce|admin/.test(values)) return 'system'
  if (/party|group/.test(values)) return 'party'
  if (/guild|legion/.test(values)) return 'guild'
  if (/whisper|private|one_on_one|direct/.test(values)) return 'whisper'
  if (/shout|yell/.test(values)) return 'shout'
  if (/faction|race|world|publish/.test(values)) return 'faction'
  return 'normal'
}

function publicChatChannelLabel(channel: PublicChatChannel) {
  return ({
    faction: '阵营', normal: '普通', system: '系统', party: '队伍',
    guild: '军团', whisper: '私聊', shout: '呐喊',
  } satisfies Record<PublicChatChannel, string>)[channel]
}

function renderGameChatContent(content: string) {
  return content.split(/(\[[^\]\r\n]+\])/g).map((part, index) => /^\[[^\]\r\n]+\]$/.test(part)
    ? <span className="game-chat-item-link" key={`${index}:${part}`}>{part}</span>
    : part)
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
  if (message.type === 'chat_message' && isOutgoingChatPayload(message.raw)) {
    return {
      characterId: textValue(
        target.characterId
        || meta.receiverCharacterId
        || meta.targetCharacterId
        || data.receiverCharacterId
        || data.targetCharacterId
        || data.receiverPlayNcCharId
        || data.targetPlayNcCharId
        || payload.characterId,
      ),
      serverKey: textValue(
        payload.serverKey
        || target.serverKey
        || meta.receiverServerId
        || data.receiverServerId
        || payload.receiverServerId
        || meta.serverId
        || data.serverId,
      ),
      targetName: textValue(
        target.targetName
        || meta.receiver
        || data.receiverUserName
        || data.targetUserName
        || data.targetName
        || payload.targetName,
      ),
    }
  }
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
  const uncertain = message.raw.status === 'unknown'
  const ok = !uncertain && message.raw.ok === true
  if (ok) return { ok: true, detail: '' }
  const status = textValue(result.status)
  const error = printableResultValue(result.error || message.raw.error)
  const response = printableResultValue(result.response)
  const detail = [status ? `HTTP ${status}` : '', error, response].filter(Boolean).join(' · ')
  return { ok: false, uncertain, detail: detail || (uncertain ? '发送结果未确认，请核对聊天记录，不要自动重发。' : '客户端未返回失败原因') }
}

function chatUploadFromConsoleMessage(message: ConsoleMessage, targetName: string): ChatMessageUpload {
  const direction = messageDirection(message)
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
      ? controlResult.uncertain ? 'pending' : controlResult.ok ? 'delivered' : 'failed'
      : direction === 'incoming' ? 'received' : direction === 'outgoing' ? 'sent' : 'delivered',
    errorMessage: controlResult && !controlResult.ok ? controlResult.detail : undefined,
    raw: message.raw,
    sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(),
  }
}

function messageBelongsToCharacter(message: ConsoleMessage, character: GameCharacter) {
  if (message.type === 'chat_message' && !isPrivateChatPayload(message.raw)) return false
  const target = whisperTargetFromMessage(message)
  return targetMatchesCharacter(target, character)
}

function messageDirection(message: ConsoleMessage): 'incoming' | 'outgoing' | 'system' {
  if (message.type === 'control_sent') return 'outgoing'
  if (message.type.startsWith('control_')) return 'system'
  return isOutgoingChatPayload(message.raw) ? 'outgoing' : 'incoming'
}

function isUnreadIncomingMessage(message: ConsoleMessage, readMessageIds: ReadonlySet<string>) {
  return isIncomingCharacterReply(message) && !readMessageIds.has(message.id)
}

function formatBadgeCount(count: number) {
  return count > 99 ? '99+' : String(count)
}

function presenceTargets(characters: GameCharacter[]) {
  return characters.filter(character => character.serverKey && character.characterId).map(character => ({
    serverId: character.serverKey, characterId: character.characterId, name: character.name,
  }))
}

function presenceKey(serverId: string, characterId: string) {
  return `${serverId}\u0000${characterId}`
}

function presenceLabel(presence?: CharacterPresence) {
  if (!presence || presence.status === 'unknown') return '在线状态未知'
  const checkedAt = presence.checkedAt ? formatClock(new Date(presence.checkedAt).toISOString()) : ''
  if (presence.status === 'stale') {
    const previous = presence.online === true ? '上次在线' : presence.online === false ? '上次离线' : '上次状态未知'
    return `在线状态已过期（${previous}）${checkedAt ? `，查询时间 ${checkedAt}` : ''}`
  }
  return `${presence.status === 'online' ? '在线' : '离线'}${checkedAt ? ` · ${checkedAt}` : ''}`
}

function delay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', finish, { once: true })

    function finish() {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
  })
}

function createVariedBulkMessageFactory(coreContent: string, variants: string[] = []) {
  const bases = normalizeBulkMessageVariants(coreContent, variants)
  const usedMessages = new Set<string>()
  return (character: GameCharacter, index: number) => {
    const base = bases[index % bases.length]
    let content = personalizeBulkMessage(base, character, index)
    let attempt = 0
    while (usedMessages.has(content)) {
      attempt += 1
      content = personalizeBulkMessage(bases[(index + attempt) % bases.length], character, index + attempt)
      if (attempt > bases.length + VARIED_BULK_OPENERS.length + VARIED_BULK_CLOSINGS.length) {
        content = `${character.name}，${base}（${character.serverName || character.serverKey}）`
        break
      }
    }
    usedMessages.add(content)
    return content
  }
}

function normalizeBulkMessageVariants(coreContent: string, variants: string[]) {
  const normalized = [coreContent, ...variants]
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(normalized)].length > 0 ? [...new Set(normalized)] : [coreContent.trim()]
}

const VARIED_BULK_OPENERS = [
  '{name}，',
  '{name}你好，',
  '嗨，{name}，',
  '{name}，这边同步一下：',
  '{name}，提醒你一下，',
  '给{name}同步一下：',
]

const VARIED_BULK_CLOSINGS = [
  '',
  '谢谢。',
  '辛苦了。',
  '先同步给你。',
  '这边通知你一下。',
  '方便时看一下。',
]

function personalizeBulkMessage(base: string, character: GameCharacter, index: number) {
  const tokenized = base
    .replaceAll('{{name}}', character.name)
    .replaceAll('{name}', character.name)
    .replaceAll('{{server}}', character.serverName || character.serverKey)
    .replaceAll('{server}', character.serverName || character.serverKey)
  if (tokenized !== base) return normalizeChatSentence(tokenized)

  const opener = VARIED_BULK_OPENERS[index % VARIED_BULK_OPENERS.length].replaceAll('{name}', character.name)
  const closing = VARIED_BULK_CLOSINGS[Math.floor(index / VARIED_BULK_OPENERS.length) % VARIED_BULK_CLOSINGS.length]
  const body = stripLeadingSentencePunctuation(base)
  return normalizeChatSentence(`${opener}${body}${closing ? ` ${closing}` : ''}`)
}

function stripLeadingSentencePunctuation(value: string) {
  return value.trim().replace(/^[,，。.!！?？:：;；\s]+/, '')
}

function normalizeChatSentence(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim()
}

function normalizeBulkIntervalRangeMs(value: BulkIntervalRangeMs): BulkIntervalRangeMs {
  const min = normalizeBulkIntervalEndpointMs(value.min, DEFAULT_BULK_INTERVAL_RANGE_MS.min)
  const max = normalizeBulkIntervalEndpointMs(value.max, DEFAULT_BULK_INTERVAL_RANGE_MS.max)
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  }
}

function normalizeBulkIntervalEndpointMs(value: number, fallback: number) {
  const milliseconds = Number.isFinite(value) ? value : fallback
  return Math.min(MAX_BULK_INTERVAL_MS, Math.max(MIN_BULK_INTERVAL_MS, Math.round(milliseconds)))
}

function randomBulkIntervalMs(range: BulkIntervalRangeMs) {
  const normalized = normalizeBulkIntervalRangeMs(range)
  return normalized.min + Math.floor(Math.random() * (normalized.max - normalized.min + 1))
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

function formatChatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function relativeTime(value: string | number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 2) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function formatDatabaseTime(value: number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFaction(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'elyos' || normalized === '天族') return '天族'
  if (normalized === '2' || normalized === 'asmodian' || normalized === '魔族') return '魔族'
  return value || '—'
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

function officialGradeLabel(value: string) {
  const labels: Record<string, string> = {
    Common: '普通',
    Rare: '稀有',
    Epic: '英雄',
    Unique: '唯一',
    Legendary: '传说',
    Mythic: '神话',
  }
  return labels[value] || value || '—'
}

function officialSlotLabel(value: string) {
  const labels: Record<string, string> = {
    MainHand: '主手',
    SubHand: '副手',
    Helmet: '头部',
    Shoulder: '肩部',
    Torso: '上衣',
    Pants: '下装',
    Gloves: '手套',
    Boots: '鞋子',
    Cape: '披风',
    Belt: '腰带',
  }
  return labels[value] || value || '装备'
}

function skillCategoryLabel(value: string) {
  const labels: Record<string, string> = {
    Active: '主动',
    Passive: '被动',
    Dp: 'DP',
  }
  return labels[value] || value || '技能'
}

function formatDuration(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`
}
