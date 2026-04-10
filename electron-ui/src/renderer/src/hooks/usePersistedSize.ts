import { useCallback, useRef, useEffect } from "react"

/**
 * Hook that persists an element's width and height in localStorage.
 * Returns a ref callback to attach to the resizable element.
 * Uses getBoundingClientRect (border-box) to avoid shrinking from padding.
 */
export function usePersistedSize(key: string, defaults: { width: number; height: number }) {
  const observerRef = useRef<ResizeObserver | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialApplied = useRef(false)

  const getSaved = (): { width: number; height: number } => {
    try {
      const raw = localStorage.getItem(`dialog-size:${key}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.width > 0 && parsed.height > 0) return parsed
      }
    } catch { /* ignore */ }
    return defaults
  }

  const refCallback = useCallback((node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    initialApplied.current = false

    if (!node) return

    // Apply saved size (border-box values)
    const s = getSaved()
    node.style.width = `${s.width}px`
    node.style.height = `${s.height}px`

    // Wait a frame before starting to observe, so the initial
    // size application doesn't trigger a save
    requestAnimationFrame(() => {
      initialApplied.current = true
    })

    // Observe size changes and persist using getBoundingClientRect (border-box)
    observerRef.current = new ResizeObserver(() => {
      if (!initialApplied.current) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const rect = node.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          localStorage.setItem(
            `dialog-size:${key}`,
            JSON.stringify({ width: Math.round(rect.width), height: Math.round(rect.height) })
          )
        }
      }, 300)
    })
    observerRef.current.observe(node)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return { ref: refCallback }
}
