import { useState, useMemo } from 'react'
import { gsPost } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { STAGES } from '../../lib/constants'
import { fmt, now, uid, productState } from '../../lib/utils'
import { CopySku, Pipe } from '../ui'

const lc = (s) => (s || '').trim().toLowerCase()
const NON_STAGE_PERMS = ['assign', 'qcaudit', 'bulk']
const stageName = (k) => (!k || k === 'all' ? 'All stages' : STAGES.find((s) => s.k === k)?.n || k)

const statBox = (bg, border) => ({
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 10,
  padding: '8px 14px',
  fontSize: 12,
})
const sectionLabel = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.6px',
  marginBottom: 6,
}
const smallTag = (bg, ink, border) => ({
  fontSize: 10,
  fontWeight: 600,
  borderRadius: 6,
  padding: '1px 8px',
  background: bg,
  color: ink,
  border: border ? `1px solid ${border}` : undefined,
})

export default function SkuAssignmentsTab({ isMasterOrAdmin, myMemberId, assignableMembers, runExclusive, busy }) {
  const { auth } = useAuth()
  const { division, products, vendors: allVendors, assignments, saveAssignments } = useData()
  const vendors = allVendors[division] || []
  const managerIdForRows = isMasterOrAdmin ? 'master' : myMemberId

  const [selMember, setSelMember] = useState('')
  const [selVendor, setSelVendor] = useState('')
  const [selSetNo, setSelSetNo] = useState('')
  const [selSkus, setSelSkus] = useState([])
  const [selStages, setSelStages] = useState([])
  const [skuSearch, setSkuSearch] = useState('')
  const [showSkuSug, setShowSkuSug] = useState(false)
  const [expandedMember, setExpandedMember] = useState(null)
  const [assErr, setAssErr] = useState('')
  const [assMsg, setAssMsg] = useState('')

  const divAssignments = useMemo(() => assignments.filter((a) => a.division === division), [assignments, division])
  const divAllProducts = useMemo(() => products.filter((p) => p.division === division), [products, division])
  const memberById = (id) => assignableMembers.find((m) => m.id === id)

  /* ---------- the pool of cards this person can hand out ---------- */
  // master: the whole division.
  // manager: cards assigned to them whose own stages aren't all Completed yet.
  const managerPool = useMemo(() => {
    if (isMasterOrAdmin) return divAllProducts
    const skuRows = {}
    divAssignments
      .filter((a) => a.memberId === myMemberId)
      .forEach((a) => (skuRows[lc(a.sku)] ||= []).push(a))
    return divAllProducts.filter((p) => {
      const rows = skuRows[lc(p.sku)]
      if (!rows || rows.length === 0) return false
      const specific = rows.filter((a) => a.stage && a.stage !== 'all')
      const toCheck = specific.length > 0 ? specific : rows
      return !toCheck.every((a) =>
        !a.stage || a.stage === 'all' ? productState(p) === 'done' : p.stages?.[a.stage]?.status === 'Completed'
      )
    })
  }, [divAllProducts, divAssignments, isMasterOrAdmin, myMemberId])

  // "sku|stage" pairs this assigner has already handed out
  const assignedSkuStageSet = useMemo(() => {
    const s = new Set()
    divAssignments.forEach((a) => {
      if (a.stage && a.stage !== 'all' && a.managerId === managerIdForRows) s.add(lc(a.sku) + '|' + a.stage.trim())
    })
    return s
  }, [divAssignments, managerIdForRows])

  const setNoOptions = useMemo(() => [...new Set(managerPool.map((p) => p.set_no).filter(Boolean))].sort(), [managerPool])

  const filteredProducts = useMemo(
    () =>
      managerPool.filter((p) => {
        if (selVendor && p.vendor !== selVendor) return false
        if (selSetNo && (p.set_no || '').trim() !== selSetNo) return false
        if (skuSearch.length >= 2) {
          const q = skuSearch.toLowerCase()
          if (!(p.sku.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q))) return false
        }
        // with stages picked, show a card if at least one picked stage is still free
        if (selStages.length > 0) return selStages.some((k) => !assignedSkuStageSet.has(lc(p.sku) + '|' + k))
        return true
      }),
    [managerPool, selVendor, selSetNo, skuSearch, selStages, assignedSkuStageSet]
  )
  const availableSkus = useMemo(() => filteredProducts.map((p) => p.sku), [filteredProducts])

  const skuSuggestions = useMemo(() => {
    if (skuSearch.length < 2) return []
    const q = skuSearch.toLowerCase()
    return managerPool.filter((p) => p.sku.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q)).slice(0, 8)
  }, [managerPool, skuSearch])

  const clearMsgs = () => {
    setAssMsg('')
    setAssErr('')
  }

  /* ---------- quick selection buttons ---------- */
  const selectTop = (n) => {
    clearMsgs()
    if (!selMember) return setAssErr('Select a team member first.')
    const remaining = availableSkus.filter((sku) => !selSkus.includes(sku))
    if (remaining.length === 0) return setAssErr('No more unassigned SKUs left to select.')
    setSelSkus((prev) => [...prev, ...remaining.slice(0, n)])
  }
  const deselectTop = (n) => {
    clearMsgs()
    if (selSkus.length === 0) return setAssErr('Nothing is selected yet.')
    const toRemove = availableSkus.filter((sku) => selSkus.includes(sku)).slice(0, n)
    setSelSkus((prev) => prev.filter((sku) => !toRemove.includes(sku)))
  }
  const selectAllAvailable = () => {
    clearMsgs()
    if (!selMember) return setAssErr('Select a team member first.')
    if (availableSkus.length === 0) return setAssErr('No unassigned SKUs available.')
    setSelSkus(availableSkus)
  }

  /* ---------- assign ---------- */
  const assignSku = () => {
    if (!selMember || selSkus.length === 0 || selStages.length === 0) {
      setAssErr('Select a member, at least one SKU, and at least one stage.')
      return
    }
    const member = memberById(selMember)
    if (!member) {
      setAssErr('Member not found.')
      return
    }

    runExclusive('Assigning cards', `${selSkus.length} SKU(s) → ${member.name}`, async (update) => {
      const memberStageKeys = (member.stages || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !NON_STAGE_PERMS.includes(s))
      const effectiveStages = selStages.includes('all') ? memberStageKeys : selStages

      let updated = [...assignments]
      selSkus.forEach((sku) => {
        const skuL = lc(sku)
        const sameRow = (a, stage) => a.division === division && a.memberId === selMember && lc(a.sku) === skuL && a.stage === stage
        updated = updated.filter((a) => !sameRow(a, 'all'))
        effectiveStages.forEach((stageKey) => {
          updated = updated.filter((a) => !sameRow(a, stageKey))
          updated.push({
            id: uid(),
            memberId: selMember,
            managerId: managerIdForRows,
            sku,
            stage: stageKey,
            division,
            assignedAt: now(),
          })
        })
      })

      clearMsgs()
      update('Saving assignments…')
      const result = await saveAssignments(updated)
      if (!result || result.ok === false) {
        setAssErr(`Could not save this assignment${result?.error ? ': ' + result.error : ''} — nothing was written, please retry.`)
        return
      }

      // history log, written a few at a time
      const historyRows = []
      selSkus.forEach((sku) =>
        effectiveStages.forEach((stageKey) =>
          historyRows.push({
            id: uid(),
            action: 'assigned',
            sku,
            division,
            fromMemberId: null,
            toMemberId: selMember,
            managerId: managerIdForRows,
            stage: stageKey,
            note: '',
            at: now(),
          })
        )
      )
      const BATCH = 5
      for (let i = 0; i < historyRows.length; i += BATCH) {
        update(`Writing history ${Math.min(i + BATCH, historyRows.length)} / ${historyRows.length}`)
        await Promise.all(historyRows.slice(i, i + BATCH).map((r) => gsPost('appendAssignmentHistory', r)))
      }

      setAssMsg(`✓ Assigned ${selSkus.length} SKU(s) × ${effectiveStages.length} stage(s) to ${member.name}.`)
      setSelSkus([])
      setSelStages([])
    })
  }

  const unassign = (id, sku, memberName) =>
    runExclusive('Removing assignment', `${sku} from ${memberName}`, async () => {
      await gsPost('appendAssignmentHistory', {
        id: uid(),
        action: 'unassigned',
        sku,
        division,
        fromMemberId: id,
        toMemberId: null,
        managerId: managerIdForRows,
        stage: '',
        note: `Removed by ${auth.name}`,
        at: now(),
      })
      await saveAssignments(assignments.filter((a) => a.id !== id))
      setAssErr('')
      setAssMsg(`✓ Removed ${sku} from ${memberName}.`)
    })

  /* ---------- manager summary numbers ---------- */
  const receivedCount = new Set(divAssignments.filter((a) => a.memberId === myMemberId).map((a) => lc(a.sku))).size
  const pushedCount = new Set(
    divAssignments.filter((a) => a.managerId === myMemberId && a.memberId !== myMemberId).map((a) => lc(a.sku))
  ).size

  const selectedMember = memberById(selMember)
  const pickableStages = selectedMember
    ? STAGES.filter((s) => {
        const keys = (selectedMember.stages || '').split(',').map((x) => x.trim())
        return s.k !== 'finalqc' && s.k !== 'scan' && keys.includes(s.k)
      })
    : []

  // cards pushed by me (manager) — one entry per SKU
  const pushedByMe = [...new Map(divAssignments.filter((a) => a.managerId === myMemberId).map((a) => [lc(a.sku), a])).values()]
  // cards master has assigned
  const masterAssignedProducts = divAllProducts.filter((p) =>
    divAssignments.some((a) => lc(a.sku) === lc(p.sku) && a.managerId === 'master')
  )
  const masterAssignedCountAll = divAllProducts.filter((p) => divAssignments.some((a) => lc(a.sku) === lc(p.sku))).length

  /* ====================== RENDER ====================== */
  return (
    <div>
      <div className="card pad" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600 }}>Assign SKU to member</h3>

        {/* manager summary */}
        {!isMasterOrAdmin && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={statBox('var(--sky-bg)', 'var(--sky)')}>
              <span style={{ color: 'var(--muted)' }}>Received from master</span>
              <b style={{ color: 'var(--sky-ink)', marginLeft: 6 }}>{receivedCount}</b>
            </div>
            <div style={statBox('var(--sage-bg)', 'var(--sage)')}>
              <span style={{ color: 'var(--muted)' }}>Pushed to team</span>
              <b style={{ color: 'var(--sage-ink)', marginLeft: 6 }}>{pushedCount}</b>
            </div>
            <div style={statBox('var(--peach-bg)', 'var(--peach)')}>
              <span style={{ color: 'var(--muted)' }}>Remaining with me</span>
              <b style={{ color: 'var(--peach-ink)', marginLeft: 6 }}>{managerPool.length}</b>
            </div>
          </div>
        )}

        {/* member / vendor / set no. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label className="fld">
            Team member
            <select
              value={selMember}
              onChange={(e) => {
                setSelMember(e.target.value)
                setSelSkus([])
                setSelStages([])
                setSkuSearch('')
                setAssErr('')
              }}
            >
              <option value="">— select member —</option>
              {assignableMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === myMemberId ? ' (myself)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="fld">
            Vendor (filter)
            <select
              value={selVendor}
              onChange={(e) => {
                setSelVendor(e.target.value)
                setSelSkus([])
                setSkuSearch('')
                setAssErr('')
              }}
            >
              <option value="">— all vendors —</option>
              {vendors.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="fld">
            Set No. (filter)
            <select
              value={selSetNo}
              onChange={(e) => {
                setSelSetNo(e.target.value)
                setSelSkus([])
                setSkuSearch('')
                setAssErr('')
              }}
            >
              <option value="">— all set no. —</option>
              {setNoOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* stage picker for the chosen member */}
        {pickableStages.length > 0 && (
          <label className="fld" style={{ marginTop: 10 }}>
            Stages to assign for this member
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {pickableStages.map((s) => {
                const on = selStages.includes(s.k)
                return (
                  <label
                    key={s.k}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      background: on ? 'var(--sky-bg)' : 'var(--card)',
                      border: `1px solid ${on ? 'var(--sky)' : 'var(--line2)'}`,
                      color: on ? 'var(--sky-ink)' : 'var(--ink)',
                      borderRadius: 8,
                      padding: '5px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      style={{ width: 13, height: 13, accentColor: 'var(--sky-ink)' }}
                      onChange={(e) => setSelStages((prev) => (e.target.checked ? [...prev, s.k] : prev.filter((k) => k !== s.k)))}
                    />
                    {s.n}
                  </label>
                )
              })}
            </div>
            {selStages.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--rose-ink)', marginTop: 4 }}>Select at least one stage to assign</div>
            )}
          </label>
        )}

        {/* SKU search */}
        <div style={{ position: 'relative', marginTop: 12 }}>
          <div style={{ position: 'relative' }}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
            <input
              className="txt"
              placeholder="Search SKU or name (type 2+ letters)…"
              value={skuSearch}
              onChange={(e) => {
                setSkuSearch(e.target.value)
                setShowSkuSug(true)
              }}
              onFocus={() => skuSearch.length >= 2 && setShowSkuSug(true)}
              onBlur={() => setTimeout(() => setShowSkuSug(false), 180)}
              style={{ paddingLeft: 32, fontSize: 12 }}
            />
            {skuSearch && (
              <button
                onClick={() => {
                  setSkuSearch('')
                  setShowSkuSug(false)
                }}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 12,
                  color: 'var(--faint)',
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {showSkuSug && skuSuggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                background: 'var(--card)',
                border: '1px solid var(--line2)',
                borderRadius: 12,
                boxShadow: 'var(--shadow-lg)',
                zIndex: 50,
                overflow: 'hidden',
              }}
            >
              {skuSuggestions.map((p) => {
                const already = selSkus.includes(p.sku)
                const stageInfo = selStages.map((k) => {
                  const existing = divAssignments.find((a) => lc(a.sku) === lc(p.sku) && a.stage === k)
                  return { stageName: stageName(k), isFree: !existing, who: existing ? memberById(existing.memberId)?.name : null }
                })
                return (
                  <div
                    key={p.id}
                    onMouseDown={() => {
                      if (!already) setSelSkus((prev) => [...prev, p.sku])
                      setSkuSearch('')
                      setShowSkuSug(false)
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--line)',
                      background: already ? 'var(--sage-bg)' : 'var(--card)',
                    }}
                    onMouseEnter={(e) => !already && (e.currentTarget.style.background = 'var(--card-2)')}
                    onMouseLeave={(e) => !already && (e.currentTarget.style.background = 'var(--card)')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CopySku sku={p.sku} style={{ flexShrink: 0 }} />
                      {p.name && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>}
                      {p.vendor && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{p.vendor}</span>}
                      {already && (
                        <span style={{ ...smallTag('var(--sage-bg)', 'var(--sage-ink)', 'var(--sage)'), fontWeight: 700, padding: '1px 7px' }}>
                          ✓ Selected
                        </span>
                      )}
                    </div>
                    {stageInfo.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 2 }}>
                        {stageInfo.map((si, i) => (
                          <span
                            key={i}
                            style={
                              si.isFree
                                ? smallTag('var(--sky-bg)', 'var(--sky-ink)', 'var(--sky)')
                                : smallTag('var(--peach-bg)', 'var(--peach-ink)', 'var(--peach)')
                            }
                          >
                            {si.stageName}: {si.isFree ? 'free' : `with ${si.who || 'someone'}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* quick select */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="ghost" onClick={() => selectTop(10)} disabled={!selMember || availableSkus.every((s) => selSkus.includes(s))}>
            + 10
          </button>
          <button className="ghost" onClick={() => deselectTop(10)} disabled={selSkus.length === 0}>
            − 10
          </button>
          <span style={{ width: 1, height: 22, background: 'var(--line2)' }} />
          <button className="ghost" onClick={selectAllAvailable} disabled={!selMember || availableSkus.length === 0}>
            Select all ({availableSkus.length})
          </button>
          {skuSearch.length >= 2 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Filtered: {filteredProducts.length} cards</span>}
          <div
            style={{
              marginLeft: 'auto',
              background: 'var(--sage-bg)',
              border: '1px solid var(--sage)',
              borderRadius: 9,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--sage-ink)',
            }}
          >
            {selSkus.length} selected
          </div>
        </div>

        {/* SKU pills */}
        <label className="fld" style={{ marginTop: 10 }}>
          <span>
            SKUs to assign{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
              — {filteredProducts.length} remaining in pool
              {!isMasterOrAdmin && ` · ${divAssignments.filter((a) => a.managerId === myMemberId).length} already assigned`}
            </span>
          </span>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 6,
              maxHeight: 220,
              overflowY: 'auto',
              padding: 8,
              border: '1px solid var(--line2)',
              borderRadius: 9,
              background: 'var(--card)',
            }}
          >
            {filteredProducts.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--faint)', padding: '8px 4px' }}>
                {selVendor
                  ? `No products found with vendor "${selVendor}" yet. Add or import products under this vendor first, or clear the vendor filter.`
                  : isMasterOrAdmin
                  ? 'No products available in this division yet.'
                  : "Your team's pool is empty — every card you can assign has already been given to your team."}
              </div>
            ) : (
              filteredProducts.map((p) => {
                const takenByThisMember = (k) =>
                  divAssignments.some((a) => a.memberId === selMember && a.sku === p.sku && a.stage === k)
                const fullyAssigned = !!selMember && selStages.length > 0 && selStages.every(takenByThisMember)
                const partlyAssigned = !!selMember && selStages.length > 0 && selStages.some(takenByThisMember) && !fullyAssigned
                const perStage = selStages.map((k) => {
                  const existing = divAssignments.find((a) => a.sku === p.sku && a.stage === k)
                  return { stageName: stageName(k), isFree: !existing, who: existing ? memberById(existing.memberId)?.name : null }
                })
                const isSelected = selSkus.includes(p.sku)

                let bg = 'var(--card)',
                  border = 'var(--line2)',
                  ink = 'var(--ink)'
                if (fullyAssigned) [bg, border, ink] = ['var(--sage-bg)', 'var(--sage)', 'var(--sage-ink)']
                else if (isSelected) [bg, border, ink] = ['var(--sky-bg)', 'var(--sky)', 'var(--sky-ink)']

                return (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      fontSize: 12,
                      fontWeight: 500,
                      color: ink,
                      background: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      padding: '6px 10px',
                      cursor: fullyAssigned ? 'default' : 'pointer',
                      minWidth: 160,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        disabled={fullyAssigned}
                        checked={isSelected || fullyAssigned}
                        style={{ width: 13, height: 13, accentColor: 'var(--sage-deep)' }}
                        onChange={(e) =>
                          !fullyAssigned &&
                          setSelSkus((prev) => (e.target.checked ? [...prev, p.sku] : prev.filter((s) => s !== p.sku)))
                        }
                      />
                      <span style={{ fontWeight: 600 }}>{p.sku}</span>
                      {p.name && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {p.name}</span>}
                    </div>
                    {fullyAssigned && (
                      <span style={{ fontSize: 10, color: 'var(--sage-ink)', fontWeight: 700, paddingLeft: 19 }}>✓ All selected stages assigned</span>
                    )}
                    {partlyAssigned && (
                      <span style={{ fontSize: 10, color: 'var(--peach-ink)', fontWeight: 700, paddingLeft: 19 }}>~ Partially assigned</span>
                    )}
                    {perStage.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingLeft: 19 }}>
                        {perStage.map((ps, i) => (
                          <span
                            key={i}
                            style={{
                              ...(ps.isFree ? smallTag('var(--sky-bg)', 'var(--sky-ink)') : smallTag('var(--peach-bg)', 'var(--peach-ink)')),
                              fontSize: 9.5,
                              borderRadius: 4,
                              padding: '1px 6px',
                            }}
                          >
                            {ps.stageName}: {ps.isFree ? 'free' : ps.who || 'taken'}
                          </span>
                        ))}
                      </div>
                    )}
                  </label>
                )
              })
            )}
          </div>
        </label>

        {/* already pushed by this manager */}
        {!isMasterOrAdmin && pushedByMe.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={sectionLabel}>Already assigned by you ({pushedByMe.length} cards pushed)</div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxHeight: 130,
                overflowY: 'auto',
                padding: 8,
                border: '1px solid var(--sage)',
                borderRadius: 9,
                background: 'var(--sage-bg)',
              }}
            >
              {pushedByMe.map((a) => {
                const prod = divAllProducts.find((p) => lc(p.sku) === lc(a.sku))
                return (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      background: 'var(--card)',
                      border: '1px solid var(--sage)',
                      borderRadius: 8,
                      padding: '5px 10px',
                      fontSize: 11.5,
                    }}
                  >
                    <span>
                      <CopySku
                        sku={a.sku}
                        style={{ fontWeight: 700, color: 'var(--ink)', background: 'transparent', border: 0, padding: 0 }}
                      />
                      {prod?.name ? ' · ' + prod.name : ''}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--sage-ink)', fontWeight: 600 }}>→ {memberById(a.memberId)?.name || '—'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* already assigned by master */}
        {isMasterOrAdmin && masterAssignedProducts.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={sectionLabel}>Already assigned ({masterAssignedCountAll} cards)</div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                maxHeight: 130,
                overflowY: 'auto',
                padding: 8,
                border: '1px solid var(--peach)',
                borderRadius: 9,
                background: 'var(--peach-bg)',
              }}
            >
              {masterAssignedProducts.map((p) => {
                const names = [
                  ...new Set(
                    divAssignments
                      .filter((a) => lc(a.sku) === lc(p.sku))
                      .map((a) => memberById(a.memberId)?.name)
                      .filter(Boolean)
                  ),
                ]
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      background: 'var(--card)',
                      border: '1px solid var(--peach)',
                      borderRadius: 8,
                      padding: '5px 10px',
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                      {p.sku}
                      {p.name ? ' · ' + p.name : ''}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--peach-ink)', fontWeight: 600 }}>→ {names.join(', ')}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <button className="primary" style={{ marginTop: 12 }} onClick={assignSku} disabled={!!busy}>
          {busy ? 'Assigning…' : `Assign${selSkus.length > 0 ? ` (${selSkus.length})` : ''}`}
        </button>
        {assErr && <div style={{ color: 'var(--rose-ink)', fontSize: 12, marginTop: 8 }}>{assErr}</div>}
        {assMsg && <div style={{ color: 'var(--sage-ink)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>{assMsg}</div>}
      </div>

      {/* ---------- per-member accordion ---------- */}
      {assignableMembers.length === 0 ? (
        <div className="card empty">Add team members first before assigning SKUs.</div>
      ) : (
        assignableMembers.map((m) => {
          const myAss = divAssignments.filter((a) => a.memberId === m.id)
          const uniqueSkuCount = new Set(myAss.map((a) => lc(a.sku))).size
          const isOpen = expandedMember === m.id

          // group this member's rows by SKU
          const skuGroups = {}
          if (isOpen)
            myAss.forEach((a) => {
              const key = lc(a.sku)
              if (!skuGroups[key])
                skuGroups[key] = { sku: a.sku, prod: divAllProducts.find((p) => lc(p.sku) === key), rows: [] }
              skuGroups[key].rows.push(a)
            })

          return (
            <div key={m.id} className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
              <div
                onClick={() => setExpandedMember(isOpen ? null : m.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', cursor: 'pointer' }}
              >
                <span className={'chev ' + (isOpen ? 'open' : '')}>▶</span>
                <b>{m.name}</b>
                <span className="tag">· {m.role}</span>
                <div className="spacer" />
                <span className="hint">
                  {uniqueSkuCount} SKU{uniqueSkuCount !== 1 ? 's' : ''} · {myAss.length} stage task{myAss.length !== 1 ? 's' : ''}
                </span>
              </div>

              {isOpen &&
                (myAss.length === 0 ? (
                  <div style={{ padding: '14px 18px', color: 'var(--faint)', fontSize: 13, borderTop: '1px solid var(--line)' }}>
                    No SKUs assigned yet.
                  </div>
                ) : (
                  <div style={{ borderTop: '1px solid var(--line)' }}>
                    {Object.values(skuGroups).map((group) => {
                      // everyone on this SKU, for every stage
                      const stageAssignees = divAssignments
                        .filter((a) => lc(a.sku) === lc(group.sku))
                        .map((a) => ({
                          stageName: stageName(a.stage),
                          memberName: memberById(a.memberId)?.name || '—',
                          assignmentId: a.id,
                          memberId: a.memberId,
                        }))
                      return (
                        <div
                          key={group.sku}
                          style={{
                            padding: '12px 18px',
                            borderBottom: '1px solid var(--line)',
                            display: 'flex',
                            gap: 14,
                            alignItems: 'flex-start',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ minWidth: 120 }}>
                            <CopySku sku={group.sku} />
                            {group.prod?.name && (
                              <div style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 600, marginTop: 4 }}>{group.prod.name}</div>
                            )}
                            {group.prod?.vendor && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{group.prod.vendor}</div>}
                          </div>

                          <div style={{ flex: 1, minWidth: 200 }}>
                            {group.prod && (
                              <div style={{ marginBottom: 8 }}>
                                <Pipe p={group.prod} />
                              </div>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {stageAssignees.map((sa, i) => {
                                const mine = sa.memberId === m.id
                                return (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      background: mine ? 'var(--sky-bg)' : 'var(--card-2)',
                                      border: `1px solid ${mine ? 'var(--sky)' : 'var(--line2)'}`,
                                      borderRadius: 8,
                                      padding: '4px 10px',
                                      fontSize: 11.5,
                                    }}
                                  >
                                    <span style={{ fontWeight: 600, color: mine ? 'var(--sky-ink)' : 'var(--muted)' }}>{sa.stageName}</span>
                                    <span style={{ color: 'var(--faint)' }}>→</span>
                                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{sa.memberName}</span>
                                    {mine && (
                                      <button
                                        className="danger"
                                        style={{ fontSize: 10, padding: '1px 6px', marginLeft: 2 }}
                                        onClick={() => unassign(sa.assignmentId, group.sku, sa.memberName)}
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>

                          <div style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap', paddingTop: 4 }}>
                            {fmt(group.rows[0]?.assignedAt)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
            </div>
          )
        })
      )}
    </div>
  )
}