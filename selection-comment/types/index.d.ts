export type Pending = { text: string; requestId?: string; isEditing: boolean }

// A comment as the prompt box's short token stands for it; its note lives in
// the token, so the person can edit it in place.
export type Stored = { id: string; text: string; source?: string; context?: string }

// What the draft shows of the comments: short tokens, full blocks, or none.
export type View = 'tokens' | 'blocks' | null

declare module 'claude-code' {
  interface PluginState {
    'selection-comment': {
      pending: Pending | null
      count: number
      comments: Record<string, Stored>
      view: View
    }
  }
}
