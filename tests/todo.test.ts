import { expect, test } from 'claude-code/testing'

import { pickLang } from '../hooks/i18n'
import { parseAddArgs, parseCommand, parseDue, parseFile, serializeFile, sortTodos, todosOf } from '../hooks/todo'

// Friday, 2026-10-23
const TODAY = new Date(2026, 9, 23)

test('a file survives a parse and serialize round trip', async () => {
  const text = [
    '# TODO',
    '',
    '- [ ] PR 리뷰 답장 !high due:2026-10-25',
    '  리뷰어 질문 3개 중 2개는',
    '  코드 수정 필요',
    '- [x] 회의록 정리',
    'free note',
    '- [ ] 블로그 초안 !low',
    '',
  ].join('\n')
  const lines = parseFile(text)
  expect(serializeFile(lines)).toBe(text)
  const [pr, notes, blog] = todosOf(lines)
  expect(pr).toEqual({ done: false, text: 'PR 리뷰 답장', priority: 'high', due: '2026-10-25', memo: '리뷰어 질문 3개 중 2개는\n코드 수정 필요' })
  expect(notes?.done).toBe(true)
  expect(notes?.priority).toBe('mid')
  expect(blog?.priority).toBe('low')
})

test('sort puts open first, then priority, then due date', async () => {
  const items = todosOf(
    parseFile(
      [
        '- [x] done high !high',
        '- [ ] low !low',
        '- [ ] mid no due',
        '- [ ] mid late due:2026-11-01',
        '- [ ] mid soon due:2026-10-24',
        '- [ ] high !high',
      ].join('\n'),
    ),
  )
  expect(sortTodos(items).map(t => t.text)).toEqual(['high', 'mid soon', 'mid late', 'mid no due', 'low', 'done high'])
})

test('due words in Korean and English become dates', async () => {
  const cases: [string, string | undefined][] = [
    ['오늘', '2026-10-23'],
    ['today', '2026-10-23'],
    ['내일', '2026-10-24'],
    ['tomorrow', '2026-10-24'],
    ['모레', '2026-10-25'],
    ['금요일', '2026-10-30'],
    ['fri', '2026-10-30'],
    ['Monday', '2026-10-26'],
    ['월요일', '2026-10-26'],
    ['next week', '2026-10-30'],
    ['+3d', '2026-10-26'],
    ['+2w', '2026-11-06'],
    ['10/25', '2026-10-25'],
    ['1/5', '2027-01-05'],
    ['2026-12-01', '2026-12-01'],
    ['2/30', undefined],
    ['회의', undefined],
  ]
  for (const [word, want] of cases) expect([word, parseDue(word, TODAY)]).toEqual([word, want])
})

test('add arguments read priority and due only at the end', async () => {
  expect(parseAddArgs('배포 체크 !high 금요일', TODAY)).toEqual({ text: '배포 체크', priority: 'high', due: '2026-10-30' })
  expect(parseAddArgs('내일 회의 준비', TODAY)).toEqual({ text: '내일 회의 준비' })
  expect(parseAddArgs('ship it next week !low', TODAY)).toEqual({ text: 'ship it', priority: 'low', due: '2026-10-30' })
})

test('commands parse scope, verb and number', async () => {
  expect(parseCommand('', TODAY, 'global')).toEqual({ kind: 'toggle' })
  expect(parseCommand('-p add 배포 체크 !high', TODAY, 'global')).toEqual({ kind: 'add', scope: 'project', fields: { text: '배포 체크', priority: 'high' } })
  expect(parseCommand('done 2', TODAY, 'global')).toEqual({ kind: 'done', scope: 'global', n: 2 })
  expect(parseCommand('rm 3 -p', TODAY, 'global')).toEqual({ kind: 'rm', scope: 'project', n: 3 })
  expect(parseCommand('edit 1 새 내용 내일', TODAY, 'global')).toEqual({ kind: 'edit', scope: 'global', n: 1, fields: { text: '새 내용', due: '2026-10-24' } })
  expect(parseCommand('done x', TODAY, 'global')).toEqual({ kind: 'error', code: 'usageDoneRm' })
  expect(parseCommand('edit', TODAY, 'global')).toEqual({ kind: 'error', code: 'usageEdit' })
  expect(parseCommand('add', TODAY, 'global')).toEqual({ kind: 'error', code: 'usageAdd' })
  expect(parseCommand('frobnicate', TODAY, 'global')).toEqual({ kind: 'unknown', verb: 'frobnicate' })
  expect(parseCommand('done 2', TODAY, 'project')).toEqual({ kind: 'done', scope: 'project', n: 2 })
  expect(parseCommand('-g done 2', TODAY, 'project')).toEqual({ kind: 'done', scope: 'global', n: 2 })
})

test('the language setting wins over the locale', async () => {
  expect(pickLang('Korean', 'en_US.UTF-8')).toBe('ko')
  expect(pickLang('한국어', undefined)).toBe('ko')
  expect(pickLang('ko', undefined)).toBe('ko')
  expect(pickLang('English', 'ko_KR.UTF-8')).toBe('en')
  expect(pickLang(undefined, 'ko_KR.UTF-8')).toBe('ko')
  expect(pickLang('', 'ko_KR.UTF-8')).toBe('ko')
  expect(pickLang(undefined, 'en_US.UTF-8')).toBe('en')
  expect(pickLang(undefined, undefined)).toBe('en')
})
