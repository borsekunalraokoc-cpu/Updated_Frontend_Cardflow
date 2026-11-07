import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { API } from '../api'
import { STAGES, STATUSES, STORES } from '../lib/constants'
import { fmt, productState } from '../lib/utils'
import { I, Chip, CopySku, statusClass } from '../components/ui'
import { playIssueSound } from '../lib/sounds'
import RecentlyAddedPanel from '../components/RecentlyAddedPanel'

/* ---------- helpers ---------- */
const PIPE_STAGES = STAGES.filter((s) => s.k !== 'finalqc')
const OVERVIEW_EXCLUDED = ['scan', 'qc', 'finalqc']
// audit "detail" format: "<Stage> → <Status>[ · person]"
const STAGE_UPDATE_RE = /^(.+?)\s*→\s*([^·]+?)(?:\s*·\s*(.+))?$/
const lc = (s) => (s || '').trim().toLowerCase()
const isQcFlagged = (stg) =>
  stg?.status === 'In Progress' && String(stg?.comments || '').startsWith('QC flagged:')
const isoDay = (d) => d.toISOString().split('T')[0]

// small style helpers so the JSX stays readable
const toolBtn = (active, tone) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  padding: '7px 12px',
  borderRadius: 9,
  cursor: 'pointer',
  border: `1px solid ${active ? `var(--${tone})` : 'var(--line2)'}`,
  background: active ? `var(--${tone}-bg)` : 'var(--card)',
  color: active ? `var(--${tone}-ink)` : 'var(--muted)',
})
const filterSel = (active) => ({
  border: '1px solid var(--line2)',
  borderRadius: 8,
  padding: '6px 10px',
  background: 'var(--card)',
  fontSize: 11.5,
  color: active ? 'var(--ink)' : 'var(--muted)',
})
const thStyle = (color, align = 'center') => ({
  textAlign: align,
  padding: '8px 10px',
  color,
  fontWeight: 700,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '.6px',
  borderBottom: '1px solid var(--line)',
})
const tdCenter = { textAlign: 'center', padding: '10px 10px' }
const dateInput = {
  border: '1px solid var(--line2)',
  borderRadius: 9,
  padding: '6px 9px',
  background: 'var(--card)',
  fontSize: 12.5,
}
const pillBadge = (bg, ink, border) => ({
  fontSize: 11.5,
  background: bg,
  color: ink,
  border: `1px solid ${border}`,
  borderRadius: 999,
  padding: '2px 10px',
  fontWeight: 700,
})
const dash = <span style={{ color: 'var(--faint)' }}>—</span>

export default function Overview({
  division,
  products, // division products already scoped to this user
  allDivProducts,
  issues, // store missing/damaged alerts
  audit,
  go,
  goProducts,
  vendors = [],
  allowedStages = null,
  auth,
  teamMembers = [],
  assignments = [],
}) {
  const todayStr = isoDay(new Date())
  const isMasterOrAdminView = auth?.role === 'master' || auth?.role === 'admin'

  /* ---------- UI state ---------- */
  const [fVendor, setFVendor] = useState('')
  const [fSetNo, setFSetNo] = useState('')
  const [fMember, setFMember] = useState('')
  const [fStage, setFStage] = useState('')
  const [fStageStatus, setFStageStatus] = useState('')
  const [fEventDate, setFEventDate] = useState('')
  const [nlQuery, setNlQuery] = useState('')
  const [drill, setDrill] = useState(null) // { stageKey, stageName, status }
  const [dashFromDate, setDashFromDate] = useState('')
  const [dashToDate, setDashToDate] = useState('')
  const [snapshotDate, setSnapshotDate] = useState(todayStr)
  const [showSnapshot, setShowSnapshot] = useState(false)
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [showQcPanel, setShowQcPanel] = useState(false)
  const [exporting, setExporting] = useState('')
  const [issueGlow, setIssueGlow] = useState(false)
  const prevIssuesCountRef = useRef(null) // null = first load, no sound

  const clearAllFilters = () => {
    setFVendor('')
    setFSetNo('')
    setFMember('')
    setFStage('')
    setFStageStatus('')
    setFEventDate('')
    setNlQuery('')
  }

  const myMemberId = useMemo(() => {
    const me = teamMembers.find(
      (m) => m.email && auth?.email && lc(m.email) === lc(auth.email)
    )
    return me?.id || null
  }, [teamMembers, auth])

  /* ---------- server stats ---------- */
  const [dbStats, setDbStats] = useState(null)
  useEffect(() => {
    if (!auth || !myMemberId) return
    fetch(
      `${API}/api/memberStats?memberId=${encodeURIComponent(myMemberId)}&division=${encodeURIComponent(division)}`
    )
      .then((r) => r.json())
      .then((data) => data.ok && setDbStats(data))
      .catch((e) => console.error('memberStats fetch failed', e))
  }, [myMemberId, division, auth])

  const [breakdownStats, setBreakdownStats] = useState({})
  useEffect(() => {
    if (!auth) return
    const params = new URLSearchParams({ division })
    const scopedMemberId = fMember || (!isMasterOrAdminView ? myMemberId : '')
    if (scopedMemberId) params.set('memberId', scopedMemberId)
    if (fVendor) params.set('vendor', fVendor)
    if (fSetNo) params.set('setNo', fSetNo)
    fetch(`${API}/api/pipelineBreakdown?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => data.ok && setBreakdownStats(data.stages))
      .catch((e) => console.error('pipelineBreakdown fetch failed', e))
  }, [division, myMemberId, isMasterOrAdminView, fVendor, fSetNo, fMember, auth])

  /* ---------- team & assignment maps ---------- */
  const myTeam = useMemo(() => {
    if (isMasterOrAdminView) return teamMembers
    const reports = teamMembers.filter((m) => m.managerId === myMemberId)
    const me = teamMembers.find((m) => m.id === myMemberId)
    if (me && !reports.some((m) => m.id === me.id)) return [...reports, me]
    return reports
  }, [teamMembers, myMemberId, isMasterOrAdminView])

  // memberId -> Set(sku) for everyone in my team
  const memberSkuMap = useMemo(() => {
    const map = {}
    const myTeamIds = new Set(myTeam.map((m) => m.id))
    assignments
      .filter((a) => a.division === division && myTeamIds.has(a.memberId))
      .forEach((a) => (map[a.memberId] ||= new Set()).add(lc(a.sku)))

    // for a manager themselves: only what they still hold (received − pushed)
    if (!isMasterOrAdminView && myMemberId) {
      const received = new Set(
        assignments.filter((a) => a.division === division && a.memberId === myMemberId).map((a) => lc(a.sku))
      )
      const pushed = new Set(
        assignments.filter((a) => a.division === division && a.managerId === myMemberId).map((a) => lc(a.sku))
      )
      const remaining = new Set([...received].filter((s) => !pushed.has(s)))
      if (remaining.size > 0) map[myMemberId] = remaining
      else delete map[myMemberId]
    }
    return map
  }, [assignments, division, isMasterOrAdminView, myMemberId, myTeam])

  // sku -> [{ stage, memberName }] — "who is on which stage" per card
  const skuStageAssignees = useMemo(() => {
    const map = {}
    assignments
      .filter((a) => a.division === division)
      .forEach((a) => {
        const key = lc(a.sku)
        const member = teamMembers.find((m) => m.id === a.memberId)
        const name = member?.name || '—'
        if (!map[key]) map[key] = []
        if (a.stage && a.stage !== 'all') map[key].push({ stage: a.stage, memberName: name })
        else PIPE_STAGES.forEach((s) => map[key].push({ stage: s.k, memberName: name }))
      })
    return map
  }, [assignments, division, teamMembers])

  const vendorOptions = vendors.map((v) => v.trim()).filter(Boolean)
  const setNoOptions = useMemo(
    () => [...new Set(products.map((p) => p.set_no).filter(Boolean))].sort(),
    [products]
  )

  // Manager's full assigned pool (same scope Products & Pipeline uses).
  const myFullPool = useMemo(() => {
    const pool = allDivProducts || products
    if (isMasterOrAdminView) return pool
    const mySkus = new Set(
      assignments.filter((a) => a.division === division && a.memberId === myMemberId).map((a) => lc(a.sku))
    )
    return pool.filter((p) => mySkus.has(lc(p.sku)))
  }, [allDivProducts, products, assignments, division, isMasterOrAdminView, myMemberId])

  /* ---------- audit-log based panels ---------- */
  const isMyAction = useCallback(
    (a) => {
      if (isMasterOrAdminView) return true
      const actor = lc(a.actor)
      return actor === lc(auth?.name) || actor === lc(auth?.email)
    },
    [isMasterOrAdminView, auth]
  )

  const dashboardActivity = useMemo(() => {
    if (!dashFromDate && !dashToDate) return []
    return audit
      .filter((a) => {
        const d = new Date(a.at)
        if (isNaN(d.getTime())) return false
        if (dashFromDate && d < new Date(dashFromDate + 'T00:00:00')) return false
        if (dashToDate && d > new Date(dashToDate + 'T23:59:59.999')) return false
        if (a.division && a.division !== division) return false
        return isMyAction(a)
      })
      .sort((x, y) => new Date(y.at) - new Date(x.at))
  }, [audit, dashFromDate, dashToDate, division, isMyAction])

  const dailySnapshot = useMemo(() => {
    const dayStart = new Date(snapshotDate + 'T00:00:00')
    const dayEnd = new Date(snapshotDate + 'T23:59:59.999')
    const rows = audit.filter((a) => {
      const d = new Date(a.at)
      if (isNaN(d.getTime()) || d < dayStart || d > dayEnd) return false
      if (a.division && a.division !== division) return false
      return isMyAction(a)
    })
    const completed = new Set(),
      issue = new Set(),
      prog = new Set(),
      added = new Set()
    rows.forEach((a) => {
      if (a.action === 'Stage update') {
        const m = String(a.detail || '').match(STAGE_UPDATE_RE)
        if (!m) return
        const status = m[2].trim()
        if (status === 'Completed') completed.add(a.entity)
        else if (status === 'Issue') issue.add(a.entity)
        else if (status === 'In Progress') prog.add(a.entity)
      } else if (a.action === 'Added product') {
        added.add(a.entity)
      } else if (a.action === 'QC Audit' && String(a.detail || '').startsWith('Issues Found')) {
        issue.add(a.entity)
      }
    })
    return {
      completed: completed.size,
      issues: issue.size,
      inProgress: prog.size,
      added: added.size,
      totalActions: rows.length,
    }
  }, [audit, snapshotDate, division, isMyAction])

  const recentActivityScoped = useMemo(() => audit.filter(isMyAction), [audit, isMyAction])

  /* ---------- selected member breakdown ---------- */
  const selectedMemberBreakdown = useMemo(() => {
    if (!fMember) return null
    const member = teamMembers.find((m) => m.id === fMember)
    if (!member) return null
    const pool = allDivProducts || products

    const skuStageMap = {}
    assignments
      .filter((a) => a.memberId === fMember && a.division === division)
      .forEach((a) => {
        const key = lc(a.sku)
        if (!skuStageMap[key]) skuStageMap[key] = new Set()
        if (a.stage && a.stage !== 'all') skuStageMap[key].add(a.stage)
      })

    const assignedStageKeys = [...new Set(Object.values(skuStageMap).flatMap((s) => [...s]))]

    const perStage = assignedStageKeys.map((stageKey) => {
      let completed = 0,
        inProgress = 0,
        issue = 0,
        notStarted = 0,
        total = 0
      const pendingSkus = []
      Object.entries(skuStageMap).forEach(([sku, stages]) => {
        if (!stages.has(stageKey)) return
        const prod = pool.find((p) => lc(p.sku) === sku)
        if (!prod) return
        total++
        const status = prod.stages?.[stageKey]?.status || 'Not Started'
        if (status === 'Completed') completed++
        else {
          if (status === 'In Progress') inProgress++
          else if (status === 'Issue') issue++
          else notStarted++
          pendingSkus.push({ sku: prod.sku, status })
        }
      })
      const s = STAGES.find((x) => x.k === stageKey)
      return { key: stageKey, name: s?.n || stageKey, completed, inProgress, issue, notStarted, total, pendingSkus }
    })

    const cardsAssigned = Object.keys(skuStageMap).length
    const cardsDone = Object.entries(skuStageMap).filter(([sku, stages]) => {
      const prod = pool.find((p) => lc(p.sku) === sku)
      if (!prod || stages.size === 0) return false
      return [...stages].every((k) => prod.stages?.[k]?.status === 'Completed')
    }).length

    return { memberName: member.name, perStage, cardsAssigned, cardsDone, cardsPending: cardsAssigned - cardsDone }
  }, [fMember, teamMembers, assignments, division, allDivProducts, products])

  // team dropdown grouped by manager
  const groupedTeamOptions = useMemo(() => {
    const managerNameOf = (id) => {
      if (!id) return 'Unassigned / Direct'
      return teamMembers.find((x) => x.id === id)?.name || id
    }
    const groups = {}
    myTeam.forEach((m) => {
      const label = m.id === myMemberId ? 'Myself' : managerNameOf(m.managerId)
      ;(groups[label] ||= []).push(m)
    })
    return Object.entries(groups)
      .map(([label, members]) => ({ label, members: members.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => (a.label === 'Myself' ? -1 : b.label === 'Myself' ? 1 : a.label.localeCompare(b.label)))
  }, [myTeam, teamMembers, myMemberId])

  /* ---------- plain-English filter box ---------- */
  const runNLQuery = useCallback(() => {
    const t = nlQuery.toLowerCase().trim()
    if (!t) return

    const statusMap = [
      [/not\s*started/, 'Not Started'],
      [/in\s*progress|wip|ongoing/, 'In Progress'],
      [/complete|done|finished/, 'Completed'],
      [/issue|flagged|problem/, 'Issue'],
    ]
    let matchedStatus = ''
    for (const [re, val] of statusMap)
      if (re.test(t)) {
        matchedStatus = val
        break
      }

    const matchedMember = [...myTeam].sort((a, b) => b.name.length - a.name.length).find((m) => t.includes(m.name.toLowerCase()))
    const matchedStage = [...PIPE_STAGES].sort((a, b) => b.n.length - a.n.length).find((s) => t.includes(s.n.toLowerCase()))
    const matchedVendor = vendorOptions.find((v) => t.includes(v.toLowerCase()))
    const matchedSetNo = setNoOptions.find((s) => t.includes(s.toLowerCase()))

    let matchedDate = ''
    if (/\btoday\b/.test(t)) matchedDate = todayStr
    else if (/\byesterday\b/.test(t)) {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      matchedDate = isoDay(d)
    } else {
      const iso = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
      const dmy = t.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
      const pad = (n) => String(n).padStart(2, '0')
      if (iso) matchedDate = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`
      else if (dmy) matchedDate = `${dmy[3]}-${pad(dmy[2])}-${pad(dmy[1])}`
    }

    setFMember(matchedMember ? matchedMember.id : '')
    setFStage(matchedStage ? matchedStage.k : '')
    setFStageStatus(matchedStatus)
    setFVendor(matchedVendor || '')
    setFSetNo(matchedSetNo || '')
    setFEventDate(matchedDate)
  }, [nlQuery, myTeam, vendorOptions, setNoOptions, todayStr])

  /* ---------- completion & issues ---------- */
  // Master: complete = QC approved. Member: complete = their own assigned stages done.
  const isCardCompleteForMe = useCallback(
    (p) => {
      if (isMasterOrAdminView) return p.verdict === 'Approved'
      const rows = assignments.filter(
        (a) => a.division === division && a.memberId === myMemberId && lc(a.sku) === lc(p.sku)
      )
      if (rows.length === 0) return false
      const specific = rows.filter((a) => a.stage && a.stage !== 'all')
      const toCheck = specific.length > 0 ? specific : rows
      return toCheck.every((a) =>
        !a.stage || a.stage === 'all' ? productState(p) === 'done' : p.stages?.[a.stage]?.status === 'Completed'
      )
    },
    [assignments, division, isMasterOrAdminView, myMemberId]
  )

  // Flags on a card, limited to the given stage keys (null = every stage)
  const collectFlags = (p, stageKeys) => {
    if (p.verdict === 'Approved') return []
    const list = []
    PIPE_STAGES.forEach((s) => {
      if (stageKeys && !stageKeys.has(s.k)) return
      const stg = p.stages[s.k]
      if (!stg) return
      const qc = isQcFlagged(stg)
      if (!qc && stg.status !== 'Issue') return
      list.push({
        p,
        stageKey: s.k,
        stageName: s.n,
        type: qc ? 'qc_flagged' : 'issue_status',
        comment: String(stg.comments || '').replace(/^QC flagged:\s*/, ''),
      })
    })
    // "Issues Found" with no stage sent back still counts as one issue
    if (list.length === 0 && p.verdict === 'Issues Found') {
      list.push({ p, stageKey: 'qcverdict', stageName: 'QC Verdict', type: 'qc_flagged', comment: p.issues || '' })
    }
    return list
  }

  const divisionIssuesList = useMemo(() => {
    if (!isMasterOrAdminView) return []
    return (allDivProducts || products).flatMap((p) => collectFlags(p, null))
  }, [isMasterOrAdminView, allDivProducts, products])

  const myFlaggedIssues = useMemo(() => {
    if (isMasterOrAdminView || !myMemberId) return []
    const myStageMap = {}
    assignments
      .filter((a) => a.division === division && a.memberId === myMemberId)
      .forEach((a) => {
        const key = lc(a.sku)
        if (!myStageMap[key]) myStageMap[key] = new Set()
        if (!a.stage || a.stage === 'all') PIPE_STAGES.forEach((s) => myStageMap[key].add(s.k))
        else myStageMap[key].add(a.stage)
      })
    return myFullPool.flatMap((p) => {
      const mine = myStageMap[lc(p.sku)]
      if (!mine || mine.size === 0) return []
      return collectFlags(p, mine)
    })
  }, [isMasterOrAdminView, myMemberId, assignments, division, myFullPool])

  const issueCardIdsForMe = useMemo(
    () => new Set((isMasterOrAdminView ? divisionIssuesList : myFlaggedIssues).map((x) => x.p.id)),
    [isMasterOrAdminView, divisionIssuesList, myFlaggedIssues]
  )

  /* ---------- filtered pool for the pipeline table ---------- */
  const stageStatusMatches = useCallback(
    (p) => {
      if (!fStage || !fStageStatus) return true
      const stg = p.stages?.[fStage]
      if (!stg) return fStageStatus === 'Not Started'
      if (fStageStatus === 'Issue') return stg.status === 'Issue' || isQcFlagged(stg)
      return stg.status === fStageStatus
    },
    [fStage, fStageStatus]
  )

  const filteredProducts = useMemo(() => {
    const base = fMember
      ? (allDivProducts || products).filter((p) => memberSkuMap[fMember]?.has(lc(p.sku)))
      : myFullPool
    return base.filter(
      (p) =>
        (!fVendor || lc(p.vendor) === lc(fVendor)) &&
        (!fSetNo || lc(p.set_no) === lc(fSetNo)) &&
        stageStatusMatches(p)
    )
  }, [myFullPool, allDivProducts, products, fVendor, fSetNo, fMember, memberSkuMap, stageStatusMatches])

  const hasFilters = fVendor || fSetNo || fMember || fStage || fStageStatus || fEventDate

  const visibleStages = STAGES.filter(
    (s) => !OVERVIEW_EXCLUDED.includes(s.k) && (!allowedStages || allowedStages.includes(s.k))
  )

  // open issues per stage in the filtered pool
  const stageIssueMap = useMemo(() => {
    const map = {}
    filteredProducts.forEach((p) => {
      if (p.verdict === 'Approved') return
      PIPE_STAGES.forEach((s) => {
        const stg = p.stages[s.k]
        if (stg && (stg.status === 'Issue' || isQcFlagged(stg))) map[s.k] = (map[s.k] || 0) + 1
      })
    })
    return map
  }, [filteredProducts])

  // who is currently working (In Progress) on each stage
  const stageActivityMap = useMemo(() => {
    const map = {}
    filteredProducts.forEach((p) =>
      PIPE_STAGES.forEach((s) => {
        const stg = p.stages[s.k]
        if (stg?.status === 'In Progress') (map[s.k] ||= []).push({ sku: p.sku, person: stg.person || '' })
      })
    )
    return map
  }, [filteredProducts])

  // what happened on a specific day (from the audit log)
  const dateScopedStageStats = useMemo(() => {
    if (!fEventDate) return null
    const dayStart = new Date(fEventDate + 'T00:00:00')
    const dayEnd = new Date(fEventDate + 'T23:59:59.999')
    const map = {}
    PIPE_STAGES.forEach((s) => {
      map[s.k] = { inProgress: 0, completed: 0, issue: 0, skus: { inProgress: [], completed: [], issue: [] } }
    })
    audit.forEach((a) => {
      if (a.action !== 'Stage update') return
      const d = new Date(a.at)
      if (isNaN(d.getTime()) || d < dayStart || d > dayEnd) return
      if (a.division && a.division !== division) return
      if (!isMyAction(a)) return
      const m = String(a.detail || '').match(STAGE_UPDATE_RE)
      if (!m) return
      const stageObj = STAGES.find((s) => s.n === m[1].trim())
      if (!stageObj || !map[stageObj.k]) return
      const key = { Completed: 'completed', 'In Progress': 'inProgress', Issue: 'issue' }[m[2].trim()]
      if (!key) return
      map[stageObj.k][key]++
      map[stageObj.k].skus[key].push(a.entity)
    })
    return map
  }, [audit, fEventDate, division, isMyAction])

  const drillCards = useMemo(() => {
    if (!drill) return []
    if (fEventDate && dateScopedStageStats) {
      const key = { 'In Progress': 'inProgress', Completed: 'completed', Issue: 'issue' }[drill.status]
      if (!key) return []
      const skus = dateScopedStageStats[drill.stageKey]?.skus?.[key] || []
      const pool = allDivProducts || products
      return [...new Set(skus)].map((sku) => pool.find((p) => p.sku === sku)).filter(Boolean)
    }
    return filteredProducts.filter((p) => (p.stages?.[drill.stageKey]?.status || 'Not Started') === drill.status)
  }, [drill, fEventDate, dateScopedStageStats, filteredProducts, allDivProducts, products])

  const downloadDrillExcel = () => {
    if (!drill || drillCards.length === 0) return
    try {
      const headers = ['S.No', 'SKU', 'Name', 'Vendor', 'Qty', 'Stage', 'Stage Status', 'Verdict', 'Stage Updated', 'Stage Comments', 'Last Updated']
      const rows = drillCards.map((p, i) => {
        const stg = p.stages?.[drill.stageKey] || {}
        return [
          i + 1,
          p.sku || '',
          p.name || '',
          p.vendor || '',
          p.qty || 0,
          drill.stageName,
          drill.status,
          p.verdict || '',
          stg.at ? fmt(stg.at) : '',
          stg.comments || '',
          p.updatedAt ? fmt(p.updatedAt) : '',
        ]
      })
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 4) }))
      const wb = XLSX.utils.book_new()
      const sheetName = (drill.stageName + '_' + drill.status).replace(/[^a-z0-9 _-]/gi, '').slice(0, 31)
      XLSX.utils.book_append_sheet(wb, ws, sheetName || 'List')
      const safe = (v) => String(v).replace(/[^a-z0-9]+/gi, '_')
      XLSX.writeFile(
        wb,
        `${safe(division)}_${safe(drill.stageName)}_${safe(drill.status)}${fEventDate ? '_' + fEventDate : ''}.xlsx`
      )
    } catch (e) {
      console.error('downloadDrillExcel error', e)
      alert('Download failed - check console.')
    }
  }

  const stageStats =
    fMember && selectedMemberBreakdown
      ? selectedMemberBreakdown.perStage.map((s) => ({ k: s.key, n: s.name }))
      : visibleStages.map((s) => ({ k: s.k, n: s.n, issue: stageIssueMap[s.k] || 0 }))

  const storeStats = STORES.map((st) => {
    let d = 0,
      r = 0,
      m = 0,
      dm = 0,
      pending = 0
    filteredProducts.forEach((p) => {
      const s = p.stores[st]
      d += s.dispatched || 0
      if (s.received) r++
      else if (s.dispatched > 0) pending++
      m += s.missing || 0
      dm += s.damaged || 0
    })
    return { st, d, r, m, dm, pending }
  })

  /* ---------- KPI numbers ---------- */
  const pool = allDivProducts || products
  const useDb = !isMasterOrAdminView && dbStats

  const totalVal = useDb && dbStats.total_assigned !== undefined ? Number(dbStats.total_assigned) : myFullPool.length

  const pendingVal =
    useDb && dbStats.pending !== undefined
      ? Number(dbStats.pending)
      : isMasterOrAdminView
      ? pool.length -
        pool.filter((p) => p.verdict === 'Approved').length -
        pool.filter((p) => p.verdict === 'Issues Found').length
      : myFullPool.filter((p) => !isCardCompleteForMe(p) && !issueCardIdsForMe.has(p.id)).length

  const completeVal =
    useDb && dbStats.completed !== undefined
      ? Number(dbStats.completed)
      : isMasterOrAdminView
      ? pool.filter((p) => p.verdict === 'Approved').length
      : myFullPool.filter((p) => isCardCompleteForMe(p) && !issueCardIdsForMe.has(p.id)).length

  const issuesVal = useDb && dbStats.issues !== undefined ? Number(dbStats.issues) : issueCardIdsForMe.size
  const flaggedList = isMasterOrAdminView ? divisionIssuesList : myFlaggedIssues
  const liveAlertCount = issues.length + issuesVal

  // glow + sound when the issue count goes up
  useEffect(() => {
    if (prevIssuesCountRef.current !== null && issuesVal > prevIssuesCountRef.current) {
      setIssueGlow(true)
      playIssueSound()
      const t = setTimeout(() => setIssueGlow(false), 5000)
      prevIssuesCountRef.current = issuesVal
      return () => clearTimeout(t)
    }
    prevIssuesCountRef.current = issuesVal
  }, [issuesVal])

  const kpis = [
    { lab: 'Total Products', val: totalVal, sub: division, ic: I.box, scope: 'all' },
    {
      lab: 'Pending',
      val: pendingVal,
      sub: isMasterOrAdminView ? 'not yet assigned' : 'with me, not done',
      ic: I.layers,
      color: pendingVal > 0 ? 'var(--peach-ink)' : 'var(--sage-ink)',
      scope: 'pending',
    },
    {
      lab: 'Complete',
      val: completeVal,
      sub: isMasterOrAdminView ? 'fully done' : 'done by me personally',
      ic: I.check,
      color: 'var(--sage-ink)',
      scope: 'completed',
    },
    {
      lab: 'Issues',
      val: issuesVal,
      sub: `${flaggedList.length} flagged stage(s)`,
      ic: I.alert,
      color: issuesVal ? 'var(--rose-ink)' : 'var(--ink)',
      scope: 'issues',
    },
  ]

  const onKpiClick = (scope) => {
    if (!goProducts) return
    if (scope === 'all') goProducts({ assignTab: 'assigned' })
    else if (scope === 'pending') goProducts({ assignTab: 'pending' })
    else if (scope === 'completed') goProducts({ assignTab: 'completed' })
    else if (scope === 'issues') goProducts({ assignTab: 'assigned', fQcVerdict: 'issues' })
  }

  const downloadKpiExcel = async (scope, label) => {
    setExporting(scope)
    try {
      const params = new URLSearchParams({ division, scope })
      if (!isMasterOrAdminView && myMemberId) params.set('memberId', myMemberId)
      const res = await fetch(`${API}/api/exportProducts?${params.toString()}`)
      const data = await res.json()
      if (!data.ok) {
        alert('Export failed: ' + (data.error || 'unknown error'))
        return
      }
      const headers = ['SKU', 'Name', 'Vendor', 'Qty', 'Verdict', 'Next Pending Stage', 'Last Updated']
      const rows = data.rows.map((r) => [
        r.sku,
        r.name || '',
        r.vendor || '',
        r.qty || 0,
        r.verdict || '',
        r.next_pending_stage || '',
        r.updated_at ? fmt(r.updated_at) : '',
      ])
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 4) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, label)
      XLSX.writeFile(wb, `${division}_${label}_${scope}.xlsx`)
    } catch (e) {
      console.error('downloadKpiExcel error', e)
      alert('Export failed — check console.')
    } finally {
      setExporting('')
    }
  }

  // one QC alert per card (merge multiple flagged stages)
  const groupedFlags = flaggedList.reduce((acc, x) => {
    const existing = acc.find((a) => a.p.id === x.p.id)
    if (existing) {
      existing.stageNames.push(x.stageName)
      if (x.type === 'qc_flagged') existing.hasQc = true
    } else {
      acc.push({ p: x.p, stageNames: [x.stageName], comment: x.comment, hasQc: x.type === 'qc_flagged' })
    }
    return acc
  }, [])

  /* ---------- clickable count pill in the pipeline table ---------- */
  const cellBtn = (s, count, status, bg, ink) => {
    if (!(count > 0)) return dash
    const active = drill && drill.stageKey === s.k && drill.status === status
    return (
      <button
        onClick={() => setDrill(active ? null : { stageKey: s.k, stageName: s.n, status })}
        style={{
          background: bg,
          color: ink,
          borderRadius: 999,
          padding: '3px 12px',
          fontWeight: 700,
          fontSize: 12,
          border: active ? `2px solid ${ink}` : '1px solid transparent',
          cursor: 'pointer',
        }}
      >
        {count}
      </button>
    )
  }

  const approvedInFilter = filteredProducts.filter((p) => p.verdict === 'Approved').length

  /* ====================== RENDER ====================== */
  return (
    <div>
      {/* ---------- top-right tool buttons ---------- */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 10 }}>
        {/* QC issues */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowQcPanel((v) => !v)} style={toolBtn(liveAlertCount > 0, 'rose')}>
            ⚠ QC issues{liveAlertCount > 0 ? ` · ${liveAlertCount}` : ''}
          </button>

          {showQcPanel && (
            <div
              className="card pad"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 30,
                width: 480,
                maxHeight: 440,
                overflowY: 'auto',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <button
                onClick={() => setShowQcPanel(false)}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  zIndex: 31,
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--card-2)',
                  border: '1px solid var(--line2)',
                  color: 'var(--muted)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                ✕
              </button>

              {liveAlertCount === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>No live alerts right now.</div>
              ) : (
                <>
                  <div className="sec-h">
                    <h3>Live alerts · missing, damaged & QC issues</h3>
                    <span className="hint">store reports + QC flags</span>
                  </div>

                  {issues.slice(0, 6).map((x, i) => (
                    <div className="alert" key={'store-' + i}>
                      <div className="ic">!</div>
                      <div className="tx">
                        <b>{x.store}</b> — {x.s.missing > 0 ? `${x.s.missing} missing` : ''}
                        {x.s.missing > 0 && x.s.damaged > 0 ? ', ' : ''}
                        {x.s.damaged > 0 ? `${x.s.damaged} damaged` : ''} · <b>{x.p.name || x.p.sku || 'product'}</b> (
                        {x.p.vendor || '—'}){x.s.notes ? ` · "${x.s.notes}"` : ''} <span className="tag">· {fmt(x.s.at)}</span>
                      </div>
                      <button
                        className="ghost"
                        onClick={() => {
                          setShowQcPanel(false)
                          go('dispatch')
                        }}
                      >
                        Resolve
                      </button>
                    </div>
                  ))}
                  {issues.length > 6 && (
                    <div className="tag" style={{ marginTop: 4 }}>
                      +{issues.length - 6} more in Dispatch & Stores
                    </div>
                  )}

                  {groupedFlags.map((x, i) => (
                    <div className="alert" key={'qc-' + i}>
                      <div className="ic" style={{ background: 'var(--rose-ink)' }}>
                        {x.hasQc ? 'QC' : '!'}
                      </div>
                      <div className="tx">
                        <b>{x.hasQc ? 'QC Issues Found' : 'Issue reported on stage'}</b> —{' '}
                        <b>{x.p.name || x.p.sku || 'product'}</b> ({x.p.vendor || '—'}){' · '}
                        <span style={{ fontWeight: 600 }}>{x.stageNames.join(', ')}</span>
                        {x.comment ? ` · "${x.comment}"` : ''}
                        <span className="tag"> · SKU: {x.p.sku}</span>
                      </div>
                      {isMasterOrAdminView && x.hasQc && (
                        <button
                          className="ghost"
                          onClick={() => {
                            setShowQcPanel(false)
                            go('qcaudit')
                          }}
                        >
                          Review
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Activity by date */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowDateFilter((v) => !v)} style={toolBtn(dashFromDate || dashToDate, 'sky')}>
            📅 Activity by date{dashFromDate || dashToDate ? ` · ${dashboardActivity.length}` : ''}
          </button>

          {showDateFilter && (
            <div
              className="card pad"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>From</label>
              <input type="date" value={dashFromDate} onChange={(e) => setDashFromDate(e.target.value)} max={todayStr} style={dateInput} />
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>To</label>
              <input type="date" value={dashToDate} onChange={(e) => setDashToDate(e.target.value)} style={dateInput} />
              {(dashFromDate || dashToDate) && (
                <button
                  onClick={() => {
                    setDashFromDate('')
                    setDashToDate('')
                  }}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--rose-ink)',
                    border: '1px solid var(--rose)',
                    background: 'var(--rose-bg)',
                    borderRadius: 8,
                    padding: '5px 10px',
                  }}
                >
                  ✕ Clear
                </button>
              )}
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {dashboardActivity.length} action(s) in range
              </span>
            </div>
          )}
        </div>

        {/* Daily snapshot */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowSnapshot((v) => !v)} style={toolBtn(false, 'sky')}>
            📊 Daily snapshot
          </button>

          {showSnapshot && (
            <div
              className="card pad"
              style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20, width: 300, boxShadow: 'var(--shadow-lg)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input type="date" value={snapshotDate} max={todayStr} onChange={(e) => setSnapshotDate(e.target.value)} style={dateInput} />
                <button className="ghost" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => setSnapshotDate(todayStr)}>
                  Today
                </button>
                <button
                  className="ghost"
                  style={{ padding: '5px 10px', fontSize: 11 }}
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() - 1)
                    setSnapshotDate(isoDay(d))
                  }}
                >
                  Yesterday
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['🆕 Cards added', dailySnapshot.added, undefined],
                  ['… Moved to In Progress', dailySnapshot.inProgress, undefined],
                  ['✓ Completed', dailySnapshot.completed, 'var(--sage-ink)'],
                  ['⚠ Issues raised', dailySnapshot.issues, 'var(--rose-ink)'],
                ].map(([label, n, color]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color }}>
                    <span>{label}</span>
                    <b>{n}</b>
                  </div>
                ))}
                <div
                  style={{
                    borderTop: '1px solid var(--line)',
                    paddingTop: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11.5,
                    color: 'var(--muted)',
                  }}
                >
                  <span>Total actions logged</span>
                  <b>{dailySnapshot.totalActions}</b>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- activity list for the chosen date range ---------- */}
      {dashFromDate && dashToDate && (
        <div className="card pad" style={{ marginBottom: 16 }}>
          {dashboardActivity.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--faint)' }}>No activity in this range.</div>
          ) : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {dashboardActivity.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{fmt(a.at)}</span>
                  <span style={{ fontWeight: 600 }}>{a.actor || '—'}</span>
                  <span>{a.action}</span>
                  <span style={{ color: 'var(--muted)' }}>{a.entity}</span>
                  <span style={{ color: 'var(--muted)' }}>{a.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- KPI cards ---------- */}
      <div className="grid kpis">
        {kpis.map((k) => (
          <div
            key={k.scope}
            className={'card kpi' + (k.scope === 'issues' && issueGlow ? ' issue-card-alert' : '')}
            onClick={() => onKpiClick(k.scope)}
            style={{ cursor: 'pointer' }}
          >
            <div className="kico">{k.ic({})}</div>
            <div className="lab">{k.lab}</div>
            <div className={'val' + (k.scope === 'issues' && issueGlow ? ' issue-card-badge' : '')} style={{ color: k.color || 'var(--ink)' }}>
              {k.val}
            </div>
            <div className="sub">{k.sub}</div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                downloadKpiExcel(k.scope, k.lab.replace(/\s+/g, '_'))
              }}
              disabled={exporting === k.scope}
              title={`Download ${k.lab} as Excel`}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                fontSize: 10.5,
                fontWeight: 700,
                padding: '4px 9px',
                borderRadius: 7,
                border: '1px solid var(--line2)',
                background: 'var(--card-2)',
                color: 'var(--sage-ink)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {exporting === k.scope ? '…' : '⬇ Excel'}
            </button>
          </div>
        ))}
      </div>

      <RecentlyAddedPanel products={allDivProducts || products} />

      {/* ---------- pipeline progress ---------- */}
      <div className="sec ov-grid">
        <div className="card pad">
          <div className="sec-h" style={{ marginBottom: 6, alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3>Pipeline progress</h3>
          </div>

          {/* plain-English query */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="txt"
              placeholder='Try: "skus under Rahul which are not started"'
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runNLQuery()}
              style={{ flex: 1 }}
            />
            <button className="primary" style={{ padding: '9px 16px', fontSize: 12.5 }} onClick={runNLQuery}>
              Apply
            </button>
            {nlQuery && (
              <button className="ghost" style={{ padding: '9px 12px', fontSize: 12.5 }} onClick={clearAllFilters}>
                ✕ Clear
              </button>
            )}
          </div>

          {/* dropdown filters */}
          <div className="sec-h" style={{ marginBottom: 6, alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <select value={fVendor} onChange={(e) => setFVendor(e.target.value)} style={filterSel(fVendor)}>
                <option value="">— all vendors —</option>
                {vendorOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>

              <select value={fSetNo} onChange={(e) => setFSetNo(e.target.value)} style={filterSel(fSetNo)}>
                <option value="">— all set no. —</option>
                {setNoOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {myTeam.length > 0 && (
                <select
                  value={fMember}
                  onChange={(e) => setFMember(e.target.value)}
                  style={{
                    border: `1px solid ${fMember ? 'var(--sky)' : 'var(--line2)'}`,
                    borderRadius: 8,
                    padding: '6px 10px',
                    background: fMember ? 'var(--sky-bg)' : 'var(--card)',
                    fontSize: 11.5,
                    fontWeight: fMember ? 700 : 400,
                    color: fMember ? 'var(--sky-ink)' : 'var(--muted)',
                    minWidth: 200,
                    cursor: 'pointer',
                  }}
                >
                  <option value="">— all my team —</option>
                  {groupedTeamOptions.map((g) => (
                    <optgroup key={g.label} label={isMasterOrAdminView ? `👤 Under ${g.label}` : g.label}>
                      {g.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.id === myMemberId ? ' (me)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}

              <select
                value={fStage}
                onChange={(e) => {
                  setFStage(e.target.value)
                  if (!e.target.value) setFStageStatus('')
                }}
                style={filterSel(fStage)}
              >
                <option value="">— any stage —</option>
                {PIPE_STAGES.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.n}
                  </option>
                ))}
              </select>

              <select
                value={fStageStatus}
                onChange={(e) => setFStageStatus(e.target.value)}
                disabled={!fStage}
                style={{ ...filterSel(fStageStatus), background: fStage ? 'var(--card)' : 'var(--card-2)', opacity: fStage ? 1 : 0.5 }}
              >
                <option value="">— any status —</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={fEventDate}
                max={todayStr}
                onChange={(e) => setFEventDate(e.target.value)}
                style={{
                  border: `1px solid ${fEventDate ? 'var(--sky)' : 'var(--line2)'}`,
                  borderRadius: 8,
                  padding: '6px 10px',
                  background: fEventDate ? 'var(--sky-bg)' : 'var(--card)',
                  fontSize: 11.5,
                  color: fEventDate ? 'var(--sky-ink)' : 'var(--muted)',
                  fontWeight: fEventDate ? 700 : 400,
                }}
              />

              {hasFilters && (
                <button className="ghost" style={{ padding: '6px 10px', fontSize: 11.5 }} onClick={clearAllFilters}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {hasFilters && (
            <div className="tag" style={{ marginBottom: 10, fontWeight: 700 }}>
              Showing {filteredProducts.length} of {totalVal} {division} products
              {fVendor ? ` · vendor: ${fVendor}` : ''}
              {fSetNo ? ` · set no: ${fSetNo}` : ''}
              {fMember ? ' · member filter' : ''}
              {fEventDate ? ` · activity on ${fEventDate}` : ''}
            </div>
          )}

          {fEventDate && (
            <div className="note" style={{ marginBottom: 10 }}>
              Showing what actually happened on <b>{fEventDate}</b> — counts come from the activity log, not current live status. Clear
              the date to go back to the live pipeline view.
            </div>
          )}

          {/* selected member summary */}
          {selectedMemberBreakdown && (
            <div style={{ marginBottom: 14, border: '1px solid var(--sky)', background: 'var(--sky-bg)', borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13, color: 'var(--sky-ink)' }}>{selectedMemberBreakdown.memberName}'s assigned work</b>
                <span style={{ ...pillBadge('var(--card)', 'var(--ink)', 'var(--line2)'), fontWeight: 600 }}>
                  {selectedMemberBreakdown.cardsAssigned} cards assigned
                </span>
                <span style={pillBadge('var(--sage-bg)', 'var(--sage-ink)', 'var(--sage)')}>✓ {selectedMemberBreakdown.cardsDone} done</span>
                <span style={pillBadge('var(--peach-bg)', 'var(--peach-ink)', 'var(--peach)')}>
                  ⏳ {selectedMemberBreakdown.cardsPending} pending
                </span>
              </div>

              {selectedMemberBreakdown.perStage.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>No specific stages assigned to this member yet.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {selectedMemberBreakdown.perStage.map((s) => (
                    <div
                      key={s.key}
                      style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 9, padding: '7px 12px', minWidth: 190 }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{s.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10.5, fontWeight: 700 }}>
                        <span style={{ color: 'var(--sage-ink)' }}>✓ {s.completed}</span>
                        <span style={{ color: 'var(--sky-ink)' }}>… {s.inProgress}</span>
                        <span style={{ color: 'var(--muted)' }}>○ {s.notStarted}</span>
                        {s.issue > 0 && <span style={{ color: 'var(--rose-ink)' }}>! {s.issue}</span>}
                      </div>
                      {s.pendingSkus.length > 0 && (
                        <div
                          style={{
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: '1px solid var(--line)',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 4,
                          }}
                        >
                          {s.pendingSkus.slice(0, 4).map((ps, i) => (
                            <span key={i} className="psku" style={{ fontSize: 9.5, padding: '1px 6px' }} title={ps.status}>
                              {ps.sku}
                            </span>
                          ))}
                          {s.pendingSkus.length > 4 && (
                            <span className="tag" style={{ fontSize: 9.5 }}>
                              +{s.pendingSkus.length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* stage × status table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle('var(--muted)', 'left'), width: 180 }}>Stage</th>
                  <th style={thStyle('#B3AFA4')}>
                    <b>Not Started</b>
                  </th>
                  <th style={thStyle('var(--sky-ink)')}>In Progress</th>
                  <th style={thStyle('var(--sage-ink)')}>Completed</th>
                  <th style={thStyle('var(--rose-ink)')}>Issue</th>
                </tr>
              </thead>
              <tbody>
                {stageStats.map((s) => {
                  // date filter: what happened that day
                  if (fEventDate && dateScopedStageStats) {
                    const ds = dateScopedStageStats[s.k] || { inProgress: 0, completed: 0, issue: 0 }
                    return (
                      <tr key={s.k} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 10px', fontWeight: 600, fontSize: 13 }}>{s.n}</td>
                        <td style={tdCenter}>{dash}</td>
                        <td style={tdCenter}>{cellBtn(s, ds.inProgress, 'In Progress', 'var(--sky-bg)', 'var(--sky-ink)')}</td>
                        <td style={tdCenter}>{cellBtn(s, ds.completed, 'Completed', 'var(--sage-bg)', 'var(--sage-ink)')}</td>
                        <td style={tdCenter}>{cellBtn(s, ds.issue, 'Issue', 'var(--rose-bg)', 'var(--rose-ink)')}</td>
                      </tr>
                    )
                  }

                  // live view: member counts > server counts > client fallback
                  const memberStage =
                    fMember && selectedMemberBreakdown ? selectedMemberBreakdown.perStage.find((x) => x.key === s.k) : null
                  const db = breakdownStats[s.k]
                  const countOf = (status) => filteredProducts.filter((p) => p.stages[s.k].status === status).length
                  const notStarted = memberStage ? memberStage.notStarted : db ? db.notStarted : countOf('Not Started')
                  const inProgress = memberStage ? memberStage.inProgress : db ? db.inProgress : countOf('In Progress')
                  const completed = memberStage ? memberStage.completed : db ? db.completed : countOf('Completed')
                  const issue = memberStage ? memberStage.issue : s.issue || 0

                  const activity = stageActivityMap[s.k] || []
                  const names = [...new Set(activity.map((a) => a.person).filter(Boolean))]

                  return (
                    <tr key={s.k} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 10px', fontWeight: 600, fontSize: 13 }}>
                        {s.n}
                        {activity.length > 0 && (
                          <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--sky-ink)', marginTop: 2 }}>
                            {activity.length} in progress
                            {names.length
                              ? ` · ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`
                              : ''}
                          </div>
                        )}
                      </td>
                      <td style={tdCenter}>{cellBtn(s, notStarted, 'Not Started', '#F0EEE8', '#8C887E')}</td>
                      <td style={tdCenter}>{cellBtn(s, inProgress, 'In Progress', 'var(--sky-bg)', 'var(--sky-ink)')}</td>
                      <td style={tdCenter}>{cellBtn(s, completed, 'Completed', 'var(--sage-bg)', 'var(--sage-ink)')}</td>
                      <td style={tdCenter}>{cellBtn(s, issue, 'Issue', 'var(--rose-bg)', 'var(--rose-ink)')}</td>
                    </tr>
                  )
                })}

                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 10px', fontWeight: 600, fontSize: 13 }}>QC Audit</td>
                  <td style={tdCenter}>{dash}</td>
                  <td style={tdCenter}>{dash}</td>
                  <td style={tdCenter}>
                    {approvedInFilter > 0 ? (
                      <span
                        style={{
                          background: 'var(--sage-bg)',
                          color: 'var(--sage-ink)',
                          borderRadius: 999,
                          padding: '3px 12px',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {approvedInFilter}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td style={tdCenter}>{dash}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* drill-down list */}
          {drill && (
            <div style={{ marginTop: 16, background: 'var(--sky-bg)', border: '1px solid var(--sky)', borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13, color: 'var(--sky-ink)' }}>
                  {drill.stageName} · {drill.status}
                </b>
                <span style={{ ...pillBadge('var(--card)', 'var(--ink)', 'var(--line2)'), fontWeight: 600 }}>
                  {drillCards.length} card{drillCards.length !== 1 ? 's' : ''}
                </span>
                {fEventDate && <span className="tag">on {fEventDate}</span>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button
                    className="ghost"
                    onClick={downloadDrillExcel}
                    disabled={drillCards.length === 0}
                    title="Download this list as Excel"
                    style={{ padding: '5px 10px', fontSize: 11, color: 'var(--sage-ink)', fontWeight: 700, gap: 5 }}
                  >
                    {I.upload({ width: 14, height: 14 })} Download Excel
                  </button>
                  <button className="ghost" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => setDrill(null)}>
                    ✕ Close
                  </button>
                </div>
              </div>

              {drillCards.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>No cards found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {drillCards.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => goProducts && goProducts({ assignTab: 'assigned', search: p.sku })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        background: 'var(--card)',
                        border: '1px solid var(--line2)',
                        borderRadius: 9,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 12.5,
                      }}
                    >
                      <CopySku sku={p.sku} />
                      {p.name && <span style={{ fontWeight: 600 }}>{p.name}</span>}
                      <span className="tag">· {p.vendor || '—'}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sky-ink)', fontWeight: 700 }}>View in Products →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* per-SKU breakdown */}
          {hasFilters && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.6px',
                  marginBottom: 8,
                }}
              >
                Per-SKU breakdown — who's on what ({filteredProducts.length} cards)
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filteredProducts.slice(0, 60).map((p) => {
                  const rows = skuStageAssignees[lc(p.sku)] || []
                  const stagesToShow = fStage ? [fStage] : PIPE_STAGES.map((s) => s.k)
                  return (
                    <div key={p.id} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 9, padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <CopySku sku={p.sku} />
                        {p.name && <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</span>}
                        <span className="tag">· {p.vendor || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {stagesToShow.map((stageKey) => {
                          const status = p.stages?.[stageKey]?.status || 'Not Started'
                          if (fStageStatus && status !== fStageStatus) return null
                          const s = STAGES.find((x) => x.k === stageKey)
                          const who = rows.find((r) => r.stage === stageKey)?.memberName
                          return (
                            <span key={stageKey} className={'chip ' + statusClass(status)} title={who ? `Assigned to ${who}` : 'Unassigned'}>
                              <span className="dot" />
                              {s?.n}
                              {who ? ` · ${who}` : ''}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {filteredProducts.length > 60 && (
                  <div className="tag">+{filteredProducts.length - 60} more — narrow the filters to see them all</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- store receipts + recent activity ---------- */}
      <div className="sec ov-grid" style={!isMasterOrAdminView ? { gridTemplateColumns: '1fr' } : undefined}>
        {isMasterOrAdminView && (
          <div>
            <div className="sec-h">
              <h3>Store receipt status</h3>
              <span className="hint">{STORES.length} stores</span>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Store</th>
                    <th className="num">Disp.</th>
                    <th className="num">Recv ✓</th>
                    <th className="num">Pending</th>
                    <th className="num">Miss</th>
                    <th className="num">Dmg</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {storeStats.map((r) => (
                    <tr key={r.st}>
                      <td>
                        <b>{r.st}</b>
                      </td>
                      <td className="num">{r.d}</td>
                      <td className="num">{r.r}</td>
                      <td className="num">{r.pending}</td>
                      <td className="num" style={{ color: r.m ? 'var(--rose-ink)' : 'inherit' }}>
                        {r.m}
                      </td>
                      <td className="num" style={{ color: r.dm ? 'var(--rose-ink)' : 'inherit' }}>
                        {r.dm}
                      </td>
                      <td>
                        {r.m || r.dm ? (
                          <Chip status="Issue" />
                        ) : r.pending === 0 && r.d > 0 ? (
                          <Chip status="Completed" />
                        ) : r.d > 0 ? (
                          <Chip status="In Progress" />
                        ) : (
                          <Chip status="Not Started" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card pad">
          <div className="sec-h" style={{ marginBottom: 6 }}>
            <h3>Recent activity</h3>
          </div>
          {recentActivityScoped.length === 0 ? (
            <div className="tag" style={{ padding: '14px 0' }}>
              No activity yet.
            </div>
          ) : (
            <div className="feed">
              {recentActivityScoped.slice(0, 9).map((a) => (
                <div className="fi" key={a.id}>
                  <span className="fdot" />
                  <div>
                    <div className="fmain">
                      <b>{a.action}</b> — {a.entity}
                    </div>
                    <div className="fmeta">
                      {a.actor} · {fmt(a.at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}