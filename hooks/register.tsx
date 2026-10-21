import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ctx, Limit } from '../types'

const limits = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])
const ctxAtom = atom({ plugin: 'usage-limits', key: 'ctx' } as const, null as Ctx | null)
const effortAtom = atom({ plugin: 'usage-limits', key: 'effort' } as const, null as string | null)

// Survives /clear, which resets the atoms but not the module
const last = { effort: null as string | null, resets: {} as Record<string, string | undefined> }

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '1w' }

const bar = (pct: number) => {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const color = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green')

const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`)

const remaining = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}d${h}h` : h > 0 ? `${h}h${m}m` : `${m}m`
}

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    const level = e.effort === undefined ? null : String(e.effort)
    if (level !== (await read($, effortAtom))) await update($, effortAtom, () => level)
    return yield* next(e)
  })

  // /effort and /model change effort without a turn: refresh right after they run
  for (const command of ['effort', 'model']) {
    on('command.run', { command }, async ($, e, next) => {
      const res = await next(e)
      const arg = e.args.trim().toLowerCase()
      const fullModel = await $.session.model()
      const cfg = (await $.settings.read()) as {
        effortLevel?: string
        modelSettings?: Record<string, { effortLevel?: string }>
      }
      const fromCfg = cfg.modelSettings?.[fullModel]?.effortLevel ?? cfg.effortLevel ?? null
      const level = command === 'effort' && LEVELS.includes(arg) ? arg : fromCfg
      last.effort = level
      await update($, effortAtom, () => level)
      $.ui.invalidate('ui.render')
      return res
    })
  }

  on('session.start', async ($, e, next) => {
    const u = await $.session.usage()
    await update($, limits, () => u.rateLimits)
    await update($, ctxAtom, () => u.context)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits)
    if (e.changed.includes('context')) await update($, ctxAtom, () => e.context)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const known = await read($, limits)
    const now = await $.clock.now()
    const all = Object.keys(LABELS).map(kind => {
      const l = known.find(k => k.kind === kind)
      if (l?.resetsAt) last.resets[kind] = l.resetsAt
      if (l) return l
      const prev = last.resets[kind]
      return { kind, percentUsed: 0, resetsAt: prev && Date.parse(prev) > now ? prev : undefined } as Limit
    })
    const ctx = await read($, ctxAtom)
    const effortNow = await read($, effortAtom)
    if (effortNow) last.effort = effortNow
    const fullModel = await $.session.model()
    let effort = effortNow ?? last.effort
    if (!effort) {
      // Before the first turn no step has reported effort yet: use the configured one
      const cfg = (await $.settings.read()) as {
        effortLevel?: string
        modelSettings?: Record<string, { effortLevel?: string }>
      }
      effort = cfg.modelSettings?.[fullModel]?.effortLevel ?? cfg.effortLevel ?? null
    }
    const model = fullModel.replace(/^claude-/, '')
    const ctxTokens = ctx?.tokens ?? 0
    const ctxPercent = ctx?.percent ?? 0
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box paddingTop={1} paddingLeft={1}>
        <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text>
          <Text bold>{model}</Text>
          {effort ? <Text dimColor> · {effort}</Text> : null}
          <Text dimColor> </Text>
          {all.map(l => (
            <Text key={l.kind}>
              <Text dimColor>│ {LABELS[l.kind]} </Text>
              <Text color={color(l.percentUsed)}>{bar(l.percentUsed)} {l.percentUsed}%</Text>
              <Text dimColor> ↻{remaining(l.resetsAt, now)} </Text>
            </Text>
          ))}
          <Text>
            <Text dimColor>│ ctx </Text>
            <Text color={color(ctxPercent)}>
              {bar(ctxPercent)} {ctxPercent}% · {tok(ctxTokens)}{ctx ? `/${tok(ctx.window)}` : ''}
            </Text>
          </Text>
        </Text>
        </Box>
      </Box>
    )
  })
}
