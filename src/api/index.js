console.log('API URL =', import.meta.env.VITE_API_URL)
const API = import.meta.env.VITE_API_URL

export { API }

/* ---------- main data calls ---------- */
export async function gsGetUsers() {
  try {
    const r = await fetch(API + '/api/getUsers')
    return await r.json()
  } catch (e) {
    console.error('gsGetUsers', e)
    return []
  }
}

export async function gsGet() {
  try {
    const r = await fetch(API + '/api/getAll')
    return await r.json()
  } catch (e) {
    console.error('gsGet', e)
    return null
  }
}

const ROUTE_MAP = {
  appendAudit: '/api/appendAudit',
  batchUpsertProducts: '/api/batchUpsertProducts',
  batchPatchStage: '/api/batchPatchStage',
  patchQCVerdict: '/api/patchQCVerdict',
  appendQCAudit: '/api/appendQCAudit',
  upsertStore: '/api/upsertStore',
  deleteProduct: '/api/deleteProduct',
  setVendors: '/api/setVendors',
  setTeamMembers: '/api/setTeamMembers',
  setAssignments: '/api/setAssignments',
  saveUsers: '/api/saveUsers',
  appendAssignmentHistory: '/api/appendAssignmentHistory',
  bulkImportProducts: '/api/bulkImportProducts',
}

export async function gsPost(action, payload) {
  const route = ROUTE_MAP[action]
  if (!route) {
    console.warn('gsPost: unknown action', action)
    return { ok: false }
  }
  try {
    const r = await fetch(API + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await r.json()
  } catch (e) {
    console.error(`gsPost[${action}] error`, e)
    return { ok: false, error: e.message }
  }
}

/* ---------- small helper used by the dispatch calls below ---------- */
async function getJson(path, params, pick, fallback) {
  try {
    const qs = new URLSearchParams(params).toString()
    const r = await fetch(`${API}${path}${qs ? '?' + qs : ''}`)
    const data = await r.json()
    return pick ? (data.ok ? data[pick] : fallback) : data
  } catch (e) {
    console.error(path, e)
    return fallback
  }
}

async function postJson(path, body) {
  try {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await r.json()
  } catch (e) {
    console.error(path, e)
    return { ok: false, error: e.message }
  }
}

/* ---------- dispatch / branch calls ---------- */
export const fetchStoreList = () => getJson('/api/store-list', {}, 'stores', [])

export const dispatchBranchUpload = (payload) =>
  postJson('/api/dispatch/branch-upload', payload)

export const dispatchAdminUpload = (payload) =>
  postJson('/api/dispatch/admin-upload', payload)

export const fetchDispatchComparison = (division, vendor, batchLabel) =>
  getJson('/api/dispatch/comparison', { division, vendor, batchLabel }, null, {
    ok: false,
  })

export const fetchDispatchGroups = (division) =>
  getJson('/api/dispatch/groups', { division }, 'groups', [])

export const fetchBatchLabels = (division, vendor) =>
  getJson('/api/dispatch/batch-labels', { division, vendor }, 'batchLabels', [])

export const fetchSetLabels = (division, vendor, batchLabel, branchName) => {
  const params = { division, vendor, batchLabel }
  if (branchName) params.branchName = branchName
  return getJson('/api/dispatch/set-labels', params, 'setLabels', [])
}

export const fetchSetSummary = (division, vendor, batchLabel) =>
  getJson('/api/dispatch/set-summary', { division, vendor, batchLabel }, 'sets', [])

export const fetchBranchPending = (division, branchName) =>
  getJson('/api/dispatch/branch-pending', { division, branchName }, 'rows', [])

export const fetchDispatchBatchesList = (division, vendor, batchLabel) =>
  getJson('/api/dispatch/batches', { division, vendor, batchLabel }, null, {
    ok: false,
  })

export const deleteDispatchBatch = (batchId) =>
  postJson('/api/dispatch/delete-batch', { batchId })

export const renameDispatchBatch = (division, vendor, oldBatchLabel, newBatchLabel) =>
  postJson('/api/dispatch/rename-batch', {
    division,
    vendor,
    oldBatchLabel,
    newBatchLabel,
  })