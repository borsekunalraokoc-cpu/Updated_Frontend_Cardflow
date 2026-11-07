import { useState, useEffect, useMemo, useRef } from 'react'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'
import { API } from '../api'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { BACKEND_STAGE_GROUP, PHOTO_VIDEO_STAGE_GROUP } from '../lib/constants'
import { fmt } from '../lib/utils'
import { I } from '../components/ui'
import TeamStageTable from '../components/analytics/TeamStageTable'
import VendorNotes from '../components/analytics/VendorNotes'

const lc = (s) => (s || '').trim().toLowerCase()
const filterInput = {
  border: '1px solid var(--line2)',
  borderRadius: 8,
  padding: '6px 10px',
  background: 'var(--card)',
  fontSize: 12.5,
}

// Turn the /api/memberStageDetail response into table rows for one stage group
function rowsForGroup(members, stageGroup) {
  const keys = new Set(stageGroup.map((s) => s.k))
  return members
    .map((m) => {
      const perStage = {}
      ;(m.stages || []).forEach((s) => {
        if (keys.has(s.stage))
          perStage[s.stage] = { completed: s.completedSkus, pending: s.inProgressSkus + s.notStartedSkus, issue: s.issueSkus }
      })
      if (Object.keys(perStage).length === 0) return null
      return { memberId: m.memberId, memberName: m.memberName, totalAssigned: m.totalAssignedSkus, perStage }
    })
    .filter(Boolean)
}

export default function SpeedAnalytics({ products, initialFilter, onFilterConsumed }) {
  const { auth } = useAuth()
  const { division } = useData()
  const isMasterOrAdmin = auth?.role === 'master' || auth?.role === 'admin'

  const [subTab, setSubTab] = useState('overview') // overview | team | full
  const [fVendor, setFVendor] = useState('')
  const [fSetNo, setFSetNo] = useState('')
  const [fDateFrom, setFDateFrom] = useState('') // Team tab (dates)
  const [fDateTo, setFDateTo] = useState('')
  const [fCompletedFrom, setFCompletedFrom] = useState('') // Full tab (date + time)
  const [fCompletedTo, setFCompletedTo] = useState('')

  // arriving from the Bombay vendor flyout in the sidebar
  useEffect(() => {
    if (initialFilter?.vendor) {
      setFVendor(initialFilter.vendor)
      setSubTab('full')
      onFilterConsumed && onFilterConsumed()
    }
  }, [initialFilter, onFilterConsumed])

  const vendorOptions = useMemo(() => [...new Set(products.map((p) => (p.vendor || '').trim()).filter(Boolean))].sort(), [products])
  const setNoOptions = useMemo(() => [...new Set(products.map((p) => p.set_no).filter(Boolean))].sort(), [products])

  /* ---------- KPI cards (follow vendor / set filters) ---------- */
  const productKpis = useMemo(() => {
    const pool = products.filter(
      (p) => (!fVendor || (p.vendor || '').trim() === fVendor.trim()) && (!fSetNo || lc(p.set_no) === lc(fSetNo))
    )
    const complete = pool.filter((p) => p.verdict === 'Approved').length
    const issues = pool.filter(
      (p) => p.verdict === 'Issues Found' || Object.values(p.stages || {}).some((s) => s.status === 'Issue')
    ).length
    const pending = pool.length - complete - issues
    return [
      { lab: 'Total Products', val: pool.length, sub: [fVendor, fSetNo].filter(Boolean).join(' · ') || division, ic: I.box, scope: 'all' },
      {
        lab: 'Pending',
        val: pending,
        sub: 'not yet assigned',
        ic: I.layers,
        color: pending > 0 ? 'var(--peach-ink)' : 'var(--sage-ink)',
        scope: 'pending',
      },
      { lab: 'Complete', val: complete, sub: 'fully done', ic: I.check, color: 'var(--sage-ink)', scope: 'completed' },
      {
        lab: 'Issues',
        val: issues,
        sub: `${issues} flagged stage(s)`,
        ic: I.alert,
        color: issues ? 'var(--rose-ink)' : 'var(--ink)',
        scope: 'issues',
      },
    ]
  }, [products, division, fVendor, fSetNo])

  const [kpiExporting, setKpiExporting] = useState('')
  const downloadKpiExcel = async (scope, label) => {
    setKpiExporting(scope)
    try {
      const res = await fetch(`${API}/api/exportProducts?${new URLSearchParams({ division, scope })}`)
      const data = await res.json()
      if (!data.ok) return alert('Export failed: ' + (data.error || 'unknown error'))
      const headers = ['SKU', 'Name', 'Vendor', 'Qty', 'Verdict', 'Next Pending Stage', 'Last Updated']
      const rows = data.rows.map((r) => [
        r.sku,
        r.name || '',
        r.vendor || '',
        r.qty || 0,
        r.verdict || '',
        r.next_pending_stage || '',
        r.updated_at ? fmt(r.updated_at) : '',
      ])
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 4) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, label)
      XLSX.writeFile(wb, `${division}_${label}_${scope}.xlsx`)
    } catch (e) {
      console.error('downloadKpiExcel error', e)
      alert('Export failed — check console.')
    } finally {
      setKpiExporting('')
    }
  }

  /* ---------- Stage Speed (bar chart) ---------- */
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/stageSpeedStats?division=${encodeURIComponent(division)}`)
      .then((r) => r.json())
      .then((d) => d.ok && setStats(d.stats))
      .catch((e) => console.error('stageSpeedStats fetch failed', e))
      .finally(() => setLoading(false))
  }, [division])

  useEffect(() => {
    if (subTab !== 'overview' || !stats || stats.length === 0 || !canvasRef.current) return
    const avg = stats.reduce((a, b) => a + b.avgHours, 0) / stats.length
    chartRef.current?.destroy()
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: stats.map((s) => s.stageName),
        datasets: [
          {
            label: 'Avg hours to complete',
            data: stats.map((s) => Math.round(s.avgHours * 10) / 10),
            backgroundColor: stats.map((s) => (s.avgHours > avg ? '#D89F9F' : '#9CBE9A')), // slower than average = rose
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: 'Hours' } } },
      },
    })
    return () => chartRef.current?.destroy()
  }, [stats, subTab])

  /* ---------- per-member × per-stage data (Team Assigned + Full Breakdown) ---------- */
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)

  useEffect(() => {
    if (!isMasterOrAdmin || (subTab !== 'full' && subTab !== 'team')) return
    const params = new URLSearchParams({ division })
    if (fVendor) params.set('vendor', fVendor)
    if (fSetNo) params.set('set_no', fSetNo)
    const from = subTab === 'full' ? fCompletedFrom : fDateFrom
    const to = subTab === 'full' ? fCompletedTo : fDateTo ? fDateTo + 'T23:59' : ''
    if (from) params.set('completedFrom', from)
    if (to) params.set('completedTo', to)

    setMembersLoading(true)
    fetch(`${API}/api/memberStageDetail?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        if (!(r.headers.get('content-type') || '').includes('application/json')) throw new Error('Endpoint not implemented on backend')
        return r.json()
      })
      .then((d) => d.ok && setMembers(d.members || []))
      .catch((e) => {
        console.warn('memberStageDetail unavailable:', e.message)
        setMembers([])
      })
      .finally(() => setMembersLoading(false))
  }, [division, fVendor, fSetNo, fDateFrom, fDateTo, fCompletedFrom, fCompletedTo, subTab, isMasterOrAdmin])

  const backendRows = useMemo(() => rowsForGroup(members, BACKEND_STAGE_GROUP), [members])
  const photoRows = useMemo(() => rowsForGroup(members, PHOTO_VIDEO_STAGE_GROUP), [members])

  const anyFilter = fVendor || fSetNo || fDateFrom || fDateTo || fCompletedFrom || fCompletedTo
  const clearFilters = () => {
    setFVendor('')
    setFSetNo('')
    setFDateFrom('')
    setFDateTo('')
    setFCompletedFrom('')
    setFCompletedTo('')
  }

  // shared vendor / set no. / dates row for the two table tabs
  const filtersRow = (dateType) => (
    <div className="team-filters">
      <select value={fVendor} onChange={(e) => setFVendor(e.target.value)} style={{ ...filterInput, color: fVendor ? 'var(--ink)' : 'var(--muted)' }}>
        <option value="">— all vendors —</option>
        {vendorOptions.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <select value={fSetNo} onChange={(e) => setFSetNo(e.target.value)} style={{ ...filterInput, color: fSetNo ? 'var(--ink)' : 'var(--muted)' }}>
        <option value="">— all set no. —</option>
        {setNoOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {dateType === 'datetime' ? (
        <>
          <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>Completed:</span>
          <input type="datetime-local" value={fCompletedFrom} onChange={(e) => setFCompletedFrom(e.target.value)} style={filterInput} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <input type="datetime-local" value={fCompletedTo} onChange={(e) => setFCompletedTo(e.target.value)} style={filterInput} />
        </>
      ) : (
        <>
          <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} style={filterInput} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} style={filterInput} />
        </>
      )}

      {anyFilter && (
        <button onClick={clearFilters} style={{ ...filterInput, color: 'var(--muted)' }}>
          Clear filters
        </button>
      )}
    </div>
  )

  const tables = (
    <div className="stacked-tables">
      <TeamStageTable title="Backend team" rows={backendRows} stageGroup={BACKEND_STAGE_GROUP} division={division} loading={membersLoading} />
      <TeamStageTable
        title="Photography & Videography team"
        rows={photoRows}
        stageGroup={PHOTO_VIDEO_STAGE_GROUP}
        division={division}
        loading={membersLoading}
      />
    </div>
  )

  /* ====================== RENDER ====================== */
  return (
    <div>
      {/* KPI cards */}
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {productKpis.map((k) => (
          <div key={k.scope} className="card kpi">
            <div className="kico">{k.ic({})}</div>
            <div className="lab">{k.lab}</div>
            <div className="val" style={{ color: k.color || 'var(--ink)' }}>
              {k.val}
            </div>
            <div className="sub">{k.sub}</div>
            <button
              onClick={() => downloadKpiExcel(k.scope, k.lab.replace(/\s+/g, '_'))}
              disabled={kpiExporting === k.scope}
              title={`Download ${k.lab} as Excel`}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                fontSize: 10.5,
                fontWeight: 700,
                padding: '4px 9px',
                borderRadius: 7,
                border: '1px solid var(--line2)',
                background: 'var(--card-2)',
                color: 'var(--sage-ink)',
              }}
            >
              {kpiExporting === k.scope ? '…' : '⬇ Excel'}
            </button>
          </div>
        ))}
      </div>

      {isMasterOrAdmin && (
        <div className="subtab-row">
          {[
            ['overview', 'Stage Speed'],
            ['team', 'Team Assigned'],
            ['full', 'Full Breakdown'],
          ].map(([k, n]) => (
            <button key={k} className={'subtab-btn' + (subTab === k ? ' on' : '')} onClick={() => setSubTab(k)}>
              {n}
            </button>
          ))}
        </div>
      )}

      {/* ---------- Stage Speed ---------- */}
      {subTab === 'overview' && (
        <>
          {loading && <div className="card empty">Loading speed data…</div>}
          {!loading && (!stats || stats.length === 0) && <div className="card empty">Not enough completed stages yet to compute speed.</div>}
          {!loading && stats?.length > 0 && (
            <>
              <div className="note">
                Average time from when a stage is marked "In Progress" to when it's marked "Completed" — based on {division}'s full activity
                history.
              </div>
              <div className="grid kpis" style={{ marginTop: 16 }}>
                {[
                  ['Fastest stage', stats[0], 'var(--sage-ink)'],
                  ['Slowest stage', stats[stats.length - 1], 'var(--rose-ink)'],
                ].map(([lab, s, color]) => (
                  <div key={lab} className="card kpi">
                    <div className="lab">{lab}</div>
                    <div className="val" style={{ color, fontSize: 22 }}>
                      {s.stageName}
                    </div>
                    <div className="sub">
                      {s.avgHours.toFixed(1)} hrs avg · {s.sampleCount} samples
                    </div>
                  </div>
                ))}
              </div>
              <div className="card pad sec">
                <div className="sec-h">
                  <h3>Stage speed comparison</h3>
                  <span className="hint">lower = faster</span>
                </div>
                <div style={{ height: Math.max(280, stats.length * 40) }}>
                  <canvas ref={canvasRef} />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ---------- Team Assigned ---------- */}
      {subTab === 'team' && isMasterOrAdmin && (
        <>
          {filtersRow('date')}
          {tables}
        </>
      )}

      {/* ---------- Full Breakdown ---------- */}
      {subTab === 'full' && isMasterOrAdmin && (
        <>
          {filtersRow('datetime')}
          {tables}
          <VendorNotes selectedVendor={fVendor} />
        </>
      )}
    </div>
  )
}