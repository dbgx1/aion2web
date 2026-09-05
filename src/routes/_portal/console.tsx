import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/console')({
  component: EmptyPortalPage,
})

function EmptyPortalPage() {
  return null
}
