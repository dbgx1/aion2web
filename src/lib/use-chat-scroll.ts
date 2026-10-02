import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

type Message = { id: string; time: string }
type Position = {
  following: boolean
  top: number
  anchors: { id: string; offset: number }[]
  seen: Set<string>
  newest: number
  unread: number
  initialized: boolean
}

/** Reading positions belong to conversations, not to whichever DOM node React reuses. */
export function useChatScroll(ref: RefObject<HTMLDivElement | null>, scope: string, active: boolean, messages: Message[]) {
  const positions = useRef(new Map<string, Position>())
  const controls = useRef<{ refresh: (messages: Message[]) => void; latest: () => void; pause: () => void } | null>(null)
  const [feedback, setFeedback] = useState({ paused: false, unread: 0 })

  useLayoutEffect(() => {
    const thread = ref.current
    if (!active || !thread) return
    let position = positions.current.get(scope)
    if (!position) {
      position = { following: true, top: 0, anchors: [], seen: new Set(), newest: -Infinity, unread: 0, initialized: false }
      positions.current.set(scope, position)
      if (positions.current.size > 100) positions.current.delete(positions.current.keys().next().value!)
    }
    const state = position
    let programmedTop: number | null = null
    let viewportHeight = thread.clientHeight
    const selected = () => {
      const selection = window.getSelection()
      return Boolean(selection && !selection.isCollapsed && (
        thread.contains(selection.anchorNode) || thread.contains(selection.focusNode)))
    }
    const visible = () => thread.clientHeight > 0 && thread.getClientRects().length > 0
    const rows = () => [...thread.querySelectorAll<HTMLElement>('[data-chat-id]')]
    const publish = () => setFeedback(previous => {
      const next = { paused: !state.following, unread: state.unread }
      return previous.paused === next.paused && previous.unread === next.unread ? previous : next
    })
    const remember = () => {
      if (!visible()) return
      state.top = thread.scrollTop
      const top = thread.getBoundingClientRect().top
      state.anchors = rows().filter(row => row.getBoundingClientRect().bottom > top)
        .slice(0, 8).map(row => ({ id: row.dataset.chatId!, offset: row.getBoundingClientRect().top - top }))
    }
    const move = (top: number) => {
      thread.scrollTop = top
      programmedTop = thread.scrollTop
    }
    const restore = () => {
      const elements = rows()
      const anchor = state.anchors.find(item => elements.some(row => row.dataset.chatId === item.id))
      const row = anchor && elements.find(item => item.dataset.chatId === anchor.id)
      if (row && anchor) move(thread.scrollTop + row.getBoundingClientRect().top - thread.getBoundingClientRect().top - anchor.offset)
      else move(state.top)
    }
    const latest = () => {
      state.following = true; state.unread = 0
      if (visible()) { move(thread.scrollHeight); remember() }
      publish()
    }
    const pause = () => { state.following = false; remember(); publish() }
    const onScroll = () => {
      if (!visible()) return
      if (programmedTop !== null && Math.abs(thread.scrollTop - programmedTop) < 1) { programmedTop = null; return }
      programmedTop = null
      const movingUp = thread.scrollTop < state.top - 1
      if (movingUp || selected()) state.following = false
      else if (thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 16) {
        state.following = true; state.unread = 0
      }
      remember(); publish()
    }
    const onSelection = () => { if (selected()) pause() }
    // Wheel intent arrives before layout/scroll, closing the new-message race.
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pause() }
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause()
    }
    const observer = new ResizeObserver(() => {
      if (!visible()) return
      if (selected()) state.following = false
      if (thread.clientHeight !== viewportHeight && state.following) move(thread.scrollHeight)
      else restore()
      viewportHeight = thread.clientHeight
      remember(); publish()
    })
    observer.observe(thread)
    const observed = new Set<Element>()
    controls.current = {
      latest, pause,
      refresh(items) {
        let added = 0
        const newest = Math.max(state.newest, ...items.map(item => Date.parse(item.time) || 0))
        for (const item of items) {
          if (state.initialized && !state.seen.has(item.id) && (Date.parse(item.time) || 0) >= state.newest) added++
        }
        // Keep only current IDs; the monotonic time watermark excludes prepended
        // history and prevents trimmed old rows being counted on a later reload.
        state.seen = new Set(items.map(item => item.id))
        state.newest = newest
        if (selected()) state.following = false
        if (!state.following) state.unread += added
        if (visible()) {
          if (state.following && (!state.initialized || added > 0)) move(thread.scrollHeight)
          else restore()
          remember()
        }
        if (items.length) state.initialized = true
        for (const child of Array.from(thread.children)) {
          if (!observed.has(child)) { observer.observe(child); observed.add(child) }
        }
        for (const child of observed) if (!thread.contains(child)) { observer.unobserve(child); observed.delete(child) }
        publish()
      },
    }
    if (visible()) {
      if (state.following) move(thread.scrollHeight)
      else restore()
      remember()
    }
    thread.addEventListener('scroll', onScroll, { passive: true })
    thread.addEventListener('wheel', onWheel, { passive: true })
    thread.addEventListener('keydown', onKey)
    document.addEventListener('selectionchange', onSelection)
    publish()
    return () => {
      observer.disconnect()
      thread.removeEventListener('scroll', onScroll)
      thread.removeEventListener('wheel', onWheel)
      thread.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onSelection)
      controls.current = null
    }
  }, [ref, scope, active])

  // Also preserves anchors when translations, receipts or history change heights.
  useLayoutEffect(() => { controls.current?.refresh(messages) })
  return { ...feedback, jumpToLatest: () => controls.current?.latest(), pause: () => controls.current?.pause() }
}
