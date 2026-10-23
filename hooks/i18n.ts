export type Lang = 'ko' | 'en'

const KO = {
  global: '전역',
  project: '프로젝트',
  empty: '비어 있음',
  overdue: '지남',
  left: (n: number) => `${n}개 남음`,
  next: '다음:',
  overdueCount: (n: number) => `${n}개 마감 지남`,
  done: '완료',
  undone: '미완료',
  edit: '수정',
  remove: '삭제',
  editLabel: '수정: ',
  memoLabel: '메모: ',
  editHint: 'Enter 저장 · 한 칸씩 저장됩니다',
  addPlaceholder: '+ 새 항목… (예: 배포 체크 !high 금요일)',
  addSubmit: '추가',
  opened: 'TODO pane을 열었습니다.',
  closed: 'TODO pane을 닫았습니다.',
  missing: (scope: string, n: number) => `${scope} 목록에 ${n}번 항목이 없습니다.`,
  usageAdd: '사용법: /todo [-p|-g] add <내용> [!high|!mid|!low] [마감]',
  usageDoneRm: '사용법: /todo [-p|-g] done|rm <번호>',
  usageEdit: '사용법: /todo [-p|-g] edit <번호> <내용>',
  unknown: (verb: string) => `알 수 없는 명령: ${verb}. add, done, rm, edit 중 하나를 쓰세요.`,
  description: 'TODO 목록: pane 열기/닫기, add · done · rm · edit (-p 프로젝트, -g 전역)',
  argumentHint: '[-p|-g] [add <내용> [!high|!mid|!low] [마감] | done <n> | rm <n> | edit <n> <내용>]',
}

export type Strings = typeof KO

const EN: Strings = {
  global: 'Global',
  project: 'Project',
  empty: 'Empty',
  overdue: 'overdue',
  left: n => `${n} left`,
  next: 'next:',
  overdueCount: n => `${n} overdue`,
  done: 'Done',
  undone: 'Undo',
  edit: 'Edit',
  remove: 'Delete',
  editLabel: 'Edit: ',
  memoLabel: 'Memo: ',
  editHint: 'Enter saves · each field saves on its own',
  addPlaceholder: '+ New item… (e.g. ship release !high fri)',
  addSubmit: 'add',
  opened: 'Opened the TODO pane.',
  closed: 'Closed the TODO pane.',
  missing: (scope, n) => `The ${scope.toLowerCase()} list has no item ${n}.`,
  usageAdd: 'Usage: /todo [-p|-g] add <text> [!high|!mid|!low] [due]',
  usageDoneRm: 'Usage: /todo [-p|-g] done|rm <n>',
  usageEdit: 'Usage: /todo [-p|-g] edit <n> <text>',
  unknown: verb => `Unknown command: ${verb}. Use add, done, rm or edit.`,
  description: 'TODO list: open/close the pane, add · done · rm · edit (-p project, -g global)',
  argumentHint: '[-p|-g] [add <text> [!high|!mid|!low] [due] | done <n> | rm <n> | edit <n> <text>]',
}

export const STRINGS: Record<Lang, Strings> = { ko: KO, en: EN }

// The Claude Code `language` setting wins when set; else the POSIX locale (LC_ALL, LC_MESSAGES, LANG).
export function pickLang(setting: unknown, locale: string | undefined): Lang {
  if (typeof setting === 'string' && setting.trim()) return /^(ko|korean|한국)/i.test(setting.trim()) ? 'ko' : 'en'
  return locale?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}
