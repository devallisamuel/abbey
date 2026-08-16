import { useEffect, useState, type FormEvent } from 'react'
import './App.css'

type SessionUser = {
  id: number
  email: string
  displayName: string
}

type Account = SessionUser & {
  bio: string
  city: string
  privateNote: string
}

type RelationshipState = 'none' | 'friend' | 'incoming' | 'outgoing'

type Person = {
  id: number
  email: string
  displayName: string
  bio: string
  city: string
  relationship: RelationshipState
}

type Friend = {
  id: number
  email: string
  displayName: string
  bio: string
  city: string
}

type FriendRequest = {
  id: number
  user: Friend
}

type Relationships = {
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  friends: Friend[]
}

type SessionResponse =
  | { authenticated: false }
  | { authenticated: true; user: SessionUser }

const emptyRelationships: Relationships = {
  incoming: [],
  outgoing: [],
  friends: [],
}

const emptyAccountForm = {
  displayName: '',
  city: '',
  bio: '',
  privateNote: '',
}

function App() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [relationships, setRelationships] = useState<Relationships>(emptyRelationships)
  const [booting, setBooting] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authForm, setAuthForm] = useState({
    displayName: '',
    email: '',
    password: '',
  })
  const [accountForm, setAccountForm] = useState(emptyAccountForm)

  async function loadDashboard(user = sessionUser) {
    if (!user) {
      return
    }

    const [accountResponse, peopleResponse, relationshipsResponse] = await Promise.all([
      request<{ account: Account }>('/api/account'),
      request<{ users: Person[] }>('/api/users'),
      request<Relationships>('/api/relationships'),
    ])

    setSessionUser({
      id: accountResponse.account.id,
      email: accountResponse.account.email,
      displayName: accountResponse.account.displayName,
    })
    setAccountForm({
      displayName: accountResponse.account.displayName,
      city: accountResponse.account.city,
      bio: accountResponse.account.bio,
      privateNote: accountResponse.account.privateNote,
    })
    setPeople(peopleResponse.users)
    setRelationships(relationshipsResponse)
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setBooting(true)
      setError('')

      try {
        const session = await request<SessionResponse>('/api/auth/session')
        if (!session.authenticated) {
          if (cancelled) {
            return
          }

          setSessionUser(null)
          setPeople([])
          setRelationships(emptyRelationships)
          setAccountForm(emptyAccountForm)
          return
        }

        if (cancelled) {
          return
        }

        setSessionUser(session.user)

        const [accountResponse, peopleResponse, relationshipsResponse] = await Promise.all([
          request<{ account: Account }>('/api/account'),
          request<{ users: Person[] }>('/api/users'),
          request<Relationships>('/api/relationships'),
        ])

        if (cancelled) {
          return
        }

        setSessionUser({
          id: accountResponse.account.id,
          email: accountResponse.account.email,
          displayName: accountResponse.account.displayName,
        })
        setAccountForm({
          displayName: accountResponse.account.displayName,
          city: accountResponse.account.city,
          bio: accountResponse.account.bio,
          privateNote: accountResponse.account.privateNote,
        })
        setPeople(peopleResponse.users)
        setRelationships(relationshipsResponse)
      } catch (caughtError) {
        if (!cancelled) {
          setError(readMessage(caughtError, 'Unable to load the application.'))
        }
      } finally {
        if (!cancelled) {
          setBooting(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyKey('auth')
    setError('')
    setMessage('')

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const response = await request<{ user: SessionUser; account: Account }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(authForm),
      })

      setSessionUser(response.user)
      setAuthForm({ displayName: '', email: '', password: '' })
      await loadDashboard(response.user)
      setMessage(authMode === 'login' ? 'You are signed in.' : 'Your account is ready.')
    } catch (caughtError) {
      setError(readMessage(caughtError, 'Unable to continue with authentication.'))
    } finally {
      setBusyKey('')
    }
  }

  async function handleLogout() {
    setBusyKey('logout')
    setError('')
    setMessage('')

    try {
      await request('/api/auth/logout', { method: 'POST' })
      setSessionUser(null)
      setPeople([])
      setRelationships(emptyRelationships)
      setAccountForm(emptyAccountForm)
      setMessage('You have been signed out.')
    } catch (caughtError) {
      setError(readMessage(caughtError, 'Unable to sign out right now.'))
    } finally {
      setBusyKey('')
    }
  }

  async function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyKey('account')
    setError('')
    setMessage('')

    try {
      await request<{ account: Account }>('/api/account', {
        method: 'PATCH',
        body: JSON.stringify(accountForm),
      })
      await loadDashboard()
      setMessage('Your profile was updated.')
    } catch (caughtError) {
      setError(readMessage(caughtError, 'Unable to save your profile.'))
    } finally {
      setBusyKey('')
    }
  }

  async function handleRelationshipAction(key: string, action: () => Promise<void>, successMessage: string) {
    setBusyKey(key)
    setError('')
    setMessage('')

    try {
      await action()
      await loadDashboard()
      setMessage(successMessage)
    } catch (caughtError) {
      setError(readMessage(caughtError, 'Unable to complete that action.'))
    } finally {
      setBusyKey('')
    }
  }

  if (booting) {
    return (
      <main className="shell loading-shell">
        <section className="hero-panel">
          <p className="eyebrow">Abbey Challenge</p>
          <h1>Loading relationship workspace...</h1>
        </section>
      </main>
    )
  }

  return (
    <main className="shell">

      {(message || error) && (
        <section className={`notice ${error ? 'error' : 'success'}`}>
          <p>{error || message}</p>
        </section>
      )}

      {!sessionUser ? (
        <section className="auth-layout">
          <form className="panel auth-panel" onSubmit={handleAuthSubmit}>
            <div className="panel-heading">
              <p className="section-label">Access</p>
              <h2>{authMode === 'login' ? 'Welcome back' : 'Create an account'}</h2>
            </div>

            <div className="mode-switch">
              <button
                type="button"
                className={authMode === 'login' ? 'selected' : ''}
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={authMode === 'register' ? 'selected' : ''}
                onClick={() => setAuthMode('register')}
              >
                Register
              </button>
            </div>

            {authMode === 'register' && (
              <label>
                <span>Display name</span>
                <input
                  value={authForm.displayName}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Ada Ojo"
                />
              </label>
            )}

            <label>
              <span>Email</span>
              <input
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="you@example.com"
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="At least 8 characters"
              />
            </label>

            <button className="primary-button" type="submit" disabled={busyKey === 'auth'}>
              {busyKey === 'auth'
                ? 'Working...'
                : authMode === 'login'
                  ? 'Login'
                  : 'Create account'}
            </button>
          </form>

          <aside className="panel demo-panel">
            <div className="panel-heading">
              <p className="section-label">Demo Accounts</p>
              <h2>Seeded users for relationship testing</h2>
            </div>
            <ul className="credential-list">
              <li>
                <strong>ada@abbey.local</strong>
                <span>Password123!</span>
              </li>
              <li>
                <strong>moses@abbey.local</strong>
                <span>Password123!</span>
              </li>
              <li>
                <strong>tola@abbey.local</strong>
                <span>Password123!</span>
              </li>
            </ul>
            <p className="muted-copy">
              Register your own account or use the seeded accounts to test friend requests immediately.
            </p>
          </aside>
        </section>
      ) : (
        <section className="workspace">
          <header className="workspace-header panel">
            <div>
              <p className="section-label">Signed in</p>
              <h2>{sessionUser.displayName}</h2>
              <p className="muted-copy">{sessionUser.email}</p>
            </div>
            <button className="secondary-button" type="button" onClick={handleLogout} disabled={busyKey === 'logout'}>
              {busyKey === 'logout' ? 'Signing out...' : 'Logout'}
            </button>
          </header>

          <div className="workspace-grid">
            <form className="panel" onSubmit={handleAccountSubmit}>
              <div className="panel-heading">
                <p className="section-label">Account</p>
                <h2>Edit your profile</h2>
              </div>

              <label>
                <span>Display name</span>
                <input
                  value={accountForm.displayName}
                  onChange={(event) =>
                    setAccountForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>City</span>
                <input
                  value={accountForm.city}
                  onChange={(event) =>
                    setAccountForm((current) => ({ ...current, city: event.target.value }))
                  }
                />
              </label>

              <label>
                <span>Bio</span>
                <textarea
                  value={accountForm.bio}
                  onChange={(event) =>
                    setAccountForm((current) => ({ ...current, bio: event.target.value }))
                  }
                  rows={4}
                />
              </label>

              <label>
                <span>Private note</span>
                <textarea
                  value={accountForm.privateNote}
                  onChange={(event) =>
                    setAccountForm((current) => ({ ...current, privateNote: event.target.value }))
                  }
                  rows={4}
                />
              </label>

              <button className="primary-button" type="submit" disabled={busyKey === 'account'}>
                {busyKey === 'account' ? 'Saving...' : 'Save profile'}
              </button>
            </form>

            <section className="panel">
              <div className="panel-heading">
                <p className="section-label">People</p>
                <h2>Discover connections</h2>
              </div>
              <div className="stack-list">
                {people.map((person) => (
                  <article className="person-card" key={person.id}>
                    <div>
                      <div className="person-header">
                        <h3>{person.displayName}</h3>
                        <span className={`status-chip ${person.relationship}`}>{person.relationship}</span>
                      </div>
                      <p className="muted-copy">{person.email}</p>
                      <p>{person.bio || 'No bio added yet.'}</p>
                      <p className="mini-copy">{person.city || 'No city provided'}</p>
                    </div>

                    {person.relationship === 'none' && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={busyKey === `send-${person.id}`}
                        onClick={() =>
                          void handleRelationshipAction(
                            `send-${person.id}`,
                            () =>
                              request('/api/relationships/requests', {
                                method: 'POST',
                                body: JSON.stringify({ receiverId: person.id }),
                              }).then(() => undefined),
                            `Friend request sent to ${person.displayName}.`,
                          )
                        }
                      >
                        {busyKey === `send-${person.id}` ? 'Sending...' : 'Send request'}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <p className="section-label">Incoming</p>
                <h2>Requests waiting on you</h2>
              </div>
              <div className="stack-list">
                {relationships.incoming.length === 0 && <p className="empty-copy">No incoming requests.</p>}
                {relationships.incoming.map((requestItem) => (
                  <article className="person-card" key={requestItem.id}>
                    <div>
                      <h3>{requestItem.user.displayName}</h3>
                      <p className="muted-copy">{requestItem.user.email}</p>
                      <p>{requestItem.user.bio || 'No bio added yet.'}</p>
                    </div>
                    <div className="action-row">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={busyKey === `accept-${requestItem.id}`}
                        onClick={() =>
                          void handleRelationshipAction(
                            `accept-${requestItem.id}`,
                            () => request(`/api/relationships/requests/${requestItem.id}/accept`, { method: 'POST' }).then(() => undefined),
                            `${requestItem.user.displayName} is now in your network.`,
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={busyKey === `decline-${requestItem.id}`}
                        onClick={() =>
                          void handleRelationshipAction(
                            `decline-${requestItem.id}`,
                            () => request(`/api/relationships/requests/${requestItem.id}/decline`, { method: 'POST' }).then(() => undefined),
                            `Request from ${requestItem.user.displayName} was declined.`,
                          )
                        }
                      >
                        Decline
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <p className="section-label">Outgoing</p>
                <h2>Pending requests</h2>
              </div>
              <div className="stack-list">
                {relationships.outgoing.length === 0 && <p className="empty-copy">No pending outbound requests.</p>}
                {relationships.outgoing.map((requestItem) => (
                  <article className="person-card compact" key={requestItem.id}>
                    <div>
                      <h3>{requestItem.user.displayName}</h3>
                      <p className="muted-copy">Waiting for response from {requestItem.user.email}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <p className="section-label">Friends</p>
                <h2>Current network</h2>
              </div>
              <div className="stack-list">
                {relationships.friends.length === 0 && <p className="empty-copy">You have no friends added yet.</p>}
                {relationships.friends.map((friend) => (
                  <article className="person-card" key={friend.id}>
                    <div>
                      <h3>{friend.displayName}</h3>
                      <p className="muted-copy">{friend.email}</p>
                      <p>{friend.bio || 'No bio added yet.'}</p>
                      <p className="mini-copy">{friend.city || 'No city provided'}</p>
                    </div>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={busyKey === `remove-${friend.id}`}
                      onClick={() =>
                        void handleRelationshipAction(
                          `remove-${friend.id}`,
                          () => request(`/api/relationships/friends/${friend.id}`, { method: 'DELETE' }).then(() => undefined),
                          `${friend.displayName} was removed from your network.`,
                        )
                      }
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </section>
      )}
    </main>
  )
}

export default App

async function request<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (response.status === 204) {
    return undefined as T
  }

  const data = (await response.json()) as T & { message?: string }

  if (!response.ok) {
    throw new Error(data.message ?? 'Request failed.')
  }

  return data
}

function readMessage(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) {
    return value.message
  }

  return fallback
}
