#!/usr/bin/env python3
"""Compile-check every starter stub exactly as written (spec §2.1: "every stub
compiles verbatim").

    python3 web/prisma/seed/verify/compile_starters.py

For C++, Java, Go and TypeScript the stub is placed in a tiny program that
declares one test's inputs with the signature's typed-harness mapping (spec
§2.1 table; C++/Java as in backend/src/services/codeWrapperService.ts), calls
the function and assigns the result to a variable of the declared return type.
That checks the stub compiles, returns a value, and has the parameter/return
types the harness will use. Go gets only `package main` + `func main` — the
stub itself must need no imports. Python/JavaScript stubs are syntax-checked.

Toolchains: g++ (or clang++), javac, go, tsc (TSC env var, web/node_modules,
repo node_modules or PATH), python3, node. A missing toolchain is reported as a
warning and its language is skipped.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

from common import HERE, Report, load_loop, load_questions, parse_type

# Same include set as the backend C++ harness.
CPP_INCLUDES = '\n'.join(f'#include <{h}>' for h in (
    'algorithm array bitset chrono climits cmath cstdint cstdio cstdlib cstring ctime deque functional limits '
    'map new numeric queue set sstream stack stdexcept string tuple unordered_map unordered_set utility vector'
).split())

CPP_SCALAR = {'int': 'int', 'long': 'long long', 'double': 'double', 'bool': 'bool', 'string': 'std::string', 'char': 'char'}
JAVA_SCALAR = {'int': 'int', 'long': 'long', 'double': 'double', 'bool': 'boolean', 'string': 'String', 'char': 'char'}
GO_SCALAR = {'int': 'int', 'long': 'int64', 'double': 'float64', 'bool': 'bool', 'string': 'string', 'char': 'byte'}
TS_SCALAR = {'int': 'number', 'long': 'number', 'double': 'number', 'bool': 'boolean', 'string': 'string', 'char': 'string'}


def c_escape(s):
    out = []
    for ch in s:
        if ch in '"\\':
            out.append('\\' + ch)
        elif ch == '\n':
            out.append('\\n')
        elif ord(ch) < 0x20:
            out.append('\\%03o' % ord(ch))
        else:
            out.append(ch)
    return ''.join(out)


def char_lit(ch):
    return "'\\''" if ch == "'" else "'\\\\'" if ch == '\\' else f"'{ch}'"


def cpp_type(t):
    base, dims = parse_type(t)
    s = CPP_SCALAR[base]
    for _ in range(dims):
        s = f'std::vector<{s}>'
    return s


def cpp_lit(t, v):
    base, dims = parse_type(t)
    if dims:
        return '{' + ', '.join(cpp_lit(t[:-2], x) for x in v) + '}'
    if base == 'bool':
        return 'true' if v else 'false'
    if base == 'string':
        return f'std::string("{c_escape(v)}")'
    if base == 'char':
        return char_lit(v)
    if base == 'long':
        return f'{v}LL'
    return repr(float(v)) if base == 'double' else str(v)


def java_type(t):
    base, dims = parse_type(t)
    return JAVA_SCALAR[base] + '[]' * dims


def java_lit(t, v, top=True):
    base, dims = parse_type(t)
    if dims:
        inner = '{' + ', '.join(java_lit(t[:-2], x, top=False) for x in v) + '}'
        return f'new {java_type(t)}{inner}' if top else inner
    if base == 'bool':
        return 'true' if v else 'false'
    if base == 'string':
        return f'"{c_escape(v)}"'
    if base == 'char':
        return char_lit(v)
    if base == 'long':
        return f'{v}L'
    return repr(float(v)) if base == 'double' else str(v)


def go_type(t):
    base, dims = parse_type(t)
    return '[]' * dims + GO_SCALAR[base]


def go_lit(t, v, top=True):
    base, dims = parse_type(t)
    if dims:
        inner = '{' + ', '.join(go_lit(t[:-2], x, top=False) for x in v) + '}'
        return go_type(t) + inner if top else inner
    if base == 'bool':
        return 'true' if v else 'false'
    if base == 'string':
        return json.dumps(v)
    if base == 'char':
        return char_lit(v)
    return repr(float(v)) if base == 'double' else str(v)


def ts_type(t):
    base, dims = parse_type(t)
    return TS_SCALAR[base] + '[]' * dims


def smallest_test(tests):
    return min(tests, key=lambda t: len(json.dumps(t['input'])))


def cpp_program(stub, fn, params, returns, inputs):
    decls = '\n'.join(f'    {cpp_type(t)} p{i} = {cpp_lit(t, v)};' for i, ((_, t), v) in enumerate(zip(params, inputs)))
    args = ', '.join(f'p{i}' for i in range(len(params)))
    return (f'{CPP_INCLUDES}\n\n{stub}\n\nint main() {{\n{decls}\n'
            f'    {cpp_type(returns)} r = {fn}({args});\n    (void)r;\n    return 0;\n}}\n')


def java_program(pkg, stub, fn, params, returns, inputs):
    decls = '\n'.join(f'        {java_type(t)} p{i} = {java_lit(t, v)};' for i, ((_, t), v) in enumerate(zip(params, inputs)))
    args = ', '.join(f'p{i}' for i in range(len(params)))
    return (f'package {pkg};\n\n{stub}\n\npublic class Main {{\n    public static void main(String[] args) {{\n{decls}\n'
            f'        {java_type(returns)} r = Solution.{fn}({args});\n        System.out.println(r);\n    }}\n}}\n')


def go_program(stub, fn, params, returns, inputs):
    decls = '\n'.join(f'\tvar p{i} {go_type(t)} = {go_lit(t, v)}' for i, ((_, t), v) in enumerate(zip(params, inputs)))
    args = ', '.join(f'p{i}' for i in range(len(params)))
    return (f'package main\n\n{stub}\nfunc main() {{\n{decls}\n'
            f'\tvar r {go_type(returns)} = {fn}({args})\n\t_ = r\n}}\n')


def ts_program(stub, fn, params, returns, inputs):
    decls = '\n'.join(f'const p{i}: {ts_type(t)} = {json.dumps(v)};' for i, ((_, t), v) in enumerate(zip(params, inputs)))
    args = ', '.join(f'p{i}' for i in range(len(params)))
    return f'{stub}\n{decls}\nconst r: {ts_type(returns)} = {fn}({args});\nvoid r;\nexport {{}};\n'


def find_tool(*names):
    for n in names:
        if n and (os.path.isfile(n) or shutil.which(n)):
            return n if os.path.isfile(n) else shutil.which(n)
    return None


def run(cmd, cwd=None, env=None, timeout=600):
    res = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    return res.returncode, (res.stdout + res.stderr).strip()


def main():
    r = Report('starters')
    items = []  # (label, language, stub, fn, params, returns, inputs)
    for _, q in load_questions():
        params = [(p['name'], p['type']) for p in q['signature']['params']]
        inputs = smallest_test(q['tests'])['input']
        for lang, stub in q['starter_code'].items():
            items.append((f'q-{q["slug"]}', lang, stub, q['function_name'], params, q['signature']['returns'], inputs))
    for c in load_loop()['components']:
        params = [(p['name'], p['type']) for p in c['signature']['params']]
        for step in c['build_steps']:
            if step['kind'] != 'build':
                continue
            inputs = smallest_test(step['payload']['tests'])['input']
            for lang, stub in step['payload']['starter_code'].items():
                items.append((f'c-{c["slug"]}', lang, stub, c['function_name'], params, c['signature']['returns'], inputs))

    repo = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
    tools = {
        'cpp': find_tool(os.environ.get('CXX'), 'g++', 'clang++'),
        'java': find_tool('javac'),
        'go': find_tool('go'),
        'typescript': find_tool(os.environ.get('TSC'), os.path.join(repo, 'web', 'node_modules', '.bin', 'tsc'),
                                os.path.join(repo, 'node_modules', '.bin', 'tsc'), 'tsc'),
        'python': sys.executable,
        'javascript': find_tool('node'),
    }
    for lang, tool in tools.items():
        if not tool:
            r.warn(lang, 'toolchain not found — skipped')

    counts = {}
    with tempfile.TemporaryDirectory(prefix='seed-starters-') as tmp:
        env = dict(os.environ, GOCACHE=os.path.join(tmp, 'gocache'), GOFLAGS='-mod=mod', GO111MODULE='on',
                   GOTOOLCHAIN='local')
        cpp_jobs, java_files, go_dirs, ts_files, script_jobs = [], [], [], [], []
        for idx, (label, lang, stub, fn, params, returns, inputs) in enumerate(items):
            if not tools.get(lang):
                continue
            counts[lang] = counts.get(lang, 0) + 1
            if lang == 'cpp':
                path = os.path.join(tmp, f'{label}.cpp')
                open(path, 'w').write(cpp_program(stub, fn, params, returns, inputs))
                cpp_jobs.append((label, path))
            elif lang == 'java':
                pkg = f'p{idx}'
                d = os.path.join(tmp, 'java', pkg)
                os.makedirs(d)
                path = os.path.join(d, 'Main.java')
                open(path, 'w').write(java_program(pkg, stub, fn, params, returns, inputs))
                java_files.append((label, path))
            elif lang == 'go':
                d = os.path.join(tmp, 'gomod', f'p{idx}')
                os.makedirs(d)
                open(os.path.join(d, 'main.go'), 'w').write(go_program(stub, fn, params, returns, inputs))
                go_dirs.append((label, f'./p{idx}'))
            elif lang == 'typescript':
                path = os.path.join(tmp, 'ts', f'{label}.ts')
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, 'w').write(ts_program(stub, fn, params, returns, inputs))
                ts_files.append((label, path))
            else:
                script_jobs.append((label, lang, stub))

        def compile_cpp(job):
            label, path = job
            code, out = run([tools['cpp'], '-std=c++17', '-fsyntax-only', '-Werror=return-type', path])
            return label, code, out

        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
            for label, code, out in pool.map(compile_cpp, cpp_jobs):
                if code:
                    r.error(f'{label} [cpp]', out[-1500:])

        if java_files:
            outdir = os.path.join(tmp, 'java-out')
            code, out = run([tools['java'], '-d', outdir, '-Xlint:none'] + [p for _, p in java_files])
            if code:
                r.error('java', out[-3000:])

        if go_dirs:
            gomod = os.path.join(tmp, 'gomod')
            open(os.path.join(gomod, 'go.mod'), 'w').write('module seedcheck\n\ngo 1.21\n')
            # Building several main packages at once type-checks them and discards the binaries.
            code, out = run([tools['go'], 'build'] + [d for _, d in go_dirs], cwd=gomod, env=env)
            if code:
                r.error('go', out[-3000:])

        if ts_files:
            # Run from the temp dir so no ancestor node_modules/@types leaks into the check.
            code, out = run([tools['typescript'], '--noEmit', '--strict', '--target', 'es2020', '--lib', 'es2020']
                            + [p for _, p in ts_files], cwd=tmp)
            if code:
                r.error('typescript', out[-3000:])

        for label, lang, stub in script_jobs:
            if lang == 'python':
                try:
                    compile(stub, f'{label}.py', 'exec')
                except SyntaxError as e:
                    r.error(f'{label} [python]', str(e))
            else:
                path = os.path.join(tmp, f'{label}.js')
                open(path, 'w').write(stub)
                code, out = run([tools['javascript'], '--check', path])
                if code:
                    r.error(f'{label} [javascript]', out[-1500:])

    print('stubs compiled per language: ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))
    return 0 if r.print() else 1


if __name__ == '__main__':
    sys.exit(main())
