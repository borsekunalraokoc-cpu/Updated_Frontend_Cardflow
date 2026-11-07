import { createContext, useContext, useState, useCallback } from 'react'

/* ---------- permission checks (same rules as the HTML version) ---------- */

export function canAssign(auth) {
  if (!auth) return false
  return auth.role === 'master' || auth.role === 'admin'
}

export function canSeeTab(auth, tabKey) {
  if (!auth) return false
  const role = auth.role || ''

  // master and admin see everything
  if (role === 'master' || role === 'admin') return true

  const stages = (auth.stages || '').split(',').map((s) => s.trim())

  if (tabKey === 'qcaudit') return stages.includes('qcaudit')
  if (tabKey === 'assign') return stages.includes('assign')
  if (tabKey === 'bulk') return stages.includes('bulk')
  if (tabKey === 'branchupload') return stages.includes('branchupload')

  // Overview is hidden only for someone whose ONLY permission is branchupload
  if (tabKey === 'overview') {
    const hasOnlyBranchUpload =
      stages.length > 0 && stages.every((s) => s === 'branchupload')
    return !hasOnlyBranchUpload
  }

  // Products & Pipeline needs at least one real pipeline stage
  if (tabKey === 'products') {
    const nonPipelinePerms = ['assign', 'bulk', 'qcaudit', 'branchupload']
    return stages.some((s) => s && !nonPipelinePerms.includes(s))
  }

  return false
}

// null = all stages allowed, otherwise an array like ['photography','videography']
export function getAllowedStages(auth) {
  if (!auth) return null
  if (!auth.stages || auth.stages === 'all') return null
  return auth.stages.split(',').map((s) => s.trim())
}

/* ---------- auth state ---------- */

const AuthContext = createContext(null)

function readSavedAuth() {
  try {
    const raw = sessionStorage.getItem('ct:auth') || localStorage.getItem('ct:auth')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveAuth(a) {
  localStorage.setItem('ct:auth', JSON.stringify(a))
  sessionStorage.setItem('ct:auth', JSON.stringify(a))
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readSavedAuth)

  // Called by the Login page after a successful sign in
  const login = useCallback((user) => {
    const a = {
      name: user.name,
      email: user.email,
      role: user.role,
      stages: user.stages,
    }
    setAuth(a)
    saveAuth(a)
  }, [])

  const logout = useCallback(() => {
    setAuth(null)
    localStorage.removeItem('ct:auth')
    sessionStorage.removeItem('ct:auth')
    localStorage.removeItem('ct:operator')
  }, [])

  // Used when the server says this person's role/stages changed
  const updateAuth = useCallback((patch) => {
    setAuth((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      saveAuth(next)
      return next
    })
  }, [])

  // "Operator" is always the signed-in person's name
  const operator = auth?.name || ''

  const value = { auth, operator, login, logout, updateAuth }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}