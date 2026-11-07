import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { useData } from '../context/DataContext'
import { fmt } from '../lib/utils'
import { I } from '../components/ui'

const STAGE_UPDATE_RE = /^(.+?)\s*→\s*([^·]+?)(?:\s*·\s*(.+))?$/
const lc = (s) => (s || '').trim().toLowerCase()

const monthKeyOf = (at) => {
  if (!at) return null
  const d = new Date(at)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const currentMonth = () => monthKeyOf(new Date().toISOString())

function statusColors(status) {
  if (status === 'Completed') return { bg: 'var(--sage-bg)', border: 'var(--sage)', ink: 'var(--sage-ink)' }
  if (status === 'In Progress') return { bg: 'var(--sky-bg)', border: 'var(--sky)', ink: 'var(--sky-ink)' }
  if (status === 'Issue') return { bg: 'var(--rose-bg)', border: 'var(--rose)', ink: 'var(--rose-ink)' }
  return { bg: '#F0EEE8', border: 'var(--line2)', ink: 'var(--muted)' }
}

function StatusPill({ status, label, small }) {
  const c = statusColors(status)
  return (
    <span
      style={{
        background: c.bg,
        color: c.ink,
        border: `1px solid ${c.border}`,
        borderRadius: 999,
        padding: small ? '2px 9px' : '2px 10px',
        fontSize: small ? 10.5 : 11,
        fontWeight: 600,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {label || status}
    </span>
  )
}

export default function Process() {
  const { division, products, teamMembers, assignments, audit } = useData()
  const [selMonth, setSelMonth] = useState(currentMonth)
  const [expandedMember, setExpandedMember] = useState(null)
  const [showDebug, setShowDebug] = useState(false)

  const skuToProduct = useMemo(() => {
    const m = {}
    products.forEach((p) => {
      m[p.sku] = p
      if (p.name) m[p.name.toLowerCase()] = p
    })
    return m
  }, [products])

  // every stage update / final audit in the chosen month and division
  const allActions = useMemo(() => {
    const rows = []
    audit.forEach((a) => {
      if (a.action !== 'Stage update' && a.action !== 'Final audit') return
      if (monthKeyOf(a.at) !== selMonth) return

      const prod = skuToProduct[a.entity] || skuToProduct[lc(a.entity)]
      const inDivision = a.division === division || (prod ? prod.division === division : !a.division)
      if (!inDivision) return

      const detail = String(a.detail || '')
      let stage, status, personFromDetail = ''
      if (a.action === 'Stage update') {
        const m = detail.match(STAGE_UPDATE_RE)
        if (!m) return
        stage = m[1].trim()
        status = m[2].trim()
        personFromDetail = (m[3] || '').trim()
      } else {
        stage = 'Final QC / Audit'
        status = detail.match(/Verdict:\s*(.+)/)?.[1]?.trim() || '—'
        if (status === '—') return
      }

      // whoever was named on the stage did the work; fall back to the logged-in operator
      const person = personFromDetail || (a.actor || '').trim()
      if (!person || lc(person) === 'unattributed') return

      rows.push({
        id: a.id,
        sku: prod ? prod.sku : a.entity,
        productName: prod ? prod.name || prod.sku : a.entity,
        stage,
        status: status || '—',
        person,
        at: a.at,
      })
    })
    return rows.sort((x, y) => new Date(y.at) - new Date(x.at))
  }, [audit, division, selMonth, skuToProduct])

  const months = useMemo(() => {
    const s = new Set(audit.map((a) => monthKeyOf(a.at)).filter(Boolean))
    if (s.size === 0) s.add(currentMonth())
    return [...s].sort().reverse()
  }, [audit])

  const getMemberActions = (m) => allActions.filter((r) => lc(r.person) === lc(m.name) || (m.email && lc(r.person) === lc(m.email)))

  const getAssignedCount = (m) =>
    new Set(assignments.filter((a) => a.memberId === m.id && a.division === division).map((a) => lc(a.sku))).size

  const downloadReport = (member, rows) => {
    const headers = ['Member Name', 'SKU', 'Product Name', 'Stage', 'Status', 'When']
    const data = rows.map((r) => [member.name, r.sku || '—', r.productName || '—', r.stage, r.status, fmt(r.at)])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 4) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Activity Log')
    XLSX.writeFile(wb, `${member.name}_${selMonth.replace('-', '_')}_activity.xlsx`)
  }

  const divMembers = teamMembers.filter(
    (m) => m.division === division || assignments.some((a) => a.memberId === m.id && a.division === division)
  )

  // debug info: what audit data actually arrived
  const actionCounts = useMemo(() => {
    const c = {}
    audit.forEach((a) => {
      const k = a.action || '(blank)'
      c[k] = (c[k] || 0) + 1
    })
    return c
  }, [audit])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Month</label>
        <select
          value={selMonth}
          onChange={(e) => setSelMonth(e.target.value)}
          style={{ border: '1px solid var(--line2)', borderRadius: 9, padding: '8px 12px', background: 'var(--card)', fontSize: 13, width: 'auto' }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Every action recorded for {selMonth} · {allActions.length} total actions in {division}
        </span>
        <button
          onClick={() => setShowDebug((s) => !s)}
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--rose-ink)',
            border: '1px solid var(--rose)',
            background: 'var(--rose-bg)',
            borderRadius: 8,
            padding: '5px 10px',
          }}
        >
          {showDebug ? 'Hide' : 'Show'} debug info
        </button>
      </div>

      {showDebug && (
        <div
          className="card pad"
          style={{ marginBottom: 20, fontSize: 12, lineHeight: 1.7, background: '#FFFBF0', border: '1px solid var(--peach)' }}
        >
          <b>Raw audit rows received from backend:</b> {audit.length}
          <br />
          <b>Action types found:</b>{' '}
          {Object.keys(actionCounts).length === 0
            ? '(none — audit array is empty)'
            : Object.entries(actionCounts)
                .map(([k, v]) => `${k} (${v})`)
                .join(', ')}
          <br />
          <b>Total team members loaded:</b> {teamMembers.length} · <b>for {division}:</b> {divMembers.length}
          <br />
          <b>Total assignments loaded:</b> {assignments.length}
          <br />
          <br />
          <b>First 3 raw audit rows:</b>
          <pre
            style={{
              background: '#fff',
              border: '1px solid var(--line2)',
              borderRadius: 8,
              padding: 10,
              overflowX: 'auto',
              fontSize: 11,
            }}
          >
            {JSON.stringify(audit.slice(0, 3), null, 2)}
          </pre>
          {audit.length === 0 && (
            <div style={{ color: 'var(--rose-ink)', fontWeight: 700 }}>
              → The audit array is empty. Check that /api/getAll returns an "audit" list.
            </div>
          )}
          {audit.length > 0 && allActions.length === 0 && (
            <div style={{ color: 'var(--rose-ink)', fontWeight: 700 }}>
              → Audit rows exist but none matched this month/division. Check that "Action types found" includes "Stage update" or "Final
              audit" exactly, and that the "at" field is a real date.
            </div>
          )}
        </div>
      )}

      {divMembers.length === 0 ? (
        <div className="card empty">No team members found for {division}. Add members in Assign Work first.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {divMembers.map((m) => {
            const rows = getMemberActions(m)
            const assignedCount = getAssignedCount(m)
            const isOpen = expandedMember === m.id
            const breakdown = ['Not Started', 'In Progress', 'Completed', 'Issue']
              .map((s) => ({ name: s, count: rows.filter((r) => r.status === s).length }))
              .filter((s) => s.count > 0)

            return (
              <div key={m.id} className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: 'linear-gradient(150deg, var(--sage), var(--sage-deep))',
                      display: 'grid',
                      placeItems: 'center',
                      color: '#fff',
                      fontFamily: 'var(--serif)',
                      fontWeight: 600,
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {m.name[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {assignedCount} SKU{assignedCount !== 1 ? 's' : ''} assigned
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontFamily: 'var(--serif)',
                        fontSize: 26,
                        fontWeight: 600,
                        lineHeight: 1,
                        color: rows.length > 0 ? 'var(--sage-ink)' : 'var(--faint)',
                      }}
                    >
                      {rows.length}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>actions</div>
                  </div>
                </div>

                {breakdown.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {breakdown.map((s) => (
                      <StatusPill key={s.name} status={s.name} label={`${s.name} · ${s.count}`} />
                    ))}
                  </div>
                )}

                {/* activity list */}
                {rows.length > 0 ? (
                  <div
                    style={{
                      maxHeight: isOpen ? 420 : 170,
                      overflowY: 'auto',
                      borderTop: '1px solid var(--line)',
                      paddingTop: 8,
                      transition: 'max-height .2s',
                    }}
                  >
                    {(isOpen ? rows : rows.slice(0, 6)).map((r, i) => (
                      <div
                        key={r.id + i}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)' }}
                      >
                        <span className="psku" style={{ flexShrink: 0, fontSize: 10.5 }}>
                          {r.sku || '—'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.stage}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--faint)' }}>{fmt(r.at)}</div>
                        </div>
                        <StatusPill status={r.status} small />
                      </div>
                    ))}
                    {rows.length > 6 && (
                      <button
                        onClick={() => setExpandedMember(isOpen ? null : m.id)}
                        style={{ fontSize: 11, color: isOpen ? 'var(--muted)' : 'var(--sage-ink)', fontWeight: 600, paddingTop: 6 }}
                      >
                        {isOpen ? 'Show less' : `+${rows.length - 6} more — view all`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', padding: '10px 0' }}>No recorded actions this month</div>
                )}

                <button
                  onClick={() => downloadReport(m, rows)}
                  disabled={rows.length === 0}
                  className="ghost"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12, opacity: rows.length === 0 ? 0.4 : 1 }}
                >
                  {I.upload({ width: 14, height: 14 })} Download full activity · {selMonth}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}