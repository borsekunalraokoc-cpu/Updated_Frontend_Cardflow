import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react'
import { API, gsGet, gsGetUsers, gsPost } from '../api'
import { useAuth } from './AuthContext'
import { DIVISIONS, DEFAULT_VENDORS, STAGES } from '../lib/constants'
import { ensureStages, normalizeAuditRow, now, uid } from '../lib/utils'

const DataContext = createContext(null)

export function DataProvider({ children }) {
  const { auth, operator, updateAuth } = useAuth()

  const [loading, setLoading] = useState(true)
  const [division, setDivision] = useState('KOC Cards')
  const [products, setProducts] = useState([])
  const [audit, setAudit] = useState([])
  const [vendors, setVendors] = useState(DEFAULT_VENDORS)
  const [teamMembers, setTeamMembers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [qcAuditLog, setQcAuditLog] = useState([])

  // refs always hold the latest value (used inside async functions)
  const productsRef = useRef([])
  const bulkLockRef = useRef(false)
  const recentStagePatchRef = useRef({}) // "pid|stageKey" -> time of our own last write
  const assignmentSaveLockRef = useRef(false)

  /* ---------- load everything from the server ---------- */
  const load = useCallback(async () => {
    const [data, sheetUsers] = await Promise.all([gsGet(), gsGetUsers()])
    if (data) {
      const PROTECT_MS = 15000 // keep our own write for 15s so a sync can't undo it
      const incoming = (data.products || []).map(ensureStages)
      const reconciled = incoming.map((inc) => {
        const local = productsRef.current.find((p) => p.id === inc.id)
        if (!local) return inc
        const merged = { ...inc.stages }
        Object.keys(merged).forEach((k) => {
          const stamp = recentStagePatchRef.current[inc.id + '|' + k]
          if (stamp && Date.now() - stamp < PROTECT_MS) merged[k] = local.stages[k]
        })
        return { ...inc, stages: merged }
      })

      productsRef.current = reconciled
      setProducts(reconciled)
      setAudit((data.audit || []).map(normalizeAuditRow))
      setVendors(data.vendors || DEFAULT_VENDORS)
      setAssignments(data.assignments || [])
      setQcAuditLog(data.qcAudit || [])

      // Users sheet is the source of truth for team members;
      // teamMembers table has the correct division and managerId
      const savedMembers = data.teamMembers || []
      const fromSheet = sheetUsers
        .filter((u) => u.email && u.role !== 'master' && u.role !== 'admin')
        .map((u) => {
          const saved = savedMembers.find(
            (m) => m.email && m.email.toLowerCase() === u.email.toLowerCase()
          )
          return {
            id: saved?.id || (u.name ? u.name.toLowerCase().replace(/\s+/g, '_') : uid()),
            name: u.name || u.email,
            email: u.email,
            password: u.password || saved?.password || '',
            role: u.role || saved?.role || 'member',
            stages: u.stages || saved?.stages || '',
            division: saved?.division || u.division || 'KOC Cards',
            managerId: saved?.managerId ?? u.managerId ?? null,
            joinedAt: saved?.joinedAt || u.joinedAt || '',
          }
        })
      setTeamMembers(fromSheet)

      // If this person's role/stages changed on the server, update the session
      if (auth?.email) {
        const me = sheetUsers.find(
          (u) => u.email && u.email.toLowerCase() === auth.email.toLowerCase()
        )
        if (me && (me.stages !== auth.stages || me.role !== auth.role)) {
          updateAuth({ stages: me.stages, role: me.role })
        }
      }
    }
    setLoading(false)
  }, [auth?.email, auth?.stages, auth?.role, updateAuth])

  useEffect(() => {
    load()
  }, [load])

  // Auto-sync every 5 minutes (skips hidden tabs and bulk updates)
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return
      if (!bulkLockRef.current) load()
    }, 300000)
    return () => clearInterval(t)
  }, [load])

  /* ---------- audit log ---------- */
  const logAudit = useCallback(
    async (action, entity, detail) => {
      const e = {
        id: uid(),
        at: now(),
        actor: operator || 'Unattributed',
        action,
        entity,
        detail,
        division,
      }
      setAudit((prev) => [e, ...prev].slice(0, 800))
      await gsPost('appendAudit', e)
    },
    [operator, division]
  )

  /* ---------- products ---------- */
  const saveProducts = useCallback(async (next) => {
    if (bulkLockRef.current) return
    productsRef.current = next
    setProducts(next)
    await gsPost('batchUpsertProducts', next)
  }, [])

  const upsertProduct = useCallback(
    async (prod, isNew) => {
      prod.updatedAt = now()
      const list = productsRef.current
      const next = isNew ? [prod, ...list] : list.map((x) => (x.id === prod.id ? prod : x))
      await saveProducts(next)
      logAudit(
        isNew ? 'Added product' : 'Edited product',
        prod.sku || prod.name || 'product',
        `${prod.name || '(unnamed)'} · ${prod.vendor || 'no vendor'} · qty ${prod.qty}`
      )
    },
    [saveProducts, logAudit]
  )

  const removeProduct = useCallback(
    async (pid) => {
      const p = productsRef.current.find((x) => x.id === pid)
      const filtered = productsRef.current.filter((x) => x.id !== pid)
      productsRef.current = filtered
      setProducts(filtered)
      await gsPost('deleteProduct', { id: pid })
      logAudit('Deleted product', `${p?.name || p?.sku || 'product'}`, p?.vendor || '')
    },
    [logAudit]
  )

  /* ---------- stage updates ---------- */
  const patchStage = useCallback(
    async (pid, stageKey, patch) => {
      if (bulkLockRef.current) return
      const nowIso = now()
      const base = productsRef.current
      const previous = base.find((x) => x.id === pid) // for rollback

      const next = base.map((p) => {
        if (p.id !== pid) return p
        const updatedStages = {
          ...p.stages,
          [stageKey]: {
            ...p.stages[stageKey],
            ...patch,
            skipped: patch.skipped !== undefined ? patch.skipped : false,
            at: nowIso,
          },
        }
        let verdict = p.verdict
        let issues = p.issues
        // if every QC-flagged stage is fixed, clear the "Issues Found" verdict
        if (patch.status === 'Completed' && p.verdict === 'Issues Found') {
          const stillFlagged = STAGES.filter((s) => {
            if (s.k === 'finalqc') return false
            const stg = updatedStages[s.k]
            return (
              stg?.status === 'In Progress' &&
              String(stg?.comments || '').startsWith('QC flagged:')
            )
          })
          if (stillFlagged.length === 0) {
            verdict = ''
            issues = ''
          }
        }
        return { ...p, stages: updatedStages, verdict, issues, updatedAt: nowIso }
      })
      productsRef.current = next
      setProducts(next)

      // retry up to 3 times so one dropped request doesn't lose the change
      let res = null
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await gsPost('batchPatchStage', { ids: [pid], stageKey, patch })
        if (res && res.ok !== false) break
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }

      if (!res || res.ok === false) {
        // roll back so the screen matches what is really saved
        if (previous) {
          const rolled = productsRef.current.map((p) => (p.id === pid ? previous : p))
          productsRef.current = rolled
          setProducts(rolled)
        }
        throw new Error('batchPatchStage failed after retries: ' + JSON.stringify(res))
      }

      // quick check that the database really has the new value
      setTimeout(async () => {
        try {
          const r = await fetch(
            `${API}/api/checkStage?productId=${encodeURIComponent(pid)}&stageKey=${encodeURIComponent(stageKey)}`
          )
          const check = await r.json()
          if (check.ok && (!check.row || check.row.status !== patch.status)) {
            console.error(`[VERIFY FAILED] ${stageKey} on ${pid}`, check.row)
          }
        } catch (e) {
          console.error('checkStage failed', e)
        }
      }, 3000)

      const updatedProduct = next.find((x) => x.id === pid)
      const originalProduct = base.find((x) => x.id === pid)
      if (updatedProduct?.verdict === '' && originalProduct?.verdict === 'Issues Found') {
        await gsPost('patchQCVerdict', { id: pid, verdict: '', issues: '' })
      }

      recentStagePatchRef.current[pid + '|' + stageKey] = Date.now()

      const p = next.find((x) => x.id === pid)
      const sn = STAGES.find((s) => s.k === stageKey).n
      logAudit(
        'Stage update',
        `${p.name || p.sku || 'product'}`,
        `${sn} → ${patch.status || p.stages[stageKey].status}${
          patch.person ? ' · ' + patch.person : ''
        }`
      )
    },
    [logAudit]
  )

  const patchStageBulk = useCallback(
    async (ids, stageKey, patch) => {
      bulkLockRef.current = true
      try {
        const nowIso = now()
        const idSet = new Set(ids)
        const next = productsRef.current.map((p) =>
          !idSet.has(p.id)
            ? p
            : {
                ...p,
                stages: {
                  ...p.stages,
                  [stageKey]: {
                    ...p.stages[stageKey],
                    ...patch,
                    skipped: patch.skipped !== undefined ? patch.skipped : false,
                    at: nowIso,
                  },
                },
                updatedAt: nowIso,
              }
        )
        productsRef.current = next
        setProducts(next)

        const res = await gsPost('batchPatchStage', { ids, stageKey, patch })
        if (!res || res.ok === false) {
          throw new Error('batchPatchStage failed: ' + JSON.stringify(res))
        }

        const stamp = Date.now()
        ids.forEach((id) => {
          recentStagePatchRef.current[id + '|' + stageKey] = stamp
        })

        const sn = STAGES.find((s) => s.k === stageKey).n
        logAudit('Bulk stage update', `${ids.length} products`, `${sn} → ${patch.status} (multi-select)`)
      } finally {
        bulkLockRef.current = false
      }
    },
    [logAudit]
  )

  /* ---------- QC ---------- */
  const submitQCAudit = useCallback(
    async (pid, verdict, comments, stagesBack) => {
      const p = productsRef.current.find((x) => x.id === pid)
      if (!p) return { ok: true, failedStages: [] }

      // 1. save the verdict
      const next = productsRef.current.map((x) =>
        x.id !== pid ? x : { ...x, verdict, issues: comments, updatedAt: now() }
      )
      productsRef.current = next
      setProducts(next)
      await gsPost('patchQCVerdict', { id: pid, verdict, issues: comments })

      // 2. send each selected stage back to In Progress (3 tries each)
      const failedStages = []
      if (verdict === 'Issues Found' && stagesBack.length > 0) {
        for (const stageKey of stagesBack) {
          let res = null
          for (let attempt = 0; attempt < 3; attempt++) {
            res = await gsPost('batchPatchStage', {
              ids: [pid],
              stageKey,
              patch: { status: 'In Progress', comments: `QC flagged: ${comments}` },
            })
            if (res && res.ok !== false) break
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
          }
          if (!res || res.ok === false) {
            failedStages.push(stageKey)
            continue
          }
          productsRef.current = productsRef.current.map((x) =>
            x.id !== pid
              ? x
              : {
                  ...x,
                  stages: {
                    ...x.stages,
                    [stageKey]: {
                      ...x.stages[stageKey],
                      status: 'In Progress',
                      comments: `QC flagged: ${comments}`,
                      at: now(),
                    },
                  },
                }
          )
          recentStagePatchRef.current[pid + '|' + stageKey] = Date.now()
        }
        setProducts([...productsRef.current])
      }

      // 3. record only the stages that were really sent back
      const confirmed = stagesBack.filter((k) => !failedStages.includes(k))
      const entry = {
        id: uid(),
        at: now(),
        auditor: operator,
        sku: p.sku,
        division: p.division,
        productId: pid,
        verdict,
        comments: comments || '',
        stagesSentBack: confirmed.join(','),
      }
      await gsPost('appendQCAudit', entry)
      setQcAuditLog((prev) => [entry, ...prev])

      logAudit(
        'QC Audit',
        p.sku || p.name,
        `${verdict}${comments ? ' · ' + comments : ''}${
          confirmed.length ? ' · sent back: ' + confirmed.join(', ') : ''
        }`
      )
      return { ok: failedStages.length === 0, failedStages }
    },
    [operator, logAudit]
  )

  const patchQC = useCallback(
    async (pid, patch) => {
      const next = productsRef.current.map((p) =>
        p.id === pid ? { ...p, ...patch, updatedAt: now() } : p
      )
      productsRef.current = next
      await saveProducts(next)
      const p = next.find((x) => x.id === pid)
      logAudit('Final audit', `${p.name || p.sku || 'product'}`, `Verdict: ${patch.verdict || p.verdict || '—'}`)
    },
    [saveProducts, logAudit]
  )

  /* ---------- stores (dispatch & receipts) ---------- */
  const patchStore = useCallback(
    async (pid, store, patch) => {
      const next = productsRef.current.map((p) =>
        p.id !== pid
          ? p
          : {
              ...p,
              stores: { ...p.stores, [store]: { ...p.stores[store], ...patch, at: now() } },
              updatedAt: now(),
            }
      )
      productsRef.current = next
      setProducts(next)
      const updated = next.find((x) => x.id === pid)
      await gsPost('upsertStore', {
        productId: pid,
        store,
        division: updated.division,
        sku: updated.sku,
        storeData: updated.stores[store],
      })
      const s = updated.stores[store]
      let d = `${store}: disp ${s.dispatched}, recv ${s.received ? 'yes' : 'no'}`
      if (s.missing > 0 || s.damaged > 0) d += ` · ⚠ missing ${s.missing}, damaged ${s.damaged}`
      logAudit(
        s.missing > 0 || s.damaged > 0 ? 'Issue reported' : 'Store update',
        `${updated.name || updated.sku || 'product'}`,
        d
      )
    },
    [logAudit]
  )

  /* ---------- vendors / team / assignments ---------- */
  const addVendor = useCallback(
    async (div, name) => {
      if (!name) return
      const list = vendors[div] || []
      if (list.includes(name)) return
      const next = { ...vendors, [div]: [...list, name].sort() }
      setVendors(next)
      await gsPost('setVendors', next)
    },
    [vendors]
  )

  const saveTeamMembers = useCallback(
    async (next) => {
      setTeamMembers(next)
      const res = await gsPost('setTeamMembers', next)
      if (!res || res.ok === false) {
        alert('Could not save team members to the server — re-syncing.')
        await load()
      }
    },
    [load]
  )

  const saveAssignments = useCallback(
    async (next) => {
      if (assignmentSaveLockRef.current) return { ok: false }
      assignmentSaveLockRef.current = true
      try {
        const res = await gsPost('setAssignments', next)
        if (!res || res.ok === false) {
          alert(
            'Could not save this assignment to the server: ' +
              (res?.error || 'unknown error') +
              ' — re-syncing.'
          )
          await load()
          return { ok: false, error: res?.error }
        }
        setAssignments(next) // only after the server confirmed
        return { ok: true }
      } finally {
        assignmentSaveLockRef.current = false
      }
    },
    [load]
  )

  const value = {
    loading,
    division,
    setDivision,
    products,
    audit,
    vendors,
    teamMembers,
    assignments,
    qcAuditLog,
    load,
    logAudit,
    saveProducts,
    upsertProduct,
    removeProduct,
    patchStage,
    patchStageBulk,
    patchQC,
    patchStore,
    submitQCAudit,
    addVendor,
    saveTeamMembers,
    saveAssignments,
    DIVISIONS,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}