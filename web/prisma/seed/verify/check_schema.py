#!/usr/bin/env python3
"""Schema and referential checks for web/prisma/seed/data against docs/spec/architecture.md
§2.1 (JSON shapes), §3 (loop rules) and §6.1 (seed file layout).

    python3 web/prisma/seed/verify/check_schema.py

Exits non-zero on any error. Checks include: exact §6.1 field sets, all six
starter languages, starter conventions, 8–15 tests with >= 3 hidden and an
explain_on_fail on each, tests < 150 KB, test values typed per the signature,
five hint levels in ladder order, every referenced topic/question slug exists,
gate questions drawn from the previous tier's topics, and icons from the
spec §8 list.
"""
import json
import re
import sys

from common import (BASE, DEFAULT_SCORE_COSTS, DIFFICULTIES, ICONS, IDENT_RE, LEVELS, MAX_TESTS_BYTES,
                    QUESTION_LANGS, RARITIES, SLUG_RE, Report, load_badges, load_loop, load_questions, parse_type,
                    value_matches)

QUESTION_KEYS = ['slug', 'title', 'difficulty', 'statement_md', 'examples', 'constraints', 'function_name',
                 'signature', 'compare_mode', 'starter_code', 'tests', 'reference_solutions', 'topics', 'tags',
                 'companies', 'editorial_md', 'hints']
LOOP_KEYS = ['tiers', 'topics', 'recipes', 'gates']
TIER_KEYS = ['ord', 'slug', 'title', 'summary']
TOPIC_KEYS = ['slug', 'tier', 'title', 'summary', 'icon', 'ord']
RECIPE_KEYS = ['topic', 'title', 'items']
ITEM_KEYS = ['topic', 'quantity', 'min_difficulty']
GATE_KEYS = ['tier', 'title', 'summary', 'pass_threshold', 'cooldown_hours', 'time_limit_minutes', 'questions']
BADGE_KEYS = ['slug', 'name', 'description', 'icon', 'rarity', 'criteria', 'ord']
HINT_KEYS = ['level', 'body_md', 'cost_kind', 'cost_amount']
TEST_KEYS = ['input', 'expected', 'hidden', 'explain_on_fail']

CRITERIA = {  # kind -> required extra keys and their validators (spec §2.1 Criteria)
    'first_accept': {},
    'solves': {'n': 'posint'},
    'solves_difficulty': {'difficulty': 'difficulty', 'n': 'posint'},
    'streak_days': {'n': 'posint'},
    'no_hint_solves': {'n': 'posint'},
    'topics_unlocked': {'n': 'posint'},
    'tier_open': {'tier_ord': 'posint'},
    'gate_first_try': {},
    'lessons_completed': {'n': 'posint'},
    'track_completed': {},
    'fast_solve': {'percentile': 'percent'},
}


def is_nonempty_str(v):
    return isinstance(v, str) and v.strip() != ''


def is_posint(v):
    return isinstance(v, int) and not isinstance(v, bool) and v > 0


def check_keys(r, where, obj, required, optional=()):
    if not isinstance(obj, dict):
        r.error(where, f'expected an object, got {type(obj).__name__}')
        return False
    missing = [k for k in required if k not in obj]
    extra = [k for k in obj if k not in required and k not in optional]
    if missing:
        r.error(where, f'missing keys {missing}')
    if extra:
        r.error(where, f'unexpected keys {extra}')
    return not missing


def check_signature(r, where, sig):
    if not check_keys(r, where + '.signature', sig, ['params', 'returns']):
        return None
    params = []
    if not isinstance(sig['params'], list):
        r.error(where, 'signature.params must be a list')
        return None
    for i, p in enumerate(sig['params']):
        if not check_keys(r, f'{where}.signature.params[{i}]', p, ['name', 'type']):
            return None
        if not isinstance(p['name'], str) or not IDENT_RE.match(p['name']):
            r.error(where, f'bad param name {p["name"]!r}')
        try:
            parse_type(p['type'])
        except ValueError as e:
            r.error(where, str(e))
            return None
        params.append((p['name'], p['type']))
    if len({n for n, _ in params}) != len(params):
        r.error(where, 'duplicate parameter names')
    try:
        parse_type(sig['returns'])
    except ValueError as e:
        r.error(where, str(e))
        return None
    return params


def check_tests(r, where, tests, params, returns, min_tests=8, max_tests=15):
    if not isinstance(tests, list):
        r.error(where, 'tests must be a list')
        return
    if not (min_tests <= len(tests) <= max_tests):
        r.error(where, f'{len(tests)} tests (want {min_tests}-{max_tests})')
    hidden = sum(1 for t in tests if isinstance(t, dict) and t.get('hidden') is True)
    if hidden < 3:
        r.error(where, f'only {hidden} hidden tests (want >= 3)')
    if hidden == len(tests):
        r.error(where, 'no visible tests')
    size = len(json.dumps(tests, separators=(',', ':'), ensure_ascii=False).encode())
    if size >= MAX_TESTS_BYTES:
        r.error(where, f'tests are {size} bytes (limit {MAX_TESTS_BYTES})')
    for i, t in enumerate(tests):
        tw = f'{where}.tests[{i}]'
        if not check_keys(r, tw, t, TEST_KEYS):
            continue
        if not isinstance(t['hidden'], bool):
            r.error(tw, 'hidden must be a boolean')
        if not is_nonempty_str(t['explain_on_fail']):
            r.error(tw, 'explain_on_fail must be a non-empty string')
        if not isinstance(t['input'], list) or len(t['input']) != len(params):
            r.error(tw, f'input arity {len(t["input"]) if isinstance(t["input"], list) else "?"} != {len(params)}')
            continue
        for (name, typ), v in zip(params, t['input']):
            if not value_matches(typ, v):
                r.error(tw, f'input {name} does not match type {typ}')
        if not value_matches(returns, t['expected']):
            r.error(tw, f'expected does not match return type {returns}')


def check_hints(r, where, hints):
    if not isinstance(hints, list):
        r.error(where, 'hints must be a list')
        return 0
    levels = [h.get('level') for h in hints if isinstance(h, dict)]
    if levels != LEVELS:
        r.error(where, f'hint levels {levels} (want {LEVELS} in order)')
    tokens = 0
    for h in hints:
        hw = f'{where}.hints[{h.get("level") if isinstance(h, dict) else "?"}]'
        if not check_keys(r, hw, h, HINT_KEYS):
            continue
        if not is_nonempty_str(h['body_md']):
            r.error(hw, 'empty body_md')
        amount = h['cost_amount']
        if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
            r.error(hw, 'cost_amount must be an int >= 0')
        if h['cost_kind'] == 'score':
            if amount != DEFAULT_SCORE_COSTS.get(h['level']):
                r.warn(hw, f'score cost {amount} differs from the default {DEFAULT_SCORE_COSTS.get(h["level"])}')
            if not (0 <= amount <= 100):
                r.error(hw, 'score cost must be a percentage 0-100')
        elif h['cost_kind'] == 'token':
            tokens += 1
            if amount < 1:
                r.error(hw, 'token cost must be >= 1')
        else:
            r.error(hw, f'bad cost_kind {h["cost_kind"]!r}')
    return tokens


def check_starters(r, where, starters, fn, langs):
    if not isinstance(starters, dict):
        r.error(where, 'starter_code must be an object')
        return
    if sorted(starters) != sorted(langs):
        r.error(where, f'starter_code languages {sorted(starters)} (want {sorted(langs)})')
    for lang, src in starters.items():
        lw = f'{where}.starter_code.{lang}'
        if not is_nonempty_str(src):
            r.error(lw, 'empty starter')
            continue
        if lang == 'python' and not re.search(rf'^def {fn}\(', src, re.M):
            r.error(lw, f'missing `def {fn}(`')
        if lang in ('javascript', 'typescript') and not re.search(rf'^function {fn}\(', src, re.M):
            r.error(lw, f'missing `function {fn}(`')
        if lang == 'typescript' and not re.search(r'\)\s*:\s*[^{]+\{', src):
            r.error(lw, 'typescript stub needs a typed return')
        if lang == 'cpp' and (f' {fn}(' not in src or 'return' not in src):
            r.error(lw, 'cpp stub must define the function and return a zero value')
        if lang == 'java':
            if not src.startswith('class Solution {') or f'public static' not in src or f' {fn}(' not in src:
                r.error(lw, 'java stub must be `class Solution { public static ... }`')
            if 'return' not in src:
                r.error(lw, 'java stub needs a default return')
        if lang == 'go':
            if re.search(r'^\s*(package|import)\b', src, re.M):
                r.error(lw, 'go stub must not have package/import lines')
            if not re.search(rf'^func {fn}\(', src, re.M) or 'return' not in src:
                r.error(lw, 'go stub must define the function and return a zero value')


def main():
    r = Report('schema')
    questions = load_questions()
    loop = load_loop()
    badges = load_badges()

    # ------------------------------------------------------------------ loop
    check_keys(r, 'loop.json', loop, LOOP_KEYS)
    tiers = loop.get('tiers', [])
    tier_by_slug = {}
    for i, t in enumerate(tiers):
        w = f'loop.tiers[{i}]'
        if not check_keys(r, w, t, TIER_KEYS):
            continue
        if not SLUG_RE.match(str(t['slug'])):
            r.error(w, f'bad slug {t["slug"]!r}')
        if t['slug'] in tier_by_slug:
            r.error(w, f'duplicate tier slug {t["slug"]}')
        tier_by_slug[t['slug']] = t
        if not is_nonempty_str(t['title']) or not is_nonempty_str(t['summary']):
            r.error(w, 'title/summary required')
    ords = sorted(t['ord'] for t in tier_by_slug.values())
    if ords != list(range(len(ords))):
        r.error('loop.tiers', f'tier ords {ords} must be unique and contiguous from 0')

    topic_by_slug = {}
    for i, t in enumerate(loop.get('topics', [])):
        w = f'loop.topics[{i}]'
        if not check_keys(r, w, t, TOPIC_KEYS):
            continue
        if not SLUG_RE.match(str(t['slug'])):
            r.error(w, f'bad slug {t["slug"]!r}')
        if t['slug'] in topic_by_slug:
            r.error(w, f'duplicate topic slug {t["slug"]}')
        topic_by_slug[t['slug']] = t
        if t['tier'] not in tier_by_slug:
            r.error(w, f'unknown tier {t["tier"]!r}')
        if t['icon'] not in ICONS:
            r.error(w, f'icon {t["icon"]!r} is not in the spec §8 list')
        if not is_nonempty_str(t['title']) or not is_nonempty_str(t['summary']):
            r.error(w, 'title/summary required')
        if not isinstance(t['ord'], int):
            r.error(w, 'ord must be an int')
    topic_ords = [t['ord'] for t in topic_by_slug.values()]
    if len(set(topic_ords)) != len(topic_ords):
        r.error('loop.topics', 'topic ords must be unique')

    def tier_ord(topic_slug):
        return tier_by_slug[topic_by_slug[topic_slug]['tier']]['ord']

    recipes_per_topic = {}
    for i, rc in enumerate(loop.get('recipes', [])):
        w = f'loop.recipes[{i}]'
        if not check_keys(r, w, rc, RECIPE_KEYS):
            continue
        if rc['topic'] not in topic_by_slug:
            r.error(w, f'unknown topic {rc["topic"]!r}')
            continue
        if tier_ord(rc['topic']) == 0:
            r.error(w, 'tier-0 topics are always unlocked and must not have recipes')
        recipes_per_topic.setdefault(rc['topic'], []).append(rc)
        if not is_nonempty_str(rc['title']):
            r.error(w, 'title required')
        if not isinstance(rc['items'], list) or not rc['items']:
            r.error(w, 'items must be a non-empty list')
            continue
        seen_items = set()
        for j, it in enumerate(rc['items']):
            iw = f'{w}.items[{j}]'
            if not check_keys(r, iw, it, ITEM_KEYS):
                continue
            if it['topic'] not in topic_by_slug:
                r.error(iw, f'unknown token topic {it["topic"]!r}')
            if it['topic'] == rc['topic']:
                r.error(iw, "a recipe can't require its own topic's tokens (they can only be earned after unlocking)")
            if not is_posint(it['quantity']):
                r.error(iw, 'quantity must be an int > 0')
            if it['min_difficulty'] not in DIFFICULTIES:
                r.error(iw, f'bad min_difficulty {it["min_difficulty"]!r}')
            if (it['topic'], it['min_difficulty']) in seen_items:
                r.warn(iw, 'duplicate (topic, min_difficulty) item — merge the quantities')
            seen_items.add((it['topic'], it['min_difficulty']))
    for slug, t in topic_by_slug.items():
        if t['tier'] in tier_by_slug and tier_ord(slug) > 0 and not recipes_per_topic.get(slug):
            r.error(f'topic {slug}', 'tier > 0 topic has no recipe')

    # -------------------------------------------------------------- questions
    q_by_slug = {}
    token_hint_questions = []
    composites = []
    for fname, q in questions:
        w = f'questions/{fname}'
        if not check_keys(r, w, q, QUESTION_KEYS):
            continue
        if fname != q['slug'] + '.json':
            r.error(w, f'file name does not match slug {q["slug"]!r}')
        if not SLUG_RE.match(str(q['slug'])):
            r.error(w, 'bad slug')
        if q['slug'] in q_by_slug:
            r.error(w, 'duplicate slug')
        q_by_slug[q['slug']] = q
        if q['difficulty'] not in DIFFICULTIES:
            r.error(w, f'bad difficulty {q["difficulty"]!r}')
        for k in ('title', 'statement_md', 'editorial_md'):
            if not is_nonempty_str(q[k]):
                r.error(w, f'{k} must be a non-empty string')
        if not isinstance(q['examples'], list) or not q['examples']:
            r.error(w, 'examples must be a non-empty list')
        else:
            for j, ex in enumerate(q['examples']):
                if check_keys(r, f'{w}.examples[{j}]', ex, ['input', 'output'], optional=['explanation']):
                    if not all(isinstance(ex[k], str) for k in ex):
                        r.error(f'{w}.examples[{j}]', 'example fields must be strings')
        if not isinstance(q['constraints'], list) or not all(is_nonempty_str(c) for c in q['constraints']):
            r.error(w, 'constraints must be a list of strings')
        if not isinstance(q['function_name'], str) or not IDENT_RE.match(q['function_name']):
            r.error(w, 'bad function_name')
        params = check_signature(r, w, q['signature'])
        if q['compare_mode'] not in ('ordered', 'unordered'):
            r.error(w, 'bad compare_mode')
        elif q['compare_mode'] == 'unordered' and params is not None and parse_type(q['signature']['returns'])[1] == 0:
            r.error(w, "'unordered' compare only makes sense for array results")
        check_starters(r, w, q['starter_code'], q['function_name'], QUESTION_LANGS)
        if params is not None:
            check_tests(r, w, q['tests'], params, q['signature']['returns'])
        refs = q['reference_solutions']
        if not isinstance(refs, dict) or sorted(refs) != ['javascript', 'python']:
            r.error(w, 'reference_solutions must have exactly python and javascript')
        else:
            if not re.search(rf'^def {q["function_name"]}\(', refs['python'], re.M):
                r.error(w, 'python reference does not define the function')
            if not re.search(rf'function {q["function_name"]}\(', refs['javascript']):
                r.error(w, 'javascript reference does not define the function')
        tps = q['topics']
        if not isinstance(tps, list) or not tps:
            r.error(w, 'topics must be a non-empty list')
        else:
            seen = set()
            for tp in tps:
                if not check_keys(r, w + '.topics[]', tp, ['slug', 'weight']):
                    continue
                if tp['slug'] not in topic_by_slug:
                    r.error(w, f'unknown topic {tp["slug"]!r}')
                if tp['slug'] in seen:
                    r.error(w, f'topic {tp["slug"]} listed twice')
                seen.add(tp['slug'])
                if not isinstance(tp['weight'], (int, float)) or tp['weight'] <= 0:
                    r.error(w, 'topic weight must be > 0')
                elif q['difficulty'] in BASE:
                    raw = BASE[q['difficulty']] * tp['weight']
                    if abs((raw % 1) - 0.5) < 1e-9:
                        r.error(w, f'award {raw} for {tp["slug"]} sits on a .5 rounding boundary '
                                   '(Python and JavaScript round it differently)')
            if len(tps) > 1:
                composites.append(q['slug'])
                total = sum(tp['weight'] for tp in tps if isinstance(tp, dict) and isinstance(tp.get('weight'), (int, float)))
                if not (1.5 <= total <= 2.0 + 1e-9):
                    r.error(w, f'composite weights sum to {total} (want 1.5-2.0)')
        for k in ('tags', 'companies'):
            if not isinstance(q[k], list) or not all(is_nonempty_str(x) for x in q[k]):
                r.error(w, f'{k} must be a list of strings')
        if not q['tags']:
            r.error(w, 'at least one tag')
        if check_hints(r, w, q['hints']):
            token_hint_questions.append(q['slug'])

    for slug, t in topic_by_slug.items():
        if not any(slug in [tp.get('slug') for tp in q.get('topics', [])] for q in q_by_slug.values()):
            r.error(f'topic {slug}', 'has no questions')

    # ------------------------------------------------------------------ gates
    gate_tiers = set()
    for i, g in enumerate(loop.get('gates', [])):
        w = f'loop.gates[{i}]'
        if not check_keys(r, w, g, GATE_KEYS):
            continue
        if g['tier'] not in tier_by_slug:
            r.error(w, f'unknown tier {g["tier"]!r}')
            continue
        n = tier_by_slug[g['tier']]['ord']
        if n == 0:
            r.error(w, 'tier 0 is always open and must not have a gate')
        if g['tier'] in gate_tiers:
            r.error(w, 'more than one gate for this tier')
        gate_tiers.add(g['tier'])
        if not is_nonempty_str(g['title']) or not is_nonempty_str(g['summary']):
            r.error(w, 'title/summary required')
        qs = g['questions']
        if not isinstance(qs, list) or not qs or len(set(qs)) != len(qs):
            r.error(w, 'questions must be a non-empty list of unique slugs')
            continue
        if not (is_posint(g['pass_threshold']) and g['pass_threshold'] <= len(qs)):
            r.error(w, 'pass_threshold must be between 1 and the number of questions')
        if not (isinstance(g['cooldown_hours'], int) and 12 <= g['cooldown_hours'] <= 24):
            r.error(w, 'cooldown_hours must be 12-24')
        if not is_posint(g['time_limit_minutes']):
            r.error(w, 'time_limit_minutes must be > 0')
        for slug in qs:
            if slug not in q_by_slug:
                r.error(w, f'unknown question {slug!r}')
                continue
            for tp in q_by_slug[slug]['topics']:
                if tp['slug'] in topic_by_slug and tier_ord(tp['slug']) != n - 1:
                    r.error(w, f'question {slug} has topic {tp["slug"]} outside tier {n - 1}')
    for slug, t in tier_by_slug.items():
        if t['ord'] > 0 and slug not in gate_tiers:
            r.error(f'tier {slug}', 'tier > 0 has no gate')

    # ----------------------------------------------------------------- badges
    if not isinstance(badges, list):
        r.error('badges.json', 'top level must be a list of badges')
        badges = []
    kinds = set()
    b_slugs, b_ords = set(), set()
    for i, b in enumerate(badges):
        w = f'badges[{i}]'
        if not check_keys(r, w, b, BADGE_KEYS):
            continue
        w = f'badge {b["slug"]}'
        if not SLUG_RE.match(str(b['slug'])) or b['slug'] in b_slugs:
            r.error(w, 'bad or duplicate slug')
        b_slugs.add(b['slug'])
        if b['ord'] in b_ords:
            r.error(w, 'duplicate ord')
        b_ords.add(b['ord'])
        for k in ('name', 'description'):
            if not is_nonempty_str(b[k]):
                r.error(w, f'{k} required')
        if b['icon'] not in ICONS:
            r.error(w, f'icon {b["icon"]!r} is not in the spec §8 list')
        if b['rarity'] not in RARITIES:
            r.error(w, f'bad rarity {b["rarity"]!r}')
        crit = b['criteria']
        if not isinstance(crit, dict) or crit.get('kind') not in CRITERIA:
            r.error(w, f'unknown criteria {crit!r}')
            continue
        spec = CRITERIA[crit['kind']]
        kinds.add(crit['kind'])
        check_keys(r, w + '.criteria', crit, ['kind'] + list(spec))
        for key, kind in spec.items():
            v = crit.get(key)
            if kind == 'posint' and not is_posint(v):
                r.error(w, f'criteria.{key} must be an int > 0')
            if kind == 'difficulty' and v not in DIFFICULTIES:
                r.error(w, f'criteria.{key} must be a difficulty')
            if kind == 'percent' and not (isinstance(v, (int, float)) and 0 < v < 100):
                r.error(w, f'criteria.{key} must be a percentile in (0, 100)')
        k = crit['kind']
        if k == 'solves' and crit.get('n', 0) > len(q_by_slug):
            r.error(w, f'needs {crit["n"]} solves but only {len(q_by_slug)} questions exist')
        if k == 'solves_difficulty':
            avail = sum(1 for q in q_by_slug.values() if q['difficulty'] == crit.get('difficulty'))
            if crit.get('n', 0) > avail:
                r.error(w, f'needs {crit["n"]} {crit["difficulty"]} solves but only {avail} exist')
        lockable = sum(1 for s in topic_by_slug if topic_by_slug[s]['tier'] in tier_by_slug and tier_ord(s) > 0)
        if k == 'topics_unlocked' and crit.get('n', 0) > lockable:
            r.error(w, f'needs {crit["n"]} unlocks but only {lockable} topics are lockable')
        if k == 'tier_open' and crit.get('tier_ord') not in {t['ord'] for t in tier_by_slug.values()}:
            r.error(w, 'tier_open refers to a tier that does not exist')
    missing_kinds = set(CRITERIA) - kinds
    if missing_kinds:
        r.error('badges.json', f'criteria kinds not covered: {sorted(missing_kinds)}')

    # ---------------------------------------------------------------- summary
    by_diff = {d: sum(1 for q in q_by_slug.values() if q['difficulty'] == d) for d in DIFFICULTIES}
    per_topic = {s: sum(1 for q in q_by_slug.values() if s in [tp['slug'] for tp in q['topics']])
                 for s in topic_by_slug}
    print(f'questions: {len(q_by_slug)} {by_diff}')
    print(f'questions per topic (composites counted in each topic): {per_topic}')
    print(f'composite questions: {composites}')
    print(f'questions with a token-cost hint: {token_hint_questions}')
    print(f'tiers: {len(tier_by_slug)}, topics: {len(topic_by_slug)}, recipes: {len(loop.get("recipes", []))} '
          f'({sum(1 for v in recipes_per_topic.values() if len(v) > 1)} topics with alternatives), '
          f'gates: {len(gate_tiers)}, badges: {len(badges)} '
          f'covering {len(kinds)}/{len(CRITERIA)} criteria kinds')
    return 0 if r.print() else 1


if __name__ == '__main__':
    sys.exit(main())
