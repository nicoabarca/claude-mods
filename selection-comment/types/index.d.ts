export type Pending = { text: string; isEditing: boolean }

declare module 'claude-code' {
  interface PluginState {
    'selection-comment': { pending: Pending | null }
  }
}
