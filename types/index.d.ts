export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Ctx = { tokens?: number; window: number; percent?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': { limits: Limit[]; ctx: Ctx | null; effort: string | null }
  }
}
