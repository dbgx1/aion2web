import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

export const setControlCommandDraftDef = toolDefinition({
  name: 'set_control_command_draft',
  description: 'Fill the control console JSON command draft. Use this when the admin asks for a MQTT control command.',
  inputSchema: z.object({
    command: z.record(z.string(), z.unknown()).meta({ description: 'A JSON object command to place in the control console.' }),
  }),
  outputSchema: z.object({
    applied: z.boolean(),
    message: z.string(),
  }),
})

export const setPrivateChatDraftDef = toolDefinition({
  name: 'set_private_chat_draft',
  description: 'Fill the private chat message draft for the currently selected game character. Use this for one-to-one chat replies.',
  inputSchema: z.object({
    content: z.string().min(1).meta({ description: 'The private message content to place in the chat composer.' }),
  }),
  outputSchema: z.object({
    applied: z.boolean(),
    message: z.string(),
  }),
})

export const sendPrivateChatDef = toolDefinition({
  name: 'send_private_chat',
  description: 'Send a private chat message to the currently selected game character.',
  inputSchema: z.object({
    content: z.string().min(1).meta({ description: 'The private message content to send to the selected character.' }),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    message: z.string(),
  }),
})

export const setGroupChatDraftDef = toolDefinition({
  name: 'set_group_chat_draft',
  description: 'Fill the group/bulk chat message draft for the current filtered recipients. Use this for group chat or bulk broadcast requests.',
  inputSchema: z.object({
    content: z.string().min(1).meta({ description: 'The group message content to place in the bulk composer.' }),
  }),
  outputSchema: z.object({
    applied: z.boolean(),
    message: z.string(),
  }),
})

export const sendGroupChatDef = toolDefinition({
  name: 'send_group_chat',
  description: 'Automatically send varied private chat messages to every character in the current filtered recipient list. Keep the same core meaning, but provide alternate phrasings when possible.',
  inputSchema: z.object({
    content: z.string().min(1).meta({ description: 'The core group message meaning to send to every filtered recipient.' }),
    variants: z.array(z.string().min(1)).optional().meta({ description: 'Optional alternate phrasings with the same meaning. The client will personalize and deduplicate per recipient.' }),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    sentCount: z.number(),
    totalCount: z.number(),
    varied: z.boolean(),
    message: z.string(),
  }),
})

export const consoleAiToolDefs = [
  setControlCommandDraftDef,
  setPrivateChatDraftDef,
  sendPrivateChatDef,
  setGroupChatDraftDef,
  sendGroupChatDef,
]

export const managedContextDef = toolDefinition({
  name: 'get_managed_context',
  description: 'Read the fixed managed-chat scope, current recipient, task instructions and progress.',
  inputSchema: z.object({}),
  outputSchema: z.object({ context: z.string() }),
})

export const managedHistoryDef = toolDefinition({
  name: 'read_managed_history',
  description: 'Read recent private chat history for the current managed recipient only.',
  inputSchema: z.object({}),
  outputSchema: z.object({ history: z.string() }),
})

export const managedPresenceDef = toolDefinition({
  name: 'query_managed_online',
  description: 'Query the current managed recipient online status. Use only when needed, not before every reply.',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
})

export const managedAiToolDefs = [...consoleAiToolDefs, managedContextDef, managedHistoryDef, managedPresenceDef]
