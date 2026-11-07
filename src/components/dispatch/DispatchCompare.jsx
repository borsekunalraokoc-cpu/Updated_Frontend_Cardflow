import { useState, useEffect, useCallback } from 'react'
import { fetchDispatchComparison, fetchDispatchBatchesList, deleteDispatchBatch } from '../../lib/dispatchApi'
import { fmt } from '../../lib/utils'
import { Chip } from '../ui'

/* ---------- list of uploads in a batch, with "Remove" ---------- */
function DispatchBatchManager({ division, vendor, batchLabel, onChanged }) {
  const [batches, setBatches] = useState([])
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const res = await fetchDispatchBatchesList(division, vendor, batchLabel)
    if (res.ok) setBatches(res.batches)
  }, [division, vendor, batchLabel])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (id, label) => {
    if (!confirm(`Remove "${label}"? This deletes its uploaded SKU list — you can re-upload it after.`)) return
    setBusyId(id)
    const res = await deleteDispatchBatch(id)
    setBusyId(null)
    if (!res.ok) {
      alert('Could not delete: ' + (res.error || 'unknown error'))
      return
    }
    await load()
    onChanged && onChanged()
  }

  if (batches.length === 0) return null

  return (
    <div className="card pad" style={{ marginBottom: 16, background: 'var(--card-2)' }}>
      <div className="sec-h" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 13 }}>Manage uploads for this batch</h3>
        <span className="hint">delete a wrong upload, then re-upload it correctly</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {batches.map((b) => {
          const sent = b.source === 'dispatched'
          return (
            <div
              key={b.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--card)',
                border: '1px solid var(--line2)',
                borderRadius: 9,
                flexWrap: 'wrap',
              }}
            >
              <span
                className="psku"
                style={{
                  background: sent ? 'var(--sage-bg)' : 'var(--sky-bg)',
                  borderColor: sent ? 'var(--sage)' : 'var(--sky)',
                  color: sent ? 'var(--sage-ink)' : 'var(--sky-ink)',
                }}
              >
                {sent ? 'Dispatched' : 'Received'}
              </span>
              <b>{b.branch_name || '—'}</b>
              <span className="tag">
                {b.sku_count} SKUs ({b.total_scans} scans) · by {b.uploaded_by} · {fmt(b.uploaded_at)}
              </span>
              <div className="spacer" />
              <button className="danger" disabled={busyId === b.id} onClick={() => remove(b.id, `${b.branch_name} (${b.source})`)}>
                {busyId === b.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- a row of SKU tags (missing / extra) ---------- */
function SkuList({ title, skus, bg, border, ink }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: ink, textTransform: 'uppercase', marginBottom: 6 }}>
        {title} ({skus.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxWidth: 420 }}>
        {skus.slice(0, 30).map((s) => (
          <span key={s} className="psku" style={{ background: bg, borderColor: border, color: ink }}>
            {s}
          </span>
        ))}
        {skus.length > 30 && <span className="tag">+{skus.length - 30} more</span>}
      </div>
    </div>
  )
}

/* ---------- Compare tab: dispatched vs received per branch ---------- */
export default function DispatchCompare({ division, vendors, groups }) {
  const [vendor, setVendor] = useState('')
  const [batchLabel, setBatchLabel] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const batchOptions = [...new Set(groups.filter((g) => !vendor || g.vendor === vendor).map((g) => g.batch_label))]

  const runCompare = async () => {
    if (!vendor || !batchLabel) return
    setLoading(true)
    const res = await fetchDispatchComparison(division, vendor, batchLabel)
    setLoading(false)
    setData(res.ok ? res : null)
  }

  return (
    <div className="card pad" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <label className="fld" style={{ minWidth: 180 }}>
          Vendor
          <select
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value)
              setBatchLabel('')
              setData(null)
            }}
          >
            <option value="">— select vendor —</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ minWidth: 180 }}>
          Batch
          <select
            value={batchLabel}
            onChange={(e) => {
              setBatchLabel(e.target.value)
              setData(null)
            }}
            disabled={!vendor}
          >
            <option value="">— select batch —</option>
            {batchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={runCompare} disabled={!vendor || !batchLabel || loading}>
          {loading ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      {vendor && batchLabel && <DispatchBatchManager division={division} vendor={vendor} batchLabel={batchLabel} onChanged={runCompare} />}

      {data && !data.reference && (
        <div className="alert">
          <div className="ic">!</div>
          <div className="tx">No admin reference set (set #1) uploaded yet for this batch.</div>
        </div>
      )}

      {data &&
        (data.branches.length === 0 ? (
          <div className="card empty">No dispatch or receipt data yet for this batch.</div>
        ) : (
          <div className="plist">
            {data.branches.map((b, i) => (
              <div key={i} className="card pad">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <b style={{ fontSize: 14 }}>{b.branchName}</b>
                  {!b.hasDispatch ? (
                    <Chip status="Not Started" />
                  ) : !b.hasReceipt ? (
                    <span className="chip c-app">
                      <span className="dot" />
                      Awaiting receipt scan
                    </span>
                  ) : b.allMatching ? (
                    <Chip status="Completed" />
                  ) : (
                    <Chip status="Issue" />
                  )}
                  <span className="tag">
                    {b.hasDispatch ? `${b.dispatchedCount} dispatched` : 'not dispatched yet'}
                    {' · '}
                    {b.hasReceipt ? `${b.receivedCount} received (${b.matched} matched)` : 'not received yet'}
                  </span>
                </div>
                {b.dispatchedAt && (
                  <div className="tag" style={{ marginBottom: 6 }}>
                    Dispatched {fmt(b.dispatchedAt)}
                    {b.receivedAt ? ` · Received ${fmt(b.receivedAt)}` : ''}
                  </div>
                )}
                {(b.missingSkus.length > 0 || b.extraSkus.length > 0) && (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    {b.missingSkus.length > 0 && (
                      <SkuList title="Missing" skus={b.missingSkus} bg="var(--rose-bg)" border="var(--rose)" ink="var(--rose-ink)" />
                    )}
                    {b.extraSkus.length > 0 && (
                      <SkuList title="Extra" skus={b.extraSkus} bg="var(--peach-bg)" border="var(--peach)" ink="var(--peach-ink)" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}