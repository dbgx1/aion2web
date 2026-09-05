import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MqttClient } from 'mqtt'
import { isPrivateChatPayload } from '#/lib/chat-channel'
import { ClientOfflineMonitor } from '#/lib/client-offline'
import { GameChatGuard } from '#/lib/game-chat-block'
import { MessageInbox } from '#/lib/message-inbox'
import { queryPresenceMqtt, presenceQuerySchema, type QueryPresence } from '#/lib/presence-mqtt'

const AGENT_TTL_MS = 45_000
const SELECTED_AGENT_STORAGE_KEY = 'aion2-selected-agent-id'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type ConnectionSettings = {
  room: string
  mqttUrl: string
  prefix: string
}

export type OnlineAgent = {
  agentId: string
  host: string
  serverId: string
  room: string
  status: string
  startedAt: string
  time: string
  lastSeenAt: number
}

export type ConsoleMessage = {
  id: string
  agentId: string
  type: string
  title: string
  content: string
  meta: string
  time: string
  raw: Record<string, unknown>
}

export const defaultConnectionSettings: ConnectionSettings = {
  room: 'aion2-local',
  mqttUrl: 'wss://broker.emqx.io:8084/mqtt',
  prefix: 'aion2-chat-bridge',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function topicBase(settings: ConnectionSettings) {
  return `${settings.prefix.trim()}/${settings.room.trim()}`
}

function normalizeAgent(value: unknown, retained = false): OnlineAgent | null {
  if (!isRecord(value) || value.type !== 'agent_status') return null

  const agentId = textValue(value.agentId)
  if (!agentId) return null

  const time = textValue(value.time || value.startedAt)
  const timestamp = Date.parse(time)
  // Live packets prove liveness when received, regardless of the client PC's
  // clock. Only retained broker snapshots need a wall-clock age check.
  if (retained && value.status !== 'offline'
    && (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > AGENT_TTL_MS)) return null
  const state = isRecord(value.state) ? value.state : {}

  return {
    agentId,
    host: textValue(value.host),
    serverId: textValue(value.serverId || value.serverKey || state.serverKey),
    room: textValue(value.room),
    status: textValue(value.status) || 'online',
    startedAt: textValue(value.startedAt),
    time,
    lastSeenAt: Date.now(),
  }
}

function messageFromPayload(value: unknown, fallbackAgentId = ''): ConsoleMessage | null {
  if (!isRecord(value)) return null

  const payload = isRecord(value.payload) ? value.payload : value
  const data = isRecord(payload.jsonData) ? payload.jsonData : {}
  const chatMeta = isRecord(value.chat_meta) ? value.chat_meta : {}
  const rawType = textValue(value.type)
  const method = textValue(value.method)
  const type = rawType === 'MESSAGE' && method === 'GAME' && textValue(data.content)
    ? 'chat_message'
    : rawType || 'message'
  const agentId = textValue(value.agentId) || fallbackAgentId
  const sender = textValue(chatMeta.sender || data.userName || data.alias) || 'unknown'
  const receiver = textValue(chatMeta.receiver || data.receiverUserName)
  const roomType = textValue(chatMeta.roomType) || 'MESSAGE'
  const isPrivate = isPrivateChatPayload(value)
  const controlLabels: Record<string, string> = {
    control_sent: '已发出',
    control_ack: '客户端已收到',
    control_result: value.ok === true ? '执行成功' : '执行失败',
  }
  const controlLabel = controlLabels[type]
  const title = controlLabel
    ? `控制命令 · ${controlLabel}`
    : isPrivate && receiver
      ? `${sender} → ${receiver}`
      : sender
  const resultText = isRecord(value.result) || isRecord(value.error)
    ? JSON.stringify(value.result || value.error)
    : textValue(value.result || value.error)
  const sentWhisperContent = type === 'control_sent' && payload.type === 'sendWhisper'
    ? textValue(payload.content)
    : ''
  const content = controlLabel
    ? sentWhisperContent || resultText || textValue(value.command) || type
    : textValue(chatMeta.content || data.content || value.summary || payload.content) || type
  const time = textValue(value.time)
  const identity = [
    type,
    textValue(value.message_id),
    textValue(value.requestId),
    time,
    agentId,
    content,
  ].join('|')

  return {
    id: identity,
    agentId,
    type,
    title,
    content,
    meta: `${roomType}${agentId ? ` · ${agentId}` : ''}`,
    time,
    raw: value,
  }
}

function loadSettings() {
  if (typeof window === 'undefined') return defaultConnectionSettings
  return {
    room: localStorage.getItem('aion2-room') || defaultConnectionSettings.room,
    mqttUrl: localStorage.getItem('aion2-mqtt-url') || defaultConnectionSettings.mqttUrl,
    prefix: localStorage.getItem('aion2-prefix') || defaultConnectionSettings.prefix,
  }
}

function saveSettings(settings: ConnectionSettings) {
  localStorage.setItem('aion2-room', settings.room.trim())
  localStorage.setItem('aion2-mqtt-url', settings.mqttUrl.trim())
  localStorage.setItem('aion2-prefix', settings.prefix.trim())
}

function loadSelectedAgentId() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(SELECTED_AGENT_STORAGE_KEY) || ''
}

function saveSelectedAgentId(agentId: string) {
  if (typeof window === 'undefined') return
  if (agentId) localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, agentId)
  else localStorage.removeItem(SELECTED_AGENT_STORAGE_KEY)
}

export function useAionConsole() {
  const [inbox] = useState(() => new MessageInbox())
  const inboxState = useSyncExternalStore(inbox.subscribe, inbox.snapshot, inbox.snapshot)
  const [chatGuard] = useState(() => new GameChatGuard())
  const chatBlocks = useSyncExternalStore(chatGuard.subscribe, chatGuard.snapshot, chatGuard.serverSnapshot)
  const [settings, setSettings] = useState(defaultConnectionSettings)
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [connectionMessage, setConnectionMessage] = useState('等待连接')
  const [agents, setAgents] = useState<OnlineAgent[]>([])
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [selectedAgentId, setSelectedAgentIdState] = useState(loadSelectedAgentId)
  const clientRef = useRef<MqttClient | null>(null)
  const connectionGeneration = useRef(0)
  const connecting = useRef(false)
  const settingsRef = useRef(defaultConnectionSettings)
  const agentsRef = useRef(new Map<string, OnlineAgent>())
  const messageIdsRef = useRef(new Set<string>())
  const offlineMonitor = useRef(new ClientOfflineMonitor(AGENT_TTL_MS))
  const offlineReports = useRef(new Map<string, number>())
  const offlineReporting = useRef(false)
  const offlineReportRetryAt = useRef(0)
  const offlineReportFailures = useRef(0)

  const flushOfflineReports = useCallback(async () => {
    if (offlineReporting.current || !navigator.onLine || !clientRef.current?.connected
      || document.visibilityState !== 'visible' || Date.now() < offlineReportRetryAt.current) return
    offlineReporting.current = true
    try {
      for (const [agentId, offlineAt] of offlineReports.current) {
        if (Date.now() - offlineAt > 60_000) {
          offlineReports.current.delete(agentId)
          continue
        }
        try {
          const response = await fetch('/api/client-locks', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'offline', agentId, offlineAt }),
            signal: AbortSignal.timeout(10_000),
          })
          const rejected = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
          if (!response.ok && !rejected) throw new Error('离线状态上报失败')
          if (offlineReports.current.get(agentId) === offlineAt) offlineReports.current.delete(agentId)
          offlineReportFailures.current = 0
          offlineReportRetryAt.current = 0
        } catch {
          offlineReportRetryAt.current = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(offlineReportFailures.current++, 4))
          break
        }
      }
    } finally {
      offlineReporting.current = false
    }
  }, [])

  const syncAgents = useCallback(() => {
    chatGuard.prune()
    const now = Date.now()
    const monitoring = Boolean(clientRef.current?.connected && navigator.onLine && document.visibilityState === 'visible')
    for (const agentId of offlineMonitor.current.sweep(monitoring, now)) {
      offlineReports.current.set(agentId, now)
      agentsRef.current.delete(agentId)
    }
    void flushOfflineReports()
    const nextAgents = [...agentsRef.current.values()].sort((a, b) =>
      (a.host || a.agentId).localeCompare(b.host || b.agentId),
    )
    setAgents(nextAgents)
    // Presence is temporary; selection is user intent. A delayed heartbeat or
    // suspended browser must not erase it, so a returning client can recover.
  }, [flushOfflineReports, chatGuard])

  const addMessage = useCallback((value: unknown, fallbackAgentId = '') => {
    // Restriction enforcement precedes React rendering and timeline deduplication.
    chatGuard.accept(fallbackAgentId || (isRecord(value) ? textValue(value.agentId) : ''), value)
    const message = messageFromPayload(value, fallbackAgentId)
    if (!message) return
    // Capture replies synchronously, including bursts larger than the event log
    // that arrive before React can render once.
    inbox.accept(message)
    if (messageIdsRef.current.has(message.id)) return
    messageIdsRef.current.add(message.id)
    setMessages((current) => {
      const next = [message, ...current]
      const removed = next.slice(500)
      for (const item of removed) messageIdsRef.current.delete(item.id)
      return next.slice(0, 500)
    })
  }, [chatGuard, inbox])

  const publishDiscover = useCallback(() => {
    const client = clientRef.current
    if (!client?.connected) return
    const sessionId = `portal-${crypto.randomUUID()}`
    client.publish(
      `${topicBase(settingsRef.current)}/signal/agent/all`,
      JSON.stringify({
        type: 'discover',
        sender: sessionId,
        target: 'all',
        sessionId,
        time: new Date().toISOString(),
      }),
    )
  }, [])

  const disconnect = useCallback(() => {
    ++connectionGeneration.current
    connecting.current = false
    const client = clientRef.current
    clientRef.current = null
    client?.end(true)
    offlineMonitor.current = new ClientOfflineMonitor(AGENT_TTL_MS)
    offlineReports.current.clear()
    agentsRef.current.clear()
    setAgents([])
    saveSelectedAgentId('')
    setSelectedAgentIdState('')
    setConnectionState('idle')
    setConnectionMessage('已断开')
  }, [])

  const connect = useCallback(async (nextSettings?: ConnectionSettings) => {
    if (clientRef.current || connecting.current) return
    connecting.current = true
    const generation = ++connectionGeneration.current
    const activeSettings = nextSettings || settingsRef.current
    chatGuard.setScope(JSON.stringify([activeSettings.mqttUrl.trim(), activeSettings.prefix.trim(), activeSettings.room.trim()]))
    settingsRef.current = activeSettings
    setSettings(activeSettings)
    saveSettings(activeSettings)
    setConnectionState('connecting')
    setConnectionMessage('正在连接 MQTT 信令…')

    try {
      const mqttModule = await import('mqtt')
      if (generation !== connectionGeneration.current) return
      const connectMqtt = typeof mqttModule.connect === 'function'
        ? mqttModule.connect
        : mqttModule.default.connect
      if (typeof connectMqtt !== 'function') {
        throw new Error('当前浏览器构建未提供 MQTT connect API')
      }
      const client = connectMqtt(activeSettings.mqttUrl.trim(), {
        clientId: `aion2-portal-${crypto.randomUUID().replaceAll('-', '')}`,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 1500,
        // Commands must not be silently queued for later execution after reconnect.
        queueQoSZero: false,
      })
      clientRef.current = client

      client.on('connect', () => {
        if (clientRef.current !== client) return
        const base = topicBase(activeSettings)
        client.subscribe([`${base}/agents/+/status`, `${base}/events/+/chat`], (error) => {
          if (clientRef.current !== client) return
          if (error) {
            setConnectionState('error')
            setConnectionMessage(`订阅客户端消息失败：${error.message}`)
            return
          }
          publishDiscover()
        })
        setConnectionState('connected')
        setConnectionMessage(`已连接 · ${activeSettings.room}`)
      })

      client.on('reconnect', () => {
        if (clientRef.current !== client) return
        setConnectionState('reconnecting')
        setConnectionMessage('信令重连中…')
      })

      client.on('error', (error) => {
        if (clientRef.current !== client) return
        setConnectionState('error')
        setConnectionMessage(`连接错误：${error.message}`)
      })

      client.on('close', () => {
        if (clientRef.current === client) {
          setConnectionState('reconnecting')
          setConnectionMessage('连接中断，正在重试…')
        }
      })

      client.on('message', (topic, buffer, packet) => {
        if (clientRef.current !== client) return
        let payload: unknown
        try {
          payload = JSON.parse(new TextDecoder().decode(buffer))
        } catch {
          return
        }

        const agent = normalizeAgent(payload, packet?.retain === true)
        if (agent) {
          // Status records are only authoritative on the matching status topic.
          // requestStatus responses on chat topics do not replace discovery data.
          if (topic !== `${topicBase(activeSettings)}/agents/${agent.agentId}/status`) return
          if (agent.status === 'offline') {
            // A will contains its creation time, not the actual disconnect time.
            // Treat it as a hint; the liveness grace period confirms the outage.
            // This also avoids an old retained will undoing a fresh connection.
            if (!isRecord(payload) || payload.will !== true) {
              const offlineAt = Date.parse(agent.time)
              const current = agentsRef.current.get(agent.agentId)
              if (!packet?.retain && Number.isFinite(offlineAt)
                && Math.abs(Date.now() - offlineAt) <= AGENT_TTL_MS
                && (!current || offlineAt >= Date.parse(current.time))) {
                agentsRef.current.delete(agent.agentId)
                offlineMonitor.current.forget(agent.agentId)
                offlineReports.current.set(agent.agentId, offlineAt)
              }
            }
          } else {
            agentsRef.current.set(agent.agentId, agent)
            offlineMonitor.current.observe(agent.agentId, agent.lastSeenAt)
            offlineReports.current.delete(agent.agentId)
          }
          syncAgents()
          return
        }

        const eventPrefix = `${topicBase(activeSettings)}/events/`
        if (topic.startsWith(eventPrefix) && topic.endsWith('/chat')) {
          const agentId = topic.slice(eventPrefix.length, -'/chat'.length)
          addMessage(payload, agentId)
        }
      })
    } catch (error) {
      if (generation !== connectionGeneration.current) return
      const message = error instanceof Error ? error.message : '未知错误'
      setConnectionState('error')
      setConnectionMessage(`无法加载 MQTT：${message}`)
    } finally {
      if (generation === connectionGeneration.current) connecting.current = false
    }
  }, [addMessage, publishDiscover, syncAgents, chatGuard])

  const reconnect = useCallback((nextSettings: ConnectionSettings) => {
    disconnect()
    void connect(nextSettings)
  }, [connect, disconnect])

  const sendCommand = useCallback((agentId: string, command: Record<string, unknown>) => {
    if (command.type === 'sendWhisper' && chatGuard.get(agentId)) return false
    const client = clientRef.current
    if (!client?.connected || !agentId) return false

    const requestId = textValue(command.requestId) || crypto.randomUUID()
    const message = {
      ...command,
      requestId,
      sender: `portal-${requestId}`,
      target: agentId,
      sessionId: `portal-${requestId}`,
      time: new Date().toISOString(),
    }
    client.publish(
      `${topicBase(settingsRef.current)}/control/agent/${agentId}`,
      JSON.stringify(message),
    )
    addMessage({
      type: 'control_sent',
      requestId,
      command: textValue(command.type) || 'command',
      agentId,
      via: 'MQTT',
      time: message.time,
      payload: message,
    })
    return true
  }, [addMessage, chatGuard])

  const queryPresence = useCallback<QueryPresence>(async (characters, onResults, signal) => {
    const client = clientRef.current
    if (!client?.connected) throw new Error('MQTT 未连接')
    const response = await fetch('/api/presence/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters }), signal,
    })
    const body = await response.json() as { query?: unknown; error?: string }
    if (!response.ok) throw new Error(body.error || '登记查询失败')
    const query = presenceQuerySchema.parse(body.query)
    try {
      await queryPresenceMqtt(client, query, onResults, signal)
    } finally {
      void fetch('/api/presence/requests', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: query.requestId }), keepalive: true,
      }).catch(() => {})
    }
  }, [])

  const clearMessages = useCallback(() => {
    messageIdsRef.current.clear()
    setMessages([])
  }, [])

  const setSelectedAgentId = useCallback((agentId: string) => {
    saveSelectedAgentId(agentId)
    setSelectedAgentIdState(agentId)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === chatGuard.storageKey) chatGuard.reload() }
    window.addEventListener('storage', onStorage)
    const initialSettings = loadSettings()
    settingsRef.current = initialSettings
    setSettings(initialSettings)
    void connect(initialSettings)
    const timer = window.setInterval(syncAgents, 3000)
    const wake = () => {
      syncAgents()
      if (navigator.onLine && document.visibilityState === 'visible') publishDiscover()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)

    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      ++connectionGeneration.current
      connecting.current = false
      window.clearInterval(timer)
      const client = clientRef.current
      clientRef.current = null
      client?.end(true)
    }
  }, [connect, syncAgents, chatGuard, publishDiscover])

  return {
    inboxMessages: inboxState.messages,
    readMessageIds: inboxState.readMessageIds,
    markMessagesRead: inbox.markRead,
    chatGuard,
    chatBlocks,
    settings,
    connectionState,
    connectionMessage,
    agents,
    messages,
    selectedAgentId,
    setSelectedAgentId,
    connect,
    disconnect,
    reconnect,
    publishDiscover,
    sendCommand,
    queryPresence,
    clearMessages,
  }
}
