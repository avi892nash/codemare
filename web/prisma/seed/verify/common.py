"""Shared helpers for the seed-data verification scripts.

Everything here is stdlib-only so the checks run with a bare `python3`.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
# SEED_DATA_DIR lets the checks run against a scratch copy (e.g. to prove they catch bad data).
DATA = os.environ.get('SEED_DATA_DIR') or os.path.normpath(os.path.join(HERE, '..', 'data'))
QUESTIONS_DIR = os.path.join(DATA, 'questions')

LANGUAGES = ['python', 'javascript', 'typescript', 'cpp', 'java', 'go']
QUESTION_LANGS = LANGUAGES
LEVELS = ['nudge', 'concept', 'pseudo', 'line', 'solution']
DEFAULT_SCORE_COSTS = {'nudge': 0, 'concept': 10, 'pseudo': 25, 'line': 40, 'solution': 100}
DIFFICULTIES = ['Easy', 'Medium', 'Hard']
BASE = {'Easy': 1, 'Medium': 2, 'Hard': 3}
RARITIES = ['common', 'rare', 'epic', 'legendary']

# Spec §8 — the only icon names content JSON may use.
ICONS = set('''
check x circle half-circle check-circle alert zap cpu memory clock search filter chev-down
chev-right chev-left chev-up play pause skip-back skip-forward graduation sparkle target lightbulb info
alert-circle gauge arrow-right arrow-down send copy refresh settings user list book flame github google
lock lock-open eye eye-off plus minus close more external bookmark thumb msg trophy layers
history terminal code drag star bolt trend hash
map route book-open award coin sun moon log-out git-branch grid edit trash
sort repeat shield puzzle network table window arrows-lr
'''.split())

SCALARS = ['int', 'long', 'double', 'bool', 'string', 'char']
SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
IDENT_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
MAX_TESTS_BYTES = 150 * 1024


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_questions():
    out = []
    for name in sorted(os.listdir(QUESTIONS_DIR)):
        if name.endswith('.json'):
            out.append((name, load_json(os.path.join(QUESTIONS_DIR, name))))
    return out


def load_loop():
    return load_json(os.path.join(DATA, 'loop.json'))


def load_badges():
    return load_json(os.path.join(DATA, 'badges.json'))


def parse_type(t):
    """'int[][]' -> ('int', 2). Raises ValueError on anything the judge can't handle."""
    if not isinstance(t, str):
        raise ValueError(f'type must be a string, got {t!r}')
    base, dims = t, 0
    while base.endswith('[]'):
        base, dims = base[:-2], dims + 1
    if base not in SCALARS or dims > 2:
        raise ValueError(f'unsupported signature type {t!r}')
    return base, dims


def value_matches(t, v):
    """True if JSON value `v` is a valid literal for signature type `t`."""
    base, dims = parse_type(t)
    if dims:
        return isinstance(v, list) and all(value_matches(t[:-2], x) for x in v)
    if base == 'int':
        return isinstance(v, int) and not isinstance(v, bool) and -2**31 <= v < 2**31
    if base == 'long':
        # JSON numbers beyond 2^53 lose precision in JavaScript.
        return isinstance(v, int) and not isinstance(v, bool) and -2**53 < v < 2**53
    if base == 'double':
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if base == 'bool':
        return isinstance(v, bool)
    if base == 'string':
        return isinstance(v, str)
    if base == 'char':
        return isinstance(v, str) and len(v) == 1 and ord(v) < 128
    return False


def canonical(value):
    """Mirror of the judge's 'unordered' canonicalisation (sort by JSON key, recursively)."""
    if isinstance(value, list):
        return sorted((canonical(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
    return value


def outputs_equal(actual, expected, mode):
    if mode == 'unordered':
        return canonical(actual) == canonical(expected)
    return actual == expected


def js_round(x):
    """Math.round semantics (half rounds up), as the TypeScript domain code will use."""
    import math
    return math.floor(x + 0.5)


class Report:
    def __init__(self, name):
        self.name = name
        self.errors = []
        self.warnings = []

    def error(self, where, msg):
        self.errors.append(f'{where}: {msg}')

    def warn(self, where, msg):
        self.warnings.append(f'{where}: {msg}')

    def print(self):
        for w in self.warnings:
            print(f'  WARN  {w}')
        for e in self.errors:
            print(f'  ERROR {e}')
        status = 'OK' if not self.errors else f'{len(self.errors)} error(s)'
        print(f'[{self.name}] {status}, {len(self.warnings)} warning(s)')
        return not self.errors
