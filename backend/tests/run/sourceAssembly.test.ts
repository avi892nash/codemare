// Run with: npx tsx --test tests/run/sourceAssembly.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  assembleGo,
  joinSources,
  locateLine,
  parseGoHeader,
  renderGoImports,
} from '../../src/services/sourceAssembly.js';
import { wrapFunctionCode } from '../../src/services/codeWrapperService.js';

test('without a prelude python/javascript/typescript code is returned unchanged', () => {
  for (const lang of ['python', 'javascript', 'typescript'] as const) {
    const joined = joinSources(lang, [], 'line1\nline2');
    assert.equal(joined.source, 'line1\nline2');
    assert.equal(joined.segments.length, 1);
  }
});

test('prelude pieces are concatenated in order and every line maps back', () => {
  const joined = joinSources('python', ['def a():\n    return 1', 'def b():\n    return 2\n'], 'x = a()\ny = b()');
  assert.equal(joined.source, 'def a():\n    return 1\n\ndef b():\n    return 2\n\nx = a()\ny = b()');
  const lines = joined.source.split('\n');
  assert.deepEqual(locateLine(joined.segments, 1), { name: 'prelude_1.py', line: 1 });
  assert.deepEqual(locateLine(joined.segments, 5), { name: 'prelude_2.py', line: 2 });
  assert.deepEqual(locateLine(joined.segments, 7), { name: 'solution.py', line: 1 });
  assert.deepEqual(locateLine(joined.segments, 8), { name: 'solution.py', line: 2 });
  // Blank separator lines belong to no segment.
  assert.equal(locateLine(joined.segments, 3), undefined);
  // Every mapped line really is that segment's line.
  const pieces: Record<string, string[]> = {
    'prelude_1.py': ['def a():', '    return 1'],
    'prelude_2.py': ['def b():', '    return 2'],
    'solution.py': ['x = a()', 'y = b()'],
  };
  lines.forEach((text, k) => {
    const loc = locateLine(joined.segments, k + 1);
    if (loc) assert.equal(pieces[loc.name][loc.line - 1], text);
  });
});

test('cpp pieces carry #line markers so compiler errors name the learner line', () => {
  const noPrelude = joinSources('cpp', [], 'int f() { return 1; }');
  assert.equal(noPrelude.source, '#line 1 "solution.cpp"\nint f() { return 1; }');
  const withPrelude = joinSources('cpp', ['int g() { return 2; }'], 'int f() { return g(); }');
  assert.equal(
    withPrelude.source,
    '#line 1 "prelude_1.cpp"\nint g() { return 2; }\n\n#line 1 "solution.cpp"\nint f() { return g(); }'
  );
});

test('java rejects a prelude; javascript/cpp/python accept one', () => {
  const tests = [{ input: [1], expectedOutput: 1, hidden: false }];
  const sig = { params: [{ name: 'x', type: 'int' as const }], returns: 'int' as const };
  assert.throws(
    () => wrapFunctionCode('class Solution {}', 'f', tests, 'java', 'ordered', sig, ['class A {}']),
    /Java does not support a prelude/
  );
  const js = wrapFunctionCode('function f(x) { return g(x); }', 'f', tests, 'javascript', 'ordered', undefined, [
    'function g(x) { return x; }',
  ]);
  assert.ok(js.wrappedCode.startsWith('function g(x) { return x; }\n\nfunction f(x)'));
});

test('parseGoHeader handles package clauses, single/grouped/named/dot/blank/raw imports and comments', () => {
  const src = `// Package doc comment
package solution // trailing

import "fmt"
import (
	"sort" // for sorting
	str "strings"
	. "math"
	_ "embed"
	/* block */ \`container/heap\`
)
import m "math/bits"; import "os"

func f() {}
`;
  const header = parseGoHeader(src);
  assert.deepEqual(
    header.imports.map((s) => [s.name ?? null, s.path, s.literal]),
    [
      [null, 'fmt', '"fmt"'],
      [null, 'sort', '"sort"'],
      ['str', 'strings', '"strings"'],
      ['.', 'math', '"math"'],
      ['_', 'embed', '"embed"'],
      [null, 'container/heap', '`container/heap`'],
      ['m', 'math/bits', '"math/bits"'],
      [null, 'os', '"os"'],
    ]
  );
  assert.equal(src.slice(header.bodyOffset).trim(), 'func f() {}');
});

test('parseGoHeader leaves a malformed import in the body for the compiler to report', () => {
  const src = 'import "fmt"\nimport (\n\t"sort"\n\n\nfunc f() {}\n';
  const header = parseGoHeader(src);
  assert.deepEqual(header.imports.map((s) => s.path), ['fmt']);
  assert.ok(src.slice(header.bodyOffset).includes('import ('));
});

test('assembleGo merges and dedupes imports across prelude and code, stripping package clauses', () => {
  const unit = assembleGo(
    [
      'package main\n\nimport (\n\t"sort"\n\t"strings"\n)\n\nfunc lb(a []int, x int) int { return sort.SearchInts(a, x) }\n',
      'import "sort"\n\nfunc up(s string) string { return strings.ToUpper(s) }\n',
    ],
    'package whatever\n\nimport (\n\t"sort"\n\tf "fmt"\n)\n\nfunc solve() int { f.Sprint(); return 0 }\n'
  );
  assert.deepEqual(
    unit.imports.map((s) => `${s.name ?? ''}|${s.path}|${s.file}:${s.line}:${s.col}`),
    ['|sort|prelude_1.go:4:2', '|strings|prelude_1.go:5:2', 'f|fmt|solution.go:5:2']
  );
  assert.ok(!unit.body.includes('package'));
  assert.ok(unit.body.includes('//line prelude_1.go:7:1\n'));
  assert.ok(unit.body.includes('//line prelude_2.go:2:1\n'));
  assert.ok(unit.body.includes('//line solution.go:7:1\n'));
  const rendered = renderGoImports(unit.imports);
  assert.equal(
    rendered,
    'import (\n//line prelude_1.go:4:2\n"sort"\n//line prelude_1.go:5:2\n"strings"\n//line solution.go:5:2\nf "fmt"\n)\n'
  );
  assert.equal(renderGoImports([]), '');
});

test('assembleGo keeps code on the header line and numbers the body from the right line', () => {
  const unit = assembleGo([], 'import "fmt"; func f() { fmt.Println() }\n');
  assert.equal(unit.body, '//line solution.go:1:1\n func f() { fmt.Println() }\n');
  const plain = assembleGo([], 'func g() int { return 1 }');
  assert.equal(plain.body, '//line solution.go:1:1\nfunc g() int { return 1 }\n');
});
