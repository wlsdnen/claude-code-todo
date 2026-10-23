import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Scope } from '../types'
import { pickLang, STRINGS } from './i18n'
import type { Strings } from './i18n'
import {
  MARK,
  parseAddArgs,
  parseCommand,
  parseDue,
  parseFile,
  serializeFile,
  shortDate,
  sortTodos,
  todosOf,
  ymd,
} from './todo'
import type { Fields, Line, Priority, Todo } from './todo'

const PANE = 'todo'
const OPEN_KEY = 'paneOpen'
const TODO_FILE = /(^|\/)(todo|TODO)\.md$/

// null until the user picks a tab: the pane then opens on defaultScope.
const tab = atom({ plugin: 'todo', key: 'tab' } as const, null as Scope | null)
const selected = atom({ plugin: 'todo', key: 'selected' } as const, null as number | null)
const editing = atom({ plugin: 'todo', key: 'editing' } as const, false)

type $ = EngineInterface

const today = async ($: $) => new Date(await $.clock.now())

let stringsCache: Strings | undefined

// shortcut: read once per load (session.start refreshes it); a changed language shows after the next reload.
async function strings($: $, isFresh = false): Promise<Strings> {
  if (stringsCache && !isFresh) return stringsCache
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  stringsCache = STRINGS[pickLang(await $.settings.read({ key: 'language' }), locale)]
  return stringsCache
}

let rootCache: { cwd: string; root: string; isRepo: boolean } | undefined

async function locate($: $) {
  const cwd = await $.session.cwd()
  if (rootCache?.cwd === cwd) return rootCache
  const git = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
  const top = git.exitCode === 0 ? git.stdout.trim() : ''
  rootCache = { cwd, root: top || cwd, isRepo: !!top }
  return rootCache
}

const projectRoot = async ($: $) => (await locate($)).root

// The list used when no scope is named: the project's inside a git repo, else the global one.
const defaultScope = async ($: $): Promise<Scope> => ((await locate($)).isRepo ? 'project' : 'global')

async function pathOf($: $, scope: Scope): Promise<string> {
  if (scope === 'project') return `${await projectRoot($)}/TODO.md`
  return `${await $.env.get('HOME')}/.claude/todo.md`
}

// A displayed path never shows the home directory, so output pasted elsewhere does not carry the user name.
async function shownPath($: $, scope: Scope): Promise<string> {
  const path = await pathOf($, scope)
  const home = await $.env.get('HOME')
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

async function load($: $, scope: Scope): Promise<Line[]> {
  const path = await pathOf($, scope)
  // A read that fails for any other reason throws, so a write never replaces a file we could not read.
  return (await $.fs.exists(path)) ? parseFile(await $.fs.read(path)) : []
}

async function save($: $, scope: Scope, lines: Line[]) {
  const text = serializeFile(lines)
  await $.fs.write(await pathOf($, scope), text.endsWith('\n') ? text : `${text}\n`)
  $.ui.invalidate('ui.render')
}

const sorted = async ($: $, scope: Scope) => sortTodos(todosOf(await load($, scope)))

function insert(lines: Line[], todo: Todo) {
  let i = lines.length
  while (i > 0 && (lines[i - 1] as { raw?: string }).raw === '') i--
  lines.splice(i, 0, { todo })
}

function applyFields(todo: Todo, fields: Fields) {
  if (fields.text) todo.text = fields.text
  if (fields.priority) todo.priority = fields.priority
  if (fields.due) todo.due = fields.due
}

// Runs `fn` on the n-th item in display order and answers the list after it; `missing` when n is out of range.
async function onItem(
  $: $,
  scope: Scope,
  n: number,
  fn: (lines: Line[], todo: Todo) => Line[] | void,
): Promise<{ missing: true } | { todo: Todo; items: Todo[] }> {
  const lines = await load($, scope)
  const todo = sortTodos(todosOf(lines))[n - 1]
  if (!todo) return { missing: true }
  const saved = fn(lines, todo) ?? lines
  await save($, scope, saved)
  return { todo, items: sortTodos(todosOf(saved)) }
}

const without = (lines: Line[], todo: Todo) => lines.filter(l => !('todo' in l && l.todo === todo))

function rowText(todo: Todo, n: number, now: Date, overdue: string): string {
  const due = todo.due ? `  ${shortDate(todo.due, now)}${!todo.done && todo.due < ymd(now) ? ` ${overdue}` : ''}` : ''
  return `${n} [${todo.done ? 'x' : ' '}] ${MARK[todo.priority]} ${todo.text}${due}`
}

async function listText($: $, scope: Scope): Promise<string> {
  const now = await today($)
  const items = await sorted($, scope)
  const head = `TODO (${scope}, ${await shownPath($, scope)})`
  if (items.length === 0) return `${head}\n(empty)`
  return [head, ...items.map((t, i) => rowText(t, i + 1, now, 'overdue') + (t.memo ? `\n    ${t.memo.replace(/\n/g, '\n    ')}` : ''))].join('\n')
}

async function togglePane($: $, s: Strings): Promise<string> {
  if ((await $.ui.panes()).some(p => p.id === PANE)) {
    await $.ui.close({ id: PANE })
    return s.closed
  }
  await $.store.set(OPEN_KEY, true)
  await $.ui.open({ id: PANE, title: 'TODO' })
  return s.opened
}

async function addItem($: $, scope: Scope, fields: Fields, memo?: string): Promise<Todo> {
  const lines = await load($, scope)
  const todo: Todo = { done: false, text: fields.text, priority: fields.priority ?? 'mid' }
  if (fields.due) todo.due = fields.due
  if (memo) todo.memo = memo
  insert(lines, todo)
  await save($, scope, lines)
  return todo
}

async function position($: $, scope: Scope, todo: Todo): Promise<number> {
  const items = await sorted($, scope)
  const i = items.findIndex(t => t.text === todo.text && t.done === todo.done)
  return i + 1
}

const TOOL_DESCRIPTION = [
  "The user's persistent TODO list, kept in Markdown files: ~/.claude/todo.md (scope 'global') and TODO.md at the project's git root (scope 'project'). Without scope, the tool uses 'project' inside a git repo and 'global' elsewhere.",
  'This is NOT the session task list (TodoWrite). Use this tool only when the user asks to see or change their TODO list; never add items on your own.',
  'Items are numbered in display order (open before done, then priority high > mid > low, then due date). Call list first to get the numbers.',
  "due takes the same words as /todo: 오늘, 내일, 모레, 금요일, today, tomorrow, fri, next week, +3d, +2w, 10/25, 2026-10-25. An empty string clears due or memo.",
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: { enum: ['list', 'add', 'update', 'remove'] },
    scope: { enum: ['global', 'project'] },
    n: { type: 'integer', minimum: 1, description: 'Item number in display order (update, remove).' },
    text: { type: 'string' },
    priority: { enum: ['high', 'mid', 'low'] },
    due: { type: 'string' },
    memo: { type: 'string' },
    done: { type: 'boolean' },
  },
  required: ['action'],
}

type ToolInput = {
  action: 'list' | 'add' | 'update' | 'remove'
  scope?: Scope
  n?: number
  text?: string
  priority?: Priority
  due?: string
  memo?: string
  done?: boolean
}

async function runTool($: $, input: ToolInput): Promise<string> {
  const scope = input.scope ?? (await defaultScope($))
  const now = await today($)
  const due = input.due ? parseDue(input.due, now) : undefined
  if (input.due && !due) return `Unknown due date: ${input.due}`
  if (input.action === 'list') return listText($, scope)
  if (input.action === 'add') {
    if (!input.text?.trim()) return 'add needs text.'
    await addItem($, scope, { text: input.text.trim(), priority: input.priority, due }, input.memo)
    return listText($, scope)
  }
  if (!input.n) return `${input.action} needs n.`
  const done = await onItem($, scope, input.n, (lines, todo) => {
    if (input.action === 'remove') return without(lines, todo)
    applyFields(todo, { text: input.text?.trim() ?? '', priority: input.priority, due })
    if (input.due === '') delete todo.due
    if (input.memo !== undefined) input.memo ? (todo.memo = input.memo) : delete todo.memo
    if (input.done !== undefined) todo.done = input.done
  })
  return 'missing' in done ? `No item ${input.n} in the ${scope} list.` : listText($, scope)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const s = await strings($, true)
    await $.command.register({ name: 'todo', description: s.description, argumentHint: s.argumentHint })
    await $.tool.register({ name: 'todo', description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    if ((await $.store.get(OPEN_KEY)) === true) void $.ui.open({ id: PANE, title: 'TODO' })
    return started
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind !== 'unload') await $.store.set(OPEN_KEY, false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'todo' }, async ($, e) => {
    const now = await today($)
    const s = await strings($)
    const cmd = parseCommand(e.args, now, await defaultScope($))
    if (cmd.kind === 'toggle') return { text: await togglePane($, s) }
    if (cmd.kind === 'error') return { text: s[cmd.code] }
    if (cmd.kind === 'unknown') return { text: s.unknown(cmd.verb) }
    const where = `(${s[cmd.scope]})`
    if (cmd.kind === 'add') {
      const todo = await addItem($, cmd.scope, cmd.fields)
      return { text: `+ ${rowText(todo, await position($, cmd.scope, todo), now, s.overdue)}   ${where}` }
    }
    const done = await onItem($, cmd.scope, cmd.n, (lines, todo) => {
      if (cmd.kind === 'rm') return without(lines, todo)
      if (cmd.kind === 'edit') applyFields(todo, cmd.fields)
      else todo.done = true
    })
    if ('missing' in done) return { text: s.missing(s[cmd.scope], cmd.n) }
    const verb = cmd.kind === 'rm' ? s.remove : cmd.kind === 'done' ? s.done : s.edit
    return { text: `${verb}: ${done.todo.text}   ${where}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await today($)
    const open = sortTodos([...todosOf(await load($, 'project')), ...todosOf(await load($, 'global'))]).filter(t => !t.done)
    const first = open[0]
    if (!first) return next(e)
    const overdue = open.filter(t => t.due && t.due < ymd(now)).length
    const s = await strings($)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text wrap="truncate-end">
          <Text dimColor>TODO </Text>
          <Text bold>{s.left(open.length)}</Text>
          <Text dimColor> · </Text>
          {s.next} {first.text}
          {overdue > 0 && <Text color="error"> · {s.overdueCount(overdue)}</Text>}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The mobile surface draws no Input: there the pane is read and pressed only.
    const Input = 'Input' in elements ? elements.Input : undefined
    const now = await today($)
    const s = await strings($)
    const scope = (await read($, tab)) ?? (await defaultScope($))
    const picked = await read($, selected)
    const isEditing = await read($, editing)
    const items = await sorted($, scope)
    const pick = picked !== null && picked <= items.length ? picked : null
    const root = await projectRoot($)
    // Every press leaves a row selected, so d/e/x stay drawn and the pane keeps the keys, and moves the ring onto it.
    // The selected row is keyed `sel-N`, a key the drawing before the press lacks: $.ui.focus then waits for the
    // new drawing instead of landing on the old one, which the following redraw re-places (onto Delete).
    // shortcut: the move is best-effort (the test kit cannot answer it); the kept selection is what holds the keys.
    const moveRing = (key: string) => $.ui.focus({ requestId: PANE, key }).catch(() => undefined)
    const focusRow = async (n: number | null) => {
      await update($, selected, () => n)
      await moveRing(n ? `sel-${n}` : 'add')
    }
    const setTab = (next: Scope) => async () => {
      await update($, tab, () => next)
      await update($, editing, () => false)
      await focusRow((await sorted($, next)).length > 0 ? 1 : null)
    }
    const act = (n: number, fn: (lines: Line[], todo: Todo) => Line[] | void) => async () => {
      await update($, editing, () => false)
      const done = await onItem($, scope, n, fn)
      if ('missing' in done) return focusRow(null)
      const at = done.items.indexOf(done.todo)
      await focusRow(at >= 0 ? at + 1 : Math.min(n, done.items.length) || null)
    }
    // Where the ring starts when the pane takes the keyboard: the edit field, the selected row, the first row, else the add field.
    const startKey = isEditing && pick ? 'edit' : pick ? `sel-${pick}` : items.length > 0 ? 'row-1' : 'add'
    const auto = (key: string) => (key === startKey ? (true as const) : undefined)

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="tab-global" label={s.global} variant={scope === 'global' ? 'primary' : 'secondary'} onPress={setTab('global')} />
          <Text> </Text>
          <Button
            key="tab-project"
            label={`${s.project} (${root.split('/').at(-1)})`}
            variant={scope === 'project' ? 'primary' : 'secondary'}
            onPress={setTab('project')}
          />
        </Box>
        {items.length === 0 && <Text dimColor>{s.empty}</Text>}
        {items.map((todo, i) => {
          const n = i + 1
          const isOverdue = !todo.done && !!todo.due && todo.due < ymd(now)
          const rowKey = pick === n ? `sel-${n}` : `row-${n}`
          const row = (
            <Button
              key={rowKey}
              plain
              autoFocus={auto(rowKey)}
              dimColor={todo.done}
              onPress={async () => {
                await update($, editing, () => false)
                await update($, selected, () => (pick === n ? null : n))
                await moveRing(pick === n ? `row-${n}` : `sel-${n}`)
              }}
            >
              {pick === n ? '▶ ' : '  '}[{todo.done ? 'x' : ' '}] <Text color={todo.priority === 'high' ? 'error' : todo.priority === 'mid' ? 'warning' : 'subtle'}>{MARK[todo.priority]}</Text> {todo.text}
              {todo.due && <Text color={isOverdue ? 'error' : 'warning'}>  {shortDate(todo.due, now)}{isOverdue ? ` ${s.overdue}` : ''}</Text>}
            </Button>
          )
          if (pick !== n) return row
          const line = [todo.text, todo.priority === 'mid' ? '' : `!${todo.priority}`, todo.due ?? ''].filter(Boolean).join(' ')
          return (
            <Box key={`open-${n}`} flexDirection="column">
              {row}
              {isEditing && Input ? (
                <Box flexDirection="column">
                  <Input
                    key="edit"
                    label={s.editLabel}
                    value={line}
                    autoFocus={auto('edit')}
                    onSubmit={(value: string) =>
                      act(n, (_, t) => {
                        const fields = parseAddArgs(value, now)
                        if (!fields.text) return
                        t.text = fields.text
                        t.priority = fields.priority ?? 'mid'
                        if (fields.due) t.due = fields.due
                        else delete t.due
                      })()
                    }
                  />
                  <Input
                    key="memo"
                    label={s.memoLabel}
                    value={todo.memo ?? ''}
                    rows={2}
                    onSubmit={(value: string) =>
                      act(n, (_, t) => {
                        if (value.trim()) t.memo = value.trimEnd()
                        else delete t.memo
                      })()
                    }
                  />
                  <Text dimColor>{s.editHint}</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  {todo.memo && <Text dimColor>    {todo.memo}</Text>}
                  <Box>
                    <Text>    </Text>
                    <Button key="done" hotkey="d" label={todo.done ? s.undone : s.done} onPress={act(n, (_, t) => void (t.done = !t.done))} />
                    <Text> </Text>
                    {Input && <Button key="edit-start" hotkey="e" label={s.edit} onPress={async () => {
                      await update($, editing, () => true)
                      await moveRing('edit')
                    }} />}
                    <Text> </Text>
                    <Button key="remove" hotkey="x" label={s.remove} onPress={act(n, without)} />
                  </Box>
                </Box>
              )}
            </Box>
          )
        })}
        {Input && (
        <Input
          key="add"
          autoFocus={auto('add')}
          placeholder={s.addPlaceholder}
          submitLabel={s.addSubmit}
          onSubmit={async (value: string) => {
            const fields = parseAddArgs(value, now)
            if (fields.text) await addItem($, scope, fields)
          }}
        />
        )}
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'mcp__todo__todo') {
      return { result: await runTool($, e as unknown as ToolInput) }
    }
    const ran = await next(e)
    if ((e.tool === 'Write' || e.tool === 'Edit') && TODO_FILE.test(e.file_path)) $.ui.invalidate('ui.render')
    return ran
  }).catch(($, e, next) => next(e))
}
