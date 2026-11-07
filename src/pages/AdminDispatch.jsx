import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { STORES } from '../lib/constants'
import { readSheet, downloadDispatchTemplate } from '../lib/excel'
import { fetchDispatchGroups, fetchBatchLabels, fetchSetLabels, fetchSetSummary, dispatchAdminUpload } from '../lib/dispatchApi'
import { I } from '../components/ui'
import DispatchKpiRow from '../components/dispatch/DispatchKpiRow'
import DispatchScanPanel from '../components/dispatch/DispatchScanPanel'
import SetSummaryPanel from '../components/dispatch/SetSummaryPanel'
import DispatchCompare from '../components/dispatch/DispatchCompare'

// pull { sku, qty } out of each uploaded row, skipping EXAMPLE rows
const extractSkus = (rows) =>
  rows
    .map((row) => {
      const sku = row.sku || row.SKU || row.Sku || Object.values(row)[0]
      const qty = row.qty || row.Qty || row.QTY || 1
      return { sku: String(sku || '').trim(), qty: Number(qty) || 1 }
    })
    .filter((x) => x.sku && !x.sku.toUpperCase().includes('EXAMPLE'))

/* "pick existing or + New" control used for batch label and set label */
function LabelPicker({ label, value, onChange, options, disabled, adding, setAdding, newValue, setNewValue, placeholder }) {
  return (
    <label className="fld">
      {label}
      {!adding ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ flex: 1 }}>
            <option value="">— select {label.split(' ')[0].toLowerCase()} —</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <button className="ghost" type="button" disabled={disabled} style={{ padding: '8px 10px', fontSize: 12 }} onClick={() => setAdding(true)}>
            + New
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="txt" placeholder={placeholder} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <button
            className="ghost"
            type="button"
            style={{ padding: '8px 10px', fontSize: 12 }}
            onClick={() => {
              setAdding(false)
              setNewValue('')
            }}
          >
            ✕
          </button>
        </div>
      )}
    </label>
  )
}

export default function AdminDispatch() {
  const { operator } = useAuth()
  const { division, vendors: allVendors } = useData()
  const vendors = allVendors[division] || []

  const [mode, setMode] = useState('admin') // "admin" | "compare"
  const [uploadMode, setUploadMode] = useState('bulk') // "bulk" | "scan"

  const [vendor, setVendor] = useState('')
  const [batchLabelOptions, setBatchLabelOptions] = useState([])
  const [batchLabel, setBatchLabel] = useState('')
  const [newBatchLabel, setNewBatchLabel] = useState('')
  const [addingBatch, setAddingBatch] = useState(false)

  const [setLabelOptions, setSetLabelOptions] = useState([])
  const [setLabel, setSetLabel] = useState('')
  const [newSetLabel, setNewSetLabel] = useState('')
  const [addingSet, setAddingSet] = useState(false)

  const [branchName, setBranchName] = useState(STORES[0])
  const [rows, setRows] = useState(null)
  const [fname, setFname] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const inputRef = useRef()

  const effectiveBatchLabel = batchLabel || newBatchLabel.trim()
  const effectiveSetLabel = setLabel || newSetLabel.trim()

  /* ---------- existing batches table ---------- */
  const [groups, setGroups] = useState([])
  const loadGroups = useCallback(async () => setGroups(await fetchDispatchGroups(division)), [division])
  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  // vendor changed → load its batch labels
  useEffect(() => {
    setBatchLabel('')
    setBatchLabelOptions([])
    setSetLabel('')
    setSetLabelOptions([])
    if (vendor) fetchBatchLabels(division, vendor).then(setBatchLabelOptions)
  }, [division, vendor])

  // batch changed → load its set labels
  useEffect(() => {
    setSetLabel('')
    setSetLabelOptions([])
    if (vendor && batchLabel) fetchSetLabels(division, vendor, batchLabel).then(setSetLabelOptions)
  }, [division, vendor, batchLabel])

  /* ---------- KPI + "Sets in this batch" (one fetch) ---------- */
  const [kpiTick, setKpiTick] = useState(0)
  const bumpKpis = useCallback(() => setKpiTick((t) => t + 1), [])
  const [summarySets, setSummarySets] = useState([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => {
    if (!vendor || !effectiveBatchLabel) {
      setSummarySets([])
      setSummaryLoading(false)
      return
    }
    let cancelled = false
    setSummaryLoading(true)
    fetchSetSummary(division, vendor, effectiveBatchLabel).then((r) => {
      if (cancelled) return
      setSummarySets(r)
      setSummaryLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [division, vendor, effectiveBatchLabel, kpiTick])

  const kpiBranchRows = (effectiveSetLabel ? summarySets.filter((x) => x.setLabel === effectiveSetLabel) : summarySets).flatMap(
    (x) => x.branches || []
  )
  const kpiDispatched = kpiBranchRows.reduce((s, b) => s + (b.dispatchedCount || 0), 0)
  const kpiReceived = kpiBranchRows.reduce((s, b) => s + (b.receivedCount || 0), 0)
  const kpiScope = [vendor, effectiveBatchLabel, effectiveSetLabel || 'all sets'].filter(Boolean).join(' › ')

  /* ---------- bulk upload ---------- */
  const pickFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setErr('')
    setResult(null)
    setRows(null)
    setFname(f.name)
    readSheet(f, (r, e2) => (e2 ? setErr(e2) : setRows(r)))
  }

  const submitAdmin = async () => {
    if (!vendor || !effectiveBatchLabel || !effectiveSetLabel || !branchName || !rows) {
      setErr('Vendor, batch label, set label, branch and a file are required.')
      return
    }
    setBusy(true)
    setErr('')
    const res = await dispatchAdminUpload({
      division,
      vendor,
      batchLabel: effectiveBatchLabel,
      setLabel: effectiveSetLabel,
      branchName,
      uploadedBy: operator || 'Unattributed',
      filename: fname,
      skus: extractSkus(rows),
    })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error || 'Upload failed.')
      return
    }
    setResult({ ...res, branchName, setLabel: effectiveSetLabel })
    setRows(null)
    setFname('')
    if (inputRef.current) inputRef.current.value = ''
    setNewBatchLabel('')
    setAddingBatch(false)
    setNewSetLabel('')
    setAddingSet(false)
    loadGroups()
    bumpKpis()
    fetchBatchLabels(division, vendor).then(setBatchLabelOptions)
    fetchSetLabels(division, vendor, effectiveBatchLabel).then(setSetLabelOptions)
    setBatchLabel(effectiveBatchLabel)
    // don't carry the set forward — the next dispatch must pick (or create) one on purpose
    setSetLabel('')
  }

  const switchMode = (m) => {
    setMode(m)
    setResult(null)
    setErr('')
  }

  return (
    <div>
      <div className="note">
        Pick (or create) a vendor batch and a set within it, choose the branch it's going to, then either bulk-upload a SKU list or scan
        cards live. The comparison view shows missing/extra SKUs per branch once both sides are in.
      </div>

      <div className="subtab-row" style={{ marginTop: 14 }}>
        <button className={'subtab-btn' + (mode === 'admin' ? ' on' : '')} onClick={() => switchMode('admin')}>
          Dispatch to Branch
        </button>
        <button className={'subtab-btn' + (mode === 'compare' ? ' on' : '')} onClick={() => switchMode('compare')}>
          Compare
        </button>
      </div>

      {mode === 'admin' && (
        <>
          <div style={{ marginTop: 14 }}>
            <DispatchKpiRow
              dispatched={kpiDispatched}
              received={kpiReceived}
              pending={Math.max(0, kpiDispatched - kpiReceived)}
              scope={kpiScope}
              ready={!!(vendor && effectiveBatchLabel)}
              loading={summaryLoading}
            />
          </div>

          <div className="card pad" style={{ marginTop: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <label className="fld">
                Vendor
                <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
                  <option value="">— select vendor —</option>
                  {vendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>

              <LabelPicker
                label="Batch label"
                value={batchLabel}
                onChange={setBatchLabel}
                options={batchLabelOptions}
                disabled={!vendor}
                adding={addingBatch}
                setAdding={setAddingBatch}
                newValue={newBatchLabel}
                setNewValue={setNewBatchLabel}
                placeholder="e.g. June-Batch-1"
              />

              <LabelPicker
                label="Set label"
                value={setLabel}
                onChange={setSetLabel}
                options={setLabelOptions}
                disabled={!effectiveBatchLabel}
                adding={addingSet}
                setAdding={setAddingSet}
                newValue={newSetLabel}
                setNewValue={setNewSetLabel}
                placeholder="e.g. Set 1"
              />

              <label className="fld">
                Dispatching to branch
                <select value={branchName} onChange={(e) => setBranchName(e.target.value)}>
                  {STORES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* bulk / scan toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[
                ['bulk', 'Bulk Upload'],
                ['scan', 'Scan Cards'],
              ].map(([k, n]) => (
                <button
                  key={k}
                  className={'subtab-btn' + (uploadMode === k ? ' on' : '')}
                  onClick={() => {
                    setUploadMode(k)
                    setErr('')
                    setResult(null)
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {uploadMode === 'scan' ? (
              !vendor || !effectiveBatchLabel || !effectiveSetLabel ? (
                <div className="note">Pick a vendor, batch label and set label above to start scanning.</div>
              ) : (
                <DispatchScanPanel
                  division={division}
                  vendor={vendor}
                  batchLabel={effectiveBatchLabel}
                  setLabel={effectiveSetLabel}
                  branchName={branchName}
                  source="dispatched"
                  scannedBy={operator}
                  onScanned={bumpKpis}
                />
              )
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <button className="ghost" onClick={() => downloadDispatchTemplate('admin')}>
                    {I.upload({ width: 15, height: 15 })} Download template
                  </button>
                </div>

                <label className="fld" style={{ marginBottom: 10 }}>
                  Upload SKU list (.xlsx or .csv) — first column should be SKU, optional "qty" column
                  <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={pickFile} className="txt" />
                </label>

                {err && (
                  <div className="alert">
                    <div className="ic">!</div>
                    <div className="tx">{err}</div>
                  </div>
                )}

                {rows && !err && (
                  <div className="card" style={{ boxShadow: 'none', background: 'var(--card-2)', padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <span className="tag">
                        <b>{fname}</b> — {extractSkus(rows).length} SKU(s) detected
                      </span>
                      <button className="primary" disabled={busy} onClick={submitAdmin}>
                        {busy ? 'Uploading…' : 'Save & Upload'}
                      </button>
                    </div>
                  </div>
                )}

                {result && (
                  <div
                    className="card"
                    style={{ boxShadow: 'none', background: 'var(--sage-bg)', border: '1px solid var(--sage)', padding: '12px 14px' }}
                  >
                    <b style={{ color: 'var(--sage-ink)' }}>Uploaded ✓</b>{' '}
                    <span className="tag">
                      {result.skuCount} SKU(s) saved for {result.branchName} · {result.setLabel}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {mode === 'compare' && <DispatchCompare division={division} vendors={vendors} groups={groups} />}

      {vendor && effectiveBatchLabel && <SetSummaryPanel sets={summarySets} />}

      {groups.length > 0 && mode !== 'compare' && (
        <div style={{ marginTop: 16 }}>
          <div className="sec-h">
            <h3>Existing batches</h3>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Batch</th>
                  <th className="num">Branches dispatched to</th>
                  <th className="num">Branches received</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={i}>
                    <td>
                      <b>{g.vendor}</b>
                    </td>
                    <td>{g.batch_label}</td>
                    <td className="num">{g.dispatched_branches}</td>
                    <td className="num">{g.received_branches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}