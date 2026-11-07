import { useState, useEffect, useMemo, useRef } from 'react'
import { fmt } from '../lib/utils'
import { playBellSound } from '../lib/sounds'

export default function RecentlyAddedPanel({ products }) {
  const [glow, setGlow] = useState(false)
  const [open, setOpen] = useState(true)
  const prevCountRef = useRef(null) // null = first load, no sound

  const recentItems = useMemo(
    () =>
      [...products]
        .filter((p) => p.createdAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8),
    [products]
  )

  const addedTodayCount = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    return products.filter((p) => p.createdAt && new Date(p.createdAt) >= todayStart).length
  }, [products])

  // glow + bell when "added today" goes up after the first load
  useEffect(() => {
    if (prevCountRef.current !== null && addedTodayCount > prevCountRef.current) {
      setGlow(true)
      setOpen(true)
      playBellSound()
      const t = setTimeout(() => setGlow(false), 5000)
      prevCountRef.current = addedTodayCount
      return () => clearTimeout(t)
    }
    prevCountRef.current = addedTodayCount
  }, [addedTodayCount])

  if (recentItems.length === 0) return null

  return (
    <div className={'card' + (glow ? ' new-card-alert' : '')} style={{ marginTop: 16, marginBottom: 8, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        className="pad"
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', paddingTop: 14, paddingBottom: 14 }}
      >
        <span className={'chev ' + (open ? 'open' : '')}>▶</span>
        <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>🆕 Recently Added</h3>
        {addedTodayCount > 0 && (
          <span className={'chip c-done' + (glow ? ' new-card-badge' : '')}>
            <span className="dot" />
            {addedTodayCount} added today
          </span>
        )}
        <div className="spacer" />
        <span className="hint">last {recentItems.length} products</span>
      </div>
      <div className="recent-body" style={{ maxHeight: open ? 480 : 0, opacity: open ? 1 : 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 18px 16px' }}>
          {recentItems.map((p) => (
            <div
              key={p.id}
              className="recent-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: 'var(--card-2)',
                borderRadius: 9,
                border: '1px solid var(--line)',
              }}
            >
              <span className="psku">{p.sku || 'no-sku'}</span>
              {p.name && <span style={{ fontWeight: 600, fontSize: 12.5 }}>{p.name}</span>}
              <span className="tag">· {p.vendor || '—'}</span>
              <div className="spacer" />
              <span className="tag" style={{ whiteSpace: 'nowrap' }}>
                {fmt(p.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}