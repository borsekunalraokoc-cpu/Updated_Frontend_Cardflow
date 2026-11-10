import { useState, useMemo, useRef } from 'react'
import { AuthProvider, useAuth, canSeeTab, getAllowedStages } from './context/AuthContext'
import { DataProvider, useData } from './context/DataContext'
import { DIVISIONS, STORES, DEFAULT_VENDORS } from './lib/constants'
import { I } from './components/ui'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Products from './pages/Products'
import QCAudit from './pages/QCAudit'
import AssignWork from './pages/AssignWork'
import Dispatch from './pages/Dispatch'
import AdminDispatch from './pages/AdminDispatch'
import BranchUpload from './pages/BranchUpload'
import Bulk from './pages/Bulk'
import AuditLog from './pages/AuditLog'
import Process from './pages/Process'
import SpeedAnalytics from './pages/SpeedAnalytics'

/* ---------- tab list: [key, label, icon] ---------- */
const ALL_NAV = [
  ['overview', 'Overview', I.grid],
  ['products', 'Products & Pipeline', I.layers],
  ['dispatch', 'Dispatch & Stores', I.truck],
  ['admindispatch', 'Admin Dispatch', I.upload],
  ['branchupload', 'Branch Upload', I.store],
  ['bulk', 'Bulk Upload', I.upload],
  ['audit', 'Audit Log', I.audit],
  ['assign', 'Assign Work', I.gear],
  ['qcaudit', 'QC Audit', I.check],
  ['process', 'Process', I.check],
  ['analytics', 'Speed Analytics', I.grid],
]

/* ---------- page titles: [title, subtitle] ---------- */
const META = {
  overview: ['Overview', 'Production, listing & dispatch at a glance'],
  products: ['Products & Pipeline', 'Every design and its full production lifecycle'],
  dispatch: ['Dispatch & Stores', `Store receipt status across ${STORES.length} stores`],
  admindispatch: ['Admin Dispatch', 'Dispatch vendor batches to branches — bulk upload or scan'],
  branchupload: ['Branch Upload', 'Scan cards as they arrive at your branch'],
  bulk: ['Bulk Upload', 'Import & update thousands of records via Excel'],
  audit: ['Audit Log', 'A complete timestamped trail of every action'],
  assign: ['Assign Work', 'Manage team members and assign SKUs to individuals'],
  qcaudit: ['QC Audit', 'Final quality check — approve or flag issues on completed cards'],
  process: ['Process', 'Member performance reports and completed work'],
  analytics: ['Speed Analytics', 'Average time-to-complete per pipeline stage'],
}

function Shell() {
  const { auth, logout, operator } = useAuth()
  const { loading, division, setDivision, products, vendors, teamMembers, assignments, audit, load } = useData()

  const [tab, setTab] = useState('overview')
  const [navOpen, setNavOpen] = useState(false)

  const [flyoutPos, setFlyoutPos] = useState(null)
  const closeTimer = useRef(null)

  const openFlyout = (e) => {
    clearTimeout(closeTimer.current)
    const r = e.currentTarget.getBoundingClientRect()
    setFlyoutPos({ top: r.top, left: r.right + 8 })
  }
  const scheduleCloseFlyout = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setFlyoutPos(null), 350)
  }
  const keepFlyoutOpen = () => clearTimeout(closeTimer.current)

  // deep-link filters handed from one tab to another
  const [productsFilter, setProductsFilter] = useState(null)
  const [qcAuditFilter, setQcAuditFilter] = useState(null)
  const [analyticsFilter, setAnalyticsFilter] = useState(null)

  const goProducts = (filter) => {
    setProductsFilter(filter)
    setTab('products')
  }
  // NOTE: this function was left unfinished in the original; restore your real body if it differed
  const goQcAuditIssues = (filter) => {
    setQcAuditFilter(filter || null)
    setTab('qcaudit')
  }

  // stable callbacks so child pages' effects don't re-fire on every render
  const clearProductsFilter = useMemo(() => () => setProductsFilter(null), [])
  const clearQcAuditFilter = useMemo(() => () => setQcAuditFilter(null), [])
  const clearAnalyticsFilter = useMemo(() => () => setAnalyticsFilter(null), [])

  /* ---------- derived data shared by several pages ---------- */
  const allDivProducts = useMemo(() => products.filter((p) => p.division === division), [products, division])

  // Products this person can see in the current division
  const divProducts = useMemo(() => {
    if (!auth) return allDivProducts
    if (auth.role === 'master' || auth.role === 'admin') return allDivProducts

    const me = teamMembers.find(
      (m) => m.email && auth.email && m.email.toLowerCase() === auth.email.toLowerCase()
    )
    const myId = me?.id || auth.name.toLowerCase().replace(/\s+/g, '_')

    const mine = assignments.filter((a) => a.memberId === myId && a.division === division)
    if (mine.length === 0) return []
    const mySkus = new Set(mine.map((a) => a.sku.toLowerCase()))

    // a manager with "assign" access: hide cards already pushed to their team
    const hasAssign = (auth.stages || '').split(',').map((s) => s.trim()).includes('assign')
    if (hasAssign) {
      const pushed = new Set(
        assignments.filter((a) => a.managerId === myId && a.division === division).map((a) => a.sku.toLowerCase())
      )
      return allDivProducts.filter((p) => mySkus.has(p.sku.toLowerCase()) && !pushed.has(p.sku.toLowerCase()))
    }
    return allDivProducts.filter((p) => mySkus.has(p.sku.toLowerCase()))
  }, [allDivProducts, auth, teamMembers, assignments, division])

  // store missing/damaged alerts
  const openIssues = useMemo(() => {
    const list = []
    divProducts.forEach((p) =>
      STORES.forEach((st) => {
        const s = p.stores?.[st]
        if (s && (s.missing > 0 || s.damaged > 0)) list.push({ p, store: st, s, type: 'store' })
      })
    )
    return list
  }, [divProducts])

  const divAudit = useMemo(() => audit.filter((a) => a.division === division), [audit, division])

  // memoized so Products' memoized rows/filters keep a stable reference
  const allowedStages = useMemo(() => getAllowedStages(auth), [auth])

  const counts = useMemo(() => {
    const c = {}
    DIVISIONS.forEach((d) => (c[d] = 0))
    products.forEach((p) => {
      if (p.division in c) c[p.division]++
    })
    return c
  }, [products])

  const NAV = ALL_NAV.filter(([k]) => canSeeTab(auth, k))
  const activeTab = canSeeTab(auth, tab) ? tab : NAV[0]?.[0] || 'overview'

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-[14px] bg-bg">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_4px_10px_rgba(124,166,125,0.35)]">
          {I.box({ stroke: '#fff' })}
        </div>
        <div className="font-serif text-[18px] text-ink">Loading workspace…</div>
        <div className="text-xs text-muted">Connecting to database</div>
      </div>
    )
  }

  const bombayVendors = vendors['Bombay Cards'] || DEFAULT_VENDORS['Bombay Cards'] || []

  const renderPage = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <Overview
            division={division}
            products={divProducts}
            allDivProducts={allDivProducts}
            issues={openIssues}
            audit={divAudit}
            go={setTab}
            goProducts={goProducts}
            vendors={vendors[division] || []}
            allowedStages={allowedStages}
            auth={auth}
            teamMembers={teamMembers}
            assignments={assignments}
          />
        )

      case 'products':
        return (
          <Products
            products={divProducts}
            allDivProducts={allDivProducts}
            allowedStages={allowedStages}
            initialFilter={productsFilter}
            onFilterConsumed={clearProductsFilter}
          />
        )

      case 'qcaudit':
        return (
          <QCAudit
            products={divProducts}
            initialFilter={qcAuditFilter}
            onFilterConsumed={clearQcAuditFilter}
          />
        )

      case 'assign':
        return <AssignWork />

      case 'dispatch':
        return <Dispatch products={divProducts} />

      case 'admindispatch':
        return <AdminDispatch />

      case 'branchupload':
        return <BranchUpload />

      case 'bulk':
        return <Bulk divProducts={divProducts} />

      case 'audit':
        return <AuditLog audit={divAudit} />

      case 'process':
        return <Process />

      case 'analytics':
        return (
          <SpeedAnalytics
            products={divProducts}
            initialFilter={analyticsFilter}
            onFilterConsumed={clearAnalyticsFilter}
          />
        )

      default:
        return (
          <div className="rounded-card border border-line bg-card p-10 text-center text-[13px] text-faint shadow-card">
            <b className="text-ink">{META[activeTab]?.[0]}</b> page will be ported next.
            <br />
            Division: {division} · Products loaded: {products.length}
          </div>
        )
    }
  }

  return (
    <div className="flex min-h-screen">
      {navOpen && (
        <div className="fixed inset-0 z-[39] bg-black/25 min-[881px]:hidden" onClick={() => setNavOpen(false)} />
      )}

      {/* ================= SIDEBAR ================= */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col overflow-y-auto border-r border-line bg-side px-[14px] py-5 transition-transform duration-[250ms] max-[880px]:shadow-[0_18px_50px_rgba(53,51,45,0.14)] ${
          navOpen ? 'translate-x-0' : 'max-[880px]:-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-[11px] px-2 pb-[18px] pt-[6px]">
          <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_4px_10px_rgba(124,166,125,0.35)]">
            {I.box({ stroke: '#fff' })}
          </div>
          <div>
            <b className="font-serif text-[19px] font-semibold leading-none tracking-[0.2px]">Card Flow</b>
            <span className="mt-[3px] block text-[10.5px] uppercase tracking-[0.6px] text-muted">Production Suite</span>
          </div>
        </div>

        <div className="px-[10px] pb-[7px] pt-[14px] text-[10px] font-bold uppercase tracking-[1px] text-faint">Division</div>
        {DIVISIONS.map((d) => (
          <div
            key={d}
            onMouseEnter={d === 'Bombay Cards' ? openFlyout : undefined}
            onMouseLeave={d === 'Bombay Cards' ? scheduleCloseFlyout : undefined}
          >
            <button
              onClick={() => {
                setDivision(d)
                setNavOpen(false)
              }}
              className={`mb-[3px] flex w-full cursor-pointer items-center gap-[11px] rounded-[11px] px-3 py-[11px] text-left font-semibold transition ${
                division === d ? 'bg-card text-ink shadow-card' : 'text-muted hover:bg-card'
              }`}
            >
              <span
                className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg font-serif text-[13px] font-semibold ${
                  division === d ? 'bg-sage text-white' : 'bg-sage-bg text-sage-ink'
                }`}
              >
                {d[0]}
              </span>
              {d}
              <span className="ml-auto text-[11px] font-semibold text-faint">{counts[d] || 0}</span>
            </button>
          </div>
        ))}

        {/* Bombay vendor flyout — fixed so the sidebar's scroll doesn't clip it */}
        {flyoutPos && (
          <div
            onMouseEnter={keepFlyoutOpen}
            onMouseLeave={scheduleCloseFlyout}
            className="fixed z-[60]"
            style={{ top: flyoutPos.top, left: flyoutPos.left }}
          >
            <div className="max-h-[340px] min-w-[210px] overflow-y-auto rounded-[10px] border border-line2 bg-card p-[6px] shadow-[0_18px_50px_rgba(53,51,45,0.14)]">
              <div className="px-2 pb-[6px] pt-1 text-[10px] font-bold uppercase tracking-[0.5px] text-faint">Vendors</div>
              {bombayVendors.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setFlyoutPos(null)
                    setDivision('Bombay Cards')
                    setAnalyticsFilter({ vendor: v })
                    setTab('analytics')
                    setNavOpen(false)
                  }}
                  className="block w-full cursor-pointer rounded-lg px-[10px] py-[7px] text-left text-[12.5px] font-medium text-ink hover:bg-card-2"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-[10px] pb-[7px] pt-[14px] text-[10px] font-bold uppercase tracking-[1px] text-faint">Workspace</div>
        {NAV.map(([k, n, Icon]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k)
              setNavOpen(false)
            }}
            className={`relative mb-px flex w-full cursor-pointer items-center gap-[11px] rounded-[11px] px-3 py-[9px] text-left transition ${
              activeTab === k
                ? 'bg-sage-bg font-semibold text-sage-ink before:absolute before:-left-[14px] before:bottom-2 before:top-2 before:w-[3px] before:rounded-[3px] before:bg-sage-deep before:content-[""]'
                : 'font-medium text-muted hover:bg-card hover:text-ink'
            }`}
          >
            <span className="shrink-0 opacity-85">{Icon({})}</span>
            {n}
            {k === 'dispatch' && openIssues.length > 0 && (
              <span className="ml-auto min-w-[18px] rounded-full bg-rose px-[7px] py-px text-center text-[10px] font-bold text-white">
                {openIssues.length}
              </span>
            )}
          </button>
        ))}

        <div className="mt-auto shrink-0 border-t border-line pt-[14px]">
          <div className="mb-2 flex items-center justify-between gap-2 rounded-[11px] border border-rose bg-rose-bg px-3 py-[10px]">
            <div>
              <div className="mb-[2px] text-[10px] font-bold uppercase tracking-[0.6px] text-rose-ink">Signed in as</div>
              <div className="text-[13px] font-semibold text-ink">{auth.name}</div>
            </div>
            <button onClick={logout} className="shrink-0 cursor-pointer whitespace-nowrap rounded-lg bg-rose px-3 py-[7px] text-xs font-bold text-white">
              ↩ Log out
            </button>
          </div>

          <div className="flex flex-col gap-[5px] px-1">
            <label className="text-[10px] font-bold uppercase tracking-[0.8px] text-faint">Operator name</label>
            <div className="rounded-[9px] border border-line2 bg-card-2 px-[10px] py-2 font-semibold text-ink">{operator || auth.name}</div>
          </div>

          <button
            onClick={load}
            className="mt-[9px] flex w-full cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border border-line2 bg-card p-2 font-semibold text-muted hover:border-faint hover:text-ink"
          >
            {I.sync({})} Sync workspace
          </button>
          <div className="mt-[9px] text-center text-[10.5px] leading-[1.4] text-faint">
            Shared workspace · everyone sees
            <br />
            the same live data
          </div>
        </div>
      </aside>

      {/* ================= MAIN ================= */}
      <main className="ml-[248px] flex min-w-0 flex-1 flex-col max-[880px]:ml-0">
        <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-bg/80 px-8 py-[18px] backdrop-blur-[10px] max-[880px]:px-[18px] max-[880px]:py-[14px]">
          <button
            onClick={() => setNavOpen(true)}
            className="hidden h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] border border-line2 bg-card max-[880px]:inline-grid"
          >
            {I.menu({})}
          </button>
          <div>
            <div className="mb-px text-[11px] font-semibold uppercase tracking-[0.4px] text-faint">{division}</div>
            <h1 className="m-0 font-serif text-[23px] font-semibold tracking-[0.2px]">{META[activeTab][0]}</h1>
            <div className="mt-[2px] text-[12.5px] text-muted">{META[activeTab][1]}</div>
          </div>
          <div className="ml-auto flex items-center gap-[10px]">
            {activeTab === 'products' && (
              <button
                onClick={() => window.__openAdd && window.__openAdd()}
                className="inline-flex cursor-pointer items-center gap-[7px] rounded-[10px] bg-ink px-[18px] py-[10px] font-semibold text-white hover:bg-[#26241f]"
              >
                {I.plus({})} Add product
              </button>
            )}
            <button
              onClick={logout}
              className="inline-flex cursor-pointer items-center gap-[6px] rounded-[10px] border border-line2 bg-card px-[14px] py-2 text-xs font-semibold text-rose-ink"
            >
              ↩ Log out
            </button>
          </div>
        </header>

        {/* analytics tables need more width, like the old .content:has(.stacked-tables) rule */}
        <div
          className={`px-8 pb-[90px] pt-6 max-[880px]:px-[18px] max-[880px]:pt-[18px] ${
            activeTab === 'analytics' ? 'max-w-[1600px]' : 'max-w-[1180px]'
          }`}
        >
          {renderPage()}
        </div>
      </main>
    </div>
  )
}

function Gate() {
  const { auth } = useAuth()
  if (!auth) return <Login />
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}