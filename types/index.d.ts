export type Scope = 'global' | 'project'

declare module 'claude-code' {
  interface PluginState {
    todo: {
      tab: Scope
      selected: number | null
      editing: boolean
    }
  }
}
