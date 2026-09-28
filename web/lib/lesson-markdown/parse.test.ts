import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { MARKDOWN_OPTIONS, isExternalHref, safeUrl } from './config';
import {
  parseAttrs,
  parseFenceInfo,
  parseLesson,
  questionSlugs,
  vizIds,
  type CalloutBlock,
  type CodeBlockNode,
  type LessonBlock,
} from './parse';

const types = (blocks: LessonBlock[]) => blocks.map((b) => b.type);
const md = (...lines: string[]) => lines.join('\n');

describe('parseLesson: plain markdown', () => {
  it('keeps prose as one markdown block', () => {
    const blocks = parseLesson(md('# Title', '', 'Some **bold** text.', '', '- a', '- b'));
    expect(blocks).toEqual([{ type: 'markdown', md: '# Title\n\nSome **bold** text.\n\n- a\n- b' }]);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseLesson('')).toEqual([]);
    expect(parseLesson('  \n\n \n')).toEqual([]);
    expect(parseLesson(undefined as unknown as string)).toEqual([]);
  });

  it('normalizes CRLF line endings', () => {
    const blocks = parseLesson('Intro\r\n\r\n```py run\r\nprint(1)\r\n```\r\n');
    expect(types(blocks)).toEqual(['markdown', 'code']);
    expect((blocks[1] as CodeBlockNode).code).toBe('print(1)');
  });
});

describe('parseLesson: code fences', () => {
  it('maps ```lang run to a runnable block', () => {
    const [intro, code] = parseLesson(md('Try it:', '', '```python run', 'print("hi")', 'print(2)', '```'));
    expect(intro).toEqual({ type: 'markdown', md: 'Try it:\n' });
    expect(code).toEqual({ type: 'code', lang: 'python', run: true, title: null, stdin: null, code: 'print("hi")\nprint(2)' });
  });

  it('maps ```lang title=… to a titled, non-runnable block', () => {
    const [code] = parseLesson(md('```cpp title=bfs.cpp', 'int main() {}', '```'));
    expect(code).toMatchObject({ type: 'code', lang: 'cpp', run: false, title: 'bfs.cpp' });
  });

  it('reads quoted titles and stdin (flag or pre-filled, with \\n escapes)', () => {
    expect(parseFenceInfo('python run title="two sum.py" stdin="3\\n1 2 3"')).toEqual({
      lang: 'python',
      run: true,
      title: 'two sum.py',
      stdin: '3\n1 2 3',
    });
    expect(parseFenceInfo('js run stdin').stdin).toBe(true);
    // stdin only means something on a runnable block
    expect(parseFenceInfo('js stdin="x"').stdin).toBeNull();
  });

  it('treats a leading key=value as attributes with no language', () => {
    expect(parseFenceInfo('title=notes.txt')).toEqual({ lang: null, run: false, title: 'notes.txt', stdin: null });
    expect(parseFenceInfo('')).toEqual({ lang: null, run: false, title: null, stdin: null });
  });

  it('keeps directive and formula syntax inside fences as code', () => {
    const blocks = parseLesson(
      md('```text', ':::callout{kind=pitfall}', '$$', 'x', '$$', ':::viz{id=binary-search}', ':::', '```', 'after')
    );
    expect(types(blocks)).toEqual(['code', 'markdown']);
    expect((blocks[0] as CodeBlockNode).code).toContain(':::viz{id=binary-search}');
  });

  it('supports tilde fences and longer fences containing shorter ones', () => {
    const blocks = parseLesson(md('````md', '```js', 'x', '```', '````', '~~~ py run', 'y', '~~~'));
    expect(blocks).toEqual([
      { type: 'code', lang: 'md', run: false, title: null, stdin: null, code: '```js\nx\n```' },
      { type: 'code', lang: 'py', run: true, title: null, stdin: null, code: 'y' },
    ]);
  });

  it('runs an unclosed fence to the end of the lesson', () => {
    const blocks = parseLesson(md('```js', 'a', ':::question{slug=two-sum}'));
    expect(types(blocks)).toEqual(['code']);
    expect((blocks[0] as CodeBlockNode).code).toBe('a\n:::question{slug=two-sum}');
  });

  it('strips an indented fence’s indentation from its body', () => {
    const [code] = parseLesson(md('  ```py', '  x = 1', '    y = 2', '  ```'));
    expect((code as CodeBlockNode).code).toBe('x = 1\n  y = 2');
  });

  it('rejects odd language tokens but keeps the code', () => {
    const [code] = parseLesson(md('```<script>alert(1)</script>', 'body', '```'));
    expect(code).toMatchObject({ type: 'code', lang: null, code: 'body' });
  });

  it('strips invisible bidi/control characters from code (Trojan Source)', () => {
    const [code] = parseLesson(md('```js', 'if (a\u202e && b\u2066) {}', '```'));
    expect((code as CodeBlockNode).code).toBe('if (a && b) {}');
  });
});

describe('parseLesson: callouts', () => {
  it('maps :::callout{kind=…} … ::: with its attributes', () => {
    const [c] = parseLesson(
      md(':::callout{kind=complexity title="Why log n?" time="O(log n)" space=O(1)}', 'Halving each step.', ':::')
    );
    expect(c).toEqual({
      type: 'callout',
      kind: 'complexity',
      title: 'Why log n?',
      time: 'O(log n)',
      space: 'O(1)',
      children: [{ type: 'markdown', md: 'Halving each step.' }],
    });
  });

  it('falls back to a note for unknown kinds', () => {
    const [c] = parseLesson(md(':::callout{kind=evil}', 'x', ':::'));
    expect((c as CalloutBlock).kind).toBe('note');
    const [d] = parseLesson(md(':::callout', 'y', ':::'));
    expect((d as CalloutBlock).kind).toBe('note');
  });

  it('parses nested blocks (code, formulas, other callouts) inside a callout', () => {
    const [c, tail] = parseLesson(
      md(
        ':::callout{kind=pitfall}',
        'Off by one:',
        '```py run',
        'print(len([1, 2]))',
        '```',
        '$$ n - 1 $$',
        ':::callout{kind=note}',
        'inner',
        ':::',
        ':::',
        'after'
      )
    );
    expect(types((c as CalloutBlock).children)).toEqual(['markdown', 'code', 'formula', 'callout']);
    expect(tail).toEqual({ type: 'markdown', md: 'after' });
  });

  it('runs an unclosed callout to the end of the lesson', () => {
    const [c] = parseLesson(md(':::callout{kind=note}', 'forever'));
    expect(c).toMatchObject({ type: 'callout', children: [{ type: 'markdown', md: 'forever' }] });
  });

  it('bounds nesting depth instead of recursing without limit', () => {
    const deep = Array.from({ length: 50 }, () => ':::callout').join('\n') + '\nx\n' + Array(50).fill(':::').join('\n');
    expect(() => parseLesson(deep)).not.toThrow();
  });
});

describe('parseLesson: formulas, viz and question blocks', () => {
  it('maps $$ … $$ blocks (multi-line and one-line) to formulas', () => {
    const blocks = parseLesson(md('Before', '$$', 'i < j,\\quad s = a_i + a_j', '$$', '$$ O(\\log n) $$', 'After'));
    expect(blocks).toEqual([
      { type: 'markdown', md: 'Before' },
      { type: 'formula', tex: 'i < j,\\quad s = a_i + a_j' },
      { type: 'formula', tex: 'O(\\log n)' },
      { type: 'markdown', md: 'After' },
    ]);
  });

  it('leaves an unclosed $$ as markdown instead of swallowing the lesson', () => {
    const blocks = parseLesson(md('$$', 'x', 'more text'));
    expect(blocks).toEqual([{ type: 'markdown', md: '$$\nx\nmore text' }]);
  });

  it('maps :::viz and :::question, dropping a stray closing :::', () => {
    const blocks = parseLesson(md(':::viz{id=binary-search}', ':::', ':::question{slug=two-sum}'));
    expect(blocks).toEqual([
      { type: 'viz', id: 'binary-search' },
      { type: 'question', slug: 'two-sum' },
    ]);
  });

  it('drops viz/question blocks whose id or slug is not kebab-case', () => {
    const hostile = [
      ':::viz{id=javascript:alert(1)}',
      ':::viz{id="<script>alert(1)</script>"}',
      ':::viz{id=../../etc/passwd}',
      ':::viz{}',
      ':::question{slug=Two_Sum}',
      ':::question{slug="two-sum onmouseover=alert(1)"}',
      ':::question{slug=https://evil.test}',
      ':::question',
    ];
    expect(parseLesson(hostile.join('\n'))).toEqual([]);
  });

  it('leaves unknown directives to markdown as text', () => {
    expect(parseLesson(':::iframe{src=https://evil.test}')).toEqual([
      { type: 'markdown', md: ':::iframe{src=https://evil.test}' },
    ]);
  });

  it('collects referenced question slugs and viz ids, including inside callouts', () => {
    const blocks = parseLesson(
      md(':::question{slug=two-sum}', ':::callout{kind=note}', ':::question{slug=valid-anagram}', ':::viz{id=dp-table}', ':::', ':::question{slug=two-sum}')
    );
    expect(questionSlugs(blocks)).toEqual(['two-sum', 'valid-anagram']);
    expect(vizIds(blocks)).toEqual(['dp-table']);
  });
});

describe('parseAttrs', () => {
  it('reads unquoted, quoted and flag attributes', () => {
    expect(parseAttrs(`a=1 b="two words" c='x' d`)).toEqual({ a: '1', b: 'two words', c: 'x', d: true });
  });

  it('handles escapes, keeps the first duplicate, lowercases keys', () => {
    expect(parseAttrs(`T="say \\"hi\\"" t=second`)).toEqual({ t: 'say "hi"' });
  });

  it('skips junk and unterminated quotes without throwing', () => {
    expect(parseAttrs(`=x !! a="open b=2`)).toEqual({});
    expect(parseAttrs(`k!bad ok=1`)).toEqual({ ok: '1' });
  });

  it('never lets markup through as anything but a string value', () => {
    const attrs = parseAttrs(`title="<img src=x onerror=alert(1)>"`);
    expect(attrs.title).toBe('<img src=x onerror=alert(1)>');
    // Callout titles are plain strings (React escapes them); length-capped.
    const [c] = parseLesson(md(`:::callout{kind=note title="<b>x</b>"}`, 'y', ':::'));
    expect((c as CalloutBlock).title).toBe('<b>x</b>');
    const [d] = parseLesson(md(`:::callout{kind=note title="${'x'.repeat(500)}"}`, 'y', ':::'));
    expect((d as CalloutBlock).title).toBeNull();
  });
});

describe('markdown rendering (the options the renderer ships with)', () => {
  const render = (src: string) => renderToStaticMarkup(createElement(Markdown, MARKDOWN_OPTIONS, src));

  it('renders GitHub-flavored markdown', () => {
    const html = render(md('| a | b |', '|---|---|', '| 1 | 2 |', '', '~~gone~~ and `code`'));
    expect(html).toContain('<table>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>code</code>');
  });

  it('never renders raw HTML: scripts, iframes, event handlers, styles', () => {
    const html = render(
      md(
        'Hi <script>alert(1)</script> there',
        '',
        '<img src=x onerror=alert(1)>',
        '',
        '<iframe src="https://evil.test"></iframe>',
        '',
        '<div style="position:fixed" onclick="steal()">div</div>',
        '',
        '<a href="javascript:alert(1)">raw link</a>'
      )
    );
    for (const bad of ['<script', '<iframe', '<img', 'onerror', 'onclick', 'style=', '<div', 'javascript:']) {
      expect(html).not.toContain(bad);
    }
  });

  it('strips dangerous URLs from markdown links and images', () => {
    const html = render(
      md(
        '[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](java\tscript:alert(1)) [d](data:text/html;base64,PHNjcmlwdD4=)',
        '[e](vbscript:msgbox) [f](//evil.test/x) ![g](javascript:alert(2)) <javascript:alert(3)>'
      )
    );
    // Some of these survive as inert text; none may survive as a URL.
    const urls = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    expect(urls.every((u) => u === '')).toBe(true);
    expect(html).not.toMatch(/(?:href|src)="[^"]*(?:script:|data:|evil\.test)/i);
  });

  it('keeps safe links', () => {
    const html = render('[lesson](/learn/foundations) [site](https://example.com) [mail](mailto:a@b.dev) [frag](#top)');
    expect(html).toContain('href="/learn/foundations"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.dev"');
    expect(html).toContain('href="#top"');
  });
});

describe('safeUrl / isExternalHref', () => {
  it('allows relative and http(s)/mailto URLs only', () => {
    expect(safeUrl('/problems/two-sum')).toBe('/problems/two-sum');
    expect(safeUrl('two-sum')).toBe('two-sum');
    expect(safeUrl('../x')).toBe('../x');
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'JAVASCRIPT:x', 'java\nscript:x', 'data:x', 'vbscript:x', 'file:///etc', '//evil.test', '\\\\evil', '/\\evil']) {
      expect(safeUrl(bad)).toBe('');
    }
  });

  it('flags absolute http(s) links as external', () => {
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(isExternalHref('/learn')).toBe(false);
    expect(isExternalHref(undefined)).toBe(false);
  });
});
