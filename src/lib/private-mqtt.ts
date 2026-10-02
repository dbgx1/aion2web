export const PRIVATE_MQTT_URL = 'wss://od43e177.ala.cn-shenzhen.emqxsl.cn:8084/mqtt'
export const LEGACY_MQTT_URL = 'wss://broker.emqx.io:8084/mqtt'

export function migrateMqttUrl(value: string | null) {
  return !value || value === LEGACY_MQTT_URL ? PRIVATE_MQTT_URL : value
}

export async function privateMqttCredentials(url: string) {
  // Never send the deployment's credentials to a user-selected broker.
  if (url.trim() !== PRIVATE_MQTT_URL) return {}
  const response = await fetch('/api/mqtt/connection', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(response.status === 401 ? '请重新登录后连接消息服务' : '私有消息服务尚未配置，请联系管理员')
  const data = await response.json()
  if (typeof data !== 'object' || data === null || !('url' in data) || data.url !== PRIVATE_MQTT_URL
    || !('username' in data) || typeof data.username !== 'string' || !data.username
    || !('password' in data) || typeof data.password !== 'string' || !data.password) throw new Error('私有消息服务配置无效')
  return { username: data.username, password: data.password }
}
