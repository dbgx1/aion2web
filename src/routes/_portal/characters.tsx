import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/characters')({
  component: EmptyPortalPage,
})

function EmptyPortalPage() {
  return null
}
