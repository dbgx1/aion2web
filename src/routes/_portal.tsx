import { createFileRoute, useRouterState } from '@tanstack/react-router'

import { AionPortal, sectionFromPortalPath } from './index'

export const Route = createFileRoute('/_portal')({
  component: PortalLayout,
})

function PortalLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return <AionPortal section={sectionFromPortalPath(pathname)} />
}
