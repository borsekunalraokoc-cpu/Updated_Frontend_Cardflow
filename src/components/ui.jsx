import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { STAGES } from '../lib/constants'

/* ---------- status → legacy class names ---------- */
export function statusClass(s) {
  if (s === 'Completed') return 'c-done'
  if (s === 'In Progress') return 'c-prog'
  if (s === 'Issue') return 'c-issue'
  return 'c-none'
}
function pipeSegClass(s) {
  if (s === 'Completed') return 's-done'
  if (s === 'In Progress') return 's-prog'
  if (s === 'Issue') return 's-issue'
  return 's-none'
}

/* ---------- icons ---------- */
export const I = {
  grid: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  layers: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" {...p}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  ),
  truck: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" {...p}>
      <path d="M3 6h11v9H3z" />
      <path d="M14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </svg>
  ),
  upload: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 16v3h16v-3" />
      <path d="M12 4v11" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  ),
  audit: (p) => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="m8 11 2 2 4-4" />
      <path d="M8 17h6" />
    </svg>
  ),
  sync: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  search: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </svg>
  ),
  plus: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  menu: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  box: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" {...p}>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </svg>
  ),
  check: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  gear: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  ),
  store: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" {...p}>
      <path d="M4 9h16v11H4z" />
      <path d="M3 9l2-5h14l2 5" />
      <path d="M9 20v-5h6v5" />
    </svg>
  ),
  alert: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 4 2 20h20L12 4Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
}

/* ---------- small building blocks ---------- */
export function Chip({ status }) {
  return (
    <span className={'chip ' + statusClass(status)}>
      <span className="dot" />
      {status}
    </span>
  )
}

export function Bar({ pct }) {
  return (
    <div className="bar">
      <i style={{ width: pct + '%' }} />
    </div>
  )
}

export function Pipe({ p }) {
  return (
    <div className="pipe">
      {STAGES.map((s) => (
        <span
          key={s.k}
          className={pipeSegClass(p.stages[s.k].status)}
          title={s.n + ': ' + p.stages[s.k].status}
        />
      ))}
    </div>
  )
}

export function Donut({ segments, size = 148, thick = 20, centerTop, centerBot }) {
  const r = (size - thick) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  const total = segments.reduce((a, s) => a + s.value, 0)
  let off = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth={thick} />
      {total > 0 &&
        segments.map((s, i) => {
          const len = (s.value / total) * circ
          const el = (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thick}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-off}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )
          off += len
          return el
        })}
      <text x={c} y={c - 1} textAnchor="middle" style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 600, fill: 'var(--ink)' }}>
        {centerTop}
      </text>
      <text x={c} y={c + 17} textAnchor="middle" style={{ fontSize: 9.5, fill: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
        {centerBot}
      </text>
    </svg>
  )
}

export function CopySku({ sku, className, style, onClick }) {
  const [copied, setCopied] = useState(false)
  if (!sku)
    return (
      <span className={className || 'psku'} style={style}>
        no-sku
      </span>
    )
  return (
    <span
      className={className || 'psku'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: onClick ? 'pointer' : 'default', ...style }}
      onClick={onClick}
    >
      {sku}
      <button
        onClick={(e) => {
          e.stopPropagation()
          navigator.clipboard.writeText(sku)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        title="Copy SKU"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          padding: 0,
          border: 0,
          background: 'none',
          color: copied ? 'var(--sage-ink)' : 'var(--faint)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {copied ? (
          '✓'
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  )
}

/* Full-screen "saving…" overlay used by Assign Work */
export function BusyOverlay({ busy }) {
  if (!busy) return null
  return createPortal(
    <div className="busy-scrim" role="alertdialog" aria-busy="true">
      <div className="busy-card">
        <div className="busy-orbit">
          <span className="ring r1" />
          <span className="ring r2" />
          <span className="core">{I.box({ stroke: '#fff' })}</span>
        </div>
        <div className="busy-title">
          {busy.title}
          <span className="busy-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="busy-sub">{busy.sub}</div>
        <div className="busy-bar">
          <i />
        </div>
        <div className="busy-hint">Please don't click anything — saving to the database.</div>
      </div>
    </div>,
    document.body
  )
}

/* Dropdown with coloured status pills */
export function StatusDropdown({
  value,
  options,
  onChange,
  disabled = false,
  readOnly = false,
  minWidth = 170,
  header = '',
  labelOnly = false,
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    const esc = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const current = options.find((o) => o.value === value) || options[0]
  const pill = (o) => (
    <span className={'chip ' + (o.cls || 'c-none')}>
      <span className="dot" />
      {o.label}
    </span>
  )

  if (readOnly) return pill(current)

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          minWidth,
          padding: '5px 8px 5px 6px',
          border: '1px solid var(--line2)',
          borderRadius: 10,
          background: 'var(--card)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {labelOnly ? (
          <span className={'chip ' + (current.cls || 'c-none')}>
            <span className="dot" />
            {header || current.label}
          </span>
        ) : (
          pill(current)
        )}
        <span style={{ fontSize: 10, color: 'var(--muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          ▼
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            minWidth: '100%',
            background: 'var(--card)',
            border: '1px solid var(--line2)',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,.12)',
            padding: 6,
          }}
        >
          {header && (
            <div
              style={{
                padding: '6px 8px 8px',
                marginBottom: 4,
                borderBottom: '1px solid var(--line)',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
              }}
            >
              {header}
            </div>
          )}
          {options.map((o) => {
            const active = o.value === value
            return (
              <div
                key={o.value}
                onClick={() => {
                  setOpen(false)
                  if (!active) onChange(o.value)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  padding: '7px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: active ? 'var(--card-2)' : 'transparent',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = active ? 'var(--card-2)' : 'transparent')}
              >
                {pill(o)}
                {active && <span style={{ fontSize: 12, color: 'var(--sage-ink)', fontWeight: 700 }}>✓</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}