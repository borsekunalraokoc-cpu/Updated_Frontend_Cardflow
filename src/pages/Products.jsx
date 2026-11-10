import { useState, useEffect, useMemo, useCallback, useDeferredValue, memo } from 'react'
import { API } from '../api'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { STAGES, STATUSES } from '../lib/constants'
import { productState, productPct } from '../lib/utils'
import { I, CopySku } from '../components/ui'
import ProductRow from '../components/products/ProductRow'
import AddModal from '../components/products/AddModal'

const PAGE_SIZE = 20
const PIPE_STAGES = STAGES.filter((s) => s.k !== 'finalqc')
const ALL_PIPE_KEYS = PIPE_STAGES.map((s) => s.k)
const EMPTY = []
const lc = (s) => (s || '').trim().toLowerCase()
const ts = (iso) => (iso ? Date.parse(iso) || 0 : 0)

/* ---------- pure helpers (module level so they never change identity) ---------- */
const isQcFlagged = (stg) =>
  stg?.status === 'In Progress' && String(stg?.comments || '').startsWith('QC flagged:')

const stageHasOpenIssue = (p, k) => {
  const stg = p.stages?.[k]
  return !!stg && (stg.status === 'Issue' || isQcFlagged(stg))
}

const cardHasOpenIssue = (p) => {
  if (p.verdict === 'Approved') return false
  if (p.verdict === 'Issues Found') return true
  return ALL_PIPE_KEYS.some((k) => stageHasOpenIssue(p, k))
}

const cardHasOpenIssueInStages = (p, stageKeys) => {
  if (p.verdict === 'Approved' || !stageKeys || stageKeys.length === 0) return false
  if (stageKeys.some((k) => stageHasOpenIssue(p, k))) return true
  // "Issues Found" with no stage flagged → show to anyone on the card
  return p.verdict === 'Issues Found' && !ALL_PIPE_KEYS.some((k) => stageHasOpenIssue(p, k))
}

const countCardIssueInstances = (p, stageKeys) => {
  const keys = stageKeys || ALL_PIPE_KEYS
  const n = keys.filter((k) => stageHasOpenIssue(p, k)).length
  return n === 0 && p.verdict === 'Issues Found' ? 1 : n
}

// Are all the stages in these assignment rows finished on this card?
function stagesDoneFor(p, rows) {
  const specific = rows.filter((a) => a.stage && a.stage !== 'all')
  const toCheck = specific.length > 0 ? specific : rows
  return toCheck.every((a) =>
    !a.stage || a.stage === 'all' ? productState(p) === 'done' : p.stages?.[a.stage]?.status === 'Completed'
  )
}

const sectionLabel = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  marginBottom: 6,
}
const bigSelect = {
  border: '1px solid var(--line2)',
  borderRadius: 9,
  padding: '9px 11px',
  background: 'var(--card)',
  fontSize: 13,
}
const smallBtn = { padding: '6px 10px', fontSize: 12 }

/* ---------- memoized row wrapper ----------
   Only re-renders when its own card / open / selected state changes,
   so opening one card or ticking one checkbox doesn't redraw all 20. */
const MemoRow = memo(function MemoRow({
  p,
  isOpen,
  isSelected,
  onToggleId,
  onSelectId,
  onStage,
  onQC,
  onRemove,
  allowedStages,
  cardStages,
  skuRows,
  filterMember,
  operator,
  assignedTo,
}) {
  const hasCardStages = !!cardStages && cardStages.size > 0

  // narrow to the stages this person was assigned on this card
  const effectiveAllowedStages = useMemo(() => {
    if (!hasCardStages) return allowedStages
    return allowedStages ? allowedStages.filter((s) => cardStages.has(s)) : [...cardStages]
  }, [hasCardStages, cardStages, allowedStages])

  // member-level done/pending for their own stages (no QC gate)
  const memberComplete = hasCardStages
    ? [...cardStages].every((k) => p.stages?.[k]?.status === 'Completed')
    : null

  const memberStages = useMemo(() => {
    if (!filterMember) return EMPTY
    return skuRows
      .filter((a) => a.memberId === filterMember)
      .map((a) => ({
        stage: a.stage,
        stageName: STAGES.find((s) => s.k === a.stage)?.n || a.stage,
        stageStatus: p.stages?.[a.stage]?.status || 'Not Started',
        memberId: a.memberId,
      }))
  }, [filterMember, skuRows, p])

  const toggle = useCallback(() => onToggleId(p.id), [onToggleId, p.id])
  const onSelect = useCallback(() => onSelectId(p.id), [onSelectId, p.id])

  return (
    <ProductRow
      p={p}
      open={isOpen}
      toggle={toggle}
      onStage={onStage}
      onQC={onQC}
      onRemove={onRemove}
      allowedStages={effectiveAllowedStages}
      selected={isSelected}
      onSelect={onSelect}
      operator={operator}
      assignedTo={assignedTo}
      memberStages={memberStages}
      memberComplete={memberComplete}
    />
  )
})

export default function Products({ products, allDivProducts, allowedStages, initialFilter, onFilterConsumed }) {
  const { auth, operator } = useAuth()
  const {
    division,
    vendors: allVendors,
    assignments,
    teamMembers,
    upsertProduct,
    patchStage,
    patchStageBulk,
    patchQC,
    removeProduct,
    addVendor,
  } = useData()
  const vendors = allVendors[division] || EMPTY

  const isFullAccess = allowedStages === null
  const isMasterOrAdmin = auth?.role === 'master' || auth?.role === 'admin'
  const hasAssignAccess =
    isMasterOrAdmin || (auth?.stages || '').split(',').map((s) => s.trim()).includes('assign')

  const myMemberId = useMemo(() => {
    const me = teamMembers.find((m) => m.email && auth?.email && lc(m.email) === lc(auth.email))
    return me?.id || (auth?.name ? auth.name.toLowerCase().replace(/\s+/g, '_') : null)
  }, [teamMembers, auth])

  /* ---------- UI state ---------- */
  const [q, setQ] = useState('')
  const deferredQ = useDeferredValue(q) // typing stays snappy; heavy filtering catches up
  const [open, setOpen] = useState({})
  const [modal, setModal] = useState(false)
  const [showSug, setShowSug] = useState(false)
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState({})
  const [bulkStage, setBulkStage] = useState('')
  const [bulkStatus, setBulkStatus] = useState('Completed')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkErr, setBulkErr] = useState('')

  // plain members only ever see their own cards, so start them on "Assigned"
  const [assignTab, setAssignTab] = useState(hasAssignAccess ? 'notassigned' : 'assigned')
  const [showFilters, setShowFilters] = useState(false)
  const [filterMember, setFilterMember] = useState('')
  const [fSetNo, setFSetNo] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fAssignee, setFAssignee] = useState('')
  const [fEventType, setFEventType] = useState('')
  const [fEventFrom, setFEventFrom] = useState('')
  const [fEventTo, setFEventTo] = useState('')
  const [fVendor, setFVendor] = useState('')
  const [fCompletion, setFCompletion] = useState('')
  const [fStage, setFStage] = useState('')
  const [fStageStatus, setFStageStatus] = useState('')
  const [fHasIssue, setFHasIssue] = useState(false)
  const [fStalledDays, setFStalledDays] = useState('')
  const [fQcVerdict, setFQcVerdict] = useState('')
  const [sortBy, setSortBy] = useState('recent')

  /* ---------- server stats ---------- */
  const [dbMemberStats, setDbMemberStats] = useState(null)
  const [dbPipelineStats, setDbPipelineStats] = useState(null)
  useEffect(() => {
    if (!auth || isMasterOrAdmin || !myMemberId) return
    const qs = `memberId=${encodeURIComponent(myMemberId)}&division=${encodeURIComponent(division)}`
    fetch(`${API}/api/memberStats?${qs}`)
      .then((r) => r.json())
      .then((d) => d.ok && setDbMemberStats(d))
      .catch((e) => console.error('memberStats fetch failed', e))
    fetch(`${API}/api/pipelineStats?${qs}`)
      .then((r) => r.json())
      .then((d) => d.ok && setDbPipelineStats(d.stages))
      .catch((e) => console.error('pipelineStats fetch failed', e))
  }, [myMemberId, division, auth, isMasterOrAdmin])

  const [dbAllMemberStats, setDbAllMemberStats] = useState(null)
  useEffect(() => {
    if (!hasAssignAccess || !division) return
    fetch(`${API}/api/allMemberStats?division=${encodeURIComponent(division)}`)
      .then((r) => r.json())
      .then((d) => d.ok && setDbAllMemberStats(d.members))
      .catch((e) => console.error('allMemberStats fetch failed', e))
  }, [division, hasAssignAccess])

  /* ---------- deep link from Overview ---------- */
  useEffect(() => {
    if (!initialFilter) return
    if (initialFilter.assignTab) {
      setAssignTab(initialFilter.assignTab)
      setShowFilters(true)
    }
    setFHasIssue(!!initialFilter.fHasIssue)
    setFQcVerdict(initialFilter.fQcVerdict || '')
    if (initialFilter.search) setQ(initialFilter.search)
    setPage(1)
    onFilterConsumed && onFilterConsumed()
  }, [initialFilter, onFilterConsumed])

  // auto-open the card when the search is an exact SKU
  useEffect(() => {
    if (!deferredQ) return
    const needle = lc(deferredQ)
    const match = products.find((p) => lc(p.sku) === needle)
    if (match) setOpen((o) => (o[match.id] ? o : { ...o, [match.id]: true }))
  }, [deferredQ, products])

  // header "Add product" button calls this
  useEffect(() => {
    window.__openAdd = () => {
      if (isFullAccess) setModal(true)
    }
    return () => {
      delete window.__openAdd
    }
  }, [isFullAccess])

  /* ============ INDEXES (built once per data change, O(1) lookups after) ============ */
  const divAssignments = useMemo(
    () => assignments.filter((a) => a.division === division),
    [assignments, division]
  )

  // sku -> assignment rows for this division
  const rowsBySku = useMemo(() => {
    const m = new Map()
    for (const a of divAssignments) {
      const k = lc(a.sku)
      if (!k) continue
      let arr = m.get(k)
      if (!arr) m.set(k, (arr = []))
      arr.push(a)
    }
    return m
  }, [divAssignments])

  const rowsFor = useCallback((sku) => rowsBySku.get(sku) || EMPTY, [rowsBySku])

  const memberById = useMemo(() => new Map(teamMembers.map((m) => [m.id, m])), [teamMembers])

  /* ---------- assignment maps ---------- */
  // sku -> Set(stage keys) THIS member was specifically assigned
  const myAssignedStagesPerSku = useMemo(() => {
    if (!auth || isMasterOrAdmin) return null
    const map = {}
    divAssignments
      .filter((a) => a.memberId === myMemberId)
      .forEach((a) => {
        const key = lc(a.sku)
        if (!map[key]) map[key] = new Set()
        if (a.stage && a.stage !== 'all')
          a.stage
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((s) => map[key].add(s))
      })
    return map
  }, [auth, isMasterOrAdmin, divAssignments, myMemberId])

  // sku -> [{ memberId, memberName, stage }] for cards this manager pushed (or holds)
  const skuAssignedTo = useMemo(() => {
    if (!hasAssignAccess) return {}
    const managerIdForRows = isMasterOrAdmin ? 'master' : myMemberId
    const map = {}
    divAssignments
      .filter((a) => a.managerId === managerIdForRows || a.memberId === myMemberId)
      .forEach((a) => {
        const member = memberById.get(a.memberId)
        ;(map[lc(a.sku)] ||= []).push({ memberId: a.memberId, memberName: member?.name || '—', stage: a.stage })
      })
    return map
  }, [divAssignments, memberById, hasAssignAccess, isMasterOrAdmin, myMemberId])

  // sku -> [{ stage, assignedAt }] for the "Assigned between dates" filter
  const skuAssignDates = useMemo(() => {
    const map = {}
    divAssignments.forEach((a) => (map[lc(a.sku)] ||= []).push({ stage: a.stage, assignedAt: a.assignedAt }))
    return map
  }, [divAssignments])

  // per-member card lists for the member dropdown
  const memberStats = useMemo(() => {
    if (!hasAssignAccess) return EMPTY
    const managerIdForRows = isMasterOrAdmin ? 'master' : myMemberId
    const memberMap = {}
    divAssignments
      .filter((a) => a.managerId === managerIdForRows)
      .forEach((a) => {
        const sku = lc(a.sku)
        if (!a.memberId || !sku) return
        if (!memberMap[a.memberId]) {
          const m = memberById.get(a.memberId)
          memberMap[a.memberId] = { id: a.memberId, name: m?.name || a.memberId, skus: new Set() }
        }
        memberMap[a.memberId].skus.add(sku)
      })
    return Object.values(memberMap).sort((a, b) => a.name.localeCompare(b.name))
  }, [divAssignments, hasAssignAccess, isMasterOrAdmin, myMemberId, memberById])

  const memberStatsById = useMemo(() => new Map(memberStats.map((m) => [m.id, m])), [memberStats])

  // SKUs assigned directly to me (any assigner)
  const myOwnSkus = useMemo(() => {
    if (!hasAssignAccess || !myMemberId) return new Set()
    return new Set(divAssignments.filter((a) => a.memberId === myMemberId).map((a) => lc(a.sku)))
  }, [divAssignments, hasAssignAccess, myMemberId])

  /* ---------- dropdown options ---------- */
  const setNoOptions = useMemo(() => [...new Set(products.map((p) => p.set_no).filter(Boolean))].sort(), [products])
  const vendorOptionsList = useMemo(
    () => [...new Set(products.map((p) => (p.vendor || '').trim()).filter(Boolean))].sort(),
    [products]
  )
  const stageFilterOptions = useMemo(
    () => (allowedStages ? PIPE_STAGES.filter((s) => allowedStages.includes(s.k)) : PIPE_STAGES),
    [allowedStages]
  )
  const assigneeOptions = useMemo(() => {
    const names = new Set()
    Object.values(skuAssignedTo).forEach((rows) =>
      rows.forEach((r) => r.memberName && r.memberName !== '—' && names.add(r.memberName))
    )
    return [...names].sort()
  }, [skuAssignedTo])

  const sourceProducts = useMemo(
    () =>
      hasAssignAccess && ['assigned', 'completed', 'pending'].includes(assignTab)
        ? allDivProducts || products
        : products,
    [hasAssignAccess, assignTab, allDivProducts, products]
  )

  /* ---------- per-person issue helpers ---------- */
  // stages this logged-in person is responsible for on this card
  const myStageKeysOnCard = useCallback(
    (p) => {
      const cardStages = myAssignedStagesPerSku?.[lc(p.sku)]
      if (cardStages && cardStages.size > 0) return [...cardStages]
      return allowedStages ? [...allowedStages] : ALL_PIPE_KEYS
    },
    [myAssignedStagesPerSku, allowedStages]
  )
  const cardHasOpenIssueForMe = useCallback(
    (p) => cardHasOpenIssueInStages(p, myStageKeysOnCard(p)),
    [myStageKeysOnCard]
  )

  const myRowsFor = useCallback(
    (p) => rowsFor(lc(p.sku)).filter((a) => a.memberId === myMemberId),
    [rowsFor, myMemberId]
  )

  // master's card-level counts (one per SKU, same maths as Overview)
  const masterCardCounts = useMemo(() => {
    if (!isMasterOrAdmin) return null
    const pool = allDivProducts || products
    let completed = 0
    let issuesFound = 0
    let assigned = 0
    for (const p of pool) {
      if (p.verdict === 'Approved') completed++
      else if (p.verdict === 'Issues Found') issuesFound++
      if (skuAssignedTo[lc(p.sku)]) assigned++
    }
    return { assigned, completed, pending: pool.length - completed - issuesFound }
  }, [isMasterOrAdmin, allDivProducts, products, skuAssignedTo])

  /* ============ THE FILTERED LIST (memoized) ============ */
  const filtered = useMemo(() => {
    const needle = deferredQ.toLowerCase()
    const fromT = fEventFrom ? new Date(fEventFrom + 'T00:00:00').getTime() : null
    const toT = fEventTo ? new Date(fEventTo + 'T23:59:59.999').getTime() : null
    const inRange = (iso) => {
      if (!iso) return false
      const t = Date.parse(iso)
      if (isNaN(t)) return false
      if (fromT !== null && t < fromT) return false
      if (toT !== null && t > toT) return false
      return true
    }
    const eventStages = fStage ? [fStage] : stageFilterOptions.map((s) => s.k)
    const stalledCutoff = fStalledDays ? Date.now() - Number(fStalledDays) * 86400000 : null
    const completionScopeId = filterMember || (!isMasterOrAdmin ? myMemberId : null)
    const filterMemberStats = filterMember ? memberStatsById.get(filterMember) : null

    const result = sourceProducts.filter((p) => {
      const sku = lc(p.sku)
      if (needle && !`${p.sku} ${p.name || ''} ${p.vendor || ''}`.toLowerCase().includes(needle)) return false

      if (fStatus === 'issue') {
        if (!cardHasOpenIssueForMe(p)) return false
      } else if (fStatus && productState(p) !== fStatus) return false

      // "when it happened" filter
      if (fEventType && (fEventFrom || fEventTo)) {
        if (fEventType === 'assigned') {
          const rows = skuAssignDates[sku] || EMPTY
          if (!rows.some((r) => (!fStage || r.stage === fStage || r.stage === 'all') && inRange(r.assignedAt))) return false
        } else {
          const target = { inprogress: 'In Progress', completed: 'Completed', issue: 'Issue' }[fEventType]
          if (!eventStages.some((k) => p.stages?.[k]?.status === target && inRange(p.stages[k].at))) return false
        }
      }

      if (fAssignee) {
        const rows = skuAssignedTo[sku] || EMPTY
        if (auth?.name && fAssignee === auth.name) {
          // my own name = cards I still hold myself, not ones I pushed on
          if (!(rows.length > 0 && rows.every((r) => r.memberName === fAssignee))) return false
        } else if (!rows.some((r) => r.memberName === fAssignee)) return false
      }

      if (fSetNo && lc(p.set_no) !== lc(fSetNo)) return false
      if (fVendor && (p.vendor || '').trim() !== fVendor) return false

      if (fStage && fStageStatus) {
        const stg = p.stages?.[fStage]
        const st = stg?.status || 'Not Started'
        if (fStageStatus === 'Issue') {
          if (st !== 'Issue' && !isQcFlagged(stg)) return false
        } else if (st !== fStageStatus) return false
      }

      if (fHasIssue && !myStageKeysOnCard(p).some((k) => p.stages?.[k]?.status === 'Issue')) return false

      if (stalledCutoff !== null) {
        if (productState(p) === 'done' || ts(p.updatedAt) >= stalledCutoff) return false
      }

      if (fQcVerdict === 'pending' && p.verdict) return false
      if (fQcVerdict === 'approved' && p.verdict !== 'Approved') return false
      if (fQcVerdict === 'issues' && p.verdict !== 'Issues Found') return false

      // Completed / Pending dropdown
      if (fCompletion) {
        const rows = rowsFor(sku).filter((a) => !completionScopeId || a.memberId === completionScopeId)
        if (rows.length === 0) return false
        const done = stagesDoneFor(p, rows)
        const isDone = isMasterOrAdmin && !completionScopeId ? done && p.verdict === 'Approved' : done
        if (fCompletion === 'completed' && !isDone) return false
        if (fCompletion === 'pending' && isDone) return false
      }

      // tab buttons: Not Assigned / Assigned / Completed / Pending
      if (hasAssignAccess) {
        const isAssigned = !!skuAssignedTo[sku]
        if (assignTab === 'notassigned' && isAssigned) return false
        if (assignTab === 'assigned' && !isAssigned) return false
        if (assignTab === 'completed' || assignTab === 'pending') {
          const overall = isMasterOrAdmin && !filterMember
          const rows = rowsFor(sku).filter((a) =>
            filterMember ? a.memberId === filterMember : isMasterOrAdmin ? true : a.memberId === myMemberId
          )
          if (rows.length === 0) return false

          const done = stagesDoneFor(p, rows)
          const fullyApproved = overall ? done && p.verdict === 'Approved' : done
          const scopeKeys = rows.map((a) => a.stage).filter((k) => k && k !== 'all')
          const hasIssue = overall
            ? cardHasOpenIssue(p)
            : cardHasOpenIssueInStages(p, scopeKeys.length > 0 ? scopeKeys : ALL_PIPE_KEYS)

          if (assignTab === 'completed' && (!fullyApproved || hasIssue)) return false
          if (assignTab === 'pending' && (fullyApproved || hasIssue)) return false
        }
      } else if (myMemberId) {
        const rows = myRowsFor(p)
        if (assignTab === 'notassigned' && rows.length > 0) return false
        if (assignTab === 'assigned' && rows.length === 0) return false
        if (assignTab === 'completed' || assignTab === 'pending') {
          if (rows.length === 0) return false
          const done = stagesDoneFor(p, rows)
          if (assignTab === 'completed' && (!done || cardHasOpenIssue(p))) return false
          if (assignTab === 'pending' && (done || cardHasOpenIssue(p))) return false
        }
      }

      // member dropdown (Completed/Pending tabs already scope by member above)
      if (filterMember && assignTab !== 'completed' && assignTab !== 'pending') {
        if (filterMember === myMemberId) {
          if (!myOwnSkus.has(sku)) return false
        } else if (!filterMemberStats || !filterMemberStats.skus.has(sku)) return false
      }
      return true
    })

    if (sortBy === 'recent') result.sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt))
    else if (sortBy === 'oldest') result.sort((a, b) => ts(a.updatedAt) - ts(b.updatedAt))
    else if (sortBy === 'pct_high') result.sort((a, b) => productPct(b) - productPct(a))
    else if (sortBy === 'pct_low') result.sort((a, b) => productPct(a) - productPct(b))
    else if (sortBy === 'sku') result.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''))
    return result
  }, [
    sourceProducts,
    deferredQ,
    fStatus,
    fEventType,
    fEventFrom,
    fEventTo,
    fStage,
    fStageStatus,
    fAssignee,
    fSetNo,
    fVendor,
    fHasIssue,
    fStalledDays,
    fQcVerdict,
    fCompletion,
    assignTab,
    filterMember,
    sortBy,
    stageFilterOptions,
    skuAssignDates,
    skuAssignedTo,
    rowsFor,
    myRowsFor,
    myOwnSkus,
    memberStatsById,
    myStageKeysOnCard,
    cardHasOpenIssueForMe,
    myMemberId,
    isMasterOrAdmin,
    hasAssignAccess,
    auth,
  ])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  )

  /* ---------- tab counts (computed once, not 4× per render) ---------- */
  const tabCounts = useMemo(() => {
    const out = {}
    if (!hasAssignAccess && myMemberId) {
      const withRows = products.map((p) => [p, myRowsFor(p)])
      const assignedCnt = withRows.filter(([, r]) => r.length > 0).length
      out.notassigned = withRows.length - assignedCnt
      out.assigned = dbMemberStats ? Number(dbMemberStats.total_assigned) : assignedCnt
      for (const k of ['completed', 'pending']) {
        const want = k === 'completed'
        out[k] = dbMemberStats
          ? Number(dbMemberStats[k])
          : withRows.filter(([p, r]) => r.length > 0 && stagesDoneFor(p, r) === want && !cardHasOpenIssue(p)).length
      }
      return out
    }
    if (!hasAssignAccess) return out

    out.notassigned = products.filter((p) => !skuAssignedTo[lc(p.sku)]).length
    for (const k of ['assigned', 'completed', 'pending']) {
      const field = k === 'assigned' ? 'total' : k
      if (filterMember) {
        const ms = dbAllMemberStats?.find((m) => m.memberId === filterMember)
        out[k] = ms ? ms[field] : 0
      } else if (!isMasterOrAdmin && dbMemberStats) {
        out[k] = Number(dbMemberStats[{ assigned: 'total_assigned', completed: 'completed', pending: 'pending' }[k]])
      } else if (isMasterOrAdmin && masterCardCounts) {
        out[k] = masterCardCounts[k]
      } else {
        out[k] = (dbAllMemberStats || EMPTY).reduce((s, m) => s + m[field], 0)
      }
    }
    return out
  }, [
    hasAssignAccess,
    myMemberId,
    products,
    myRowsFor,
    dbMemberStats,
    skuAssignedTo,
    filterMember,
    dbAllMemberStats,
    isMasterOrAdmin,
    masterCardCounts,
  ])

  /* ---------- card status chip counts ---------- */
  const statusCounts = useMemo(() => {
    let issue = 0
    let prog = 0
    let none = 0
    for (const p of sourceProducts) {
      issue += countCardIssueInstances(p, myStageKeysOnCard(p))
      if (!cardHasOpenIssueForMe(p)) {
        const st = productState(p)
        if (st === 'prog') prog++
        else if (st === 'none') none++
      }
    }
    return { '': sourceProducts.length, issue, prog, none }
  }, [sourceProducts, myStageKeysOnCard, cardHasOpenIssueForMe])

  /* ---------- per-stage status summary next to the stage dropdown ---------- */
  const stageStatusSummary = useMemo(() => {
    if (!fStage) return ''
    const counts = {}
    for (const p of sourceProducts) {
      const st = p.stages?.[fStage]?.status
      if (st) counts[st] = (counts[st] || 0) + 1
    }
    return STATUSES.filter((s) => counts[s] > 0)
      .map((s) => `${s}: ${counts[s]}`)
      .join(' · ')
  }, [sourceProducts, fStage])

  /* ---------- search suggestions ---------- */
  const suggestions = useMemo(() => {
    if (!showSug || !deferredQ) return EMPTY
    const needle = deferredQ.toLowerCase()
    const out = []
    for (const p of products) {
      if (`${p.sku} ${p.name || ''} ${p.vendor || ''}`.toLowerCase().includes(needle)) {
        out.push(p)
        if (out.length === 8) break
      }
    }
    return out
  }, [showSug, deferredQ, products])

  /* ---------- filters bookkeeping ---------- */
  const activeFilterCount = [
    fStatus,
    fVendor,
    fStage && fStageStatus,
    fHasIssue,
    fStalledDays,
    fQcVerdict,
    fSetNo,
    filterMember,
    fAssignee,
    fEventType && (fEventFrom || fEventTo),
  ].filter(Boolean).length

  const clearAllFilters = () => {
    setFStatus('')
    setFVendor('')
    setFStage('')
    setFStageStatus('')
    setFHasIssue(false)
    setFStalledDays('')
    setFQcVerdict('')
    setFSetNo('')
    setFilterMember('')
    setFAssignee('')
    setFEventType('')
    setFEventFrom('')
    setFEventTo('')
    setFCompletion('')
    setSortBy('recent')
    setPage(1)
  }
  const resetPage = () => setPage(1)

  /* ---------- open / select (stable callbacks for memoized rows) ---------- */
  const toggleOpen = useCallback((id) => setOpen((o) => ({ ...o, [id]: !o[id] })), [])
  const toggleSelect = useCallback((id) => setSelected((s) => ({ ...s, [id]: !s[id] })), [])
  const clearSelect = () => setSelected({})
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected])

  /* ---------- bulk stage update ---------- */
  const applyBulk = async () => {
    if (!bulkStage || selectedIds.length === 0) return
    setBulkBusy(true)
    setBulkErr('')
    const person = (operator && operator.trim()) || ''
    try {
      const CHUNK = 25
      for (let i = 0; i < selectedIds.length; i += CHUNK) {
        await patchStageBulk(selectedIds.slice(i, i + CHUNK), bulkStage, { status: bulkStatus, person })
      }
      clearSelect()
    } catch (e) {
      console.error('Bulk apply failed', e)
      setBulkErr('Could not apply to all selected — please try again or check your connection.')
    } finally {
      setBulkBusy(false)
    }
  }

  const headerFilterCount = [assignTab !== 'notassigned', !!filterMember, !!fSetNo].filter(Boolean).length

  /* ====================== RENDER ====================== */
  return (
    <div>
      {/* ---------- Filters toggle ---------- */}
      <button
        onClick={() => setShowFilters((s) => !s)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
          padding: '9px 16px',
          borderRadius: 10,
          border: '1px solid var(--line2)',
          background: showFilters ? 'var(--ink)' : 'var(--card)',
          color: showFilters ? '#fff' : 'var(--ink)',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters
        {headerFilterCount > 0 && (
          <span style={{ background: 'var(--rose)', color: '#fff', borderRadius: 999, fontSize: 10.5, fontWeight: 700, padding: '1px 7px' }}>
            {headerFilterCount}
          </span>
        )}
        <span style={{ fontSize: 11, opacity: 0.7 }}>{showFilters ? '▲' : '▼'}</span>
      </button>

      {/* ---------- Tabs ---------- */}
      {showFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            ['notassigned', 'Not Assigned'],
            ['assigned', 'Assigned'],
            ['completed', 'Completed'],
            ['pending', 'Pending'],
          ].map(([k, n]) => (
            <button
              key={k}
              onClick={() => {
                setAssignTab(k)
                resetPage()
              }}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: '1px solid var(--line2)',
                background: assignTab === k ? 'var(--ink)' : 'var(--card)',
                color: assignTab === k ? '#fff' : 'var(--ink)',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {n} <span style={{ opacity: 0.7, marginLeft: 4 }}>{tabCounts[k]}</span>
            </button>
          ))}
        </div>
      )}

      {/* ---------- My assigned stages (members) ---------- */}
      {showFilters && !isMasterOrAdmin && dbPipelineStats && ['assigned', 'completed', 'pending'].includes(assignTab) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Your assigned stages — click a number to filter cards</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {STAGES.filter((s) => dbPipelineStats[s.k]).map((s) => {
              const st = dbPipelineStats[s.k]
              const chip = (status, label, count, color, bg) => {
                const active = status === 'Issue' ? fQcVerdict === 'issues' : fStage === s.k && fStageStatus === status
                return (
                  <button
                    key={status}
                    onClick={() => {
                      if (status === 'Issue') {
                        // Issue chip jumps to QC-flagged cards
                        setFQcVerdict('issues')
                        setFStage('')
                        setFStageStatus('')
                        if (assignTab === 'completed' || assignTab === 'pending') setAssignTab('assigned')
                      } else {
                        setFQcVerdict('')
                        setFStage(s.k)
                        setFStageStatus(status)
                      }
                      resetPage()
                    }}
                    style={{
                      background: active ? color : bg,
                      color: active ? '#fff' : color,
                      border: `1px solid ${color}`,
                      borderRadius: 999,
                      padding: '4px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {label}: {count}
                  </button>
                )
              }
              return (
                <div
                  key={s.k}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    background: 'var(--card)',
                    border: '1px solid var(--line2)',
                    borderRadius: 10,
                    padding: '10px 14px',
                  }}
                >
                  <b style={{ fontSize: 13, minWidth: 140 }}>{s.n}</b>
                  {chip('Not Started', '○ Not Started', st.notStarted, '#8C887E', '#F0EEE8')}
                  {chip('In Progress', '… In Progress', st.inProgress, 'var(--sky-ink)', 'var(--sky-bg)')}
                  {chip('Completed', '✓ Completed', st.completed, 'var(--sage-ink)', 'var(--sage-bg)')}
                  {chip('Issue', '⚠ Issue', st.issue, 'var(--rose-ink)', 'var(--rose-bg)')}
                </div>
              )
            })}
          </div>
          {fStage && (
            <button
              className="ghost"
              style={{ ...smallBtn, marginTop: 8 }}
              onClick={() => {
                setFStage('')
                setFStageStatus('')
                resetPage()
              }}
            >
              ✕ Clear stage filter
            </button>
          )}
        </div>
      )}

      {/* ---------- Member dropdown (managers) ---------- */}
      {hasAssignAccess && showFilters && memberStats.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <select
            value={filterMember}
            onChange={(e) => {
              setFilterMember(e.target.value)
              resetPage()
            }}
            style={{ ...bigSelect, borderRadius: 10, padding: '9px 12px', fontWeight: 500, minWidth: 180 }}
          >
            <option value="">— all members —</option>
            {memberStats
              .filter((m) => m.id !== myMemberId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          {filterMember && (
            <button
              className="ghost"
              style={smallBtn}
              onClick={() => {
                setFilterMember('')
                resetPage()
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ---------- Big filter panel ---------- */}
      {showFilters && (
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--line2)',
            borderRadius: 12,
            padding: 14,
            marginBottom: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* card status chips */}
          <div>
            <div style={sectionLabel}>Card status</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                ['', 'All'],
                ['issue', '⚠ With issues'],
                ['prog', '… In production'],
                ['none', '○ Not started'],
              ].map(([k, label]) => (
                <button
                  key={k || 'all'}
                  onClick={() => {
                    setFStatus(k)
                    resetPage()
                  }}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: fStatus === k ? 'var(--ink)' : 'var(--card-2)',
                    color: fStatus === k ? '#fff' : 'var(--ink)',
                    border: `1px solid ${fStatus === k ? 'var(--ink)' : 'var(--line2)'}`,
                  }}
                >
                  {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{statusCounts[k]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* specific stage */}
          <div>
            <div style={sectionLabel}>Filter by a specific stage</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={fStage}
                onChange={(e) => {
                  setFStage(e.target.value)
                  if (!e.target.value) setFStageStatus('')
                  resetPage()
                }}
                style={{ ...bigSelect, minWidth: 190 }}
              >
                <option value="">— pick a stage —</option>
                {stageFilterOptions.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.n}
                  </option>
                ))}
              </select>
              <select
                value={fStageStatus}
                onChange={(e) => {
                  setFStageStatus(e.target.value)
                  resetPage()
                }}
                disabled={!fStage}
                style={{ ...bigSelect, minWidth: 160, background: fStage ? 'var(--card)' : 'var(--card-2)', opacity: fStage ? 1 : 0.5 }}
              >
                <option value="">— any status —</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {fStage && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{stageStatusSummary}</span>}
              {fStage && (
                <button
                  className="ghost"
                  style={smallBtn}
                  onClick={() => {
                    setFStage('')
                    setFStageStatus('')
                    resetPage()
                  }}
                >
                  ✕ Clear stage filter
                </button>
              )}
            </div>
          </div>

          {/* when it happened */}
          <div>
            <div style={sectionLabel}>Filter by when it happened</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={fEventType}
                onChange={(e) => {
                  setFEventType(e.target.value)
                  resetPage()
                }}
                style={{ ...bigSelect, minWidth: 190 }}
              >
                <option value="">— pick an event —</option>
                <option value="assigned">Assigned</option>
                <option value="inprogress">Moved to In Progress</option>
                <option value="completed">Completed</option>
                <option value="issue">Issue raised</option>
              </select>
              {[
                ['From', fEventFrom, setFEventFrom],
                ['To', fEventTo, setFEventTo],
              ].map(([label, val, setter]) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                  {label}
                  <input
                    type="date"
                    value={val}
                    onChange={(e) => {
                      setter(e.target.value)
                      resetPage()
                    }}
                    disabled={!fEventType}
                    style={{
                      border: '1px solid var(--line2)',
                      borderRadius: 8,
                      padding: '7px 9px',
                      background: fEventType ? 'var(--card)' : 'var(--card-2)',
                      fontSize: 13,
                    }}
                  />
                </label>
              ))}
              {fEventType && !fStage && (
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                  across any of your visible stages{fEventType === 'assigned' ? ' (or pick a stage above to narrow it)' : ''}
                </span>
              )}
              {fEventType && (fEventFrom || fEventTo) && (
                <button
                  className="ghost"
                  style={smallBtn}
                  onClick={() => {
                    setFEventType('')
                    setFEventFrom('')
                    setFEventTo('')
                    resetPage()
                  }}
                >
                  ✕ Clear date filter
                </button>
              )}
            </div>
          </div>

          {/* vendor / set / completion / assignee / verdict / stalled / sort */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="fld" style={{ minWidth: 170 }}>
              Vendor
              <select
                value={fVendor}
                onChange={(e) => {
                  setFVendor(e.target.value)
                  resetPage()
                }}
              >
                <option value="">— all vendors —</option>
                {vendorOptionsList.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld" style={{ minWidth: 170 }}>
              Set No.
              <select
                value={fSetNo}
                onChange={(e) => {
                  setFSetNo(e.target.value)
                  resetPage()
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

            <label className="fld" style={{ minWidth: 170 }}>
              Completion status
              <select
                value={fCompletion}
                onChange={(e) => {
                  setFCompletion(e.target.value)
                  resetPage()
                }}
              >
                <option value="">— any —</option>
                <option value="completed">✓ Completed</option>
                <option value="pending">⏳ Pending</option>
              </select>
            </label>

            {assigneeOptions.length > 0 && (
              <label className="fld" style={{ minWidth: 170 }}>
                Assigned to
                <select
                  value={fAssignee}
                  onChange={(e) => {
                    setFAssignee(e.target.value)
                    resetPage()
                  }}
                >
                  <option value="">— everyone —</option>
                  {assigneeOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="fld" style={{ minWidth: 170 }}>
              QC verdict
              <select
                value={fQcVerdict}
                onChange={(e) => {
                  setFQcVerdict(e.target.value)
                  resetPage()
                }}
              >
                <option value="">— any verdict —</option>
                <option value="pending">Pending review</option>
                <option value="approved">Approved</option>
                <option value="issues">Issues found</option>
              </select>
            </label>

            <label className="fld" style={{ minWidth: 170 }}>
              Stalled for
              <select
                value={fStalledDays}
                onChange={(e) => {
                  setFStalledDays(e.target.value)
                  resetPage()
                }}
              >
                <option value="">— any time —</option>
                <option value="3">3+ days no update</option>
                <option value="7">7+ days no update</option>
                <option value="14">14+ days no update</option>
                <option value="30">30+ days no update</option>
              </select>
            </label>

            <label className="fld" style={{ minWidth: 170 }}>
              Sort by
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="recent">Recently updated</option>
                <option value="oldest">Oldest updated</option>
                <option value="pct_high">% complete: high → low</option>
                <option value="pct_low">% complete: low → high</option>
                <option value="sku">SKU (A–Z)</option>
              </select>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--rose-ink)',
                cursor: 'pointer',
                paddingBottom: 9,
              }}
            >
              <input
                type="checkbox"
                checked={fHasIssue}
                onChange={(e) => {
                  setFHasIssue(e.target.checked)
                  resetPage()
                }}
                style={{ width: 14, height: 14, accentColor: 'var(--rose-ink)' }}
              />
              Only cards with a stage issue
            </label>

            {activeFilterCount > 0 && (
              <button className="ghost" style={{ padding: '9px 14px', fontSize: 12.5 }} onClick={clearAllFilters}>
                ✕ Clear all filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------- result count ---------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span
          style={{
            background: 'var(--sky-bg)',
            color: 'var(--sky-ink)',
            border: '1px solid var(--sky)',
            borderRadius: 999,
            padding: '4px 14px',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {filtered.length} card{filtered.length !== 1 ? 's' : ''}
        </span>
        {(fCompletion || filterMember) && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {filterMember ? `for ${memberById.get(filterMember)?.name || 'selected member'}` : ''}
            {fCompletion ? ` · ${fCompletion === 'completed' ? 'Completed' : 'Pending'}` : ''}
          </span>
        )}
      </div>

      {/* ---------- search with suggestions ---------- */}
      <div className="toolbar">
        <div className="search">
          {I.search({})}
          <input
            placeholder="Search SKU, product or vendor…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setShowSug(true)
              resetPage()
            }}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            onFocus={() => q && setShowSug(true)}
          />
          {showSug && q.length > 0 && suggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
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
              {suggestions.map((p) => {
                const info = skuAssignedTo[lc(p.sku)] || EMPTY
                const unique = [...new Map(info.map((a) => [a.memberId, a])).values()]
                return (
                  <div
                    key={p.id}
                    onMouseDown={() => {
                      setQ(p.sku)
                      setShowSug(false)
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      padding: '9px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--line)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--card)')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CopySku sku={p.sku} style={{ flexShrink: 0 }} />
                      {p.name && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>}
                      {p.vendor && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{p.vendor}</span>}
                      {p.set_no && (
                        <span
                          className="psku"
                          style={{ background: 'var(--peach-bg)', color: 'var(--peach-ink)', border: '1px solid var(--peach)', flexShrink: 0 }}
                        >
                          {p.set_no}
                        </span>
                      )}
                    </div>
                    {unique.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 2 }}>
                        {unique.map((a, i) => {
                          const member = memberById.get(a.memberId)
                          const stageNames = info
                            .filter((x) => x.memberId === a.memberId)
                            .map((x) => STAGES.find((st) => st.k === x.stage)?.n || x.stage)
                          return (
                            <span
                              key={i}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 10.5,
                                fontWeight: 600,
                                background: 'var(--sky-bg)',
                                color: 'var(--sky-ink)',
                                border: '1px solid var(--sky)',
                                borderRadius: 6,
                                padding: '2px 8px',
                              }}
                            >
                              → {a.memberName}
                              {member?.role && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 10 }}>· {member.role}</span>}
                              {stageNames.length > 0 && (
                                <span style={{ fontWeight: 400, fontSize: 10, opacity: 0.8 }}>({stageNames.join(', ')})</span>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <div style={{ fontSize: 10.5, color: 'var(--faint)', paddingLeft: 2 }}>Not assigned to anyone</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---------- bulk stage bar ---------- */}
      {selectedIds.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--sky-bg)',
            border: '1px solid var(--sky)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sky-ink)' }}>{selectedIds.length} selected</span>
          <button className="ghost" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setSelected(Object.fromEntries(pageItems.map((p) => [p.id, true])))}>
            Select page
          </button>
          <button className="ghost" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setSelected(Object.fromEntries(filtered.map((p) => [p.id, true])))}>
            Select all ({filtered.length})
          </button>
          <select
            value={bulkStage}
            onChange={(e) => setBulkStage(e.target.value)}
            style={{ border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 10px', background: 'var(--card)', fontSize: 12 }}
          >
            <option value="">— pick stage —</option>
            {(allowedStages ? STAGES.filter((s) => allowedStages.includes(s.k)) : STAGES)
              .filter((s) => s.k !== 'qc')
              .map((s) => (
                <option key={s.k} value={s.k}>
                  {s.n}
                </option>
              ))}
          </select>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            style={{ border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 10px', background: 'var(--card)', fontSize: 12 }}
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="primary" onClick={applyBulk} disabled={!bulkStage || bulkBusy} style={{ padding: '7px 14px', fontSize: 12 }}>
            {bulkBusy ? 'Applying…' : 'Apply to all'}
          </button>
          <button className="ghost" onClick={clearSelect} style={{ padding: '7px 12px', fontSize: 12 }}>
            Clear
          </button>
          {bulkErr && <div style={{ color: 'var(--rose-ink)', fontSize: 12, fontWeight: 600, width: '100%' }}>{bulkErr}</div>}
        </div>
      )}

      {/* ---------- list ---------- */}
      {filtered.length === 0 ? (
        <div className="card empty">No products match. Add your first SKU to start tracking its full pipeline.</div>
      ) : (
        <div>
          <div className="plist">
            {pageItems.map((p) => {
              const sku = lc(p.sku)
              return (
                <MemoRow
                  key={p.id}
                  p={p}
                  isOpen={!!open[p.id]}
                  isSelected={!!selected[p.id]}
                  onToggleId={toggleOpen}
                  onSelectId={toggleSelect}
                  onStage={patchStage}
                  onQC={patchQC}
                  onRemove={removeProduct}
                  allowedStages={allowedStages}
                  cardStages={myAssignedStagesPerSku?.[sku]}
                  skuRows={rowsFor(sku)}
                  filterMember={filterMember}
                  operator={operator}
                  assignedTo={skuAssignedTo[sku]}
                />
              )
            })}
          </div>

          {/* pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="ghost" style={{ padding: '7px 12px', fontSize: 12 }} disabled={safePage === 1} onClick={() => setPage(1)}>
                «
              </button>
              <button className="ghost" style={{ padding: '7px 12px', fontSize: 12 }} disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
                ‹ Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - safePage) <= 2)
                .reduce((acc, n, i, arr) => {
                  if (i > 0 && n - arr[i - 1] > 1) acc.push('...')
                  acc.push(n)
                  return acc
                }, [])
                .map((n, i) =>
                  n === '...' ? (
                    <span key={'e' + i} style={{ padding: '0 4px', color: 'var(--faint)' }}>
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      style={{
                        padding: '7px 12px',
                        fontSize: 12,
                        borderRadius: 10,
                        border: '1px solid var(--line2)',
                        background: safePage === n ? 'var(--ink)' : 'var(--card)',
                        color: safePage === n ? '#fff' : 'var(--ink)',
                        fontWeight: 600,
                      }}
                    >
                      {n}
                    </button>
                  )
                )}
              <button className="ghost" style={{ padding: '7px 12px', fontSize: 12 }} disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
                Next ›
              </button>
              <button className="ghost" style={{ padding: '7px 12px', fontSize: 12 }} disabled={safePage === totalPages} onClick={() => setPage(totalPages)}>
                »
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 4 }}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
            </div>
          )}
        </div>
      )}

      {modal && isFullAccess && (
        <AddModal
          division={division}
          vendors={vendors}
          addVendor={addVendor}
          onClose={() => setModal(false)}
          onSave={(p) => {
            upsertProduct(p, true)
            setModal(false)
          }}
        />
      )}
    </div>
  )
}