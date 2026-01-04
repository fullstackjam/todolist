# TodoList

A simple todo list application with GitHub OAuth authentication, built on Cloudflare Workers.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: GitHub OAuth

## Prerequisites

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account
- GitHub OAuth App

## Setup

### 1. Create GitHub OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps > New OAuth App
2. Set the callback URL to `https://your-worker.workers.dev/auth/github/callback`
3. Note your Client ID and Client Secret

### 2. Create D1 Database

```bash
wrangler d1 create todolist-db
```

Update `wrangler.toml` with the returned database_id.

### 3. Run Database Migrations

```bash
npm run db:migrate        # Local
npm run db:migrate:prod   # Production
```

### 4. Set Secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

### 5. Update APP_URL

Edit `wrangler.toml` and set `APP_URL` to your production URL.

## Development

```bash
npm install
npm run dev
```

Local server runs at http://localhost:8787

## Deployment

```bash
npm run deploy
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Web UI |
| GET | `/auth/github` | Initiate GitHub login |
| GET | `/auth/github/callback` | OAuth callback |
| GET | `/auth/logout` | Logout |
| GET | `/api/todos` | List todos |
| POST | `/api/todos` | Create todo |
| PATCH | `/api/todos/:id` | Update todo |
| DELETE | `/api/todos/:id` | Delete todo |
