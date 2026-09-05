import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/ai-persona')({
  component: EmptyPortalPage,
})

function EmptyPortalPage() {
  return null
}
