import type { Limit } from '../types'

// Windows reset on a fixed clock, so two readings of one window carry the same
// resetsAt up to rounding
const SAME_WINDOW_MS = 5 * 60 * 1000

const pick = (a: Limit | undefined, b: Limit | undefined): Limit | undefined => {
  if (!a || !b) return a ?? b
  const ta = a.resetsAt ? Date.parse(a.resetsAt) : NaN
  const tb = b.resetsAt ? Date.parse(b.resetsAt) : NaN
  // A later reset means a newer window, whatever the percentages say
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && Math.abs(ta - tb) > SAME_WINDOW_MS) return ta > tb ? a : b
  // Same window: usage only grows within it, so the higher reading is the later one
  return b.percentUsed > a.percentUsed ? b : a
}

// Combines two sets of readings so a stale one never wins over a fresher one
export const mergeLimits = (a: Limit[], b: Limit[]): Limit[] => {
  const kinds = [...new Set([...a, ...b].map(l => l.kind))]
  return kinds.map(kind => pick(a.find(l => l.kind === kind), b.find(l => l.kind === kind))!)
}

export const sameLimits = (a: Limit[], b: Limit[]) => JSON.stringify(a) === JSON.stringify(b)
