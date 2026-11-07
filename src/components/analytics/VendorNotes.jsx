import { useState, useEffect, useCallback } from 'react'
import { API } from '../../api'
import { useAuth } from '../../context/AuthContext'

// rows can come back in snake_case or camelCase
const field = (row, snake, camel) => row?.[snake] ?? row?.[camel]

const formatDate = (value) => {
  if (!value) return '—'
  const d = new Date(value?.value || value)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

const timeOf = (row) => {
  const v = field(row, 'created_at', 'createdAt')
  return new Date(v?.value || v || 0).getTime() || 0
}

// parse JSON and turn server errors into readable messages
async function readJson(response) {
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${response.status}). Check the API URL and backend.`)
  }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `Request failed (HTTP ${response.status})`)
  return data
}

// Notes about one vendor. Everyone can read; only master can add or edit.
export default function VendorNotes({ selectedVendor = '' }) {
  const { auth } = useAuth()
  const isMaster = String(auth?.role || '').toLowerCase() === 'master'

  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // { type: 'add' } | { type: 'edit', id }
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState({})

  // show a name instead of an email address
  const displayName = (who) => {
    const v = String(who || '').trim()
    if (!v) return '—'
    if (!v.includes('@')) return v
    if (auth?.email && v.toLowerCase() === auth.email.toLowerCase() && auth?.name) return auth.name
    return (
      v
        .split('@')[0]
        .split(/[._\-+]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ') || v
    )
  }

  const load = useCallback(async (vendor) => {
    if (!vendor) {
      setNotes([])
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setNotes([])
    try {
      const data = await readJson(await fetch(`${API}/api/vendor-issues?vendor=${encodeURIComponent(vendor)}`))
      const rows = Array.isArray(data) ? data : data.issues || data.rows || data.data
      if (!Array.isArray(rows)) throw new Error('Unexpected Vendor Notes API response.')
      setNotes(rows)
    } catch (err) {
      setError(err.message || 'Unable to load vendor notes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(selectedVendor)
  }, [selectedVendor, load])

  const sorted = [...notes].sort((x, y) => timeOf(y) - timeOf(x)) // newest first

  const openAdd = () => {
    setText('')
    setModal({ type: 'add' })
  }
  const openEdit = (n) => {
    setText(n.note || '')
    setModal({ type: 'edit', id: String(n.id) })
  }

  const save = async () => {
    if (!isMaster || !selectedVendor || !modal || !text.trim() || saving) return
    setSaving(true)
    try {
      const isEdit = modal.type === 'edit'
      const url = isEdit ? `${API}/api/vendor-issues/${encodeURIComponent(modal.id)}` : `${API}/api/vendor-issues`
      const body = isEdit ? { note: text.trim() } : { vendorName: selectedVendor, note: text.trim() }
      await readJson(
        await fetch(url, {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-email': auth?.email || '' },
          body: JSON.stringify(body),
        })
      )
      setModal(null)
      await load(selectedVendor)
    } catch (err) {
      alert(`Could not save note: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const ready = selectedVendor && !loading && !error

  return (
    <div className="card pad" style={{ marginTop: 16, marginBottom: 16, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>Vendor Notes</h3>
        {isMaster && ready && (
          <button className="primary" onClick={openAdd}>
            + Add Note
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="tag">
          {selectedVendor ? (
            <>
              Vendor: <b>{selectedVendor}</b>
            </>
          ) : (
            'Select a vendor from the filter above'
          )}
        </span>
        {ready && (
          <span className="chip c-none">
            {notes.length} note{notes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {!selectedVendor && (
        <div className="empty" style={{ padding: 28 }}>
          Select a vendor to view and add its notes.
        </div>
      )}
      {selectedVendor && loading && (
        <div className="empty" style={{ padding: 28 }}>
          Loading vendor notes...
        </div>
      )}
      {selectedVendor && !loading && error && (
        <div className="note" style={{ background: 'var(--rose-bg)', borderColor: 'var(--rose)', color: 'var(--rose-ink)' }}>
          Could not load vendor notes: {error}
        </div>
      )}
      {ready && notes.length === 0 && (
        <div className="empty" style={{ padding: 28 }}>
          No notes yet for this vendor.
        </div>
      )}

      {ready &&
        sorted.map((n) => (
          <div key={n.id} style={{ padding: '16px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.note}</div>

                {expanded[n.id] && (
                  <>
                    <div className="tag" style={{ marginTop: 8 }}>
                      Created by: {displayName(field(n, 'created_by', 'createdBy'))} · {formatDate(field(n, 'created_at', 'createdAt'))}
                    </div>
                    {field(n, 'updated_at', 'updatedAt') && (
                      <div className="tag" style={{ marginTop: 4 }}>
                        Updated by: {displayName(field(n, 'updated_by', 'updatedBy'))} · {formatDate(field(n, 'updated_at', 'updatedAt'))}
                      </div>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setExpanded((p) => ({ ...p, [n.id]: !p[n.id] }))}
                  style={{ marginTop: 8, padding: 0, fontSize: 12, fontWeight: 700, color: 'var(--sky-ink)', background: 'none', border: 'none' }}
                >
                  {expanded[n.id] ? 'Show less' : 'Show more'}
                </button>
              </div>

              {isMaster && (
                <button className="ghost" onClick={() => openEdit(n)} style={{ padding: '4px 10px', fontSize: 12 }}>
                  Edit
                </button>
              )}
            </div>
          </div>
        ))}

      {modal && isMaster && (
        <div className="scrim" onClick={() => !saving && setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal.type === 'add' ? 'Add Vendor Note' : 'Edit Vendor Note'}</h3>
            <div className="mbody">
              <div className="tag">
                Vendor: <b>{selectedVendor}</b>
              </div>
              <label className="fld">
                Note
                <textarea
                  rows={5}
                  maxLength={5000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Write a note about this vendor..."
                />
              </label>
            </div>
            <div className="mfoot">
              <button className="ghost" disabled={saving} onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="primary" disabled={saving || !text.trim()} onClick={save}>
                {saving ? 'Saving...' : modal.type === 'add' ? 'Add Note' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}