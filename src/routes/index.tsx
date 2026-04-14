import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchRegistry, type RegistryResult } from '../server/search'

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

const LISTBOX_ID = 'search-listbox'
const optionId = (i: number) => `search-option-${i}`

function HomePage() {
  const navigate = useNavigate()
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm')
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<RegistryResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  // Debounced registry search
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      setIsOpen(false)
      setActiveIndex(-1)
      return
    }

    setIsSearching(true)
    const timer = setTimeout(async () => {
      try {
        const results = await searchRegistry({
          data: { ecosystem, query: trimmed },
        })
        setSuggestions(results)
        if (results.length > 0 && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          setDropdownStyle({
            position: 'fixed',
            top: rect.bottom + 6,
            left: rect.left,
            width: rect.width,
            maxHeight: window.innerHeight - rect.bottom - 16,
            overflowY: 'auto',
            zIndex: 50,
          })
        }
        setIsOpen(results.length > 0)
      } catch {
        setSuggestions([])
        setIsOpen(false)
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      setIsSearching(false)
    }
  }, [query, ecosystem])

  // Close dropdown when ecosystem changes
  useEffect(() => {
    setSuggestions([])
    setIsOpen(false)
    setActiveIndex(-1)
  }, [ecosystem])

  // Click outside to close
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      const listbox = document.getElementById(LISTBOX_ID)
      if (
        !containerRef.current?.contains(target) &&
        !listbox?.contains(target)
      ) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  function goTo(name: string) {
    setIsOpen(false)
    setActiveIndex(-1)
    navigate({ to: `/$ecosystem/$name`, params: { ecosystem, name } })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      goTo(suggestions[activeIndex].name)
      return
    }
    const trimmed = query.trim()
    if (!trimmed) return
    goTo(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setActiveIndex(-1)
      return
    }

    if (!isOpen || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      goTo(suggestions[activeIndex].name)
    } else if (e.key === 'Tab') {
      setIsOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <main className="page-wrap px-4 pb-16 pt-14">
      {/* Hero */}
      <section className="rise-in px-2 py-16 text-center sm:py-24">
        <p className="island-kicker mb-5">
          Analyze the true cost of any dependency
        </p>
        <h1 className="mb-5 text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
          <span className="bg-gradient-to-br from-[#4f46e5] via-[#7c3aed] to-[#6366f1] bg-clip-text text-transparent">
            Dependency Lens
          </span>
        </h1>
        <p className="mx-auto mb-10 max-w-lg text-base text-[var(--sea-ink-soft)] sm:text-lg">
          Bundle size, security vulnerabilities, maintenance health, and
          dependency attribution — across npm, PyPI, and Maven.
        </p>

        {/* Search form */}
        <form
          onSubmit={handleSubmit}
          role="search"
          aria-label="Search packages"
          className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row"
        >
          {/* Ecosystem selector */}
          <div
            role="group"
            aria-label="Ecosystem"
            className="flex rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm sm:flex-shrink-0"
          >
            {ECOSYSTEMS.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={ecosystem === e.id}
                aria-label={`Search in ${e.label}`}
                onClick={() => setEcosystem(e.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  ecosystem === e.id
                    ? 'bg-[var(--lagoon-deep)] text-white shadow-sm'
                    : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>

          {/* Input + dropdown */}
          <div ref={containerRef} className="relative flex-1">
            <div className="relative">
              <input
                ref={inputRef}
                id="package-search"
                type="text"
                role="combobox"
                aria-label="Package name"
                aria-expanded={isOpen}
                aria-autocomplete="list"
                aria-controls={LISTBOX_ID}
                aria-activedescendant={
                  activeIndex >= 0 ? optionId(activeIndex) : undefined
                }
                aria-busy={isSearching}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDERS[ecosystem]}
                autoFocus
                autoComplete="off"
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 pr-9 text-sm text-[var(--sea-ink)] shadow-sm outline-none placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon-deep)] focus:ring-2 focus:ring-[var(--lagoon-deep)]/20"
              />
              {isSearching && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <svg
                    className="h-4 w-4 animate-spin text-[var(--lagoon-deep)]"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                </span>
              )}
              {/* Screen-reader-only status for search state */}
              <span role="status" className="sr-only">
                {isSearching
                  ? 'Searching…'
                  : isOpen
                    ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} available`
                    : ''}
              </span>
            </div>

            {/* Dropdown — rendered via portal to escape overflow:hidden on the hero section */}
            {isOpen &&
              suggestions.length > 0 &&
              createPortal(
                <ul
                  id={LISTBOX_ID}
                  role="listbox"
                  aria-label="Package suggestions"
                  style={dropdownStyle}
                  className="island-shell overflow-hidden rounded-2xl p-1"
                >
                  {suggestions.map((s, i) => (
                    <li
                      key={s.name}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        goTo(s.name)
                      }}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition ${
                        i === activeIndex
                          ? 'bg-[var(--lagoon)]/20 outline outline-1 outline-[var(--lagoon-deep)]/30'
                          : 'hover:bg-[var(--surface-strong)]/60'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--sea-ink)]">
                          {s.name}
                        </span>
                        {s.version && (
                          <span className="shrink-0 rounded-md bg-[var(--lagoon)]/15 px-1.5 py-0.5 text-xs font-medium text-[var(--lagoon-deep)]">
                            {s.version}
                          </span>
                        )}
                      </div>
                      {s.description && (
                        <span className="line-clamp-2 text-xs text-[var(--sea-ink-soft)]">
                          {s.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>,
                document.body,
              )}
          </div>

          <button
            type="submit"
            disabled={!query.trim()}
            className="rounded-xl bg-[var(--lagoon-deep)] px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
          >
            Analyze
          </button>
        </form>
      </section>

      {/* Feature grid */}
      <section
        aria-label="Features"
        className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {[
          {
            icon: '⚖️',
            title: 'True bundle cost',
            desc: 'Actual gzip size after bundling, not just the npm tarball. Includes transitive dependencies.',
          },
          {
            icon: '🌳',
            title: 'Dependency attribution',
            desc: 'See exactly which dependency in the tree is responsible for the most weight.',
          },
          {
            icon: '🔒',
            title: 'Security analysis',
            desc: 'CVE lookups via the OSV database across all three ecosystems.',
          },
          {
            icon: '⭐',
            title: 'Quality score',
            desc: 'Composite A–F grade combining size, security, and maintenance freshness.',
          },
        ].map(({ icon, title, desc }, i) => (
          <article
            key={title}
            className="island-shell feature-card rise-in rounded-xl p-5"
            style={{ animationDelay: `${i * 70 + 60}ms` }}
          >
            <span aria-hidden="true" className="mb-3 block text-2xl">
              {icon}
            </span>
            <h2 className="mb-1.5 text-sm font-bold text-[var(--sea-ink)]">
              {title}
            </h2>
            <p className="m-0 text-sm leading-relaxed text-[var(--sea-ink-soft)]">
              {desc}
            </p>
          </article>
        ))}
      </section>
    </main>
  )
}
