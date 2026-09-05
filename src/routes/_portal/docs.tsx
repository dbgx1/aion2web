import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/docs')({
  component: EmptyPortalPage,
})

function EmptyPortalPage() {
  return null
}
