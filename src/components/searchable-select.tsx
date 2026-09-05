import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'

export type SelectOption = { value: string; label: string; group?: string }
const ROW_HEIGHT = 36
const LIST_HEIGHT = 252
const OVERSCAN = 3

export const SearchableSelect = memo(function SearchableSelect({ label, value, options, onChange, disabled = false }: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => options.find(option => option.value === value), [options, value])
  return <>
    <button ref={trigger} type="button" className="searchable-select-trigger"
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={disabled} onClick={() => setOpen(current => !current)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
      }}>
      <span>{selected?.label || value || '暂无选项'}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && !disabled && createPortal(<SelectPopup id={id} label={label} value={value} options={options}
      anchor={trigger.current!} onSelect={next => { setOpen(false); trigger.current?.focus(); onChange(next) }}
      onClose={restoreFocus => { setOpen(false); if (restoreFocus) trigger.current?.focus() }} />, document.body)}
  </>
})

function SelectPopup({ id, label, value, options, anchor, onSelect, onClose }: {
  id: string; label: string; value: string; options: SelectOption[]; anchor: HTMLButtonElement
  onSelect: (value: string) => void; onClose: (restoreFocus: boolean) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const searchable = useMemo(() => options.map(option => ({ option, text: `${option.label} ${option.group || ''} ${option.value}`.toLowerCase() })), [options])
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return text ? searchable.filter(item => item.text.includes(text)).map(item => item.option) : options
  }, [options, searchable, query])
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(option => option.value === value)))
  const [scrollTop, setScrollTop] = useState(0)
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const upwards = below < 330 && above > below
  const height = Math.max(36, Math.min(LIST_HEIGHT, (upwards ? above : below) - 80))
  const activeIndex = Math.min(active, filtered.length - 1)
  const start = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, filtered.length - 1))
  const end = Math.min(filtered.length, start + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2)

  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    const element = list.current
    if (!element || activeIndex < 0) return
    const top = activeIndex * ROW_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + height) element.scrollTop = top + ROW_HEIGHT - height
    setScrollTop(element.scrollTop)
  }, [activeIndex, height])
  useEffect(() => {
    function outside(event: Event) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.contains(event.target)) onClose(false)
    }
    function moved(event: Event) {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) onClose(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', moved)
    window.addEventListener('scroll', moved, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', moved)
      window.removeEventListener('scroll', moved, true)
    }
  }, [anchor, onClose])

  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true) }
    else if (event.key === 'Tab') onClose(true)
    else if (event.key === 'Enter') {
      event.preventDefault()
      if (filtered[activeIndex]) onSelect(filtered[activeIndex].value)
    } else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault()
      const step = event.key.startsWith('Page') ? Math.floor(height / ROW_HEIGHT) : 1
      setActive(Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key.endsWith('Down') ? step : -step))))
    } else if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || !query)) {
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : Math.max(0, filtered.length - 1))
    }
  }

  return <div ref={panel} id={id} role="dialog" aria-label={label} className="searchable-select-popup"
    style={{ width, left, ...(upwards ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) }} onKeyDown={onKeyDown}>
    <div className="searchable-select-search"><Search size={14} aria-hidden="true" />
      <input ref={input} role="combobox" aria-label={`搜索${label}`} aria-expanded="true" aria-autocomplete="list"
        aria-controls={`${id}-list`} aria-activedescendant={activeIndex >= start && activeIndex < end ? `${id}-option-${activeIndex}` : undefined}
        placeholder="输入名称搜索" value={query} onChange={event => {
          setQuery(event.target.value); setActive(0); setScrollTop(0)
          if (list.current) list.current.scrollTop = 0
        }} />
    </div>
    <div ref={list} id={`${id}-list`} role="listbox" aria-label={`${label}选项`} className="searchable-select-list"
      style={{ height: Math.min(height, Math.max(1, filtered.length) * ROW_HEIGHT) }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
        {filtered.slice(start, end).map((option, offset) => {
          const index = start + offset
          return <div id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={option.value === value}
            aria-posinset={index + 1} aria-setsize={filtered.length}
            className={`searchable-select-option${index === activeIndex ? ' is-active' : ''}`}
            style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }} title={option.label}
            onPointerDown={event => event.preventDefault()} onClick={() => onSelect(option.value)}>
            <span>{option.label}</span>{option.group && <small>{option.group}</small>}
          </div>
        })}
      </div>
      {filtered.length === 0 && <p className="searchable-select-empty">没有匹配的选项</p>}
    </div>
    <div className="searchable-select-count" role="status">{filtered.length} 个选项</div>
  </div>
}
