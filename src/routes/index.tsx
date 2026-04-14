import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({ component: HomePage })

const ECOSYSTEMS = [
  { id: 'npm', label: 'npm', description: 'JavaScript / TypeScript' },
  { id: 'pypi', label: 'PyPI', description: 'Python' },
  { id: 'maven', label: 'Maven', description: 'Java / JVM' },
] as const

type Ecosystem = (typeof ECOSYSTEMS)[number]['id']

const PLACEHOLDERS: Record<Ecosystem, string> = {
  npm: 'e.g. axios, lodash, react-query',
  pypi: 'e.g. requests, pandas, fastapi',
  maven: 'e.g. org.springframework:spring-core',
}

function HomePage() {
  const navigate = useNavigate()
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm')
  const [query, setQuery] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    navigate({ to: `/$ecosystem/$name`, params: { ecosystem, name: trimmed } })
  }

  return (
    <main className="page-wrap px-4 pb-16 pt-14">
      {/* Hero */}
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-10 sm:py-16 text-center">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />

        <p className="island-kicker mb-3">
          Analyze the true cost of any dependency
        </p>
        <h1 className="display-title mb-4 text-4xl font-bold leading-[1.05] tracking-tight text-[var(--sea-ink)] sm:text-5xl">
          DepLens
        </h1>
        <p className="mx-auto mb-10 max-w-xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          Bundle size, security vulnerabilities, maintenance health, and
          dependency attribution — across npm, PyPI, and Maven.
        </p>

        {/* Search form */}
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row"
        >
          {/* Ecosystem selector */}
          <div className="flex rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-1 sm:flex-shrink-0">
            {ECOSYSTEMS.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEcosystem(e.id)}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                  ecosystem === e.id
                    ? 'bg-[var(--lagoon-deep)] text-white shadow-sm'
                    : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>

          {/* Package name input */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDERS[ecosystem]}
            autoFocus
            className="flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon-deep)] focus:ring-2 focus:ring-[var(--lagoon-deep)]/20"
          />

          <button
            type="submit"
            disabled={!query.trim()}
            className="rounded-2xl bg-[var(--lagoon-deep)] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-40 disabled:translate-y-0"
          >
            Analyze
          </button>
        </form>
      </section>

      {/* Feature grid */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            title: 'True bundle cost',
            desc: 'Actual gzip size after bundling, not just the npm tarball. Includes transitive dependencies.',
          },
          {
            title: 'Dependency attribution',
            desc: 'See exactly which dependency in the tree is responsible for the most weight.',
          },
          {
            title: 'Security analysis',
            desc: 'CVE lookups via the OSV database across all three ecosystems.',
          },
          {
            title: 'Health score',
            desc: 'Composite A–F grade combining size, security, and maintenance freshness.',
          },
        ].map(({ title, desc }, i) => (
          <article
            key={title}
            className="island-shell feature-card rise-in rounded-2xl p-5"
            style={{ animationDelay: `${i * 90 + 80}ms` }}
          >
            <h2 className="mb-2 text-base font-semibold text-[var(--sea-ink)]">
              {title}
            </h2>
            <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{desc}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
