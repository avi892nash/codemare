"""Shared helpers for the seed-data verification scripts.

Everything here is stdlib-only so the checks run with a bare `python3`.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
# SEED_DATA_DIR / SEED_REFS_FILE let the checks run against a scratch copy (e.g. to prove they catch bad data).
DATA = os.environ.get('SEED_DATA_DIR') or os.path.normpath(os.path.join(HERE, '..', 'data'))
QUESTIONS_DIR = os.path.join(DATA, 'questions')
REFS_FILE = os.environ.get('SEED_REFS_FILE') or os.path.join(HERE, 'component_refs.json')

LANGUAGES = ['python', 'javascript', 'typescript', 'cpp', 'java', 'go']
QUESTION_LANGS = LANGUAGES
COMPONENT_LANGS = ['python', 'javascript', 'typescript', 'cpp', 'go']  # spec §0.4: no Java for components
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


def load_component_refs():
    """Reference solutions for component build steps. They live here, not in loop.json, because
    build-step payloads are learner-facing and §6.1 gives components no reference field."""
    return load_json(REFS_FILE)


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


def topo_order(components):
    """Return component slugs in dependency order; raise ValueError on a cycle."""
    deps = {c['slug']: list(c.get('depends_on', [])) for c in components}
    order, state = [], {}

    def visit(slug, path):
        if state.get(slug) == 'done':
            return
        if state.get(slug) == 'active':
            raise ValueError('dependency cycle: ' + ' -> '.join(path + [slug]))
        state[slug] = 'active'
        for dep in deps.get(slug, []):
            visit(dep, path + [slug])
        state[slug] = 'done'
        order.append(slug)

    for slug in deps:
        visit(slug, [])
    return order


def transitive_deps(slug, components):
    """Dependencies of `slug` (not including itself) in topological order."""
    by_slug = {c['slug']: c for c in components}
    out, seen = [], set()

    def visit(s):
        for dep in by_slug[s].get('depends_on', []):
            if dep not in seen:
                visit(dep)
                seen.add(dep)
                out.append(dep)

    visit(slug)
    return out


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
