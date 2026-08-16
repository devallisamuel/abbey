# Abbey Challenge Implementation Plan

  ## Summary

  Build a single-repo full-stack app using a React frontend plus an Express + SQLite backend. The product will be a small friend-network app where users can
  register, log in, manage account-specific profile data, and send/accept/remove friend relationships. Prioritize simple local setup, readable code, and a
  coherent visual direction over infrastructure complexity.

  ## Key Changes

  - Add a Node/Express API inside the repo with SQLite persistence, local email/password auth, and cookie-based session handling.
  - Replace the Vite starter UI with a focused product flow:
      - unauthenticated screens for sign up / login
      - authenticated dashboard for editing account data
      - people discovery / relationship management
      - current friends view

  - Use one consistent domain model:
      - users
      - sessions
      - friend_requests
      - user-owned profile fields / private notes

  - Keep auth intentionally simple:
      - local email + password only
      - hashed passwords
      - session cookie issued by backend
      - frontend checks current session on load and updates UI state from API responses

  - Keep the relationship model intentionally symmetric:
      - user sends friend request
      - recipient accepts or declines
      - accepted requests become friendship
      - either side can remove a friendship

  - Keep account-specific data simple but demonstrable:
      - display name
      - bio
      - city
      - private note visible only to the owner

  ## Visual Direction

  - Base/background: near-white cool gray (#f5f7fb), panels in pure white (#ffffff)
  - Primary/dark: near-black navy (#0a0e17) — used for the hero panel, primary buttons, headings, high-priority status chips
  - Accent: clean blue (#2f5fe0 / #1d4ed8) — used for focus rings, ghost buttons, links, and the "friend" status
  - Text: near-black (#0a0e17) on light surfaces, near-white (#f5f7fb) on dark surfaces, muted slate (#4b5565) for secondary copy
  - Surfaces are flat with a single subtle soft shadow on panels, thin cool-gray borders (#e2e6ee), corners modestly rounded (8-16px)
  - Status colors: blue for friend, solid black for incoming (draws the eye to action needed), muted gray for outgoing/none, red reserved for errors

  ## Public Interfaces / Behavior

  - Backend endpoints:
      - POST /api/auth/register
      - POST /api/auth/login
      - POST /api/auth/logout
      - GET /api/auth/session
      - GET /api/account
      - PATCH /api/account
      - GET /api/users
      - GET /api/relationships
      - POST /api/relationships/requests
      - POST /api/relationships/requests/:id/accept
      - POST /api/relationships/requests/:id/decline
      - DELETE /api/relationships/friends/:friendId

  - Frontend state:
      - session-aware root app shell
      - auth form state with basic validation
      - dashboard state split into account form, incoming/outgoing requests, and friends/discovery lists

  - Data rules:
      - emails must be unique
      - users cannot friend themselves
      - duplicate pending requests are blocked
      - sending a request to an existing friend is blocked
      - private note is never exposed in public user listings

  ## Test Plan

  - Auth:
      - register succeeds for new email
      - duplicate email is rejected
      - login succeeds with valid credentials
      - invalid credentials are rejected
      - logout clears the session
      - session endpoint restores logged-in state after refresh

  - Account:
      - authenticated user can fetch and update their own profile
      - unauthenticated account requests are rejected
      - private note is returned only for the current user

  - Relationships:
      - user can send a friend request to another user
      - recipient can accept and decline
      - accepted friendship appears for both users
      - duplicate/self/friend re-request cases are rejected
  - Frontend:
      - auth screens switch correctly based on session state

  - Verification:
      - run lint
