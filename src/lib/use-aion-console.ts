import { useCallback, useEffect, useRef, useState } from 'react'
import type { MqttClient } from 'mqtt'

const AGENT_TTL_MS = 15_000

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

function normalizeAgent(value: unknown): OnlineAgent | null {
  if (!isRecord(value) || value.type !== 'agent_status') return null

  const agentId = textValue(value.agentId)
  if (!agentId) return null

  const time = textValue(value.time || value.startedAt)
  const timestamp = Date.parse(time)
  if (Number.isFinite(timestamp) && Date.now() - timestamp > AGENT_TTL_MS) return null
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
  const type = textValue(value.type) || 'message'
  const agentId = textValue(value.agentId) || fallbackAgentId
  const sender = textValue(chatMeta.sender || data.userName || data.alias) || 'unknown'
  const receiver = textValue(chatMeta.receiver || data.receiverUserName)
  const roomType = textValue(chatMeta.roomType) || 'MESSAGE'
  const isPrivate = chatMeta.kind === 'private' || isRecord(data.gameRoomKeyInfo) && data.gameRoomKeyInfo.type === 'ONE_ON_ONE'
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

export function useAionConsole() {
  const [settings, setSettings] = useState(defaultConnectionSettings)
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [connectionMessage, setConnectionMessage] = useState('等待连接')
  const [agents, setAgents] = useState<OnlineAgent[]>([])
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const clientRef = useRef<MqttClient | null>(null)
  const settingsRef = useRef(defaultConnectionSettings)
  const agentsRef = useRef(new Map<string, OnlineAgent>())
  const messageIdsRef = useRef(new Set<string>())

  const syncAgents = useCallback(() => {
    const now = Date.now()
    for (const [agentId, agent] of agentsRef.current) {
      if (now - agent.lastSeenAt > AGENT_TTL_MS) agentsRef.current.delete(agentId)
    }
    const nextAgents = [...agentsRef.current.values()].sort((a, b) =>
      (a.host || a.agentId).localeCompare(b.host || b.agentId),
    )
    setAgents(nextAgents)
    setSelectedAgentId((current) => {
      if (current && agentsRef.current.has(current)) return current
      return ''
    })
  }, [])

  const addMessage = useCallback((value: unknown, fallbackAgentId = '') => {
    const message = messageFromPayload(value, fallbackAgentId)
    if (!message || messageIdsRef.current.has(message.id)) return
    messageIdsRef.current.add(message.id)
    setMessages((current) => {
      const next = [message, ...current]
      const removed = next.slice(500)
      for (const item of removed) messageIdsRef.current.delete(item.id)
      return next.slice(0, 500)
    })
  }, [])

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
    const client = clientRef.current
    clientRef.current = null
    client?.end(true)
    agentsRef.current.clear()
    setAgents([])
    setSelectedAgentId('')
    setConnectionState('idle')
    setConnectionMessage('已断开')
  }, [])

  const connect = useCallback(async (nextSettings?: ConnectionSettings) => {
    if (clientRef.current) return
    const activeSettings = nextSettings || settingsRef.current
    settingsRef.current = activeSettings
    setSettings(activeSettings)
    saveSettings(activeSettings)
    setConnectionState('connecting')
    setConnectionMessage('正在连接 MQTT 信令…')

    try {
      const mqttModule = await import('mqtt')
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
      })
      clientRef.current = client

      client.on('connect', () => {
        const base = topicBase(activeSettings)
        client.subscribe([`${base}/agents/+/status`, `${base}/events/+/chat`])
        setConnectionState('connected')
        setConnectionMessage(`已连接 · ${activeSettings.room}`)
        publishDiscover()
      })

      client.on('reconnect', () => {
        setConnectionState('reconnecting')
        setConnectionMessage('信令重连中…')
      })

      client.on('error', (error) => {
        setConnectionState('error')
        setConnectionMessage(`连接错误：${error.message}`)
      })

      client.on('close', () => {
        if (clientRef.current === client) {
          setConnectionState('reconnecting')
          setConnectionMessage('连接中断，正在重试…')
        }
      })

      client.on('message', (topic, buffer) => {
        let payload: unknown
        try {
          payload = JSON.parse(new TextDecoder().decode(buffer))
        } catch {
          return
        }

        const agent = normalizeAgent(payload)
        if (agent) {
          if (agent.status === 'offline') agentsRef.current.delete(agent.agentId)
          else agentsRef.current.set(agent.agentId, agent)
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
      const message = error instanceof Error ? error.message : '未知错误'
      setConnectionState('error')
      setConnectionMessage(`无法加载 MQTT：${message}`)
    }
  }, [addMessage, publishDiscover, syncAgents])

  const reconnect = useCallback((nextSettings: ConnectionSettings) => {
    disconnect()
    void connect(nextSettings)
  }, [connect, disconnect])

  const sendCommand = useCallback((agentId: string, command: Record<string, unknown>) => {
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
  }, [addMessage])

  const clearMessages = useCallback(() => {
    messageIdsRef.current.clear()
    setMessages([])
  }, [])

  useEffect(() => {
    const initialSettings = loadSettings()
    settingsRef.current = initialSettings
    setSettings(initialSettings)
    void connect(initialSettings)
    const timer = window.setInterval(syncAgents, 3000)

    return () => {
      window.clearInterval(timer)
      const client = clientRef.current
      clientRef.current = null
      client?.end(true)
    }
  }, [connect, syncAgents])

  return {
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
    clearMessages,
  }
}
