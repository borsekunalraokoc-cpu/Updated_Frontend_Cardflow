import { useState, useMemo } from 'react'
import { useData } from '../context/DataContext'
import { STAGES } from '../lib/constants'
import { fmt } from '../lib/utils'
import { I, CopySku } from '../components/ui'

// audit "detail" format: "<Stage> → <Status>[ · person]"
const STAGE_UPDATE_RE = /^(.+?)\s*→\s*([^·]+?)(?:\s*·\s*(.+))?$/
const STAGE_KEY_BY_NAME = Object.fromEntries(STAGES.map((s) => [s.n, s.k]))

export default function AuditLog({ audit }) {
  const { products, patchStage } = useData()
  const [q, setQ] = useState('')

  // audit entity is a SKU or a product name
  const skuToProduct = useMemo(() => {
    const m = {}
    products.forEach((p) => {
      m[p.sku] = p
      if (p.name) m[p.name.toLowerCase()] = p
    })
    return m
  }, [products])

  // One row per product+stage that is Completed RIGHT NOW, taken from the latest
  // "Stage update" for that pair. Moving a stage back to In Progress makes its
  // row disappear immediately.
  const completedRows = useMemo(() => {
    const latest = new Map()
    audit.forEach((a) => {
      if (a.action !== 'Stage update') return
      const m = String(a.detail || '').match(STAGE_UPDATE_RE)
      if (!m) return
      const stageName = m[1].trim()
      const stageKey = STAGE_KEY_BY_NAME[stageName]
      const prod = skuToProduct[a.entity] || skuToProduct[String(a.entity || '').toLowerCase()]
      if (!prod || !stageKey) return

      const key = prod.id + '|' + stageKey
      const existing = latest.get(key)
      if (!existing || new Date(a.at) > new Date(existing.a.at)) {
        latest.set(key, { a, prod, stageKey, stageName, status: m[2].trim(), personFromDetail: (m[3] || '').trim() })
      }
    })

    const rows = []
    latest.forEach(({ a, prod, stageKey, stageName, status, personFromDetail }) => {
      if (status !== 'Completed' || prod.stages[stageKey]?.status !== 'Completed') return
      // prefer the typed person, else whoever was logged in
      const person = personFromDetail || (a.actor || '').trim()
      if (!person) return
      rows.push({
        id: a.id,
        productId: prod.id,
        sku: prod.sku,
        stageName,
        stageKey,
        person,
        comments: prod.stages[stageKey].comments || '',
        at: a.at,
      })
    })
    return rows.sort((x, y) => new Date(y.at) - new Date(x.at))
  }, [audit, skuToProduct])

  const filtered = completedRows.filter((r) =>
    `${r.sku} ${r.stageName} ${r.person} ${r.comments}`.toLowerCase().includes(q.toLowerCase())
  )

  const moveBack = (row) => {
    const prod = products.find((p) => p.id === row.productId)
    if (!prod) return
    const stg = prod.stages[row.stageKey]
    patchStage(prod.id, row.stageKey, { status: 'In Progress', person: stg.person, comments: stg.comments })
  }

  return (
    <div>
      <div className="note">
        Showing every stage marked Completed, drawn from the full activity log — including bulk imports and admin updates, regardless of
        whether a "person" name was typed in. Use <b>↩ In Progress</b> to move a stage back if needed.
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="search">
          {I.search({})}
          <input placeholder="Filter by SKU, stage, person…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="tag">{filtered.length} completed stages</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">No completed stages yet.</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 140 }}>When</th>
                <th style={{ width: 110 }}>SKU</th>
                <th style={{ width: 160 }}>Stage</th>
                <th style={{ width: 120 }}>By</th>
                <th>Comments</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ background: 'var(--sage-bg)' }}>
                  <td className="tag" style={{ whiteSpace: 'nowrap' }}>
                    {fmt(r.at)}
                  </td>
                  <td>
                    <CopySku sku={r.sku} />
                  </td>
                  <td>
                    <span className="audit-act" style={{ background: 'var(--sage)', color: '#fff' }}>
                      ✓ {r.stageName}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{r.person}</td>
                  <td className="tag">{r.comments || '—'}</td>
                  <td>
                    <button
                      onClick={() => confirm('Move back to In Progress?') && moveBack(r)}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        border: '1px solid var(--sky)',
                        borderRadius: 7,
                        background: 'var(--sky-bg)',
                        color: 'var(--sky-ink)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ↩ In Progress
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}