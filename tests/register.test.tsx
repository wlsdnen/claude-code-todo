import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = new Date(2026, 9, 23, 9).getTime()
const GLOBAL = '/home/u/.claude/todo.md'
const PROJECT = '/repo/TODO.md'

// root null: the session runs outside any git repo.
function world(on: On, files: Record<string, string>, language = 'Korean', root: string | null = '/repo') {
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/u', LANG: 'en_US.UTF-8' })
  on('settings.read', () => ({ value: { language } }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('session.cwd', () => ({ value: root ? '/repo/sub' : '/home/u/notes' }))
  on('process.run', () => ({
    value: { exitCode: root ? 0 : 128, stdout: root ? `${root}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', () => ({ value: { command: 'todo' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__todo__todo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const PANE = {
  plugin: 'todo',
  component: 'Pane',
  requestId: 'todo',
  props: { title: 'TODO', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const run = (args: string) =>
  ({ command: 'todo', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const

const BAND = {
  plugin: 'todo',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

test('/todo writes the project file by default in a repo, and the global file with -g', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files)
  await $.session.start({ cwd: '/repo/sub', surface: 'terminal', isInteractive: true })

  const added = await $.command.run(run('-g add 배포 체크 !high 금요일'))
  expect(added.text).toContain('배포 체크')
  expect(files[GLOBAL]).toBe('- [ ] 배포 체크 !high due:2026-10-30\n')

  await $.command.run(run('add 블로그 초안'))
  expect(files[PROJECT]).toBe('- [ ] 블로그 초안\n')

  await $.command.run(run('-g done 1'))
  expect(files[GLOBAL]).toBe('- [x] 배포 체크 !high due:2026-10-30\n')

  const missing = await $.command.run(run('-g rm 9'))
  expect(missing.text).toContain('9번')
  expect(files[PROJECT]).toBe('- [ ] 블로그 초안\n')
})

test('outside a git repo the model tool adds to the global list', async ($, on) => {
  const files: Record<string, string> = { [GLOBAL]: '# 내 할 일\n- [ ] 기존 항목\n' }
  world(on, files, 'Korean', null)
  await $.session.start({ cwd: '/repo/sub', surface: 'terminal', isInteractive: true })

  const ran = await $.tool.call({ tool: 'mcp__todo__todo', action: 'add', text: '롤백 검토', priority: 'high', due: 'tomorrow' } as never)
  expect(String(ran.result)).toContain('1 [ ] !!! 롤백 검토  10/24')
  expect(String(ran.result)).toContain('TODO (global, ~/.claude/todo.md)')
  expect(String(ran.result)).not.toContain('/home/u')
  expect(files[GLOBAL]).toBe('# 내 할 일\n- [ ] 기존 항목\n- [ ] 롤백 검토 !high due:2026-10-24\n')
})

test('the pane lists, selects, finishes and adds; the band counts', async ($, on) => {
  const files: Record<string, string> = { [GLOBAL]: '- [ ] 늦은 일 due:2026-10-20\n- [ ] 급한 일 !high\n' }
  world(on, files, 'Korean', null)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /2개 남음/ }))?.text).toContain('다음: 급한 일')
    expect(await band.find({ type: 'Text', text: /1개 마감 지남/ })).toBeDefined()
    await band.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // With nothing selected the ring starts on the first row, and only there.
  expect((await ui.find({ key: 'row-1' }))?.props.autoFocus).toBe(true)
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.autoFocus)).toHaveLength(1)

  // The kit cannot observe the ring, so these check what holds it: the pressed row stays selected and drawn.
  await ui.press({ key: 'row-1' })
  // The selected row takes the key sel-N, which the drawing before the press lacks, so $.ui.focus waits for the new one.
  expect(await ui.find({ key: 'row-1' })).toBeUndefined()
  expect((await ui.find({ key: 'sel-1' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'done' })
  expect(files[GLOBAL]).toBe('- [ ] 늦은 일 due:2026-10-20\n- [x] 급한 일 !high\n')
  // The finished item sorts to row 2; the selection follows it, so d/e/x stay drawn.
  expect((await ui.find({ key: 'sel-2' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'sel-2' }))?.text).toContain('급한 일')
  // Only the selected row is ever the start of the ring, never a Delete button.
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.autoFocus).map(b => b.key)).toEqual(['sel-2'])
  await ui.press({ key: 'done' })
  expect(files[GLOBAL]).toBe('- [ ] 늦은 일 due:2026-10-20\n- [ ] 급한 일 !high\n')
  expect((await ui.find({ key: 'sel-1' }))?.text).toContain('급한 일')

  await ui.press({ key: 'remove' })
  expect(files[GLOBAL]).toBe('- [ ] 늦은 일 due:2026-10-20\n')
  expect(await ui.find({ key: 'done' })).toBeDefined()

  await ui.press({ key: 'edit-start' })
  expect((await ui.find({ key: 'edit' }))?.props.autoFocus).toBe(true)
  await ui.input({ key: 'edit', text: '고친 일 !low' })
  expect(files[GLOBAL]).toBe('- [ ] 고친 일 !low\n')
  expect(await ui.find({ key: 'done' })).toBeDefined()

  await ui.press({ key: 'tab-project' })
  expect((await ui.find({ key: 'add' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'tab-global' })
  expect((await ui.find({ key: 'sel-1' }))?.props.autoFocus).toBe(true)
  expect(await ui.find({ key: 'done' })).toBeDefined()

  await ui.input({ key: 'add', text: '새 일 !low 내일' })
  expect(files[GLOBAL]).toBe('- [ ] 고친 일 !low\n- [ ] 새 일 !low due:2026-10-24\n')
  await ui.unmount()
})

test('UI text follows the language: English when the setting is English', async ($, on) => {
  const files: Record<string, string> = { [GLOBAL]: '- [ ] late due:2026-10-20\n' }
  world(on, files, 'English')
  await $.session.start({ cwd: '/repo/sub', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(run('-g rm 9'))).text).toBe('The global list has no item 9.')
  expect((await $.command.run(run('frobnicate'))).text).toBe('Unknown command: frobnicate. Use add, done, rm or edit.')
  expect((await $.command.run(run('-g add 회의 준비 내일'))).text).toContain('(Global)')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /2 left/ }))?.text).toContain('next: late')
  expect(await band.find({ type: 'Text', text: /1 overdue/ })).toBeDefined()
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'tab-global' }))?.text).toContain('Global')
  expect((await ui.find({ key: 'tab-project' }))?.text).toContain('Project (repo)')
  await ui.unmount()
})

test('UI text is Korean when the setting is Korean', async ($, on) => {
  world(on, {})
  await $.session.start({ cwd: '/repo/sub', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(run('-g rm 9'))).text).toBe('전역 목록에 9번 항목이 없습니다.')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // In a repo the pane opens on the project tab.
  expect((await ui.find({ key: 'tab-project' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'tab-project' }))?.text).toContain('프로젝트 (repo)')
  expect(await ui.find({ type: 'Text', text: /비어 있음/ })).toBeDefined()
  await ui.unmount()
})

test('a project path under the home directory shows as ~', async ($, on) => {
  const files: Record<string, string> = {}
  world(on, files, 'Korean', '/home/u/repo')
  await $.session.start({ cwd: '/home/u/repo', surface: 'terminal', isInteractive: true })

  const ran = await $.tool.call({ tool: 'mcp__todo__todo', action: 'list', scope: 'project' } as never)
  expect(String(ran.result)).toBe('TODO (project, ~/repo/TODO.md)\n(empty)')
})
