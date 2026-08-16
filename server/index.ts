import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import express, { type NextFunction, type Request, type Response } from 'express'

const app = express()
const port = Number(process.env.PORT ?? 4000)
const sessionCookieName = 'abbey_session'
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7
const isProduction = process.env.NODE_ENV === 'production'
const rootDir = process.cwd()
const dataDir = join(rootDir, 'data')
const clientDir = join(rootDir, 'dist', 'client')
const databasePath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : join(dataDir, 'abbey.db')

mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(databasePath)
db.exec(`
  pragma journal_mode = wal;

  create table if not exists users (
    id integer primary key autoincrement,
    email text not null unique,
    password_hash text not null,
    password_salt text not null,
    display_name text not null,
    bio text not null default '',
    city text not null default '',
    private_note text not null default '',
    created_at text not null
  );

  create table if not exists sessions (
    id text primary key,
    user_id integer not null,
    created_at integer not null,
    expires_at integer not null,
    foreign key(user_id) references users(id) on delete cascade
  );

  create table if not exists friend_requests (
    id integer primary key autoincrement,
    sender_id integer not null,
    receiver_id integer not null,
    status text not null check(status in ('pending', 'accepted', 'declined')),
    created_at integer not null,
    responded_at integer,
    foreign key(sender_id) references users(id) on delete cascade,
    foreign key(receiver_id) references users(id) on delete cascade
  );

  create table if not exists friendships (
    user_one_id integer not null,
    user_two_id integer not null,
    created_at integer not null,
    primary key(user_one_id, user_two_id),
    foreign key(user_one_id) references users(id) on delete cascade,
    foreign key(user_two_id) references users(id) on delete cascade
  );

  create index if not exists idx_sessions_expires_at on sessions(expires_at);
  create index if not exists idx_friend_requests_sender on friend_requests(sender_id);
  create index if not exists idx_friend_requests_receiver on friend_requests(receiver_id);
`)

type UserRow = {
  id: number
  email: string
  display_name: string
  bio: string
  city: string
  private_note: string
}

type PendingRequestRow = {
  id: number
  sender_id: number
  receiver_id: number
}

type RelationshipUserRow = {
  id: number
  email: string
  display_name: string
  bio: string
  city: string
  request_id?: number
}

type SessionRow = {
  id: string
  user_id: number
  expires_at: number
}

type AuthedRequest = Request & {
  currentUser: UserRow
  sessionId: string
}

app.set('trust proxy', 1)
app.use(express.json())

seedDemoUsers()
cleanupExpiredSessions()

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/auth/session', (req, res) => {
  const auth = getAuthenticatedRequest(req)

  if (!auth) {
    res.json({ authenticated: false })
    return
  }

  res.json({
    authenticated: true,
    user: toSessionUser(auth.currentUser),
  })
})

app.post('/api/auth/register', (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')
  const displayName = normalizeDisplayName(req.body?.displayName)

  if (!email || !password || !displayName) {
    res.status(400).json({ message: 'Email, password, and display name are required.' })
    return
  }

  if (password.length < 8) {
    res.status(400).json({ message: 'Password must be at least 8 characters.' })
    return
  }

  const existingUser = getUserByEmail(email)
  if (existingUser) {
    res.status(409).json({ message: 'An account with that email already exists.' })
    return
  }

  const createdAt = new Date().toISOString()
  const { hash, salt } = hashPassword(password)
  const insert = db.prepare(`
    insert into users (email, password_hash, password_salt, display_name, created_at)
    values (?, ?, ?, ?, ?)
  `)

  const result = insert.run(email, hash, salt, displayName, createdAt)
  const user = getUserById(Number(result.lastInsertRowid))

  if (!user) {
    res.status(500).json({ message: 'Unable to create account.' })
    return
  }

  const sessionId = createSession(user.id)
  setSessionCookie(res, sessionId)

  res.status(201).json({
    user: toSessionUser(user),
    account: toAccount(user),
  })
})

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')

  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required.' })
    return
  }

  const userRecord = db
    .prepare(`
      select id, email, password_hash, password_salt, display_name, bio, city, private_note
      from users
      where email = ?
    `)
    .get(email) as (UserRow & { password_hash: string; password_salt: string }) | undefined

  if (!userRecord || !verifyPassword(password, userRecord.password_salt, userRecord.password_hash)) {
    res.status(401).json({ message: 'Invalid email or password.' })
    return
  }

  const sessionId = createSession(userRecord.id)
  setSessionCookie(res, sessionId)

  res.json({
    user: toSessionUser(userRecord),
    account: toAccount(userRecord),
  })
})

app.post('/api/auth/logout', (req, res) => {
  const sessionId = readCookie(req, sessionCookieName)
  if (sessionId) {
    db.prepare('delete from sessions where id = ?').run(sessionId)
  }

  clearSessionCookie(res)
  res.status(204).end()
})

app.get('/api/account', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  res.json({ account: toAccount(auth.currentUser) })
})

app.patch('/api/account', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  const displayName = normalizeDisplayName(req.body?.displayName)
  const bio = normalizeText(req.body?.bio, 240)
  const city = normalizeText(req.body?.city, 80)
  const privateNote = normalizeText(req.body?.privateNote, 360)

  if (!displayName) {
    res.status(400).json({ message: 'Display name is required.' })
    return
  }

  db.prepare(`
    update users
    set display_name = ?, bio = ?, city = ?, private_note = ?
    where id = ?
  `).run(displayName, bio, city, privateNote, auth.currentUser.id)

  const updatedUser = getUserById(auth.currentUser.id)
  if (!updatedUser) {
    res.status(500).json({ message: 'Unable to load updated account.' })
    return
  }

  res.json({ account: toAccount(updatedUser) })
})

app.get('/api/users', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  const users = db
    .prepare(`
      select id, email, display_name, bio, city, private_note
      from users
      where id != ?
      order by display_name asc
    `)
    .all(auth.currentUser.id) as UserRow[]

  const friendIds = getFriendIds(auth.currentUser.id)
  const pendingRequests = getPendingRequests(auth.currentUser.id)
  const incomingBySender = new Map<number, number>()
  const outgoingByReceiver = new Map<number, number>()

  for (const request of pendingRequests) {
    if (request.receiver_id === auth.currentUser.id) {
      incomingBySender.set(request.sender_id, request.id)
    }

    if (request.sender_id === auth.currentUser.id) {
      outgoingByReceiver.set(request.receiver_id, request.id)
    }
  }

  res.json({
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      bio: user.bio,
      city: user.city,
      relationship: friendIds.has(user.id)
        ? 'friend'
        : incomingBySender.has(user.id)
          ? 'incoming'
          : outgoingByReceiver.has(user.id)
            ? 'outgoing'
            : 'none',
    })),
  })
})

app.get('/api/relationships', requireAuth, (req, res) => {
  const auth = req as AuthedRequest

  const incoming = db
    .prepare(`
      select fr.id as request_id, u.id, u.email, u.display_name, u.bio, u.city
      from friend_requests fr
      join users u on u.id = fr.sender_id
      where fr.receiver_id = ? and fr.status = 'pending'
      order by fr.created_at desc
    `)
    .all(auth.currentUser.id) as RelationshipUserRow[]

  const outgoing = db
    .prepare(`
      select fr.id as request_id, u.id, u.email, u.display_name, u.bio, u.city
      from friend_requests fr
      join users u on u.id = fr.receiver_id
      where fr.sender_id = ? and fr.status = 'pending'
      order by fr.created_at desc
    `)
    .all(auth.currentUser.id) as RelationshipUserRow[]

  const friends = db
    .prepare(`
      select u.id, u.email, u.display_name, u.bio, u.city, u.private_note
      from friendships f
      join users u on u.id = case when f.user_one_id = ? then f.user_two_id else f.user_one_id end
      where f.user_one_id = ? or f.user_two_id = ?
      order by u.display_name asc
    `)
    .all(auth.currentUser.id, auth.currentUser.id, auth.currentUser.id) as UserRow[]

  res.json({
    incoming: incoming.map((entry) => ({
      id: entry.request_id ?? 0,
      user: toPublicUser(entry),
    })),
    outgoing: outgoing.map((entry) => ({
      id: entry.request_id ?? 0,
      user: toPublicUser(entry),
    })),
    friends: friends.map(toPublicUser),
  })
})

app.post('/api/relationships/requests', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  const receiverId = Number(req.body?.receiverId)

  if (!Number.isInteger(receiverId)) {
    res.status(400).json({ message: 'A valid receiver is required.' })
    return
  }

  if (receiverId === auth.currentUser.id) {
    res.status(400).json({ message: 'You cannot send a friend request to yourself.' })
    return
  }

  if (!getUserById(receiverId)) {
    res.status(404).json({ message: 'User not found.' })
    return
  }

  if (getFriendIds(auth.currentUser.id).has(receiverId)) {
    res.status(409).json({ message: 'You are already connected to this user.' })
    return
  }

  const duplicate = db
    .prepare(`
      select id
      from friend_requests
      where status = 'pending'
        and ((sender_id = ? and receiver_id = ?) or (sender_id = ? and receiver_id = ?))
    `)
    .get(auth.currentUser.id, receiverId, receiverId, auth.currentUser.id) as { id: number } | undefined

  if (duplicate) {
    res.status(409).json({ message: 'A pending request already exists between these users.' })
    return
  }

  const createdAt = Date.now()
  const result = db
    .prepare(`
      insert into friend_requests (sender_id, receiver_id, status, created_at)
      values (?, ?, 'pending', ?)
    `)
    .run(auth.currentUser.id, receiverId, createdAt)

  res.status(201).json({ requestId: Number(result.lastInsertRowid) })
})

app.post('/api/relationships/requests/:id/accept', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  const requestId = Number(req.params.id)
  const request = getPendingRequestById(requestId)

  if (!request || request.receiver_id !== auth.currentUser.id) {
    res.status(404).json({ message: 'Friend request not found.' })
    return
  }

  const [userOneId, userTwoId] = normalizeFriendship(request.sender_id, request.receiver_id)

  db.prepare(`
    update friend_requests
    set status = 'accepted', responded_at = ?
    where id = ?
  `).run(Date.now(), request.id)

  db.prepare(`
    insert or ignore into friendships (user_one_id, user_two_id, created_at)
    values (?, ?, ?)
  `).run(userOneId, userTwoId, Date.now())

  res.status(204).end()
})

app.post('/api/relationships/requests/:id/decline', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  const requestId = Number(req.params.id)
  const request = getPendingRequestById(requestId)

  if (!request || request.receiver_id !== auth.currentUser.id) {
    res.status(404).json({ message: 'Friend request not found.' })
    return
  }

  db.prepare(`
    update friend_requests
    set status = 'declined', responded_at = ?
    where id = ?
  `).run(Date.now(), request.id)

  res.status(204).end()
})

app.delete('/api/relationships/friends/:friendId', requireAuth, (req, res) => {
  const auth = req as AuthedRequest
  const friendId = Number(req.params.friendId)

  if (!Number.isInteger(friendId) || !getUserById(friendId)) {
    res.status(404).json({ message: 'Friend not found.' })
    return
  }

  const [userOneId, userTwoId] = normalizeFriendship(auth.currentUser.id, friendId)
  const deleted = db
    .prepare('delete from friendships where user_one_id = ? and user_two_id = ?')
    .run(userOneId, userTwoId)

  if (deleted.changes === 0) {
    res.status(404).json({ message: 'Friendship not found.' })
    return
  }

  res.status(204).end()
})

if (existsSync(clientDir)) {
  app.use(express.static(clientDir))

  app.get(/^(?!\/api).*/, async (_req, res) => {
    try {
      const indexPath = resolve(clientDir, 'index.html')
      const html = await readFile(indexPath, 'utf8')
      res.type('html').send(html)
    } catch {
      res.status(500).send('Client build is unavailable.')
    }
  })
}

app.listen(port, () => {
  console.log(`Abbey app running on http://localhost:${port}`)
})

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuthenticatedRequest(req)

  if (!auth) {
    clearSessionCookie(res)
    res.status(401).json({ message: 'Authentication required.' })
    return
  }

  ;(req as AuthedRequest).currentUser = auth.currentUser
  ;(req as AuthedRequest).sessionId = auth.sessionId
  next()
}

function getAuthenticatedRequest(req: Request) {
  cleanupExpiredSessions()

  const sessionId = readCookie(req, sessionCookieName)
  if (!sessionId) {
    return null
  }

  const session = db
    .prepare('select id, user_id, expires_at from sessions where id = ?')
    .get(sessionId) as SessionRow | undefined

  if (!session || session.expires_at < Date.now()) {
    if (session) {
      db.prepare('delete from sessions where id = ?').run(session.id)
    }
    return null
  }

  const user = getUserById(session.user_id)
  if (!user) {
    db.prepare('delete from sessions where id = ?').run(session.id)
    return null
  }

  return {
    sessionId,
    currentUser: user,
  }
}

function getUserByEmail(email: string) {
  return db
    .prepare(`
      select id, email, display_name, bio, city, private_note
      from users
      where email = ?
    `)
    .get(email) as UserRow | undefined
}

function getUserById(id: number) {
  return db
    .prepare(`
      select id, email, display_name, bio, city, private_note
      from users
      where id = ?
    `)
    .get(id) as UserRow | undefined
}

function getPendingRequests(userId: number) {
  return db
    .prepare(`
      select id, sender_id, receiver_id
      from friend_requests
      where status = 'pending' and (sender_id = ? or receiver_id = ?)
    `)
    .all(userId, userId) as PendingRequestRow[]
}

function getPendingRequestById(id: number) {
  return db
    .prepare(`
      select id, sender_id, receiver_id
      from friend_requests
      where id = ? and status = 'pending'
    `)
    .get(id) as PendingRequestRow | undefined
}

function getFriendIds(userId: number) {
  const rows = db
    .prepare(`
      select case when user_one_id = ? then user_two_id else user_one_id end as friend_id
      from friendships
      where user_one_id = ? or user_two_id = ?
    `)
    .all(userId, userId, userId) as Array<{ friend_id: number }>

  return new Set(rows.map((row) => row.friend_id))
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeDisplayName(value: unknown) {
  return String(value ?? '').trim().slice(0, 60)
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actualHash = scryptSync(password, salt, 64).toString('hex')
  return timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))
}

function createSession(userId: number) {
  const sessionId = createHash('sha256').update(randomBytes(32)).digest('hex')
  const now = Date.now()

  db.prepare(`
    insert into sessions (id, user_id, created_at, expires_at)
    values (?, ?, ?, ?)
  `).run(sessionId, userId, now, now + sessionTtlMs)

  return sessionId
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) {
    return null
  }

  for (const item of cookieHeader.split(';')) {
    const [key, ...value] = item.trim().split('=')
    if (key === name) {
      return decodeURIComponent(value.join('='))
    }
  }

  return null
}

function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: sessionTtlMs,
    path: '/',
  })
}

function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  })
}

function cleanupExpiredSessions() {
  db.prepare('delete from sessions where expires_at < ?').run(Date.now())
}

function normalizeFriendship(firstUserId: number, secondUserId: number) {
  return firstUserId < secondUserId
    ? [firstUserId, secondUserId]
    : [secondUserId, firstUserId]
}

function toSessionUser(user: Pick<UserRow, 'id' | 'email' | 'display_name'>) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
  }
}

function toPublicUser(user: Pick<UserRow, 'id' | 'email' | 'display_name' | 'bio' | 'city'>) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    bio: user.bio,
    city: user.city,
  }
}

function toAccount(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    bio: user.bio,
    city: user.city,
    privateNote: user.private_note,
  }
}

function seedDemoUsers() {
  const count = db.prepare('select count(*) as count from users').get() as { count: number }
  if (count.count > 0) {
    return
  }

  const demoUsers = [
    { email: 'ada@abbey.local', displayName: 'Ada', city: 'Lagos', bio: 'Product-minded lender building her first network.' },
    { email: 'moses@abbey.local', displayName: 'Moses', city: 'Abuja', bio: 'Operations specialist who values fast, clear communication.' },
    { email: 'tola@abbey.local', displayName: 'Tola', city: 'Ibadan', bio: 'Finance analyst testing relationship flows across the app.' },
  ]

  for (const demoUser of demoUsers) {
    const { hash, salt } = hashPassword('Password123!')
    db.prepare(`
      insert into users (email, password_hash, password_salt, display_name, bio, city, private_note, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      demoUser.email,
      hash,
      salt,
      demoUser.displayName,
      demoUser.bio,
      demoUser.city,
      'Private demo note',
      new Date().toISOString(),
    )
  }
}
