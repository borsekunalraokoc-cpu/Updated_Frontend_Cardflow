import { useState } from 'react'
import { gsGetUsers } from '../api'
import { useAuth } from '../context/AuthContext'
import { I } from '../components/ui'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const em = email.trim().toLowerCase()

    const users = await gsGetUsers()
    const user = users.find(
      (u) => u.email.toLowerCase() === em && u.password === password
    )

    if (user) {
      setBusy(false)
      login(user)
      return
    }

    setErr('Incorrect email or password.')
    setBusy(false)
  }

  const labelCls =
    'flex flex-col gap-[6px] text-[11.5px] font-semibold uppercase tracking-[0.3px] text-muted'
  const inputCls =
    'w-full rounded-[11px] border border-line2 bg-side px-3 py-[10px] text-[14px] font-normal normal-case tracking-normal text-ink outline-none focus:border-sage-deep'

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-5">
      <div className="w-full max-w-[360px] rounded-card border border-line bg-card px-7 pb-7 pt-8 text-center shadow-[0_18px_50px_rgba(53,51,45,0.14)]">
        <div className="mx-auto mb-[14px] grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_4px_10px_rgba(124,166,125,0.35)]">
          {I.box({ stroke: '#fff' })}
        </div>
        <h1 className="mb-1 font-serif text-[22px] font-semibold">Card Flow</h1>
        <p className="mb-6 text-[12.5px] text-muted">
          Production Suite — sign in to continue
        </p>

        <form onSubmit={submit} className="flex flex-col gap-[14px] text-left">
          <label className={labelCls}>
            Email
            <input
              type="email"
              autoFocus
              value={email}
              placeholder="you@koc.com"
              className={inputCls}
              onChange={(e) => {
                setEmail(e.target.value)
                setErr('')
              }}
            />
          </label>

          <label className={labelCls}>
            Password
            <div className="relative flex">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                placeholder="••••••••"
                className={`${inputCls} flex-1 pr-14`}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setErr('')
                }}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-[6px] top-1/2 -translate-y-1/2 cursor-pointer px-2 py-[5px] text-[11px] font-bold normal-case tracking-normal text-sage-ink"
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {err && (
            <div className="rounded-[11px] border border-rose bg-rose-bg px-[11px] py-[9px] text-[12.5px] font-semibold text-rose-ink">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 cursor-pointer rounded-[11px] bg-sage-deep p-[11px] text-[13.5px] font-bold text-white shadow-[0_6px_16px_rgba(124,166,125,0.3)] disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}