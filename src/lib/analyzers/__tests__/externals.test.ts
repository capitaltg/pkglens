import { describe, expect, it } from 'vitest'
import { buildExternals } from '../npm'

describe('buildExternals', () => {
  it('keeps host frameworks external for an unrelated package', () => {
    const externals = buildExternals('lodash')
    expect(externals).toContain('react')
    expect(externals).toContain('next')
  })

  it('never externalizes the package being measured', () => {
    // Regression: `next` is in ALWAYS_EXTERNAL, so analyzing next passed
    // --external:next and esbuild emitted a re-export stub — 19 bytes.
    expect(buildExternals('next')).not.toContain('next')
    expect(buildExternals('react')).not.toContain('react')
    expect(buildExternals('gatsby')).not.toContain('gatsby')
  })

  it('drops subpaths of the package being measured', () => {
    const externals = buildExternals('react')
    expect(externals).not.toContain('react/jsx-runtime')
    expect(externals).not.toContain('react/jsx-dev-runtime')
    // A different package that merely shares a prefix stays external.
    expect(externals).toContain('react-dom')
  })

  it('adds declared peer dependencies', () => {
    expect(buildExternals('some-lib', ['zod'])).toContain('zod')
  })

  it('does not externalize a peer dep that is the package itself', () => {
    expect(buildExternals('zod', ['zod'])).not.toContain('zod')
  })
})
