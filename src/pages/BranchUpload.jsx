import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { STORES } from '../lib/constants'
import { timeAgo } from '../lib/utils'
import { fetchBranchPending } from '../lib/dispatchApi'
import DispatchKpiRow from '../components/dispatch/DispatchKpiRow'
import DispatchScanPanel from '../components/dispatch/DispatchScanPanel'

const lc = (s) => (s || '').trim().toLowerCase()
const uniq = (arr) => [...new Set(arr)]

/* ---------- receiving screen for one branch ---------- */
function BranchReceiving({ division, myBranch, operator }) {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const scanPanelRef = useRef(null)

  const loadPending = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      setPending(await fetchBranchPending(division, myBranch))
      setLoading(false)
    },
    [division, myBranch]
  )
  useEffect(() => {
    loadPending()
  }, [loadPending])

  const [vendor, setVendor] = useState('')
  const [batchLabel, setBatchLabel] = useState('')
  const [setLabel, setSetLabel] = useState('')

  // switching branch clears the pickers
  useEffect(() => {
    setVendor('')
    setBatchLabel('')
    setSetLabel('')
  }, [myBranch])

  // options come only from what was actually dispatched to THIS branch
  const branchVendors = useMemo(() => uniq(pending.map((r) => r.vendor)).sort(), [pending])
  const batchLabelOptions = useMemo(
    () => (vendor ? uniq(pending.filter((r) => r.vendor === vendor).map((r) => r.batch_label)) : []),
    [pending, vendor]
  )
  const setLabelOptions = useMemo(
    () =>
      vendor && batchLabel
        ? uniq(pending.filter((r) => r.vendor === vendor && r.batch_label === batchLabel).map((r) => r.set_label))
        : [],
    [pending, vendor, batchLabel]
  )

  // keep a picked value only while it's still a valid option
  useEffect(() => {
    if (batchLabel && !batchLabelOptions.includes(batchLabel)) setBatchLabel('')
  }, [batchLabelOptions, batchLabel])
  useEffect(() => {
    if (setLabel && !setLabelOptions.includes(setLabel)) setSetLabel('')
  }, [setLabelOptions, setLabel])

  const pendingOnly = pending.filter((r) => !r.fully_received)

  // KPI numbers follow the three pickers ("" = everything for this branch)
  const kpiRows = pending.filter(
    (r) => (!vendor || r.vendor === vendor) && (!batchLabel || r.batch_label === batchLabel) && (!setLabel || r.set_label === setLabel)
  )
  const sum = (key) => kpiRows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
  const kpiScope = [vendor, batchLabel, setLabel].filter(Boolean).join(' › ') || `all dispatches to ${myBranch}`

  const jumpTo = (r) => {
    setVendor(r.vendor)
    setBatchLabel(r.batch_label)
    setSetLabel(r.set_label)
    setTimeout(() => scanPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  return (
    <div>
      <div className="note">
        Scan every card as it arrives at <b>{myBranch}</b>. Only sets that were actually dispatched to your branch show up below.
        Duplicate scans are flagged instantly.
      </div>

      <DispatchKpiRow
        dispatched={sum('dispatched_count')}
        received={sum('received_count')}
        pending={sum('pending_count')}
        scope={kpiScope}
        loading={loading}
      />

      {/* ---------- waiting list ---------- */}
      <div className="sec">
        <div className="sec-h">
          <h3>Waiting on your branch</h3>
          <span className="hint">
            {loading
              ? 'loading…'
              : `${pendingOnly.length} batch(es) · ${pendingOnly.reduce((s, r) => s + r.pending_count, 0)} SKU(s) pending`}
          </span>
        </div>

        {!loading && pendingOnly.length === 0 ? (
          <div className="card empty">Nothing pending — you're all caught up.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {pendingOnly.map((r, i) => {
              const started = r.received_count > 0
              return (
                <div key={i} className="card pad" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {started ? (
                    <span className="chip c-prog">
                      <span className="dot" />
                      In progress
                    </span>
                  ) : (
                    <span className="chip c-app">
                      <span className="dot" />
                      Awaiting receipt
                    </span>
                  )}
                  <b>{r.vendor}</b>
                  <span className="tag">
                    · Batch: {r.batch_label} · Set: {r.set_label}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      borderRadius: 999,
                      padding: '2px 10px',
                      background: 'var(--rose-bg)',
                      color: 'var(--rose-ink)',
                      border: '1px solid var(--rose)',
                    }}
                  >
                    {r.pending_count} SKU{r.pending_count !== 1 ? 's' : ''} pending
                  </span>
                  {started && (
                    <span className="tag">
                      · {r.received_count}/{r.dispatched_count} scanned
                    </span>
                  )}
                  <div className="spacer" />
                  <span className="tag" style={{ fontWeight: 600 }}>
                    Dispatched {timeAgo(r.dispatched_at)}
                  </span>
                  <button className="ghost" style={{ padding: '6px 10px', fontSize: 11.5 }} onClick={() => jumpTo(r)}>
                    Scan this →
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ---------- pickers ---------- */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, margin: '14px 0' }}>
        <label className="fld">
          Vendor
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">— select vendor —</option>
            {branchVendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {branchVendors.length === 0 && !loading && (
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>No vendor has dispatched anything to your branch yet.</div>
          )}
        </label>
        <label className="fld">
          Batch label
          <select value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} disabled={!vendor}>
            <option value="">— select batch —</option>
            {batchLabelOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          Set
          <select value={setLabel} onChange={(e) => setSetLabel(e.target.value)} disabled={!batchLabel}>
            <option value="">— select set —</option>
            {setLabelOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {vendor && batchLabel && setLabel && (
        <div ref={scanPanelRef}>
          <DispatchScanPanel
            key={`${vendor}|${batchLabel}|${setLabel}`}
            division={division}
            vendor={vendor}
            batchLabel={batchLabel}
            setLabel={setLabel}
            branchName={myBranch}
            source="received"
            scannedBy={operator}
            onScanned={() => loadPending(true)}
          />
        </div>
      )}
    </div>
  )
}

/* ---------- page: pick the branch, then receive ---------- */
export default function BranchUpload() {
  const { auth, operator } = useAuth()
  const { division, assignments, teamMembers } = useData()
  const isMasterOrAdmin = auth.role === 'master' || auth.role === 'admin'

  const myMemberId = useMemo(
    () => teamMembers.find((m) => m.email && auth.email && lc(m.email) === lc(auth.email))?.id || null,
    [teamMembers, auth.email]
  )

  // branches assigned to me in Assign Work → Branch Upload (none yet = all branches)
  const myAssignedBranches = useMemo(() => {
    if (isMasterOrAdmin) return STORES
    const mine = assignments
      .filter((a) => a.division === division && a.stage === 'branchupload' && a.memberId === myMemberId)
      .map((a) => a.sku)
    return mine.length > 0 ? mine : STORES
  }, [assignments, division, isMasterOrAdmin, myMemberId])

  // someone logged in as "Hoodi" gets the Hoodi branch automatically
  const nameMatchedBranch = useMemo(
    () => myAssignedBranches.find((b) => lc(b) === lc(auth.name)) || null,
    [myAssignedBranches, auth.name]
  )

  const [myBranch, setMyBranch] = useState(nameMatchedBranch || myAssignedBranches[0])
  useEffect(() => {
    if (nameMatchedBranch) setMyBranch(nameMatchedBranch)
    else if (!myAssignedBranches.includes(myBranch)) setMyBranch(myAssignedBranches[0])
  }, [myAssignedBranches, nameMatchedBranch, myBranch])

  // no picker when the login already tells us the branch
  const branchIsLocked = !isMasterOrAdmin && (!!nameMatchedBranch || myAssignedBranches.length === 1)

  return (
    <div>
      {branchIsLocked ? (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Your branch
          </span>
          <span className="chip c-done">
            <span className="dot" />
            {myBranch}
          </span>
        </div>
      ) : (
        <label className="fld" style={{ maxWidth: 280, marginBottom: 16 }}>
          Your branch
          <select value={myBranch} onChange={(e) => setMyBranch(e.target.value)}>
            {myAssignedBranches.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      <BranchReceiving division={division} myBranch={myBranch} operator={operator} />
    </div>
  )
}