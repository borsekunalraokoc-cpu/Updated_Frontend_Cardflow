import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchScanLog, postScan, undoScan } from '../../lib/dispatchApi'

const same = (a, b) => a.toLowerCase() === b.toLowerCase()

// Text box that a USB barcode scanner types into (scanner sends Enter at the end)
export function ScannerInput({ onScan, placeholder }) {
  const [val, setVal] = useState('')
  const ref = useRef()
  useEffect(() => {
    ref.current?.focus()
  }, [])

  const submit = () => {
    const sku = val.trim()
    if (!sku) return
    onScan(sku)
    setVal('')
    ref.current?.focus()
  }

  return (
    <input
      ref={ref}
      className="txt"
      autoFocus
      value={val}
      placeholder={placeholder || 'Scan barcode…'}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && submit()}
      style={{ fontSize: 16, padding: '12px 14px', fontFamily: 'ui-monospace, monospace' }}
    />
  )
}

// source = "dispatched" (admin sending) or "received" (branch receiving)
export default function DispatchScanPanel({ division, vendor, batchLabel, setLabel, branchName, source, scannedBy, onScanned }) {
  const [items, setItems] = useState([]) // [{ sku, scanCount }]
  const [flashDupe, setFlashDupe] = useState(null)
  const [batchId, setBatchId] = useState(null)
  const [selectedDupe, setSelectedDupe] = useState('')

  const load = useCallback(async () => {
    if (!division || !vendor || !batchLabel || !setLabel || !branchName) return
    const r = await fetchScanLog({ division, vendor, batchLabel, setLabel, branchName, source })
    if (r.ok) {
      setItems(r.items.map((i) => ({ sku: i.sku, scanCount: i.scan_count })))
      setBatchId(r.batchId || null)
    }
  }, [division, vendor, batchLabel, setLabel, branchName, source])

  useEffect(() => {
    load()
  }, [load])

  const flash = (sku) => {
    setFlashDupe(sku)
    setTimeout(() => setFlashDupe(null), 1500)
  }

  const handleScan = async (sku) => {
    // instant warning before the server answers
    if (items.some((i) => same(i.sku, sku))) flash(sku)

    const res = await postScan({ division, vendor, batchLabel, setLabel, branchName, source, sku, scannedBy })
    if (!res.ok) {
      alert(res.error || 'Scan failed')
      return
    }
    if (res.batchId) setBatchId(res.batchId)
    if (res.isDuplicate) flash(sku)

    setItems((prev) => {
      const idx = prev.findIndex((i) => same(i.sku, sku))
      if (idx === -1) return [{ sku, scanCount: res.scanCount }, ...prev]
      const next = [...prev]
      next[idx] = { sku, scanCount: res.scanCount }
      return next
    })
    onScanned && onScanned()
  }

  const removeOne = async (sku) => {
    if (!batchId) return
    const res = await undoScan(batchId, sku)
    if (!res.ok) {
      alert(res.error || 'Could not remove')
      return
    }
    setItems((prev) =>
      res.removed ? prev.filter((i) => !same(i.sku, sku)) : prev.map((i) => (same(i.sku, sku) ? { ...i, scanCount: res.scanCount } : i))
    )
    onScanned && onScanned()
  }

  const totalScans = items.reduce((s, i) => s + i.scanCount, 0)
  const dupeItems = items.filter((i) => i.scanCount > 1)
  const dupeScanTotal = dupeItems.reduce((s, i) => s + i.scanCount, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <ScannerInput onScan={handleScan} placeholder={`Scan for ${branchName || '…'}`} />
        <span className="tag" style={{ whiteSpace: 'nowrap' }}>
          {items.length} unique · {totalScans} scans
        </span>
      </div>

      {dupeItems.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            background: 'var(--rose-bg)',
            border: '1.5px solid var(--rose)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 12,
          }}
        >
          <span className="chip c-issue">
            <span className="dot" />
            {dupeItems.length} duplicate SKU{dupeItems.length !== 1 ? 's' : ''}
          </span>
          <span className="tag" style={{ color: 'var(--rose-ink)', fontWeight: 600 }}>
            {dupeScanTotal} total scans across duplicates
          </span>
          <div className="spacer" />
          <select
            className="txt"
            value={selectedDupe}
            onChange={(e) => setSelectedDupe(e.target.value)}
            style={{ minWidth: 220, width: 'auto', borderColor: 'var(--rose)' }}
          >
            <option value="">— view duplicated SKUs ({dupeItems.length}) —</option>
            {dupeItems.map((i) => (
              <option key={i.sku} value={i.sku}>
                {i.sku} · ×{i.scanCount}
              </option>
            ))}
          </select>
          {selectedDupe && (
            <button
              className="ghost"
              style={{ padding: '6px 10px', fontSize: 11.5 }}
              onClick={() => {
                removeOne(selectedDupe)
                setSelectedDupe('')
              }}
            >
              Remove duplicate
            </button>
          )}
        </div>
      )}

      <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((i) => {
          const dupe = i.scanCount > 1
          return (
            <div
              key={i.sku}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 12px',
                borderRadius: 8,
                background: dupe ? 'var(--rose-bg)' : 'var(--card)',
                border: `1px solid ${dupe ? 'var(--rose)' : 'var(--line2)'}`,
                animation: flashDupe === i.sku ? 'glowPulseRose 0.6s ease-out 2' : 'none',
              }}
            >
              <span className="psku">{i.sku}</span>
              {dupe && (
                <>
                  <span className="chip c-issue">
                    <span className="dot" />
                    Duplicate ×{i.scanCount}
                  </span>
                  <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => removeOne(i.sku)}>
                    Remove duplicate
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}