// 3 KPI cards: Dispatched / Received / Still Pending
// used by Admin Dispatch and Branch Upload
export default function DispatchKpiRow({ dispatched, received, pending, scope, ready = true, loading = false }) {
  const show = (n) => (!ready ? '—' : n)
  const sub = (text) => (!ready ? scope : loading ? 'updating…' : text)

  return (
    <div className="grid kpis" style={{ marginBottom: 16 }}>
      <div className="card kpi">
        <div className="lab">Cards Dispatched</div>
        <div className="val" style={{ color: 'var(--sky-ink)' }}>
          {show(dispatched)}
        </div>
        <div className="sub">{sub(scope)}</div>
      </div>
      <div className="card kpi">
        <div className="lab">Cards Received</div>
        <div className="val" style={{ color: 'var(--sage-ink)' }}>
          {show(received)}
        </div>
        <div className="sub">{sub('scanned in so far')}</div>
      </div>
      <div className="card kpi">
        <div className="lab">Still Pending</div>
        <div className="val" style={{ color: ready && pending > 0 ? 'var(--rose-ink)' : 'var(--sage-ink)' }}>
          {show(pending)}
        </div>
        <div className="sub">{sub('not yet scanned')}</div>
      </div>
    </div>
  )
}