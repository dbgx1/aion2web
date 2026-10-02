import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/ai-persona')({
  beforeLoad: () => { throw redirect({ to: '/reception', hash: 'config', replace: true }) },
})
