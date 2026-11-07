import { useState, useEffect } from 'react'
import { STATUSES } from '../../lib/constants'
import { fmt } from '../../lib/utils'

const dimLabel = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: 'var(--muted)',
  fontWeight: 600,
}

// One editable stage line (status, comments, save) inside an open product row
export default function StageEditor({ p, stage, idx, onStage, operator, selected, onToggleSelect }) {
  const cur = p.stages[stage.k]
  const isDim = stage.k === 'dimensions'

  const [status, setStatus] = useState(cur.status)
  const [comments, setComments] = useState(cur.comments)
  const [width, setWidth] = useState(cur.width || '')
  const [height, setHeight] = useState(cur.height || '')
  const [weight, setWeight] = useState(cur.weight || '')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  // keep the form in sync when the server data changes
  useEffect(() => {
    setStatus(cur.status)
    setComments(cur.comments)
    if (isDim) {
      setWidth(cur.width || '')
      setHeight(cur.height || '')
      setWeight(cur.weight || '')
    }
  }, [cur.status, cur.comments, cur.width, cur.height, cur.weight, isDim])

  const effectivePerson = (operator && operator.trim()) || cur.person || ''
  const dirty =
    status !== cur.status ||
    comments !== cur.comments ||
    (isDim && (width !== (cur.width || '') || height !== (cur.height || '') || weight !== (cur.weight || '')))

  const save = async () => {
    // a completed stage can't be changed from here
    if (status !== cur.status && cur.status === 'Completed') {
      setStatus(cur.status)
      setComments(cur.comments)
      return
    }
    const patch = { status, person: effectivePerson, comments }
    if (isDim) Object.assign(patch, { width, height, weight })

    setBusy(true)
    setSaveErr('')
    try {
      await onStage(p.id, stage.k, patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 1400)
    } catch (e) {
      console.error('Stage save failed', e)
      setSaveErr('Save failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (cur.status === 'Completed') return null

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 11,
        padding: '12px 14px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          style={{ width: 14, height: 14, accentColor: 'var(--rose-ink)', flexShrink: 0, cursor: 'pointer' }}
          title="Select this stage for bulk actions"
        />
        <span className="stnum" style={{ flex: '0 0 22px' }}>
          {idx}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13, width: 150, flexShrink: 0 }}>{stage.n}</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{
            border: '1px solid var(--line2)',
            borderRadius: 8,
            padding: '6px 9px',
            background: 'var(--bg)',
            fontSize: 12,
            width: 130,
            flexShrink: 0,
          }}
        >
          {STATUSES.filter((s) => s !== 'Issue').map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span
          className="tag"
          style={{
            width: 110,
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--sage-ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={effectivePerson || 'no name set'}
        >
          {effectivePerson || '—'}
        </span>
        <input
          className="txt"
          placeholder="comments…"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          style={{ fontSize: 12, padding: '6px 9px', flex: 1, minWidth: 0 }}
        />
        <span style={{ fontSize: 10.5, color: 'var(--faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {cur.at ? fmt(cur.at) : '—'}
        </span>
        <button className={'mini ' + (saved ? 'saved' : '')} disabled={(!dirty && !saved) || busy} onClick={save} style={{ flexShrink: 0 }}>
          {busy ? 'Saving…' : saved ? '✓' : 'Save'}
        </button>
        {saveErr && (
          <span style={{ fontSize: 10.5, color: 'var(--rose-ink)', fontWeight: 600, flexShrink: 0 }}>{saveErr}</span>
        )}
        {p.division === 'Bombay Cards' && (
          <button
            onClick={() => onStage(p.id, stage.k, { skipped: true })}
            title="Mark this stage as not required for this card"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--muted)',
              border: '1px solid var(--line2)',
              background: 'var(--card-2)',
              borderRadius: 7,
              padding: '6px 9px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            ⊘ N/A
          </button>
        )}
      </div>

      {isDim && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10, paddingLeft: 36, flexWrap: 'wrap' }}>
          {[
            ['Height (cm)', height, setHeight, 'e.g. 14.5'],
            ['Width (cm)', width, setWidth, 'e.g. 10.5'],
            ['Weight (gm)', weight, setWeight, 'e.g. 85'],
          ].map(([label, val, setter, ph]) => (
            <label key={label} style={dimLabel}>
              {label}
              <input
                className="txt"
                type="number"
                placeholder={ph}
                value={val}
                onChange={(e) => setter(e.target.value)}
                style={{ fontSize: 12, padding: '6px 9px', width: 110 }}
              />
            </label>
          ))}
          {(cur.height || cur.width || cur.weight) && (
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--sage-ink)',
                  fontWeight: 600,
                  background: 'var(--sage-bg)',
                  border: '1px solid var(--sage)',
                  borderRadius: 7,
                  padding: '4px 10px',
                }}
              >
                Saved: {cur.height || '—'} × {cur.width || '—'} cm · {cur.weight || '—'} gm
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

