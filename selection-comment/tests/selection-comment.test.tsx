import { expect, mock, test } from 'claude-code/testing'

import type { SessionMessage } from 'claude-code'

import type { Stored } from '../types'
import { collapseDraft, expandDraft, findOrigin, formatComment, tokenFor, viewOf } from '../hooks/comment'

const PLUGIN = 'selection-comment'
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'add a debounce', toolUses: [] },
  {
    role: 'assistant',
    text: 'Plan:\n\nUse a **debounce** of 300ms here\nso typing stays smooth',
    toolUses: [
      {
        tool_use_id: 'toolu_1',
        tool: 'Edit',
        input: { file_path: '/repo/src/search.ts', old_string: 'search()', new_string: 'debounced()' },
        text: 'The file was updated',
      },
    ],
  },
  { role: 'user', text: '', toolUses: [], toolResults: [] },
  { role: 'user', text: 'now run tests', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'toolu_2', tool: 'Bash', input: { command: 'npm test' }, text: 'ok 1\nnot ok 2 search\nok 3' }],
  },
]

test('formatComment wraps quote, context and note in a tagged block', () => {
  expect(
    formatComment({ id: 'C3', text: 'a\nb', note: ' why? ', source: 'assistant · turn 2', context: 'x\n[SELECTION]\ny' }),
  ).toBe(
    '<comment id="C3" source="assistant · turn 2">\n<quote>\na\nb\n</quote>\n<context>\nx\n[SELECTION]\ny\n</context>\n<note>why?</note>\n</comment>\n',
  )
  expect(formatComment({ id: 'C1', text: 'a', note: '' })).toBe('<comment id="C1">\n<quote>\na\n</quote>\n</comment>\n')
})

test('formatComment cuts long quotes', () => {
  const text = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n')
  const block = formatComment({ id: 'C1', text, note: '' })
  expect(block).toContain('line 19\n[… 5 more lines]\n</quote>')
  expect(block).not.toContain('line 20')
})

test('findOrigin finds the message, ignoring rendered markdown', () => {
  expect(findOrigin(MESSAGES, 'Use a debounce of 300ms here')).toEqual({
    source: 'assistant · turn 1',
    context: 'Plan:\n[SELECTION]\nso typing stays smooth',
  })
})

test('findOrigin names the tool call from the row id', () => {
  expect(findOrigin(MESSAGES, 'not ok 2 search', 'toolu_2')).toEqual({
    source: 'Bash · npm test · turn 2',
    context: 'ok 1\n[SELECTION]\nok 3',
  })
  expect(findOrigin(MESSAGES, 'nothing like this', 'toolu_1')).toEqual({ source: 'Edit · /repo/src/search.ts · turn 1' })
})

test('findOrigin finds tool output without a row id, and gives up quietly', () => {
  expect(findOrigin(MESSAGES, 'not ok 2 search').source).toBe('Bash · npm test · turn 2')
  expect(findOrigin(MESSAGES, 'never said')).toEqual({})
})

const STORED: Record<string, Stored> = {
  C1: { id: 'C1', text: 'Use a debounce of 300ms here', source: 'assistant · turn 1', context: 'Plan:\n[SELECTION]\nso typing stays smooth' },
  C2: { id: 'C2', text: 'not ok 2 search' },
}

test('tokenFor keeps its own marks out of what it shows', () => {
  expect(tokenFor({ ...STORED.C1!, note: 'why 300?' })).toBe('[C1 · assistant · turn 1: "Use a debounce of 300ms here" → why 300?]')
  expect(tokenFor({ id: 'C3', text: 'a [b] "c" → d', note: '' })).toBe(`[C3: "a (b) 'c' -> d"]`)
})

test('expandDraft reads the note from the token as edited', () => {
  const draft = 'look at these\n[C1 · assistant · turn 1: "Use a debounce…" → why 200? [really]]\n[C2: "not ok"]\n[C9: "unknown"]\nthanks'
  expect(expandDraft(draft, STORED)).toBe(
    'look at these\n' +
      formatComment({ ...STORED.C1!, note: 'why 200? [really]' }) +
      formatComment({ ...STORED.C2!, note: '' }) +
      '[C9: "unknown"]\nthanks',
  )
})

test('collapseDraft keeps edits made to the full block', () => {
  const draft = expandDraft('[C1: "x" → why?]\n[C2: "y"]', STORED)
    .replace('Use a debounce of 300ms here', 'Use a debounce')
    .replace('<note>why?</note>', '<note>shorter</note>')
    .replace(' source="assistant · turn 1"', '')
  const collapsed = collapseDraft(draft, STORED)
  expect(collapsed.text).toBe('[C1: "Use a debounce" → shorter]\n[C2: "not ok 2 search"]')
  expect(collapsed.comments.C1).toEqual({ id: 'C1', text: 'Use a debounce', source: undefined, context: STORED.C1!.context })
  expect(collapsed.comments.C2).toEqual({ id: 'C2', text: 'not ok 2 search', source: undefined, context: undefined })
})

test('collapseDraft keeps a long quote whole while its cut is untouched', () => {
  const text = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n')
  const stored = { C1: { id: 'C1', text } }
  const collapsed = collapseDraft(expandDraft('[C1: "x"]', stored), stored)
  expect(collapsed.comments.C1!.text).toBe(text)
})

test('collapseDraft leaves a mangled block as it is', () => {
  const draft = '<comment id="C1">\nno quote here\n</comment>'
  expect(collapseDraft(draft, STORED).text).toBe(draft)
})

test('viewOf tells tokens from blocks', () => {
  expect(viewOf('[C1: "x"]', STORED)).toBe('tokens')
  expect(viewOf(expandDraft('[C1: "x"]', STORED), STORED)).toBe('blocks')
  expect(viewOf('[C9: "x"]\nplain', STORED)).toBe(null)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`select, comment, Enter fills a token; expand, collapse and submit (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    let selected: string | undefined
    let draft = 'intro'
    const fills: string[] = []
    const sent: string[] = []

    on('session.start', async ($, e) => ({ cwd: e.cwd }))
    on('ui.render', async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    on('ui.selection', async () => ({ value: selected ? { text: selected } : undefined }))
    on('session.messages', async () => ({
      value: [{ role: 'assistant', text: 'Here:\nconst x = 1\nconst y = 2\nDone.', toolUses: [] }],
    }))
    on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
    on('prompt.fill', async ($, e) => {
      fills.push(e.text)
      draft = e.mode === 'replace' ? e.text : draft + e.text
      return { isFilled: true, text: draft }
    })
    on('prompt.submit', async ($, e) => {
      sent.push(e.text)
      return { text: e.text }
    })

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ key: 'comment' })).toBeUndefined()

    selected = 'const x = 1\nconst y = 2'
    await clock.advance(400)
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'comment-input', text: 'rename these' })

    const token = '[C1 · assistant · turn 1: "const x = 1 const y = 2" → rename these]'
    expect(fills).toEqual([`\n${token}\n`])
    expect(await ui.find({ key: 'comment' })).toBeUndefined()

    // The same selection does not bring the selection back, but the toggle stays.
    await clock.advance(400)
    expect(await ui.find({ key: 'comment' })).toBeUndefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()

    // The note edited in the token, then expanded, edited, collapsed.
    draft = draft.replace('rename these', 'rename both')
    await ui.press({ key: 'toggle' })
    expect(draft).toContain('<note>rename both</note>')
    expect(draft).toContain('<context>\nHere:\n[SELECTION]\nDone.\n</context>')
    draft = draft.replace('<note>rename both</note>', '<note>inline them</note>')
    await ui.press({ key: 'toggle' })
    expect(draft).toBe('intro\n[C1 · assistant · turn 1: "const x = 1 const y = 2" → inline them]\n')

    // The model gets the full block; the next comment takes the next id.
    await $.prompt.submit({ text: draft, wait: false, origin: { kind: 'composer' } })
    expect(sent.at(-1)).toContain('<comment id="C1" source="assistant · turn 1">')
    expect(sent.at(-1)).toContain('<note>inline them</note>')

    selected = 'Done.'
    await clock.advance(400)
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'comment-input', text: '' })
    expect(fills.at(-1)).toContain('[C2 ')
  })
}
