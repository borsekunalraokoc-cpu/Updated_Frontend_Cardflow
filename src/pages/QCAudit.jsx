import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { STAGES } from '../lib/constants'
import { fmt } from '../lib/utils'
import { I, Pipe, CopySku } from '../components/ui'

// stages that must be done before a card can be QC'd
const ELIGIBLE_STAGES = STAGES.filter((s) => !['scan', 'qc', 'finalqc'].includes(s.k))
const lc = (s) => (s || '').trim().toLowerCase()
const isQcFlagged = (stg) =>
  stg?.status === 'In Progress' && String(stg?.comments || '').startsWith('QC flagged:')
const isStageDone = (p, k) => p.stages[k]?.skipped || p.stages[k]?.status === 'Completed'
const completedStages = (p) => ELIGIBLE_STAGES.filter((s) => p.stages[s.k].status === 'Completed')

const sectionLabel = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.6px',
  marginBottom: 8,
}
const filterSelect = {
  border: '1px solid var(--line2)',
  borderRadius: 10,
  padding: '9px 12px',
  background: 'var(--card)',
  fontSize: 13,
  fontWeight: 500,
  minWidth: 180,
}

// colours for each stage pill in "Pipeline status"
function stagePill(sg) {
  if (sg.skipped) return { bg: '#F0EEE8', border: 'var(--line2)', ink: 'var(--muted)', icon: '⊘' }
  if (sg.status === 'Issue' || isQcFlagged(sg)) return { bg: 'var(--rose-bg)', border: 'var(--rose)', ink: 'var(--rose-ink)', icon: '⚠' }
  if (sg.status === 'Completed') return { bg: 'var(--sage-bg)', border: 'var(--sage)', ink: 'var(--sage-ink)', icon: '✓' }
  if (sg.status === 'In Progress') return { bg: 'var(--sky-bg)', border: 'var(--sky)', ink: 'var(--sky-ink)', icon: '…' }
  return { bg: '#F0EEE8', border: 'var(--line2)', ink: 'var(--muted)', icon: '○' }
}

function verdictBadge(verdict) {
  if (verdict === 'Approved') return ['var(--sage-bg)', 'var(--sage-ink)', 'var(--sage)', '✓ Approved']
  if (verdict === 'Issues Found') return ['var(--rose-bg)', 'var(--rose-ink)', 'var(--rose)', '⚠ Issues']
  return ['var(--peach-bg)', 'var(--peach-ink)', 'var(--peach)', '⏳ Pending']
}

export default function QCAudit({ products, initialFilter, onFilterConsumed }) {
  const { auth, operator } = useAuth()
  const { qcAuditLog, submitQCAudit } = useData()
  const isMasterOrAdmin = auth?.role === 'master' || auth?.role === 'admin'

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState(initialFilter || 'pending')
  const [fSetNo, setFSetNo] = useState('')
  const [fVendor, setFVendor] = useState('')
  const [expanded, setExpanded] = useState({})
  const [verdicts, setVerdicts] = useState({}) // pid -> { verdict, comments, stagesBack }
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [copied, setCopied] = useState({})
  const [bulkSelected, setBulkSelected] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDone, setBulkDone] = useState(false)

  // deep link from Overview ("issues")
  useEffect(() => {
    if (initialFilter) {
      setFilter(initialFilter)
      onFilterConsumed && onFilterConsumed()
    }
  }, [initialFilter, onFilterConsumed])

  /* ---------- dropdown options ---------- */
  const vendorOptions = useMemo(
    () => [...new Set(products.map((p) => (p.vendor || '').trim()).filter(Boolean))].sort(),
    [products]
  )
  // set numbers narrow to the chosen vendor
  const setNoOptions = useMemo(
    () =>
      [
        ...new Set(
          products
            .filter((p) => !fVendor || lc(p.vendor) === lc(fVendor))
            .map((p) => p.set_no)
            .filter(Boolean)
        ),
      ].sort(),
    [products, fVendor]
  )

  /* ---------- flag history ---------- */
  const wasFlaggedBefore = (p) =>
    qcAuditLog.some((r) => r.productId === p.id && r.verdict === 'Issues Found') ||
    STAGES.filter((s) => s.k !== 'finalqc').some((s) => String(p.stages[s.k]?.comments || '').includes('QC flagged:'))

  const getFlaggedStageKeys = (p) => {
    const fromLog = qcAuditLog
      .filter((r) => r.productId === p.id && r.verdict === 'Issues Found' && r.stagesSentBack)
      .flatMap((r) => r.stagesSentBack.split(',').map((s) => s.trim()).filter(Boolean))
    const fromComments = ELIGIBLE_STAGES.filter((s) => String(p.stages[s.k]?.comments || '').includes('QC flagged:')).map((s) => s.k)
    return [...new Set([...fromLog, ...fromComments])]
  }

  const allStagesDone = (p) => ELIGIBLE_STAGES.every((s) => isStageDone(p, s.k))

  // flagged before, and the flagged stages are now fixed → ready for re-review
  const isResolved = (p) => {
    if (p.verdict || !wasFlaggedBefore(p)) return false
    const keys = getFlaggedStageKeys(p)
    return keys.length > 0 ? keys.every((k) => p.stages[k]?.status === 'Completed') : allStagesDone(p)
  }

  /* ---------- filtered list ---------- */
  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (q && !`${p.sku} ${p.name || ''} ${p.vendor || ''}`.toLowerCase().includes(q.toLowerCase())) return false
      if (isMasterOrAdmin && fVendor && lc(p.vendor) !== lc(fVendor)) return false
      if (isMasterOrAdmin && fSetNo && lc(p.set_no) !== lc(fSetNo)) return false

      const flaggedBefore = wasFlaggedBefore(p)
      const keys = getFlaggedStageKeys(p)
      const flaggedDone = keys.length > 0 ? keys.every((k) => p.stages[k]?.status === 'Completed') : allStagesDone(p)

      if (filter === 'pending') return !p.verdict && allStagesDone(p) && !flaggedBefore
      if (filter === 'resolved') return !p.verdict && flaggedBefore && flaggedDone
      if (filter === 'approved') return p.verdict === 'Approved'
      if (filter === 'issues') return p.verdict === 'Issues Found'
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, q, filter, qcAuditLog, fSetNo, fVendor, isMasterOrAdmin])

  /* ---------- KPI counts ---------- */
  const resolvedCount = products.filter(isResolved).length
  const pendingCount = products.filter((p) => !p.verdict).length - resolvedCount
  const approvedCount = products.filter((p) => p.verdict === 'Approved').length

  // count issue INSTANCES (a card can have several flagged stages) — matches Overview
  const issuesCount = products.reduce((sum, p) => {
    if (p.verdict === 'Approved') return sum
    const n = ELIGIBLE_STAGES.filter((s) => {
      const stg = p.stages[s.k]
      return stg && (stg.status === 'Issue' || isQcFlagged(stg))
    }).length
    return sum + (n === 0 && p.verdict === 'Issues Found' ? 1 : n)
  }, 0)

  const kpis = [
    { lab: 'Pending QC', val: pendingCount, bg: 'var(--peach-bg)', border: 'var(--peach)', color: 'var(--peach-ink)', key: 'pending' },
    { lab: 'Issue Resolved', val: resolvedCount, bg: 'var(--sky-bg)', border: 'var(--sky)', color: 'var(--sky-ink)', key: 'resolved' },
    { lab: 'Approved', val: approvedCount, bg: 'var(--sage-bg)', border: 'var(--sage)', color: 'var(--sage-ink)', key: 'approved' },
    { lab: 'Issues Found', val: issuesCount, bg: 'var(--rose-bg)', border: 'var(--rose)', color: 'var(--rose-ink)', key: 'issues' },
    { lab: 'Total Products', val: products.length, bg: 'var(--card)', border: 'var(--line2)', color: 'var(--ink)', key: 'all' },
  ]

  /* ---------- per-card form state ---------- */
  const getVState = (pid) => verdicts[pid] || { verdict: '', comments: '', stagesBack: [] }
  const setVState = (pid, patch) => setVerdicts((v) => ({ ...v, [pid]: { ...getVState(pid), ...patch } }))

  const handleSubmit = async (p) => {
    const st = getVState(p.id)
    if (!st.verdict) return
    setSaving((s) => ({ ...s, [p.id]: true }))
    await submitQCAudit(p.id, st.verdict, st.comments, st.stagesBack)
    setSaving((s) => ({ ...s, [p.id]: false }))
    setSaved((s) => ({ ...s, [p.id]: true }))
    setTimeout(() => setSaved((s) => ({ ...s, [p.id]: false })), 2200)
  }

  /* ---------- bulk approve ---------- */
  const toggleBulkSelect = (id) =>
    setBulkSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const clearBulkSelect = () => setBulkSelected(new Set())

  const bulkApprove = async () => {
    if (bulkSelected.size === 0) return
    setBulkBusy(true)
    for (const pid of bulkSelected) {
      await submitQCAudit(pid, 'Approved', '', [])
    }
    setBulkBusy(false)
    setBulkDone(true)
    setBulkSelected(new Set())
    setTimeout(() => setBulkDone(false), 2000)
  }

  /* ====================== RENDER ====================== */
  return (
    <div>
      {/* ---------- KPI row ---------- */}
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div
            key={k.key}
            className="card kpi"
            onClick={() => setFilter(k.key)}
            style={{
              background: k.bg,
              border: filter === k.key ? `2px solid ${k.color}` : `1px solid ${k.border}`,
              cursor: 'pointer',
            }}
          >
            <div className="lab">{k.lab}</div>
            <div className="val" style={{ color: k.color }}>
              {k.val}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- vendor / set filters (master/admin) ---------- */}
      {isMasterOrAdmin && (vendorOptions.length > 0 || setNoOptions.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <select
            value={fVendor}
            onChange={(e) => {
              setFVendor(e.target.value)
              setFSetNo('')
              clearBulkSelect()
            }}
            style={filterSelect}
          >
            <option value="">— all vendors —</option>
            {vendorOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select value={fSetNo} onChange={(e) => setFSetNo(e.target.value)} style={filterSelect}>
            <option value="">— all set no. —</option>
            {setNoOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {(fVendor || fSetNo) && (
            <button
              className="ghost"
              style={{ padding: '6px 10px', fontSize: 12 }}
              onClick={() => {
                setFVendor('')
                setFSetNo('')
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ---------- search ---------- */}
      <div className="toolbar">
        <div className="search">
          {I.search({})}
          <input placeholder="Search SKU, product or vendor" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.length > 0 &&
            (() => {
              const sugs = products
                .filter((p) => `${p.sku} ${p.name || ''} ${p.vendor || ''}`.toLowerCase().includes(q.toLowerCase()))
                .slice(0, 8)
              // hide the dropdown once the search is an exact SKU
              if (sugs.length === 0 || (sugs.length === 1 && sugs[0].sku === q)) return null
              return (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'var(--card)',
                    border: '1px solid var(--line2)',
                    borderRadius: 12,
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 50,
                    overflow: 'hidden',
                  }}
                >
                  {sugs.map((p) => {
                    const [bg, ink, border, label] = verdictBadge(p.verdict)
                    return (
                      <div
                        key={p.id}
                        onMouseDown={() => setQ(p.sku)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '9px 14px',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--line)',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-2)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--card)')}
                      >
                        <CopySku sku={p.sku} style={{ flexShrink: 0 }} />
                        {p.name && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>}
                        {p.vendor && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{p.vendor}</span>}
                        {p.set_no && (
                          <span
                            className="psku"
                            style={{ background: 'var(--peach-bg)', color: 'var(--peach-ink)', border: '1px solid var(--peach)', flexShrink: 0 }}
                          >
                            {p.set_no}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            borderRadius: 999,
                            padding: '2px 9px',
                            flexShrink: 0,
                            background: bg,
                            color: ink,
                            border: `1px solid ${border}`,
                          }}
                        >
                          {label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
        </div>
      </div>

      {/* ---------- bulk approve bar ---------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={bulkSelected.size === filtered.length && filtered.length > 0}
            onChange={(e) => (e.target.checked ? setBulkSelected(new Set(filtered.map((p) => p.id))) : clearBulkSelect())}
            style={{ width: 15, height: 15, accentColor: 'var(--sage-deep)' }}
          />
          Select all ({filtered.length})
        </label>
        {bulkSelected.size > 0 && (
          <>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--sky-ink)',
                background: 'var(--sky-bg)',
                border: '1px solid var(--sky)',
                borderRadius: 999,
                padding: '3px 14px',
              }}
            >
              {bulkSelected.size} selected
            </span>
            <button
              onClick={bulkApprove}
              disabled={bulkBusy}
              style={{
                padding: '8px 20px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                background: bulkDone ? 'var(--sage)' : 'var(--sage-deep)',
                color: '#fff',
                border: 0,
                opacity: bulkBusy ? 0.6 : 1,
              }}
            >
              {bulkBusy ? 'Approving…' : bulkDone ? '✓ Done' : `✓ Approve all (${bulkSelected.size})`}
            </button>
            <button className="ghost" style={{ padding: '7px 14px', fontSize: 12 }} onClick={clearBulkSelect}>
              Clear
            </button>
          </>
        )}
      </div>

      {/* ---------- cards ---------- */}
      {filtered.length === 0 ? (
        <div className="card empty">No products match this filter.</div>
      ) : (
        <div className="plist">
          {filtered.map((p) => {
            const st = getVState(p.id)
            const isOpen = !!expanded[p.id]
            const done = allStagesDone(p)
            const resolved = isResolved(p)
            const flaggedBefore = wasFlaggedBefore(p)
            const doneStages = completedStages(p)

            // a card that already has issues can get MORE issues raised
            // before the first ones are fixed; approving still needs every stage done
            const gateBlocks = !done && !(p.verdict === 'Issues Found' && st.verdict === 'Issues Found')
            const needsStagePick = st.verdict === 'Issues Found' && doneStages.length > 0 && st.stagesBack.length === 0
            const submitDisabled =
              gateBlocks || !st.verdict || saving[p.id] || (st.verdict === 'Issues Found' && !st.comments?.trim()) || needsStagePick

            const submitLabel = gateBlocks
              ? 'Pipeline incomplete — finish all stages first'
              : saving[p.id]
              ? 'Saving…'
              : saved[p.id]
              ? '✓ Saved'
              : st.verdict === 'Approved'
              ? 'Confirm Approval'
              : needsStagePick
              ? 'Select at least one stage to send back'
              : st.verdict === 'Issues Found'
              ? 'Submit & Send Back'
              : 'Select a verdict first'

            const history = qcAuditLog.filter((r) => r.productId === p.id)

            return (
              <div key={p.id} className="prow">
                {/* header */}
                <div className="phead" onClick={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}>
                  <input
                    type="checkbox"
                    checked={bulkSelected.has(p.id)}
                    onChange={(e) => {
                      e.stopPropagation()
                      toggleBulkSelect(p.id)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 15, height: 15, accentColor: 'var(--sage-deep)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span className={'chev ' + (isOpen ? 'open' : '')}>▶</span>
                  <span className="psku">{p.sku || 'no-sku'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard.writeText(p.sku || '')
                      setCopied((c) => ({ ...c, [p.id]: true }))
                      setTimeout(() => setCopied((c) => ({ ...c, [p.id]: false })), 1500)
                    }}
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: '2px 9px',
                      borderRadius: 6,
                      background: copied[p.id] ? 'var(--sage-bg)' : 'var(--card)',
                      border: `1px solid ${copied[p.id] ? 'var(--sage)' : 'var(--line2)'}`,
                      color: copied[p.id] ? 'var(--sage-ink)' : 'var(--muted)',
                      flexShrink: 0,
                      transition: '.15s',
                    }}
                  >
                    {copied[p.id] ? '✓ Copied' : 'Copy SKU'}
                  </button>
                  {p.name && <span className="pname">{p.name}</span>}
                  <span className="pvend">
                    · {p.vendor || '—'} · {p.qty || 0} cards
                  </span>
                  {p.set_no && (
                    <span className="psku" style={{ background: 'var(--peach-bg)', color: 'var(--peach-ink)', border: '1px solid var(--peach)' }}>
                      {p.set_no}
                    </span>
                  )}
                  <div className="spacer" />
                  {p.verdict === 'Approved' && (
                    <span className="chip c-done">
                      <span className="dot" />
                      Approved
                    </span>
                  )}
                  {p.verdict === 'Issues Found' && (
                    <span className="chip c-issue">
                      <span className="dot" />
                      Issues Found
                    </span>
                  )}
                  {!p.verdict && resolved && (
                    <span className="chip" style={{ background: 'var(--sky-bg)', color: 'var(--sky-ink)', border: '1px solid var(--sky)' }}>
                      <span className="dot" style={{ background: 'var(--sky)' }} />↻ Issue Resolved — Re-review
                    </span>
                  )}
                  {!p.verdict && done && !flaggedBefore && (
                    <span className="chip c-prog">
                      <span className="dot" />
                      Ready for QC
                    </span>
                  )}
                  {!p.verdict && !done && !resolved && (
                    <span className="chip c-app">
                      <span className="dot" />
                      Pipeline incomplete
                    </span>
                  )}
                  <Pipe p={p} />
                </div>

                {isOpen && (
                  <div className="pbody" style={{ padding: '16px 18px' }}>
                    {/* pipeline overview */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={sectionLabel}>Pipeline status</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {ELIGIBLE_STAGES.map((s) => {
                          const sg = p.stages[s.k]
                          const c = stagePill(sg)
                          const strong = !sg.skipped && (sg.status === 'Issue' || isQcFlagged(sg))
                          return (
                            <span
                              key={s.k}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                background: c.bg,
                                border: `${strong ? 2 : 1}px solid ${c.border}`,
                                color: c.ink,
                                borderRadius: 8,
                                padding: '3px 10px',
                                fontSize: 11.5,
                                fontWeight: 700,
                              }}
                              title={sg.skipped ? 'Marked Not Required' : isQcFlagged(sg) ? sg.comments.replace(/^QC flagged:\s*/, '') : undefined}
                            >
                              {c.icon} {s.n}
                              {sg.skipped ? ' (N/A)' : sg.person ? ` · ${sg.person}` : ''}
                            </span>
                          )
                        })}
                      </div>
                    </div>

                    {/* existing verdict */}
                    {p.verdict && (
                      <div
                        style={{
                          marginBottom: 14,
                          background: p.verdict === 'Approved' ? 'var(--sage-bg)' : 'var(--rose-bg)',
                          border: `1px solid ${p.verdict === 'Approved' ? 'var(--sage)' : 'var(--rose)'}`,
                          borderRadius: 10,
                          padding: '10px 14px',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13, color: p.verdict === 'Approved' ? 'var(--sage-ink)' : 'var(--rose-ink)' }}>
                          {p.verdict === 'Approved' ? '✓ Currently Approved' : '⚠ Issues Found'}
                        </div>
                        {p.issues && <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 4 }}>{p.issues}</div>}
                        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>Use the form below to re-audit</div>
                      </div>
                    )}

                    {/* QC form */}
                    <div style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 12, padding: 16 }}>
                      <div style={{ ...sectionLabel, marginBottom: 12 }}>{p.verdict ? 'Re-audit' : 'QC Verdict'}</div>

                      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                        {[
                          { v: 'Approved', active: 'var(--sage-deep)', passiveBg: 'var(--sage-bg)', passiveBorder: 'var(--sage)', ink: 'var(--sage-ink)', label: '✓  Approve' },
                          { v: 'Issues Found', active: 'var(--rose-ink)', passiveBg: 'var(--rose-bg)', passiveBorder: 'var(--rose)', ink: 'var(--rose-ink)', label: '⚠  Issues Found' },
                        ].map((opt) => {
                          const on = st.verdict === opt.v
                          return (
                            <button
                              key={opt.v}
                              onClick={() => setVState(p.id, { verdict: opt.v, stagesBack: opt.v === 'Approved' ? [] : st.stagesBack })}
                              style={{
                                flex: 1,
                                padding: '11px 0',
                                borderRadius: 10,
                                fontWeight: 700,
                                fontSize: 13,
                                transition: '.15s',
                                background: on ? opt.active : opt.passiveBg,
                                border: `2px solid ${on ? opt.active : opt.passiveBorder}`,
                                color: on ? '#fff' : opt.ink,
                              }}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>

                      {st.verdict === 'Issues Found' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <label className="fld">
                            Describe the issue(s) *
                            <textarea
                              placeholder="e.g. colour mismatch on 3 cards, content typo in line 2, image missing…"
                              value={st.comments || ''}
                              onChange={(e) => setVState(p.id, { comments: e.target.value })}
                              style={{ minHeight: 80, fontSize: 13 }}
                            />
                          </label>
                          <label className="fld">
                            Send these stages back to "In Progress"
                            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2, marginBottom: 6 }}>
                              Only completed stages shown — select ones that need rework
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {doneStages.map((s) => {
                                const checked = st.stagesBack.includes(s.k)
                                return (
                                  <label
                                    key={s.k}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      fontSize: 12,
                                      fontWeight: 500,
                                      cursor: 'pointer',
                                      background: checked ? 'var(--sky-bg)' : 'var(--card)',
                                      border: `1px solid ${checked ? 'var(--sky)' : 'var(--line2)'}`,
                                      color: checked ? 'var(--sky-ink)' : 'var(--ink)',
                                      borderRadius: 8,
                                      padding: '5px 10px',
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      style={{ width: 13, height: 13, accentColor: 'var(--sky-ink)' }}
                                      onChange={(e) =>
                                        setVState(p.id, {
                                          stagesBack: e.target.checked ? [...st.stagesBack, s.k] : st.stagesBack.filter((k) => k !== s.k),
                                        })
                                      }
                                    />
                                    {s.n}
                                  </label>
                                )
                              })}
                              {doneStages.length === 0 && <span style={{ fontSize: 12, color: 'var(--faint)' }}>No completed stages to send back</span>}
                            </div>
                          </label>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Auditor: <b style={{ color: 'var(--ink)' }}>{operator}</b>
                        </span>
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => handleSubmit(p)}
                          disabled={submitDisabled}
                          style={{
                            padding: '10px 24px',
                            borderRadius: 10,
                            fontWeight: 700,
                            fontSize: 13,
                            border: 0,
                            transition: '.15s',
                            background: saved[p.id]
                              ? 'var(--sage)'
                              : st.verdict === 'Approved'
                              ? 'var(--sage-deep)'
                              : st.verdict === 'Issues Found'
                              ? 'var(--rose-ink)'
                              : 'var(--faint)',
                            color: '#fff',
                            opacity: submitDisabled ? 0.45 : 1,
                          }}
                        >
                          {submitLabel}
                        </button>
                      </div>
                    </div>

                    {/* QC history */}
                    {history.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <div style={sectionLabel}>QC history</div>
                        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                          {history.map((r, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                gap: 12,
                                alignItems: 'flex-start',
                                padding: '10px 14px',
                                borderBottom: i < history.length - 1 ? '1px solid var(--line)' : 'none',
                                background: r.verdict === 'Approved' ? 'var(--sage-bg)' : 'var(--rose-bg)',
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, fontSize: 12, color: r.verdict === 'Approved' ? 'var(--sage-ink)' : 'var(--rose-ink)' }}>
                                    {r.verdict === 'Approved' ? '✓ Approved' : '⚠ Issues Found'}
                                  </span>
                                  {r.stagesSentBack && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: 'var(--sky-ink)',
                                        fontWeight: 600,
                                        background: 'var(--sky-bg)',
                                        border: '1px solid var(--sky)',
                                        borderRadius: 6,
                                        padding: '1px 8px',
                                      }}
                                    >
                                      ↩ {r.stagesSentBack.split(',').map((k) => STAGES.find((s) => s.k === k)?.n || k).join(', ')}
                                    </span>
                                  )}
                                </div>
                                {r.comments && <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 3 }}>{r.comments}</div>}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0 }}>
                                <div>{fmt(r.at)}</div>
                                <div style={{ fontWeight: 600, color: 'var(--muted)' }}>by {r.auditor}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}