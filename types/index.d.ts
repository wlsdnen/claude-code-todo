export type Scope = 'global' | 'project'

declare module 'claude-code' {
  interface PluginState {
    todo: {
      tab: Scope | null
      selected: number | null
      editing: boolean
    }
  }
}
