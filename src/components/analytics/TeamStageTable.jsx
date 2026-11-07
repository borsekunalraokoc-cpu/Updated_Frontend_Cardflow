import { Fragment } from 'react'

const leftSticky = { position: 'sticky', left: 0, zIndex: 2, borderRight: '2px solid var(--line2)' }
const groupBorder = { borderLeft: '2px solid var(--line2)' }
const totalBorder = { borderTop: '2px solid var(--line2)' }

/*
  Member × stage table: for every stage in the group, three columns
  (Completed / Pending / Issues), plus a Total row at the bottom.

  rows: [{ memberId, memberName, totalAssigned, perStage: { [stageKey]: { completed, pending, issue } } }]
*/
export default function TeamStageTable({ title, rows, stageGroup, division, loading }) {
  const colCount = stageGroup.length * 3 + 2
  const subColWidth = 83 / (stageGroup.length * 3)
  const sumOf = (k, f) => rows.reduce((s, r) => s + (r.perStage[k]?.[f] || 0), 0)

  return (
    <div className="card pad">
      <div className="sec-h">
        <h3>{title}</h3>
        <span className="hint">{division}</span>
      </div>

      <div
        className="team-table"
        style={{
          overflowX: 'auto',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r)',
          background: 'var(--card)',
          boxShadow: 'var(--shadow)',
        }}
      >
        <table style={{ minWidth: 1500 }}>
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            {stageGroup.map((s) => (
              <Fragment key={s.k}>
                <col style={{ width: `${subColWidth * 1.35}%` }} />
                <col style={{ width: `${subColWidth * 0.9}%` }} />
                <col style={{ width: `${subColWidth * 0.75}%` }} />
              </Fragment>
            ))}
          </colgroup>

          <thead>
            <tr>
              <th rowSpan={2} style={{ ...leftSticky, zIndex: 3, background: 'var(--card-2)' }}>
                Member
              </th>
              <th rowSpan={2} className="num" style={{ borderRight: '2px solid var(--line2)', lineHeight: 1.25 }}>
                Total
                <br />
                Assigned
              </th>
              {stageGroup.map((s) => (
                <th
                  key={s.k}
                  colSpan={3}
                  style={{ ...groupBorder, textAlign: 'center', fontWeight: 700, background: '#F3E4E4', color: '#7A3B3B' }}
                >
                  {s.n}
                </th>
              ))}
            </tr>
            <tr>
              {stageGroup.map((s) => (
                <Fragment key={s.k}>
                  <th className="num" style={groupBorder}>
                    Completed
                  </th>
                  <th className="num">Pending</th>
                  <th className="num">Issues</th>
                </Fragment>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                  No assignments yet.
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((r) => (
                <tr key={r.memberId}>
                  <td style={{ ...leftSticky, background: 'var(--card)' }}>
                    <b>{r.memberName}</b>
                  </td>
                  <td className="num" style={{ borderRight: '2px solid var(--line2)' }}>
                    {r.totalAssigned}
                  </td>
                  {stageGroup.map((s) => {
                    const st = r.perStage[s.k]
                    const empty = !st || st.completed + st.pending + st.issue === 0
                    return (
                      <Fragment key={s.k}>
                        <td className="num" style={{ ...groupBorder, background: 'var(--sage-bg)', color: 'var(--sage-ink)', fontWeight: 700 }}>
                          {empty ? '-' : st.completed}
                        </td>
                        <td className="num" style={{ background: 'var(--peach-bg)', color: 'var(--peach-ink)', fontWeight: 700 }}>
                          {empty ? '-' : st.pending}
                        </td>
                        <td className="num" style={{ background: 'var(--rose-bg)', color: 'var(--rose-ink)', fontWeight: 700 }}>
                          {empty ? '-' : st.issue}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}

            {!loading && rows.length > 0 && (
              <tr style={{ fontWeight: 700 }}>
                <td style={{ ...leftSticky, ...totalBorder, background: 'var(--card)' }}>Total</td>
                <td className="num" style={{ borderRight: '2px solid var(--line2)', ...totalBorder }}></td>
                {stageGroup.map((s) => (
                  <Fragment key={s.k}>
                    <td className="num" style={{ ...groupBorder, ...totalBorder }}>
                      {sumOf(s.k, 'completed')}
                    </td>
                    <td className="num" style={totalBorder}>
                      {sumOf(s.k, 'pending')}
                    </td>
                    <td className="num" style={totalBorder}>
                      {sumOf(s.k, 'issue')}
                    </td>
                  </Fragment>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}