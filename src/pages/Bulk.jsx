import { useState, useRef, useCallback } from 'react'
import { gsPost } from '../api'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { DIVISIONS, STORES, STATUSES, STAGE_COLS, DEFAULT_VENDORS, PROD_HEADERS, STORE_HEADERS } from '../lib/constants'
import { fieldFromProduct, normBool, now } from '../lib/utils'
import { makeWorkbook, readSheet, writeFile } from '../lib/excel'
import { I } from '../components/ui'

const isExampleOrBlank = (sku) => !sku || sku.toUpperCase().includes('EXAMPLE')
const pickDivision = (row, fallback) => {
  const d = String(row.division || '').trim()
  return DIVISIONS.includes(d) ? d : fallback
}

/* ---------- one import card (template / export / upload / confirm) ---------- */
function BulkPanel({ title, icon, blurb, onTemplate, onExport, exportLabel, runImport, summarize, resultText }) {
  const [rows, setRows] = useState(null)
  const [fname, setFname] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef()

  const pick = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setErr('')
    setResult(null)
    setRows(null)
    setFname(f.name)
    readSheet(f, (r, e2) => (e2 ? setErr(e2) : setRows(r)))
  }

  const confirmImport = async () => {
    setBusy(true)
    const res = await runImport(rows)
    setResult(res)
    setRows(null)
    setFname('')
    if (inputRef.current) inputRef.current.value = ''
    setBusy(false)
  }

  return (
    <div className="card pad">
      <h3 style={{ margin: '0 0 6px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--sage-ink)' }}>{icon({})}</span>
        {title}
      </h3>
      <p className="tag" style={{ margin: '0 0 14px', lineHeight: 1.55 }}>
        {blurb}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="ghost" onClick={onTemplate}>
          {I.upload({ width: 15, height: 15 })} Blank template
        </button>
        <button className="ghost" onClick={onExport}>
          {I.upload({ width: 15, height: 15 })} {exportLabel}
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <label className="fld" style={{ marginBottom: 10 }}>
          Upload filled sheet (.xlsx or .csv)
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={pick} className="txt" />
        </label>

        {err && (
          <div className="alert">
            <div className="ic">!</div>
            <div className="tx">Couldn't read file: {err}</div>
          </div>
        )}

        {rows && !err && (
          <div className="card" style={{ boxShadow: 'none', background: 'var(--card-2)', padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span className="tag">
                <b>{fname}</b> — {rows.length} row(s) · {summarize(rows)}
              </span>
              <button className="primary" disabled={busy} onClick={confirmImport}>
                {busy ? 'Importing…' : 'Confirm import'}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="card" style={{ boxShadow: 'none', background: 'var(--sage-bg)', border: '1px solid var(--sage)', padding: '12px 14px' }}>
            <b style={{ color: 'var(--sage-ink)' }}>Imported ✓</b> <span className="tag">{resultText(result)}</span>
            {result.errs?.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {result.errs.slice(0, 6).map((m, i) => (
                  <li key={i} className="tag" style={{ color: 'var(--rose-ink)' }}>
                    {m}
                  </li>
                ))}
                {result.errs.length > 6 && <li className="tag">+{result.errs.length - 6} more…</li>}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- page ---------- */
export default function Bulk({ divProducts }) {
  const { operator } = useAuth()
  const { division, products, load, logAudit, saveProducts } = useData()

  /* ---------- import products (chunked, retried, a few in parallel) ---------- */
  const bulkProducts = useCallback(
    async (rows) => {
      const validRows = rows
        .filter((r) => !isExampleOrBlank(String(r.sku || '').trim()))
        .map((r) => ({ ...r, division: pickDivision(r, division) }))

      const CHUNK = 500
      const CONCURRENCY = 3
      let created = 0,
        updated = 0
      const errs = []

      const chunks = []
      for (let i = 0; i < validRows.length; i += CHUNK) chunks.push(validRows.slice(i, i + CHUNK))

      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (chunk) => {
            let res = null
            for (let attempt = 0; attempt < 3; attempt++) {
              res = await gsPost('bulkImportProducts', chunk)
              if (res && res.ok) break
              await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
            }
            return res
          })
        )
        results.forEach((res, idx) => {
          if (!res || !res.ok) {
            errs.push(`Chunk failed after 3 retries (${batch[idx].length} rows): ${res?.error || 'no response / network error'}`)
            return
          }
          created += res.created
          updated += res.updated
          if (res.failed?.length) errs.push(...res.failed.map((f) => `${f.sku}: ${f.error}`))
        })
      }

      await load()
      logAudit(
        'Bulk import',
        `${created + updated} products`,
        `${created} created, ${updated} updated${errs.length ? `, ${errs.length} error(s)` : ''}`
      )
      return { created, updated, errs }
    },
    [division, load, logAudit]
  )

  /* ---------- import store rows ---------- */
  const bulkStores = useCallback(
    async (rows) => {
      let updated = 0
      const errs = []
      let next = [...products]

      rows.forEach((row, i) => {
        const sku = String(row.sku || '').trim()
        if (isExampleOrBlank(sku)) return
        const div = pickDivision(row, division)
        const store = String(row.store || '').trim()
        if (!STORES.includes(store)) return errs.push(`Row ${i + 2}: unknown store "${store}"`)

        const existing = next.find((p) => p.division === div && p.sku.toLowerCase() === sku.toLowerCase())
        if (!existing) return errs.push(`Row ${i + 2}: product "${sku}" not found in ${div}`)

        const s = { ...existing.stores[store] }
        const has = (k) => row[k] !== '' && row[k] != null
        if (has('dispatched') && !isNaN(+row.dispatched)) s.dispatched = +row.dispatched
        if (has('missing') && !isNaN(+row.missing)) s.missing = +row.missing
        if (has('damaged') && !isNaN(+row.damaged)) s.damaged = +row.damaged
        if (has('notes')) s.notes = String(row.notes).trim()
        if (has('received')) {
          const rv = normBool(row.received)
          if (rv && !s.received) {
            s.received = true
            s.receivedAt = now()
            s.receivedBy = operator || 'bulk'
          } else s.received = rv
        }
        s.at = now()

        const np = { ...existing, stores: { ...existing.stores, [store]: s }, updatedAt: now() }
        next = next.map((p) => (p.id === np.id ? np : p))
        updated++
      })

      await saveProducts(next)
      logAudit('Bulk store import', `${updated} store rows`, errs.length ? `${errs.length} errors` : 'ok')
      return { updated, errs }
    },
    [products, division, operator, saveProducts, logAudit]
  )

  /* ---------- downloads ---------- */
  const dlProducts = (withData) => {
    const ex1 = PROD_HEADERS.map(
      (h) =>
        ({
          division,
          sku: 'EXAMPLE-001 (delete this row)',
          name: 'Sample design',
          vendor: (DEFAULT_VENDORS[division] || [])[0] || 'Vendor',
          inward: '2026-06-01',
          qty: 30,
          note: 'old/new split etc',
          barcoding_status: 'Completed',
          barcoding_person: 'Vijaya',
          content_status: 'In Progress',
          photography_status: 'Not Started',
        })[h] ?? ''
    )
    const ex2 = PROD_HEADERS.map(
      (h) => ({ sku: 'EXAMPLE-002 (delete this row)', division, name: 'Another design', qty: 12 })[h] ?? ''
    )
    const data = withData ? divProducts.map((p) => PROD_HEADERS.map((h) => fieldFromProduct(p, h))) : [ex1, ex2]
    const instr = [
      ['How to use the Products & Pipeline sheet'],
      [''],
      ["1. One row = one product / SKU. 'sku' is the key and must be unique within a division."],
      ['2. Re-uploading UPDATES products that already exist (matched on division + sku) and CREATES new ones.'],
      ['3. Leave a cell BLANK to keep the existing value — only filled cells are written, nothing is wiped.'],
      ['4. Allowed division: ' + DIVISIONS.join(' / ') + '. Blank = currently selected division.'],
      ['5. Allowed *_status: ' + STATUSES.join(', ') + ' (done/complete/pending also accepted, auto-mapped).'],
      ['6. Each stage has 3 columns: <stage>_status, <stage>_person, <stage>_comments.'],
      ['7. Stage order: ' + STAGE_COLS.map((s) => s.n).join(' → ') + '.'],
      ['8. qc_verdict: Approved / Issues Found. qc_issues = free text.'],
      ['9. inward date format: YYYY-MM-DD.'],
      ['10. Delete EXAMPLE rows before uploading. Blank-sku rows are ignored.'],
      ["11. Tip: 'Export current products' to download all as-is, edit, and re-upload."],
    ]
    writeFile(
      makeWorkbook(PROD_HEADERS, data, 'Products', instr),
      withData ? 'card_products_export.xlsx' : 'card_products_template.xlsx'
    )
  }

  const dlStores = (withData) => {
    const ex = [
      { division, sku: 'EXAMPLE-001 (delete this row)', store: STORES[0], dispatched: 30, received: 'yes', missing: 0, damaged: 0, notes: '' },
      {
        division,
        sku: 'EXAMPLE-001 (delete this row)',
        store: STORES[1],
        dispatched: 30,
        received: 'no',
        missing: 2,
        damaged: 1,
        notes: '2 missing, 1 bent',
      },
    ]
    const rowObjs = withData
      ? divProducts.flatMap((p) =>
          STORES.map((st) => {
            const s = p.stores[st]
            return {
              division: p.division,
              sku: p.sku,
              store: st,
              dispatched: s.dispatched,
              received: s.received ? 'yes' : 'no',
              missing: s.missing,
              damaged: s.damaged,
              notes: s.notes,
            }
          })
        )
      : ex
    const data = rowObjs.map((o) => STORE_HEADERS.map((h) => o[h] ?? ''))
    const instr = [
      ['How to use the Store Dispatch & Receipts sheet'],
      [''],
      ['1. One row = one product at one store.'],
      ['2. Products must already exist (matched on division + sku) — create them via the Products sheet first.'],
      ['3. Allowed stores: ' + STORES.join(', ') + '.'],
      ["4. received: yes/no (or true/false, 1/0). 'yes' stamps receipt date/time automatically."],
      ['5. dispatched / missing / damaged = whole numbers. Any missing or damaged > 0 raises a live alert.'],
      ['6. Leave a cell blank to keep the existing value. Delete EXAMPLE rows before uploading.'],
    ]
    writeFile(makeWorkbook(STORE_HEADERS, data, 'Stores', instr), withData ? 'card_stores_export.xlsx' : 'card_stores_template.xlsx')
  }

  return (
    <div>
      <div className="note">
        Built for scale — download a template, fill it in Excel (or export what's already here, edit, and re-upload), then import thousands
        of rows at once. Re-uploading updates existing SKUs and adds new ones; blank cells are never overwritten. Each row's <b>division</b>{' '}
        column decides where it lands.
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', marginTop: 16 }}>
        <BulkPanel
          title="Products & Pipeline"
          icon={I.layers}
          blurb="Add new designs and update any pipeline step — bar coding, content, photography, videography, video editing, images, App & Shopify listing, scan and final QC — all in one sheet."
          onTemplate={() => dlProducts(false)}
          onExport={() => dlProducts(true)}
          exportLabel={`Export current products (${divProducts.length})`}
          runImport={bulkProducts}
          summarize={(rows) => {
            let c = 0,
              u = 0
            rows.forEach((r) => {
              const sku = String(r.sku || '').trim()
              if (isExampleOrBlank(sku)) return
              const div = pickDivision(r, division)
              products.some((p) => p.division === div && p.sku.toLowerCase() === sku.toLowerCase()) ? u++ : c++
            })
            return `${c} new · ${u} updates`
          }}
          resultText={(r) => `${r.created} created, ${r.updated} updated${r.errs.length ? ` · ${r.errs.length} warning(s)` : ''}`}
        />
        <BulkPanel
          title="Store Dispatch & Receipts"
          icon={I.store}
          blurb={`Bulk-record dispatched quantities, store receipts and any missing or damaged cards across all ${STORES.length} stores. Flagged shortages appear instantly on the Overview.`}
          onTemplate={() => dlStores(false)}
          onExport={() => dlStores(true)}
          exportLabel="Export current store data"
          runImport={bulkStores}
          summarize={(rows) => `${rows.filter((r) => !isExampleOrBlank(String(r.sku || '').trim())).length} store row(s)`}
          resultText={(r) => `${r.updated} store rows updated${r.errs.length ? ` · ${r.errs.length} error(s)` : ''}`}
        />
      </div>
    </div>
  )
}