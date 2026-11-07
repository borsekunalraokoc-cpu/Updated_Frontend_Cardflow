import { useState, useEffect } from 'react'

// Final QC verdict box shown at the bottom of an open product (full-access users only)
export default function QCStage({ p, idx, onQC }) {
  const [verdict, setVerdict] = useState(p.verdict || '')
  const [issues, setIssues] = useState(p.issues || '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setVerdict(p.verdict || '')
    setIssues(p.issues || '')
  }, [p.verdict, p.issues])

  const dirty = verdict !== (p.verdict || '') || issues !== (p.issues || '')

  const save = () => {
    onQC(p.id, { verdict, issues })
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  return (
    <div className="stage" style={{ background: 'var(--card)' }}>
      <div className="lab">
        <span className="stnum">{idx}</span>Final QC / Audit
      </div>
      <label className="fld">
        Verdict
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
          <option value="">— pending review —</option>
          <option>Approved</option>
          <option>Issues Found</option>
        </select>
      </label>
      <label className="fld">
        Auditor notes / issues after final audit
        <textarea
          placeholder="e.g. colour difference on 3 cards, content typo…"
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
        />
      </label>
      <button className={'mini ' + (saved ? 'saved' : '')} disabled={!dirty && !saved} onClick={save}>
        {saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  )
}