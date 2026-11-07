import { API } from '../api'

// Small helper: GET with query params, returns parsed JSON or a fallback
async function getJson(path, params, fallback) {
  try {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    const r = await fetch(`${API}${path}${qs}`)
    return await r.json()
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

/* ---------- lists for dropdowns ---------- */
export async function fetchDispatchGroups(division) {
  const d = await getJson('/api/dispatch/groups', { division }, {})
  return d.ok ? d.groups : []
}

export async function fetchBatchLabels(division, vendor) {
  const d = await getJson('/api/dispatch/batch-labels', { division, vendor }, {})
  return d.ok ? d.batchLabels : []
}

export async function fetchSetLabels(division, vendor, batchLabel, branchName) {
  const params = { division, vendor, batchLabel }
  if (branchName) params.branchName = branchName
  const d = await getJson('/api/dispatch/set-labels', params, {})
  return d.ok ? d.setLabels : []
}

export async function fetchSetSummary(division, vendor, batchLabel) {
  const d = await getJson('/api/dispatch/set-summary', { division, vendor, batchLabel }, {})
  return d.ok ? d.sets : []
}

export async function fetchBranchPending(division, branchName) {
  const d = await getJson('/api/dispatch/branch-pending', { division, branchName }, {})
  return d.ok ? d.rows : []
}

/* ---------- compare + batch management ---------- */
export const fetchDispatchComparison = (division, vendor, batchLabel) =>
  getJson('/api/dispatch/comparison', { division, vendor, batchLabel }, { ok: false })

export const fetchDispatchBatchesList = (division, vendor, batchLabel) =>
  getJson('/api/dispatch/batches', { division, vendor, batchLabel }, { ok: false })

export const deleteDispatchBatch = (batchId) => postJson('/api/dispatch/delete-batch', { batchId })

/* ---------- uploads ---------- */
// payload: { division, vendor, batchLabel, setLabel, branchName, uploadedBy, filename, skus: [{sku, qty}] }
export const dispatchAdminUpload = (payload) => postJson('/api/dispatch/admin-upload', payload)

/* ---------- live scanning ---------- */
export const fetchScanLog = (params) => getJson('/api/dispatch/scan-log', params, { ok: false })
export const postScan = (body) => postJson('/api/dispatch/scan', body)
export const undoScan = (batchId, sku) => postJson('/api/dispatch/scan-undo', { batchId, sku })