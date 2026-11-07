import { useState } from 'react'
import { blankProduct } from '../../lib/utils'

// "New product" popup
export default function AddModal({ division, vendors, addVendor, onClose, onSave }) {
  const [f, setF] = useState(() => blankProduct(division, ''))
  const [nv, setNv] = useState('')
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New product · {division}</h3>
        <div className="mbody">
          <div className="mrow">
            <label className="fld">
              SKU / Barcode
              <input className="txt" value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. KOC-00142" />
            </label>
            <label className="fld">
              Card quantity
              <input className="txt" type="number" value={f.qty} onChange={(e) => set('qty', +e.target.value)} />
            </label>
          </div>

          <label className="fld">
            Product name
            <input className="txt" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="design / card name" />
          </label>

          <div className="mrow">
            <label className="fld">
              Vendor
              <select value={f.vendor} onChange={(e) => set('vendor', e.target.value)}>
                <option value="">— select —</option>
                {vendors.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="fld">
              Inward date
              <input className="txt" type="date" value={f.inward} onChange={(e) => set('inward', e.target.value)} />
            </label>
          </div>

          <div className="mrow">
            <label className="fld">
              Add a new vendor
              <input className="txt" value={nv} onChange={(e) => setNv(e.target.value)} placeholder="vendor name" />
            </label>
            <button
              className="ghost"
              style={{ alignSelf: 'end' }}
              onClick={() => {
                addVendor(division, nv.trim())
                set('vendor', nv.trim())
                setNv('')
              }}
            >
              Add vendor
            </button>
          </div>

          <label className="fld">
            Note (optional)
            <textarea value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="old/new split, set number, etc." />
          </label>
        </div>

        <div className="mfoot">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(f)}>
            Create product
          </button>
        </div>
      </div>
    </div>
  )
}