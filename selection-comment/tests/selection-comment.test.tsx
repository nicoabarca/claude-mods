import { expect, mock, test } from 'claude-code/testing'

import type { SessionMessage } from 'claude-code'

import { findOrigin, formatComment } from '../hooks/register'

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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`select, comment, Enter fills the prompt (${surface})`, async ($, on) => {
    const clock = mock.clock(on)
    let selected: string | undefined
    let draft = 'intro'
    const fills: string[] = []

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
      draft += e.text
      return { isFilled: true, text: draft }
    })

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ key: 'comment' })).toBeUndefined()

    selected = 'const x = 1\nconst y = 2'
    await clock.advance(400)
    expect(await ui.find({ key: 'comment' })).toBeDefined()

    await ui.press({ key: 'comment' })
    await ui.input({ key: 'comment-input', text: 'rename these' })

    expect(fills).toEqual([
      '\n<comment id="C1" source="assistant · turn 1">\n<quote>\nconst x = 1\nconst y = 2\n</quote>\n<context>\nHere:\n[SELECTION]\nDone.\n</context>\n<note>rename these</note>\n</comment>\n',
    ])
    expect(await ui.find({ key: 'comment' })).toBeUndefined()
    expect(await ui.find({ key: 'comment-input' })).toBeUndefined()

    // The same selection does not bring the band back.
    await clock.advance(400)
    expect(await ui.find({ key: 'comment' })).toBeUndefined()

    // The next comment takes the next id.
    selected = 'Done.'
    await clock.advance(400)
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'comment-input', text: '' })
    expect(fills[1]).toContain('<comment id="C2"')
  })
}
