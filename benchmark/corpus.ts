/**
 * Benchmark corpus — packages chosen to stress different measurement paths,
 * not just popular ones.
 *
 * Each axis exists because it exercises something different in the analyzer:
 *
 *   tiny        fixed overhead dominates, so small absolute differences show up
 *               as large ratios (nanoid measured 0.83x against bundlephobia)
 *   client      the ordinary case — a real browser bundle to compare
 *   heavy       multi-MB bundles where install and bundle timeouts bite
 *   ui          wide peerDependency sets, which drive the externals list
 *   server      imports Node built-ins; we report serverOnly where
 *               bundlephobia polyfills and reports a number (see README)
 *   tooling     usually unbundleable by both tools — agreement on failure is
 *               itself a useful signal
 *   scoped      @scope/name encoding in registry URLs
 *   esm         ESM-only publishes
 *   cjs         legacy CommonJS-only publishes
 *   deeptree    large transitive graphs, where dep resolution dominates
 *   deprecated  deprecated packages still need to measure
 */

export interface CorpusEntry {
  name: string
  tags: readonly string[]
  /** Why this package earns a slot, where it is not obvious. */
  note?: string
}

export const CORPUS: readonly CorpusEntry[] = [
  // ─── Tiny utilities ────────────────────────────────────────────────────────
  {
    name: 'nanoid',
    tags: ['tiny', 'client', 'esm'],
    note: 'measured 0.83x — fixed overhead dominates',
  },
  { name: 'clsx', tags: ['tiny', 'client'] },
  { name: 'ms', tags: ['tiny', 'cjs'] },
  { name: 'mitt', tags: ['tiny', 'client', 'esm'] },
  { name: 'tiny-invariant', tags: ['tiny', 'client'] },
  { name: 'lodash.get', tags: ['tiny', 'cjs'], note: 'measured 1.20x' },
  { name: 'classnames', tags: ['tiny', 'client'] },
  { name: 'uuid', tags: ['tiny', 'client'] },
  { name: 'debug', tags: ['tiny', 'cjs'] },
  { name: 'kleur', tags: ['tiny'] },

  // ─── Popular client libraries ──────────────────────────────────────────────
  {
    name: 'react',
    tags: ['client', 'popular'],
    note: 'in ALWAYS_EXTERNAL — regression guard for the self-external bug',
  },
  { name: 'react-dom', tags: ['client', 'popular', 'heavy'] },
  { name: 'vue', tags: ['client', 'popular'] },
  { name: 'preact', tags: ['client', 'tiny'] },
  { name: 'svelte', tags: ['client', 'tooling'] },
  { name: 'solid-js', tags: ['client'] },
  { name: 'lodash', tags: ['client', 'popular', 'cjs'] },
  { name: 'axios', tags: ['client', 'popular'] },
  { name: 'zod', tags: ['client', 'popular', 'esm'] },
  { name: 'date-fns', tags: ['client', 'popular'] },
  { name: 'dayjs', tags: ['client', 'tiny'] },
  { name: 'rxjs', tags: ['client', 'heavy'] },
  { name: 'immer', tags: ['client'] },
  { name: 'redux', tags: ['client', 'tiny'] },
  { name: '@reduxjs/toolkit', tags: ['client', 'scoped'] },
  { name: 'zustand', tags: ['client', 'tiny'] },
  { name: 'jotai', tags: ['client', 'tiny'] },
  { name: 'valtio', tags: ['client', 'tiny'] },
  { name: 'swr', tags: ['client'] },
  { name: 'ky', tags: ['client', 'tiny', 'esm'] },

  // ─── UI component libraries (wide peer deps) ───────────────────────────────
  { name: '@mui/material', tags: ['ui', 'scoped', 'heavy'] },
  { name: 'antd', tags: ['ui', 'heavy', 'deeptree'] },
  { name: '@chakra-ui/react', tags: ['ui', 'scoped', 'heavy'] },
  { name: 'react-bootstrap', tags: ['ui'] },
  { name: '@radix-ui/react-dialog', tags: ['ui', 'scoped'] },
  { name: '@radix-ui/react-select', tags: ['ui', 'scoped'] },
  { name: 'framer-motion', tags: ['ui', 'heavy'] },
  { name: 'react-select', tags: ['ui'] },
  { name: 'react-day-picker', tags: ['ui'] },
  { name: 'cmdk', tags: ['ui', 'tiny'] },
  {
    name: 'lucide-react',
    tags: ['ui', 'heavy'],
    note: 'huge icon set — tree-shaking differences show here',
  },
  { name: 'react-icons', tags: ['ui', 'heavy'] },
  { name: '@headlessui/react', tags: ['ui', 'scoped'] },
  { name: 'react-hook-form', tags: ['ui', 'client'] },
  { name: '@tanstack/react-table', tags: ['ui', 'scoped'] },

  // ─── Heavy client bundles ──────────────────────────────────────────────────
  {
    name: 'three',
    tags: ['heavy', 'client'],
    note: 'measured 1.03x — best agreement of the set',
  },
  { name: 'chart.js', tags: ['heavy', 'client'] },
  { name: 'd3', tags: ['heavy', 'client', 'deeptree'] },
  { name: 'moment', tags: ['heavy', 'client', 'cjs', 'deprecated'] },
  { name: 'pdfjs-dist', tags: ['heavy', 'client'] },
  { name: 'echarts', tags: ['heavy', 'client'] },
  { name: 'plotly.js', tags: ['heavy', 'client'] },
  { name: 'monaco-editor', tags: ['heavy', 'client'] },
  { name: 'katex', tags: ['heavy', 'client'] },
  { name: 'highlight.js', tags: ['heavy', 'client'] },
  {
    name: 'core-js',
    tags: ['heavy', 'cjs'],
    note: 'polyfill bundle — pathological for tree-shaking',
  },
  {
    name: '@faker-js/faker',
    tags: ['heavy', 'scoped'],
    note: 'measured 1.34x minified — largest outlier so far',
  },

  // ─── Server-side (expect serverOnly on our side) ───────────────────────────
  {
    name: 'express',
    tags: ['server'],
    note: 'bundlephobia polyfills and reports 241 kB; we report serverOnly',
  },
  { name: 'koa', tags: ['server'] },
  { name: 'fastify', tags: ['server', 'deeptree'] },
  { name: 'pg', tags: ['server'] },
  { name: 'mysql2', tags: ['server'] },
  { name: 'mongoose', tags: ['server', 'heavy'] },
  { name: 'ioredis', tags: ['server'] },
  { name: 'bullmq', tags: ['server'] },
  { name: 'winston', tags: ['server'] },
  { name: 'pino', tags: ['server'] },
  { name: 'drizzle-orm', tags: ['server'] },
  { name: 'prisma', tags: ['server', 'heavy'] },
  { name: 'node-fetch', tags: ['server', 'tiny'] },
  { name: 'dotenv', tags: ['server', 'tiny'] },
  { name: 'jsonwebtoken', tags: ['server'] },
  {
    name: 'bcrypt',
    tags: ['server'],
    note: 'native addon — install may behave differently',
  },
  {
    name: 'sharp',
    tags: ['server', 'heavy'],
    note: 'native binaries; large install',
  },
  { name: 'nodemailer', tags: ['server'] },

  // ─── Build tooling (often unbundleable by both) ────────────────────────────
  { name: 'webpack', tags: ['tooling', 'server', 'deeptree'] },
  { name: 'rollup', tags: ['tooling', 'server'] },
  { name: 'esbuild', tags: ['tooling', 'server'] },
  { name: 'vite', tags: ['tooling', 'server'] },
  { name: 'typescript', tags: ['tooling', 'server', 'heavy'] },
  { name: 'eslint', tags: ['tooling', 'server', 'deeptree'] },
  { name: 'prettier', tags: ['tooling', 'server'] },
  {
    name: 'jest',
    tags: ['tooling', 'server'],
    note: 'bundlephobia returns BuildError — agreement on failure',
  },
  { name: 'vitest', tags: ['tooling', 'server'] },
  { name: 'tsx', tags: ['tooling', 'server'] },
  {
    name: 'gatsby',
    tags: ['tooling', 'server', 'deeptree'],
    note: 'ships untranspiled JSX in .js — needs the jsx loader',
  },
  { name: '@angular/cli', tags: ['tooling', 'server', 'scoped', 'deeptree'] },

  // ─── Scoped packages ───────────────────────────────────────────────────────
  {
    name: '@capitaltg/vero',
    tags: ['scoped', 'ui'],
    note: 'the package that started all of this',
  },
  { name: '@tanstack/react-query', tags: ['scoped', 'client'] },
  { name: '@babel/core', tags: ['scoped', 'server', 'deeptree'] },
  { name: '@octokit/rest', tags: ['scoped', 'server'] },
  { name: '@sentry/browser', tags: ['scoped', 'client'] },
  {
    name: '@aws-sdk/client-s3',
    tags: ['scoped', 'server', 'heavy', 'deeptree'],
  },
  { name: '@emotion/react', tags: ['scoped', 'client'] },
  { name: '@floating-ui/dom', tags: ['scoped', 'client', 'tiny'] },

  // ─── ESM-only ──────────────────────────────────────────────────────────────
  { name: 'chalk', tags: ['esm', 'tiny'] },
  { name: 'execa', tags: ['esm', 'server'] },
  { name: 'got', tags: ['esm', 'server'] },
  { name: 'p-limit', tags: ['esm', 'tiny'] },
  { name: 'ora', tags: ['esm', 'server'] },

  // ─── Legacy CJS / deprecated ───────────────────────────────────────────────
  { name: 'underscore', tags: ['cjs', 'client'] },
  { name: 'jquery', tags: ['cjs', 'client', 'popular'] },
  { name: 'bluebird', tags: ['cjs', 'deprecated'] },
  {
    name: 'request',
    tags: ['cjs', 'deprecated', 'server'],
    note: 'long deprecated — deprecation flag should surface',
  },
  { name: 'left-pad', tags: ['tiny', 'cjs', 'deprecated'] },

  // ─── Deep dependency trees ─────────────────────────────────────────────────
  { name: 'firebase', tags: ['deeptree', 'heavy', 'client'] },
  {
    name: 'next',
    tags: ['deeptree', 'server', 'tooling'],
    note: 'bundlephobia blocklists it entirely',
  },
  { name: 'storybook', tags: ['deeptree', 'tooling', 'server'] },
]

export const ALL_TAGS = [...new Set(CORPUS.flatMap((e) => e.tags))].sort()

export function filterCorpus(tags?: string[]): readonly CorpusEntry[] {
  if (!tags || tags.length === 0) return CORPUS
  return CORPUS.filter((e) => tags.some((t) => e.tags.includes(t)))
}
