# DepLens

Analyze the true cost of any dependency across ecosystems. A free, open-source alternative to bundlephobia that adds contextual health scoring, dependency tree attribution, security analysis via OSV, and support for npm, PyPI, and Maven.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev:all
```

That is everything. `npm run dev:all` will:

1. Check that Postgres and Redis are reachable — and if they are not, start them
   with Docker (`docker-compose.dev.yml`) using the credentials from your
   `DATABASE_URL`, waiting until they report healthy.
2. Apply any pending database migrations.
3. Run the **web server and the analysis worker together**, with prefixed output.
   Ctrl-C stops both.

The app comes up at [http://localhost:3000](http://localhost:3000) (set `PORT` to
change it).

> Running the worker is not optional. It is what consumes analysis jobs — start
> the web server alone and every search queues a job that nothing will pick up,
> leaving the page waiting on a result that never arrives.

If you already run Postgres and Redis natively, `dev:all` detects them and leaves
them alone; Docker is only a fallback.

---

## Manual setup

Prefer to run each piece yourself, or not use Docker at all? The steps below are
what `dev:all` automates.

### 1. Install PostgreSQL and Redis

**macOS (Homebrew):**

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

Add the PostgreSQL binaries to your PATH (add this to your `~/.zshrc` or `~/.bashrc`):

```bash
# Apple Silicon (M1/M2/M3):
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
# Intel:
export PATH="/usr/local/opt/postgresql@16/bin:$PATH"
```

Then reload your shell:

```bash
source ~/.zshrc
```

**Other platforms:** install [PostgreSQL](https://www.postgresql.org/download/) 14+ and [Redis](https://redis.io/docs/getting-started/) 7+ via your package manager or the official installers.

### 2. Create the database

```bash
createdb deplens
```

### 3. Install Node dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env.local` file in the project root:

```bash
DATABASE_URL=postgresql://localhost:5432/deplens
REDIS_URL=redis://localhost:6379
```

### 5. Create the database tables

```bash
npm run db:push
```

### 6. Start the services

You need two processes running simultaneously — open two terminal windows.
(Or skip this and run `npm run dev:all`, which starts both in one terminal.)

**Terminal 1 — web server:**

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

**Terminal 2 — analysis worker:**

```bash
npm run worker
```

The worker connects to Redis and processes package analysis jobs. Without it, searches will queue but never complete. It reads `.env.local` via Node's `--env-file` flag before any modules load, which is necessary because the database client initializes at import time.

## How it works

1. Search for a package on the homepage and select an ecosystem (npm, PyPI, or Maven).
2. The web server checks the database cache. On a cache miss, it enqueues a job and returns a `pending` state.
3. The worker picks up the job, runs the analysis (fetches registry metadata, bundles with esbuild for npm, measures sizes, queries OSV for CVEs), and writes results to the database.
4. The UI polls every 3 seconds until the result is ready, then renders the package detail page with health score, bundle size breakdown, dependency tree, and security panel.

Results are cached for 6 hours and refreshed in the background on subsequent visits.

## Other commands

```bash
npm run dev:all            # Everything: services, migrations, web + worker
npm run dev:services       # Just start Postgres + Redis in Docker
npm run dev:services:down  # Stop them (add -v to drop the volume)
npm run build        # Production build
npm run test         # Run tests
npm run lint         # ESLint
npm run check        # Prettier + ESLint fix
npm run db:studio    # Open Drizzle Studio (visual DB browser)
```
