import { createFileRoute } from '@tanstack/react-router'
import { guildTrackingResponse } from '#/server/guild-tracking.server'
export const Route = createFileRoute('/api/guild-tracking')({server:{handlers:{
  GET:({request})=>guildTrackingResponse(request),
  POST:({request})=>guildTrackingResponse(request),
}}})
