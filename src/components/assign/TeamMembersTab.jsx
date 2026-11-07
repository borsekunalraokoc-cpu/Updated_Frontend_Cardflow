import { useState } from 'react'
import { gsGetUsers, gsPost } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { STAGES } from '../../lib/constants'
import { fmt, now } from '../../lib/utils'

const lc = (s) => (s || '').trim().toLowerCase()

// pill colours for the permission checkboxes
function permColors(k, on) {
  if (!on) return { bg: 'var(--card)', border: 'var(--line2)' }
  if (k === 'bulk') return { bg: 'var(--peach-bg)', border: 'var(--peach)' }
  if (k === 'assign') return { bg: 'var(--lav-bg)', border: 'var(--lav)' }
  return { bg: 'var(--sage-bg)', border: 'var(--sage)' }
}

// A row of checkbox pills for picking stages / permissions
function PermissionPicker({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
      {options.map((s) => {
        const on = value.includes(s.k)
        const c = permColors(s.k, on)
        return (
          <label
            key={s.k}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--ink)',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              padding: '5px 10px',
              cursor: 'pointer',
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            <input
              type="checkbox"
              checked={on}
              style={{ width: 13, height: 13, accentColor: s.k === 'bulk' ? 'var(--peach-ink)' : 'var(--sage-deep)' }}
              onChange={(e) => onChange(e.target.checked ? [...value, s.k] : value.filter((k) => k !== s.k))}
            />
            {s.n}
          </label>
        )
      })}
    </div>
  )
}

export default function TeamMembersTab({ isMasterOrAdmin, myMemberId, divMembers }) {
  const { auth } = useAuth()
  const { division, teamMembers, assignments, saveTeamMembers, saveAssignments } = useData()

  // stages (and for master: extra permissions) that can be given to a member
  const pipelineStages = STAGES.filter((s) => s.k !== 'finalqc' && s.k !== 'scan')
  const myStages = (auth.stages || '').split(',').map((x) => x.trim())
  const allPermissions = isMasterOrAdmin
    ? [
        ...pipelineStages,
        { k: 'bulk', n: 'Bulk Upload' },
        { k: 'assign', n: 'Assign Work' },
        { k: 'qcaudit', n: 'QC Audit' },
        { k: 'branchupload', n: 'Branch Upload' },
      ]
    : pipelineStages.filter((s) => myStages.includes(s.k))

  /* ---------- add ---------- */
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPass, setNewPass] = useState('')
  const [selectedStages, setSelectedStages] = useState([])
  const [addErr, setAddErr] = useState('')
  const [addMsg, setAddMsg] = useState('')

  const resetMsgs = () => {
    setAddErr('')
    setAddMsg('')
  }

  const addMember = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPass.trim()) {
      setAddErr('Name, email and password are required.')
      return
    }
    const id = newName.trim().toLowerCase().replace(/\s+/g, '_')
    if (teamMembers.find((m) => m.id === id && m.division === division)) {
      setAddErr('A member with this name already exists.')
      return
    }
    if (selectedStages.length === 0) {
      setAddErr('Select at least one stage for this member.')
      return
    }

    const stages = selectedStages.join(',')
    const name = newName.trim()
    const email = newEmail.trim()
    const password = newPass.trim()

    const m = {
      id,
      name,
      email,
      password,
      role: 'member',
      stages,
      division,
      managerId: isMasterOrAdmin ? null : myMemberId,
      joinedAt: now(),
    }
    saveTeamMembers([...teamMembers, m])

    // reset the form straight away
    setNewName('')
    setNewEmail('')
    setNewPass('')
    setSelectedStages([])
    setAddErr('')
    setAddMsg(`✓ ${name} added to the team.`)

    // also create the login in the Users table
    const existing = await gsGetUsers()
    if (!existing.find((u) => lc(u.email) === lc(email))) {
      await gsPost('saveUsers', [...existing, { email, password, name, role: 'member', stages }])
    }
  }

  /* ---------- remove ---------- */
  const removeMember = async (id) => {
    const member = teamMembers.find((m) => m.id === id && m.division === division)
    saveTeamMembers(teamMembers.filter((m) => !(m.id === id && m.division === division)))
    saveAssignments(assignments.filter((a) => !(a.memberId === id && a.division === division)))
    if (member) {
      const existing = await gsGetUsers()
      await gsPost('saveUsers', existing.filter((u) => lc(u.email) !== lc(member.email)))
    }
  }

  /* ---------- edit ---------- */
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editStages, setEditStages] = useState([])
  const [editErr, setEditErr] = useState('')

  const startEdit = (m) => {
    setEditingId(m.id)
    setEditName(m.name)
    setEditStages((m.stages || '').split(',').map((s) => s.trim()).filter(Boolean))
    setEditErr('')
  }

  const saveEdit = async () => {
    if (!editName.trim()) return setEditErr('Name is required.')
    if (editStages.length === 0) return setEditErr('Select at least one stage.')
    const name = editName.trim()
    const stages = editStages.join(',')
    const member = teamMembers.find((m) => m.id === editingId)
    if (!member) return setEditingId(null)

    saveTeamMembers(teamMembers.map((m) => (m.id === editingId ? { ...m, name, stages } : m)))
    setEditingId(null)

    const existing = await gsGetUsers()
    await gsPost(
      'saveUsers',
      existing.map((u) => (lc(u.email) === lc(member.email) ? { ...u, name, stages } : u))
    )
  }

  // distinct SKUs assigned to a member
  const skuCount = (memberId) => new Set(assignments.filter((a) => a.memberId === memberId).map((a) => lc(a.sku))).size

  return (
    <div>
      {/* ---------- add form ---------- */}
      <div className="card pad" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600 }}>Add team member — {division}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <label className="fld">
            Full name
            <input
              className="txt"
              placeholder="e.g. Priya Sharma"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                resetMsgs()
              }}
            />
          </label>
          <label className="fld">
            Email (login)
            <input
              className="txt"
              type="email"
              placeholder="priya@koc.com"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value)
                resetMsgs()
              }}
            />
          </label>
          <label className="fld">
            Password
            <input
              className="txt"
              type="password"
              placeholder="••••••••"
              value={newPass}
              onChange={(e) => {
                setNewPass(e.target.value)
                resetMsgs()
              }}
            />
          </label>
          <label className="fld" style={{ gridColumn: '1/-1' }}>
            Stages this member can access
            <PermissionPicker options={allPermissions} value={selectedStages} onChange={setSelectedStages} />
            {selectedStages.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--rose-ink)', marginTop: 4 }}>Select at least one stage</div>
            )}
          </label>
        </div>
        {addErr && <div style={{ color: 'var(--rose-ink)', fontSize: 12, marginBottom: 10 }}>{addErr}</div>}
        {addMsg && <div style={{ color: 'var(--sage-ink)', fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{addMsg}</div>}
        <button className="primary" onClick={addMember}>
          Add member
        </button>
      </div>

      {/* ---------- members table ---------- */}
      {divMembers.length === 0 ? (
        <div className="card empty">No team members added yet for {division}.</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Division</th>
                <th>Stages & Access</th>
                <th>Joined</th>
                <th className="num">Assigned SKUs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {divMembers.map((m) =>
                editingId === m.id ? (
                  <tr key={m.id} style={{ background: 'var(--sky-bg)' }}>
                    <td colSpan={7} style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label className="fld" style={{ minWidth: 220 }}>
                            Name
                            <input
                              className="txt"
                              value={editName}
                              onChange={(e) => {
                                setEditName(e.target.value)
                                setEditErr('')
                              }}
                            />
                          </label>
                          <span className="tag">{m.email} (login email can't be changed here)</span>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--muted)',
                              textTransform: 'uppercase',
                              letterSpacing: '.6px',
                            }}
                          >
                            Stages & access
                          </div>
                          <PermissionPicker options={allPermissions} value={editStages} onChange={setEditStages} />
                        </div>
                        {editErr && <div style={{ color: 'var(--rose-ink)', fontSize: 12 }}>{editErr}</div>}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="primary" onClick={saveEdit}>
                            Save changes
                          </button>
                          <button className="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id}>
                    <td>
                      <b>{m.name}</b>
                    </td>
                    <td className="tag">{m.email}</td>
                    <td>
                      <span className="chip c-done" style={{ fontSize: 10.5 }}>
                        <span className="dot" />
                        {m.division || '—'}
                      </span>
                    </td>
                    <td>
                      {(m.stages || '')
                        .split(',')
                        .filter(Boolean)
                        .map((stage) => (
                          <span key={stage} className="chip c-prog" style={{ marginRight: 4 }}>
                            <span className="dot" />
                            {STAGES.find((x) => x.k === stage)?.n || stage}
                          </span>
                        ))}
                    </td>
                    <td className="tag">{m.joinedAt ? fmt(m.joinedAt) : '—'}</td>
                    <td className="num">{skuCount(m.id)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="ghost" style={{ padding: '5px 10px', fontSize: 11.5 }} onClick={() => startEdit(m)}>
                          Edit
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            if (confirm(`Remove ${m.name}? Their assignments will also be cleared.`)) removeMember(m.id)
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}