export type Pending = { text: string; requestId?: string; isEditing: boolean }

declare module 'claude-code' {
  interface PluginState {
    'selection-comment': { pending: Pending | null; count: number }
  }
}
