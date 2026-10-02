import { createFileRoute } from '@tanstack/react-router'
import { intelligenceResponse } from '#/server/intelligence.server'
export const Route = createFileRoute('/api/intelligence')({ server: { handlers: { GET: ({ request }) => intelligenceResponse(request) } } })
