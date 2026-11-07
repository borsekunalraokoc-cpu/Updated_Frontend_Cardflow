import { useState, useMemo, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { BusyOverlay } from '../components/ui'
import TeamMembersTab from '../components/assign/TeamMembersTab'
import SkuAssignmentsTab from '../components/assign/SkuAssignmentsTab'
import BranchesTab from '../components/assign/BranchesTab'

const lc = (s) => (s || '').trim().toLowerCase()

export default function AssignWork() {
  const { auth } = useAuth()
  const { teamMembers } = useData()

  const isMasterOrAdmin = auth.role === 'master' || auth.role === 'admin'
  const canManageMembers =
    isMasterOrAdmin || (auth.stages || '').split(',').map((s) => s.trim()).includes('assign')

  const [subTab, setSubTab] = useState(canManageMembers ? 'members' : 'assignments')

  const myMemberId = useMemo(
    () => teamMembers.find((m) => m.email && auth.email && lc(m.email) === lc(auth.email))?.id || null,
    [teamMembers, auth.email]
  )

  // master sees everyone; a manager sees only their own reports
  const divMembers = useMemo(
    () => (isMasterOrAdmin ? teamMembers : teamMembers.filter((m) => m.managerId === myMemberId)),
    [teamMembers, isMasterOrAdmin, myMemberId]
  )

  // who you can assign SKUs to: your reports + yourself (managers keep some work)
  const assignableMembers = useMemo(() => {
    if (isMasterOrAdmin) return divMembers
    const me = teamMembers.find((m) => m.id === myMemberId)
    return me && !divMembers.some((m) => m.id === me.id) ? [...divMembers, me] : divMembers
  }, [divMembers, teamMembers, myMemberId, isMasterOrAdmin])

  /* ---------- one save at a time, with a full-screen "saving" overlay ---------- */
  const [busy, setBusy] = useState(null) // { title, sub }
  const busyRef = useRef(false) // instant lock (state is too slow for double clicks)

  const runExclusive = async (title, sub, fn) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy({ title, sub })
    try {
      return await fn((nextSub) => setBusy({ title, sub: nextSub }))
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const shared = { isMasterOrAdmin, myMemberId, divMembers, assignableMembers, runExclusive, busy }

  const tabs = canManageMembers
    ? [
        ['members', 'Team Members'],
        ['assignments', 'SKU Assignments'],
        ['branches', 'Branch Upload'],
      ]
    : [['assignments', 'SKU Assignments']]

  return (
    <div>
      <BusyOverlay busy={busy} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabs.map(([k, n]) => (
          <button
            key={k}
            onClick={() => setSubTab(k)}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              border: '1px solid var(--line2)',
              background: subTab === k ? 'var(--ink)' : 'var(--card)',
              color: subTab === k ? '#fff' : 'var(--ink)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {n}
          </button>
        ))}
      </div>

      {subTab === 'members' && canManageMembers && <TeamMembersTab {...shared} />}
      {subTab === 'assignments' && <SkuAssignmentsTab {...shared} />}
      {subTab === 'branches' && canManageMembers && <BranchesTab {...shared} />}
    </div>
  )
}