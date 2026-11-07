import { STAGES, STAGE_COLS, STORES } from './constants'

/* ---------- basic helpers ---------- */
export const now = () => new Date().toISOString()
export const uid = () => Math.random().toString(36).slice(2, 9)

export function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(iso) {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

export function normalizeAuditRow(raw) {
  const vals = Object.values(raw)
  return {
    id: vals[0] ?? '',
    at: vals[1] ?? '',
    actor: vals[2] ?? '',
    action: vals[3] ?? '',
    entity: vals[4] ?? '',
    detail: vals[5] ?? '',
    division: vals[6] ?? '',
  }
}

/* ---------- status colours (Tailwind classes, same colours as before) ---------- */
// Returns the classes for a status pill and for its small dot
export function statusStyle(s) {
  if (s === 'Completed') return { chip: 'bg-sage-bg text-sage-ink', dot: 'bg-sage' }
  if (s === 'In Progress') return { chip: 'bg-sky-bg text-sky-ink', dot: 'bg-sky' }
  if (s === 'Issue') return { chip: 'bg-rose-bg text-rose-ink', dot: 'bg-rose' }
  if (s === 'Approved') return { chip: 'bg-peach-bg text-peach-ink', dot: 'bg-peach' }
  return { chip: 'bg-[#f0eee8] text-muted', dot: 'bg-faint' }
}

// Colour of one segment in the small pipeline bar
export function pipeClass(s) {
  if (s === 'Completed') return 'bg-sage'
  if (s === 'In Progress') return 'bg-sky'
  if (s === 'Issue') return 'bg-rose'
  return 'bg-line2'
}

/* ---------- Excel / CSV value cleaners ---------- */
export function normStatus(v) {
  const m = {
    'not started': 'Not Started',
    notstarted: 'Not Started',
    'in progress': 'In Progress',
    inprogress: 'In Progress',
    progress: 'In Progress',
    wip: 'In Progress',
    pending: 'In Progress',
    completed: 'Completed',
    complete: 'Completed',
    done: 'Completed',
    approved: 'Completed',
    issue: 'Issue',
    issues: 'Issue',
    error: 'Issue',
  }
  return m[String(v).trim().toLowerCase()] || null
}

export function normBool(v) {
  return /^(y|yes|true|1|received|recd|done|✓|x)$/i.test(String(v).trim())
}

export function normDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return d.toISOString().slice(0, 10)
  }
  return String(v).trim()
}

// Reads one column value out of a product, used when exporting to Excel
export function fieldFromProduct(p, h) {
  if (['division', 'sku', 'name', 'vendor', 'inward', 'qty', 'note', 'set_no'].includes(h))
    return p[h] ?? ''
  if (h === 'qc_verdict') return p.verdict || ''
  if (h === 'qc_issues') return p.issues || ''
  if (h === 'dimensions_width') return p.stages?.dimensions?.width || ''
  if (h === 'dimensions_height') return p.stages?.dimensions?.height || ''
  if (h === 'dimensions_weight') return p.stages?.dimensions?.weight || ''
  const mm = h.match(/^(.+)_(status|person|comments)$/)
  if (mm && p.stages[mm[1]]) return p.stages[mm[1]][mm[2]] || ''
  return ''
}

/* ---------- product helpers ---------- */
const blankStore = () => ({
  dispatched: 0,
  received: false,
  receivedAt: '',
  receivedBy: '',
  missing: 0,
  damaged: 0,
  notes: '',
  at: '',
})

// Makes sure a product from the server has every stage and every store filled in
export function ensureStages(p) {
  if (!p.stages) p.stages = {}
  STAGES.forEach((s) => {
    if (!p.stages[s.k])
      p.stages[s.k] = { status: 'Not Started', person: '', comments: '', at: '', skipped: false }
    if (p.stages[s.k].skipped === undefined) p.stages[s.k].skipped = false
    if (s.k === 'dimensions') {
      if (p.stages[s.k].width === undefined) p.stages[s.k].width = ''
      if (p.stages[s.k].height === undefined) p.stages[s.k].height = ''
      if (p.stages[s.k].weight === undefined) p.stages[s.k].weight = ''
    }
  })
  if (!p.stores) p.stores = {}
  STORES.forEach((st) => {
    if (!p.stores[st]) p.stores[st] = blankStore()
  })
  return p
}

// A brand-new empty product (used by the "Add product" popup)
export function blankProduct(division, vendor) {
  const stages = {}
  STAGES.forEach((s) => {
    stages[s.k] = { status: 'Not Started', person: '', comments: '', at: '', skipped: false }
    if (s.k === 'dimensions') {
      stages[s.k].width = ''
      stages[s.k].height = ''
      stages[s.k].weight = ''
    }
  })
  const stores = {}
  STORES.forEach((st) => (stores[st] = blankStore()))
  return {
    id: uid(),
    division,
    sku: '',
    name: '',
    vendor: vendor || '',
    inward: '',
    qty: 0,
    note: '',
    stages,
    stores,
    verdict: '',
    issues: '',
    createdAt: now(),
    updatedAt: now(),
  }
}

// % of stages completed (ignores stages marked "Not required")
export function productPct(p) {
  const relevant = STAGES.filter((s) => !p.stages[s.k]?.skipped)
  if (relevant.length === 0) return 100
  return Math.round(
    (relevant.filter((s) => p.stages[s.k].status === 'Completed').length / relevant.length) * 100
  )
}

// Overall state of a product: 'issue' | 'done' | 'none' | 'prog'
export function productState(p) {
  const pc = productPct(p)
  if (STAGES.some((s) => !p.stages[s.k]?.skipped && p.stages[s.k].status === 'Issue'))
    return 'issue'
  if (pc === 100) return 'done'
  if (pc === 0) return 'none'
  return 'prog'
}

// Re-exported so other files can import everything product-related from one place
export { STAGE_COLS }