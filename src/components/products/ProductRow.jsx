import { useState, useEffect, useMemo } from 'react'
import { STAGES } from '../../lib/constants'
import { fmt } from '../../lib/utils'
import { CopySku } from '../ui'
import StageEditor from './StageEditor'
import QCStage from './QCStage'

const isQcFlagged = (stg) =>
  stg?.status === 'In Progress' && String(stg?.comments || '').startsWith('QC flagged:')

// colours for the "Stage: Status" pills shown when a member filter is active
const stagePillColors = (status) => {
  if (status === 'Completed') return ['var(--sage-bg)', 'var(--sage-ink)', 'var(--sage)']
  if (status === 'In Progress') return ['var(--sky-bg)', 'var(--sky-ink)', 'var(--sky)']
  if (status === 'Issue') return ['var(--rose-bg)', 'var(--rose-ink)', 'var(--rose)']
  return ['#F0EEE8', 'var(--muted)', 'var(--line2)']
}

export default function ProductRow({
  p,
  open,
  toggle,
  onStage,
  onQC,
  onRemove,
  allowedStages,
  selected,
  onSelect,
  operator,
  assignedTo,
  memberStages,
  memberComplete,
}) {
  const isFullAccess = allowedStages === null
  // allowedStages is already narrowed to this person's stages on this card
  const visibleStages = allowedStages ? STAGES.filter((s) => allowedStages.includes(s.k)) : STAGES

  const issueCount = visibleStages.reduce((n, s) => {
    const stg = p.stages[s.k]
    return n + (stg.status === 'Issue' || isQcFlagged(stg) ? 1 : 0)
  }, 0)

  /* ---------- multi-stage "mark as Issue" ---------- */
  const [stageSel, setStageSel] = useState({})
  const [issueNote, setIssueNote] = useState('')
  const [bulkIssueBusy, setBulkIssueBusy] = useState(false)
  const [markIssueErr, setMarkIssueErr] = useState('')

  const activeStages = visibleStages.filter(
    (s) => s.k !== 'finalqc' && p.stages[s.k].status !== 'Completed' && !p.stages[s.k].skipped
  )
  const completedStages = visibleStages.filter((s) => s.k !== 'finalqc' && p.stages[s.k].status === 'Completed')
  const skippedStages = visibleStages.filter((s) => s.k !== 'finalqc' && p.stages[s.k].skipped)
  const isBombay = p.division === 'Bombay Cards'

  const activeKeyString = activeStages.map((s) => s.k).join(',')
  const activeStageKeySet = useMemo(() => new Set(activeKeyString.split(',').filter(Boolean)), [activeKeyString])

  // drop selected stages that are no longer active (e.g. completed by someone else)
  useEffect(() => {
    setStageSel((prev) => {
      const next = {}
      let changed = false
      Object.keys(prev).forEach((k) => {
        if (prev[k] && activeStageKeySet.has(k)) next[k] = true
        else changed = true
      })
      return changed ? next : prev
    })
  }, [activeStageKeySet])

  const selectedStageKeys = Object.keys(stageSel).filter((k) => stageSel[k] && activeStageKeySet.has(k))
  const toggleStageSel = (k) => setStageSel((s) => ({ ...s, [k]: !s[k] }))
  const clearStageSel = () => {
    setStageSel({})
    setIssueNote('')
  }

  const markSelectedAsIssue = async () => {
    if (selectedStageKeys.length === 0) return
    setBulkIssueBusy(true)
    setMarkIssueErr('')
    const failedKeys = []
    for (const k of selectedStageKeys) {
      const cur = p.stages[k]
      try {
        await onStage(p.id, k, {
          status: 'Issue',
          person: operator || cur.person,
          comments: issueNote.trim() || cur.comments,
        })
      } catch (e) {
        console.error('markSelectedAsIssue failed for stage', k, e)
        failedKeys.push(k)
      }
    }
    setBulkIssueBusy(false)
    if (failedKeys.length > 0) {
      const names = failedKeys.map((k) => STAGES.find((s) => s.k === k)?.n || k)
      setMarkIssueErr(`Could not mark: ${names.join(', ')}. Please retry.`)
      // keep the failed ones ticked so the user can just retry
      setStageSel(Object.fromEntries(failedKeys.map((k) => [k, true])))
      setIssueNote('')
    } else {
      clearStageSel()
    }
  }

  const uniqueAssignees = assignedTo ? [...new Map(assignedTo.map((a) => [a.memberId, a])).values()] : []

  return (
    <div className="prow">
      {/* ---------- header ---------- */}
      <div className="phead" style={{ background: selected ? 'var(--sky-bg)' : '' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 15, height: 15, accentColor: 'var(--sky-ink)', cursor: 'pointer', flexShrink: 0 }}
        />
        <span className={'chev ' + (open ? 'open' : '')} onClick={toggle}>
          ▶
        </span>
        <CopySku sku={p.sku} onClick={toggle} />
        {p.name && <span className="pname">{p.name}</span>}
        <span className="pvend">
          · {p.vendor || '—'} · {p.qty || 0} cards
        </span>
        {p.set_no && (
          <span className="psku" style={{ background: 'var(--peach-bg)', color: 'var(--peach-ink)', border: '1px solid var(--peach)' }}>
            {p.set_no}
          </span>
        )}

        {uniqueAssignees.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {uniqueAssignees.map((a, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--sky-ink)',
                  background: 'var(--sky-bg)',
                  border: '1px solid var(--sky)',
                  borderRadius: 999,
                  padding: '2px 10px',
                }}
              >
                → {a.memberName}
              </span>
            ))}
          </span>
        )}

        {memberStages && memberStages.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {memberStages.map((ms, i) => {
              const [bg, ink, border] = stagePillColors(ms.stageStatus)
              return (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: '2px 10px',
                    background: bg,
                    color: ink,
                    border: `1px solid ${border}`,
                  }}
                >
                  {ms.stageName}: {ms.stageStatus}
                </span>
              )
            })}
          </span>
        )}

        <div className="spacer" />

        {memberComplete === true && (
          <span className="chip c-done">
            <span className="dot" />
            Completed
          </span>
        )}
        {memberComplete === false && (
          <span className="chip c-prog">
            <span className="dot" />
            Pending
          </span>
        )}
        {issueCount > 0 && (
          <span className="chip c-issue">
            <span className="dot" />
            {issueCount > 1 ? `${issueCount} Issues` : 'Issue'}
          </span>
        )}
        {p.verdict === 'Approved' && (
          <span className="chip c-done">
            <span className="dot" />
            QC Approved
          </span>
        )}
      </div>

      {/* ---------- body ---------- */}
      {open && (
        <div className="pbody">
          {/* "mark as Issue" bar */}
          {activeStages.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0', flexWrap: 'wrap' }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selectedStageKeys.length === activeStages.length && activeStages.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) setStageSel(Object.fromEntries(activeStages.map((s) => [s.k, true])))
                    else clearStageSel()
                  }}
                  style={{ width: 13, height: 13, accentColor: 'var(--rose-ink)' }}
                />
                Select stages
              </label>

              {selectedStageKeys.length > 0 && (
                <>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: 'var(--rose-ink)',
                      background: 'var(--rose-bg)',
                      border: '1px solid var(--rose)',
                      borderRadius: 999,
                      padding: '2px 10px',
                    }}
                  >
                    {selectedStageKeys.length} selected
                  </span>
                  <input
                    className="txt"
                    placeholder="Issue note (applies to all selected)…"
                    value={issueNote}
                    onChange={(e) => setIssueNote(e.target.value)}
                    style={{ fontSize: 12, padding: '6px 9px', flex: 1, minWidth: 160, maxWidth: 320 }}
                  />
                  <button
                    onClick={markSelectedAsIssue}
                    disabled={bulkIssueBusy}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '7px 14px',
                      borderRadius: 8,
                      background: 'var(--rose-ink)',
                      color: '#fff',
                      border: 0,
                      opacity: bulkIssueBusy ? 0.6 : 1,
                    }}
                  >
                    {bulkIssueBusy ? 'Marking…' : `⚠ Mark ${selectedStageKeys.length} as Issue`}
                  </button>
                  <button className="ghost" style={{ padding: '6px 10px', fontSize: 12 }} onClick={clearStageSel}>
                    Clear
                  </button>
                </>
              )}

              {markIssueErr && (
                <div style={{ width: '100%', fontSize: 11.5, color: 'var(--rose-ink)', fontWeight: 600 }}>{markIssueErr}</div>
              )}
            </div>
          )}

          {/* active stage editors */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px' }}>
            {activeStages.map((s) => (
              <StageEditor
                key={s.k}
                p={p}
                stage={s}
                idx={STAGES.findIndex((st) => st.k === s.k) + 1}
                onStage={onStage}
                operator={operator}
                selected={!!stageSel[s.k]}
                onToggleSelect={() => toggleStageSel(s.k)}
              />
            ))}
          </div>

          {/* completed stages as hover pills */}
          {completedStages.length > 0 && (
            <div
              style={{
                borderTop: '1px solid var(--line)',
                padding: '10px 16px',
                background: 'var(--sage-bg)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--sage-ink)',
                  letterSpacing: '.6px',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                Done
              </span>
              {completedStages.map((s) => {
                const st = p.stages[s.k]
                return (
                  <div key={s.k} className="done-pill-wrap" style={{ position: 'relative', display: 'inline-block' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        background: 'var(--card)',
                        border: '1px solid var(--sage)',
                        borderRadius: 999,
                        padding: '3px 11px',
                        fontSize: 12,
                        color: 'var(--sage-ink)',
                        fontWeight: 600,
                        cursor: 'default',
                      }}
                    >
                      ✓ {s.n}
                    </span>
                    <div
                      className="done-popup"
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 7px)',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'var(--ink)',
                        color: '#fff',
                        borderRadius: 9,
                        padding: '8px 12px',
                        fontSize: 11.5,
                        whiteSpace: 'nowrap',
                        zIndex: 10,
                        pointerEvents: 'none',
                        opacity: 0,
                        transition: 'opacity .15s',
                        lineHeight: 1.6,
                        boxShadow: 'var(--shadow-lg)',
                      }}
                    >
                      <b style={{ color: 'var(--sage)' }}>✓ {s.n}</b>
                      <br />
                      {st.person && (
                        <span>
                          By: {st.person}
                          <br />
                        </span>
                      )}
                      {s.k === 'dimensions' && (st.height || st.width || st.weight) && (
                        <span>
                          {st.height || '—'} × {st.width || '—'} cm · {st.weight || '—'} gm
                          <br />
                        </span>
                      )}
                      {st.comments && (
                        <span>
                          Note: {st.comments}
                          <br />
                        </span>
                      )}
                      <span style={{ color: '#B3AFA4' }}>{st.at ? fmt(st.at) : '—'}</span>
                      <div
                        style={{
                          position: 'absolute',
                          bottom: -5,
                          left: '50%',
                          transform: 'translateX(-50%) rotate(45deg)',
                          width: 10,
                          height: 10,
                          background: 'var(--ink)',
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* stages marked "not required" (Bombay only) */}
          {skippedStages.length > 0 && (
            <div
              style={{
                borderTop: '1px solid var(--line)',
                padding: '10px 16px',
                background: '#F0EEE8',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--muted)',
                  letterSpacing: '.6px',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                Not Required
              </span>
              {skippedStages.map((s) => (
                <span
                  key={s.k}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'var(--card)',
                    border: '1px solid var(--line2)',
                    borderRadius: 999,
                    padding: '3px 11px',
                    fontSize: 12,
                    color: 'var(--muted)',
                    fontWeight: 600,
                  }}
                >
                  ⊘ {s.n}
                  {isBombay && (
                    <button
                      onClick={() => onStage(p.id, s.k, { skipped: false })}
                      style={{ fontSize: 10, fontWeight: 700, color: 'var(--sky-ink)', border: 0, background: 'none', padding: 0 }}
                    >
                      Undo
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {isFullAccess && <QCStage p={p} idx={STAGES.length} onQC={onQC} />}

          <div style={{ padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="tag">
              Inward {p.inward || '—'} · created {fmt(p.createdAt)} · updated {fmt(p.updatedAt)}
            </span>
            {isFullAccess && (
              <button
                className="danger"
                onClick={() => {
                  if (confirm('Delete this product?')) onRemove(p.id)
                }}
              >
                Delete product
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}