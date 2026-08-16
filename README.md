# Abbey Circle

Circle is a small full-stack app built for the Abbey engineering challenge. It demonstrates local authentication, account-specific data, and user-to-user relationships in a single repository.

## Stack

- React 19 + Vite
- Express 5
- TypeScript
- SQLite via Node 22 built-in `node:sqlite`

## Features

- Register, login, logout, and restore sessions with an HTTP-only cookie
- Edit account data: display name, city, bio, and a private note
- Browse other users and send friend requests
- Accept, decline, and remove friendships
- Seeded demo accounts for quick testing

## Local Setup

1. Install dependencies with `npm install`
2. Start the client and server together with `npm run dev`
3. Open the Vite URL shown in the terminal

The API runs on `http://localhost:4000` and Vite proxies `/api` requests during development.

## Demo Accounts

- `ada@abbey.local` / `Password123!`
- `moses@abbey.local` / `Password123!`
- `tola@abbey.local` / `Password123!`

The demo users are inserted only when the database is empty.

## Production Build

- `npm run build`
- `npm run start`

The server serves the built frontend from `dist/client` and stores the SQLite database in `data/abbey.db`.

## Deploy Free On Render

Use a single Render web service for both frontend and backend.

### Render settings

- Runtime: `Node`
- Build Command: `npm install --include=dev && npm run build`
- Start Command: `NODE_ENV=production npm run start`
- Health Check Path: `/api/health`
- Node Version: `22.16.0`

### Fastest setup

1. Push the repo to GitHub.
2. In Render, click `New +` -> `Blueprint`.
3. Select this repository.
4. Render will read `render.yaml` and create the service.

### Important limitation

This app uses a local SQLite file. On Render free web services, the filesystem is ephemeral, so the database can reset after redeploys, restarts, or idle spin-down. This is acceptable for a demo, but it is not durable production storage.

### Do not use GitHub Pages

GitHub Pages is static-only and cannot host this repo's Express backend, auth, or session flow.
