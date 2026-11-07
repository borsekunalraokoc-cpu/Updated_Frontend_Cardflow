import { Chip } from '../ui'

function statusChip(status) {
  if (status === 'received') return <Chip status="Completed" />
  if (status === 'awaiting_receipt')
    return (
      <span className="chip c-app">
        <span className="dot" />
        Awaiting receipt
      </span>
    )
  return <Chip status="Not Started" />
}

// "Sets in this batch" — which branches each set went to
export default function SetSummaryPanel({ sets }) {
  if (sets.length === 0) return null

  return (
    <div className="sec">
      <div className="sec-h">
        <h3>Sets in this batch</h3>
        <span className="hint">who each set was dispatched to</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sets.map((s) => (
          <div key={s.setLabel} className="card pad">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{s.setLabel}</div>
            {s.branches.length === 0 ? (
              <div className="tag">Not dispatched to any branch yet.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {s.branches.map((b) => (
                  <div
                    key={b.branchName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: '1px solid var(--line2)',
                      borderRadius: 9,
                      padding: '6px 12px',
                    }}
                  >
                    <b style={{ fontSize: 12.5 }}>{b.branchName}</b>
                    {statusChip(b.status)}
                    <span className="tag">
                      {b.dispatchedCount} sent
                      {b.receivedCount ? ` · ${b.receivedCount} received` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}