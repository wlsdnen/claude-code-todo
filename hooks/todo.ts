import type { Scope } from '../types'

export type Priority = 'high' | 'mid' | 'low'

export type Todo = {
  done: boolean
  text: string
  priority: Priority
  due?: string
  memo?: string
}

// A file is its lines in order; lines that are not items are kept verbatim.
export type Line = { todo: Todo } | { raw: string }

export type Fields = { text: string; priority?: Priority; due?: string }

export type Command =
  | { kind: 'toggle' }
  | { kind: 'add'; scope: Scope; fields: Fields }
  | { kind: 'done' | 'rm'; scope: Scope; n: number }
  | { kind: 'edit'; scope: Scope; n: number; fields: Fields }
  | { kind: 'error'; code: 'usageAdd' | 'usageDoneRm' | 'usageEdit' }
  | { kind: 'unknown'; verb: string }

const ITEM = /^- \[( |x|X)\] (.*)$/
const PRIORITY = /(?:^|\s)!(high|mid|low)(?=\s|$)/
const DUE = /(?:^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/
const RANK: Record<Priority, number> = { high: 0, mid: 1, low: 2 }

export function parseFile(text: string): Line[] {
  const lines: Line[] = []
  for (const line of text.split('\n')) {
    const last = lines.at(-1)
    if (last && 'todo' in last && line.startsWith('  ') && line.trim()) {
      const memo = line.slice(2)
      last.todo.memo = last.todo.memo === undefined ? memo : `${last.todo.memo}\n${memo}`
      continue
    }
    const m = ITEM.exec(line)
    if (!m) {
      lines.push({ raw: line })
      continue
    }
    let rest = m[2] ?? ''
    const priority = PRIORITY.exec(rest)?.[1] as Priority | undefined
    const due = DUE.exec(rest)?.[1]
    rest = rest.replace(PRIORITY, ' ').replace(DUE, ' ').replace(/\s+/g, ' ').trim()
    const todo: Todo = { done: m[1] !== ' ', text: rest, priority: priority ?? 'mid' }
    if (due) todo.due = due
    lines.push({ todo })
  }
  return lines
}

export function serializeTodo(t: Todo): string {
  let line = `- [${t.done ? 'x' : ' '}] ${t.text}`
  if (t.priority !== 'mid') line += ` !${t.priority}`
  if (t.due) line += ` due:${t.due}`
  const memo = t.memo ? t.memo.split('\n').map(m => `\n  ${m}`).join('') : ''
  return line + memo
}

export function serializeFile(lines: Line[]): string {
  return lines.map(l => ('todo' in l ? serializeTodo(l.todo) : l.raw)).join('\n')
}

export const todosOf = (lines: Line[]): Todo[] =>
  lines.flatMap(l => ('todo' in l ? [l.todo] : []))

export function sortTodos(items: readonly Todo[]): Todo[] {
  return [...items].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      RANK[a.priority] - RANK[b.priority] ||
      (a.due ?? '9999').localeCompare(b.due ?? '9999'),
  )
}

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const WEEKDAYS: string[][] = [
  ['일요일', 'sun', 'sunday'],
  ['월요일', 'mon', 'monday'],
  ['화요일', 'tue', 'tuesday'],
  ['수요일', 'wed', 'wednesday'],
  ['목요일', 'thu', 'thursday'],
  ['금요일', 'fri', 'friday'],
  ['토요일', 'sat', 'saturday'],
]
const OFFSETS: Record<string, number> = { 오늘: 0, today: 0, 내일: 1, tomorrow: 1, 모레: 2, 'next week': 7 }

// Weekday words mean the next one after today; M/D already past rolls to next year.
export function parseDue(word: string, today: Date): string | undefined {
  const w = word.trim().toLowerCase()
  const offset = OFFSETS[w]
  if (offset !== undefined) return ymd(addDays(today, offset))
  const rel = /^\+(\d+)([dw])$/.exec(w)
  if (rel) return ymd(addDays(today, Number(rel[1]) * (rel[2] === 'w' ? 7 : 1)))
  const day = WEEKDAYS.findIndex(names => names.includes(w))
  if (day >= 0) return ymd(addDays(today, ((day - today.getDay() + 6) % 7) + 1))
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w)
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const md = /^(\d{1,2})\/(\d{1,2})$/.exec(w)
  if (md) {
    const thisYear = validDate(today.getFullYear(), Number(md[1]), Number(md[2]))
    if (!thisYear || thisYear >= ymd(today)) return thisYear
    return validDate(today.getFullYear() + 1, Number(md[1]), Number(md[2]))
  }
  return undefined
}

function validDate(y: number, m: number, d: number): string | undefined {
  const date = new Date(y, m - 1, d)
  return date.getMonth() === m - 1 && date.getDate() === d ? ymd(date) : undefined
}

// Priority and due words are read only at the end, so "내일 회의 준비" keeps its text.
export function parseAddArgs(input: string, today: Date): Fields {
  const words = input.trim().split(/\s+/).filter(Boolean)
  const fields: Fields = { text: '' }
  while (words.length > 1) {
    const last = words.at(-1) ?? ''
    const pair = words.slice(-2).join(' ')
    const p = /^!(high|mid|low)$/.exec(last)?.[1] as Priority | undefined
    if (p && !fields.priority) {
      fields.priority = p
      words.pop()
    } else if (!fields.due && parseDue(pair, today)) {
      fields.due = parseDue(pair, today)
      words.splice(-2)
    } else if (!fields.due && parseDue(last, today)) {
      fields.due = parseDue(last, today)
      words.pop()
    } else break
  }
  fields.text = words.join(' ')
  return fields
}

const toIndex = (s: string | undefined): number => (s && /^\d+$/.test(s) ? Number(s) : NaN)

// -p picks the project list and -g the global one; with neither, fallback.
export function parseCommand(args: string, today: Date, fallback: Scope): Command {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const scope: Scope = words.includes('-p') ? 'project' : words.includes('-g') ? 'global' : fallback
  const [verb, ...rest] = words.filter(w => w !== '-p' && w !== '-g')
  if (!verb) return { kind: 'toggle' }
  if (verb === 'add') {
    const fields = parseAddArgs(rest.join(' '), today)
    return fields.text ? { kind: 'add', scope, fields } : { kind: 'error', code: 'usageAdd' }
  }
  if (verb !== 'done' && verb !== 'rm' && verb !== 'edit') return { kind: 'unknown', verb }
  const n = toIndex(rest[0])
  if (Number.isNaN(n) || n < 1) return { kind: 'error', code: verb === 'edit' ? 'usageEdit' : 'usageDoneRm' }
  if (verb === 'edit') return { kind: 'edit', scope, n, fields: parseAddArgs(rest.slice(1).join(' '), today) }
  return { kind: verb, scope, n }
}

// M/D for display; the year shows only when it differs from today's.
export function shortDate(due: string, today: Date): string {
  const [y, m, d] = due.split('-')
  return `${y === String(today.getFullYear()) ? '' : `${y}/`}${Number(m)}/${Number(d)}`
}

export const MARK: Record<Priority, string> = { high: '!!!', mid: '!! ', low: '!  ' }
