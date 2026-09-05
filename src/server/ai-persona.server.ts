import { env } from 'cloudflare:workers'
import { defaultAiPersona, type AiPersona, type AiPersonaPayload } from '#/lib/ai-persona'
import type { AdminPrincipal } from '#/server/admin-users.server'

const TEXT_LIMITS = {
  name: 60,
  systemPrompt: 3_000,
  stylePrompt: 3_000,
  goalPrompt: 3_000,
  forbiddenPrompt: 3_000,
  examplePrompt: 6_000,
} as const

type AiPersonaRow = {
  name: string
  system_prompt: string
  style_prompt: string
  goal_prompt: string
  forbidden_prompt: string
  example_prompt: string
  updated_at: number
}

export type SaveAiPersonaResult =
  | { ok: true; persona: AiPersona }
  | { ok: false; error: string }

function database() {
  return env.DB
}

function cleanText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength)
}

export function sanitizeAiPersonaPayload(input: AiPersonaPayload): SaveAiPersonaResult {
  const persona = {
    name: cleanText(input.name, TEXT_LIMITS.name) || defaultAiPersona.name,
    systemPrompt: cleanText(input.systemPrompt, TEXT_LIMITS.systemPrompt),
    stylePrompt: cleanText(input.stylePrompt, TEXT_LIMITS.stylePrompt),
    goalPrompt: cleanText(input.goalPrompt, TEXT_LIMITS.goalPrompt),
    forbiddenPrompt: cleanText(input.forbiddenPrompt, TEXT_LIMITS.forbiddenPrompt),
    examplePrompt: cleanText(input.examplePrompt, TEXT_LIMITS.examplePrompt),
    updatedAt: Date.now(),
  }

  if (!persona.systemPrompt) return { ok: false, error: 'AI 应该是谁不能为空。' }
  if (!persona.stylePrompt) return { ok: false, error: '说话风格不能为空。' }
  if (!persona.goalPrompt) return { ok: false, error: '聊天目标不能为空。' }
  if (!persona.forbiddenPrompt) return { ok: false, error: '禁止内容不能为空。' }
  return { ok: true, persona }
}

export async function getAiPersona(principal: AdminPrincipal): Promise<AiPersona> {
  try {
    const row = await database().prepare(`
      SELECT name, system_prompt, style_prompt, goal_prompt, forbidden_prompt,
        example_prompt, updated_at
      FROM ai_personas
      WHERE owner_user_key = ?
    `).bind(principal.userKey).first<AiPersonaRow>()
    if (!row) return defaultPersona()
    return {
      name: row.name,
      systemPrompt: row.system_prompt,
      stylePrompt: row.style_prompt,
      goalPrompt: row.goal_prompt,
      forbiddenPrompt: row.forbidden_prompt,
      examplePrompt: row.example_prompt,
      updatedAt: row.updated_at,
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table')) return defaultPersona()
    throw cause
  }
}

export async function saveAiPersona(principal: AdminPrincipal, input: AiPersonaPayload): Promise<SaveAiPersonaResult> {
  const sanitized = sanitizeAiPersonaPayload(input)
  if (!sanitized.ok) return sanitized

  const now = Date.now()
  const persona = { ...sanitized.persona, updatedAt: now }
  try {
    await database().prepare(`
      INSERT INTO ai_personas (
        owner_user_key, owner_username, name, system_prompt, style_prompt,
        goal_prompt, forbidden_prompt, example_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_user_key) DO UPDATE SET
        owner_username = excluded.owner_username,
        name = excluded.name,
        system_prompt = excluded.system_prompt,
        style_prompt = excluded.style_prompt,
        goal_prompt = excluded.goal_prompt,
        forbidden_prompt = excluded.forbidden_prompt,
        example_prompt = excluded.example_prompt,
        updated_at = excluded.updated_at
    `).bind(
      principal.userKey,
      principal.username,
      persona.name,
      persona.systemPrompt,
      persona.stylePrompt,
      persona.goalPrompt,
      persona.forbiddenPrompt,
      persona.examplePrompt,
      now,
      now,
    ).run()
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table')) {
      return { ok: false, error: 'AI 人设表尚未初始化，请先执行数据库迁移。' }
    }
    throw cause
  }

  return { ok: true, persona }
}

export function aiPersonaPrompt(persona: AiPersona) {
  return [
    `当前客服使用的 AI 人设：${persona.name}`,
    `AI 应该是谁：\n${persona.systemPrompt}`,
    `说话风格：\n${persona.stylePrompt}`,
    `聊天目标：\n${persona.goalPrompt}`,
    `禁止内容：\n${persona.forbiddenPrompt}`,
    persona.examplePrompt ? `参考示例：\n${persona.examplePrompt}` : '',
  ].filter(Boolean).join('\n\n')
}

function defaultPersona(): AiPersona {
  return { ...defaultAiPersona, updatedAt: 0 }
}
