#!/usr/bin/env python3
"""Run the whole seed-data verification suite.

    python3 web/prisma/seed/verify/verify_all.py [--skip-compile]

1. check_schema.py      — §2.1/§6.1 shapes, references between files, icons, hint ladders
2. run_references.py    — python + javascript references vs every test; predict snippets
3. compile_starters.py  — C++/Java/Go/TypeScript stubs compile verbatim (needs the toolchains)
4. simulate_loop.py     — deadlock simulation (plus --with-builds and --hint-heavy variants)

Exits non-zero if any step fails.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

STEPS = [
    ('schema', ['check_schema.py']),
    ('references', ['run_references.py']),
    ('starters', ['compile_starters.py']),
    ('simulation', ['simulate_loop.py']),
    ('simulation + builds', ['simulate_loop.py', '--quiet', '--with-builds']),
    ('simulation + token hints', ['simulate_loop.py', '--quiet', '--hint-heavy']),
    ('simulation + builds + token hints', ['simulate_loop.py', '--quiet', '--with-builds', '--hint-heavy']),
]


def main():
    skip_compile = '--skip-compile' in sys.argv[1:]
    results = []
    for name, cmd in STEPS:
        if skip_compile and name == 'starters':
            results.append((name, 'skipped'))
            continue
        print(f'\n===== {name} =====', flush=True)
        code = subprocess.call([sys.executable, os.path.join(HERE, cmd[0])] + cmd[1:], cwd=HERE)
        results.append((name, 'ok' if code == 0 else 'FAILED'))
    print('\n===== summary =====')
    for name, status in results:
        print(f'  {status:8} {name}')
    return 0 if all(status != 'FAILED' for _, status in results) else 1


if __name__ == '__main__':
    sys.exit(main())
