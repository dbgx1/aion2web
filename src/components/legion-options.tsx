import { memo } from 'react'

// Thousands of options should not reconcile again on every incoming message or keystroke.
export const LegionOptions = memo(function LegionOptions({ legions }: {
  legions: Array<{ legionName: string; memberCount: number }>
}) {
  return legions.map(({ legionName, memberCount }) => (
    <option value={legionName} key={legionName}>{legionName} ({memberCount})</option>
  ))
})
