import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameCharacter } from './game-characters'

// Keep in sync with .character-list .character-card in styles.css.
export const CHARACTER_ROW_HEIGHT = 72
const OVERSCAN = 5

export function useCharacterWindow(characters: GameCharacter[], resetKey: string) {
  const listRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 720 })
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => setViewport({ top: list.scrollTop, height: list.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setViewport(current => ({ ...current, top: 0 }))
  }, [resetKey])
  // One extra row covers the sticky broadcast button above the characters.
  const start = Math.min(Math.max(0, characters.length - 1), Math.max(0, Math.floor(viewport.top / CHARACTER_ROW_HEIGHT) - OVERSCAN - 1))
  const end = Math.min(characters.length, start + Math.ceil(viewport.height / CHARACTER_ROW_HEIGHT) + OVERSCAN * 2 + 2)
  const items = useMemo(() => characters.slice(start, end), [characters, start, end])
  return {
    listRef, items,
    paddingTop: start * CHARACTER_ROW_HEIGHT,
    paddingBottom: (characters.length - end) * CHARACTER_ROW_HEIGHT,
    onScroll: (list: HTMLDivElement) => setViewport(current => current.top === list.scrollTop
      ? current : { top: list.scrollTop, height: list.clientHeight }),
  }
}
