import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { STORES } from '../lib/constants'
import { fmt, now } from '../lib/utils'
import { I, CopySku } from '../components/ui'

// "scan" isn't in STAGES, so older products may not have it
const EMPTY_SCAN = { status: 'Not Started', person: '', at: '' }

/* ---------- one store line inside a product ---------- */
function StoreCell({ p, store, onStore, operator }) {
  const s = p.stores[store]
  const [d, setD] = useState(s.dispatched)
  const [r, setR] = useState(s.received)
  const [m, setM] = useState(s.missing)
  const [dm, setDm] = useState(s.damaged)
  const [notes, setNotes] = useState(s.notes)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setD(s.dispatched)
    setR(s.received)
    setM(s.missing)
    setDm(s.damaged)
    setNotes(s.notes)
  }, [s.dispatched, s.received, s.missing, s.damaged, s.notes])

  const dirty = d !== s.dispatched || r !== s.received || m !== s.missing || dm !== s.damaged || notes !== s.notes
  const flagged = +m > 0 || +dm > 0

  const save = () => {
    const newlyReceived = r && !s.received
    onStore(p.id, store, {
      dispatched: +d,
      received: r,
      missing: +m,
      damaged: +dm,
      notes,
      receivedAt: newlyReceived ? now() : s.receivedAt,
      receivedBy: newlyReceived ? operator || '' : s.receivedBy,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1300)
  }

  const numInput = (val, setter) => (
    <input className="txt" type="number" value={val} onChange={(e) => setter(e.target.value)} style={{ textAlign: 'right' }} />
  )

  return (
    <tr style={flagged ? { background: 'var(--rose-bg)' } : null}>
      <td>
        <b>{store}</b>
        {s.received && (
          <div className="tag">
            recv {fmt(s.receivedAt)}
            {s.receivedBy ? ' · ' + s.receivedBy : ''}
          </div>
        )}
      </td>
      <td className="num" style={{ width: 84 }}>
        {numInput(d, setD)}
      </td>
      <td style={{ width: 96 }}>
        <label className="recv">
          <input type="checkbox" checked={r} onChange={(e) => setR(e.target.checked)} />
          received
        </label>
      </td>
      <td className="num" style={{ width: 80 }}>
        {numInput(m, setM)}
      </td>
      <td className="num" style={{ width: 80 }}>
        {numInput(dm, setDm)}
      </td>
      <td style={{ minWidth: 150 }}>
        <input className="txt" placeholder="optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </td>
      <td style={{ width: 76 }}>
        <button className={'mini ' + (saved ? 'saved' : '')} disabled={!dirty && !saved} onClick={save}>
          {saved ? '✓' : 'Save'}
        </button>
      </td>
    </tr>
  )
}

/* ---------- one product (collapsible) ---------- */
function DispatchRow({ p, open, toggle, onStore, onStage, operator }) {
  const scan = p.stages.scan || EMPTY_SCAN
  const recvCount = STORES.filter((st) => p.stores[st].received).length
  const issueCount = STORES.filter((st) => p.stores[st].missing > 0 || p.stores[st].damaged > 0).length

  return (
    <div className="prow">
      <div className="phead" onClick={toggle}>
        <span className={'chev ' + (open ? 'open' : '')}>▶</span>
        <CopySku sku={p.sku} />
        {p.name && <span className="pname">{p.name}</span>}
        <span className="pvend">· {p.vendor || '—'}</span>
        <div className="spacer" />
        {scan.status === 'Completed' ? (
          <span className="chip c-done">
            <span className="dot" />
            Scanned
          </span>
        ) : (
          <span className="chip c-app">
            <span className="dot" />
            Not scanned
          </span>
        )}
        {issueCount > 0 && (
          <span className="chip c-issue">
            <span className="dot" />
            {issueCount} store issue
          </span>
        )}
        <span className="tag">
          {recvCount}/{STORES.length} received
        </span>
      </div>

      {open && (
        <div className="pbody">
          <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--line)' }}>
            <label className="recv">
              <input
                type="checkbox"
                checked={scan.status === 'Completed'}
                onChange={(e) =>
                  onStage(p.id, 'scan', {
                    status: e.target.checked ? 'Completed' : 'Not Started',
                    person: operator || scan.person,
                  })
                }
              />
              <b>Scanned before dispatch</b>
            </label>
            <span className="tag">{scan.at ? `${fmt(scan.at)}${scan.person ? ' · ' + scan.person : ''}` : 'awaiting scan'}</span>
          </div>
          <div className="tbl-wrap" style={{ border: 0, borderRadius: 0, boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th className="num">Disp.</th>
                  <th>Received</th>
                  <th className="num">Missing</th>
                  <th className="num">Damaged</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {STORES.map((st) => (
                  <StoreCell key={st} p={p} store={st} onStore={onStore} operator={operator} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- page ---------- */
export default function Dispatch({ products }) {
  const { operator } = useAuth()
  const { patchStore, patchStage } = useData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})

  const filtered = products.filter((p) => `${p.sku} ${p.name || ''} ${p.vendor || ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="note">
        Cards are scanned before dispatch, then sent to each store. Store executives confirm receipt and flag any missing or damaged
        cards — flagged shortages appear instantly on the Overview alerts. Dispatching to a branch and branch receiving now live under
        their own "Admin Dispatch" / "Branch Upload" tabs.
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="search">
          {I.search({})}
          <input placeholder="Search product to dispatch / receive…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="card empty">No products to dispatch yet.</div>
      ) : (
        <div className="plist">
          {filtered.map((p) => (
            <DispatchRow
              key={p.id}
              p={p}
              open={!!open[p.id]}
              toggle={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
              onStore={patchStore}
              onStage={patchStage}
              operator={operator}
            />
          ))}
        </div>
      )}
    </div>
  )
}