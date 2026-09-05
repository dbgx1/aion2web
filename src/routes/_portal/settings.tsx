import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/settings')({
  component: EmptyPortalPage,
})

function EmptyPortalPage() {
  return null
}
