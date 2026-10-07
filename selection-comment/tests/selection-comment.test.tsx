import { expect, mock, test } from 'claude-code/testing'

import { formatComment } from '../hooks/register'

const PLUGIN = 'selection-comment'
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

test('formatComment quotes every line and adds the comment below', () => {
  expect(formatComment('a\n\nb', ' why? ')).toBe('> a\n>\n> b\n\nwhy?\n')
  expect(formatComment('a', '')).toBe('> a\n')
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

    expect(fills).toEqual(['\n> const x = 1\n> const y = 2\n\nrename these\n'])
    expect(await ui.find({ key: 'comment' })).toBeUndefined()
    expect(await ui.find({ key: 'comment-input' })).toBeUndefined()

    // The same selection does not bring the band back.
    await clock.advance(400)
    expect(await ui.find({ key: 'comment' })).toBeUndefined()
  })
}
