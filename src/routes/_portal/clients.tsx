import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/clients')({
  component: EmptyPortalPage,
})

function EmptyPortalPage() {
  return null
}
