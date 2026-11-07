import { useState } from 'react'
import { useData } from '../../context/DataContext'
import { STORES } from '../../lib/constants'
import { now, uid } from '../../lib/utils'

const lc = (s) => (s || '').trim().toLowerCase()
const hasBranchUpload = (m) => (m.stages || '').split(',').map((s) => s.trim()).includes('branchupload')

// Branch assignments are stored as assignment rows with stage "branchupload"
// and the branch name in the "sku" field.
export default function BranchesTab({ isMasterOrAdmin, myMemberId, divMembers, runExclusive }) {
  const { division, assignments, saveAssignments } = useData()

  const [selMember, setSelMember] = useState('')
  const [selBranches, setSelBranches] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const branchAssignments = assignments.filter((a) => a.division === division && a.stage === 'branchupload')
  const branchMembers = divMembers.filter(hasBranchUpload)

  const assignBranches = () => {
    if (!selMember || selBranches.length === 0) {
      setErr('Select a team member and at least one branch.')
      return
    }
    const member = divMembers.find((m) => m.id === selMember)
    if (!member) {
      setErr('Member not found.')
      return
    }

    runExclusive('Assigning branches', `${selBranches.length} branch(es) → ${member.name}`, async () => {
      let updated = [...assignments]
      selBranches.forEach((branch) => {
        // replace any existing identical row
        updated = updated.filter(
          (a) => !(a.division === division && a.memberId === selMember && a.stage === 'branchupload' && lc(a.sku) === lc(branch))
        )
        updated.push({
          id: uid(),
          memberId: selMember,
          managerId: isMasterOrAdmin ? 'master' : myMemberId,
          sku: branch,
          stage: 'branchupload',
          division,
          assignedAt: now(),
        })
      })
      setErr('')
      setMsg('')
      const result = await saveAssignments(updated)
      if (!result || result.ok === false) {
        setErr(`Could not save${result?.error ? ': ' + result.error : ''}.`)
        return
      }
      setMsg(`✓ Assigned ${selBranches.length} branch(es) to ${member.name}.`)
      setSelBranches([])
    })
  }

  const unassignBranch = (id, branch, memberName) =>
    runExclusive('Removing branch', `${branch} from ${memberName}`, async () => {
      await saveAssignments(assignments.filter((a) => a.id !== id))
      setMsg(`✓ Removed ${branch} from ${memberName}.`)
    })

  return (
    <div>
      <div className="card pad" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600 }}>Assign branches for Branch Upload</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
          <label className="fld">
            Team member
            <select
              value={selMember}
              onChange={(e) => {
                setSelMember(e.target.value)
                setSelBranches([])
                setErr('')
              }}
            >
              <option value="">— select member —</option>
              {branchMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="fld">
            Branches
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {STORES.map((st) => {
                const already = branchAssignments.some((a) => a.memberId === selMember && a.sku === st)
                const on = selBranches.includes(st) || already
                return (
                  <label
                    key={st}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      background: on ? 'var(--sky-bg)' : 'var(--card)',
                      border: `1px solid ${on ? 'var(--sky)' : 'var(--line2)'}`,
                      borderRadius: 8,
                      padding: '5px 10px',
                      cursor: already ? 'default' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={already}
                      checked={on}
                      onChange={(e) =>
                        setSelBranches((prev) => (e.target.checked ? [...prev, st] : prev.filter((b) => b !== st)))
                      }
                    />
                    {st}
                  </label>
                )
              })}
            </div>
          </label>
        </div>

        {err && <div style={{ color: 'var(--rose-ink)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        {msg && <div style={{ color: 'var(--sage-ink)', fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{msg}</div>}
        <button className="primary" onClick={assignBranches}>
          Assign branch(es)
        </button>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Branches assigned</th>
            </tr>
          </thead>
          <tbody>
            {branchMembers.map((m) => {
              const rows = branchAssignments.filter((a) => a.memberId === m.id)
              return (
                <tr key={m.id}>
                  <td>
                    <b>{m.name}</b>
                  </td>
                  <td>
                    {rows.length === 0 ? (
                      <span className="tag">No branches assigned</span>
                    ) : (
                      rows.map((r) => (
                        <span key={r.id} className="chip c-done" style={{ marginRight: 6, marginBottom: 4 }}>
                          <span className="dot" />
                          {r.sku}
                          <button
                            className="danger"
                            style={{ fontSize: 9, padding: '0 5px', marginLeft: 6 }}
                            onClick={() => unassignBranch(r.id, r.sku, m.name)}
                          >
                            ✕
                          </button>
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}