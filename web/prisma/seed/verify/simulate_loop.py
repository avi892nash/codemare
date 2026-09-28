#!/usr/bin/env python3
"""Deadlock simulation of the learning loop, using the rules in docs/spec/architecture.md §3.

    python3 web/prisma/seed/verify/simulate_loop.py [--with-builds] [--quiet]

The simulated learner:
  * solves every accessible question on the first accepted submit, with no hints
    (§3.2: amount = round(BASE[difficulty] × weight) per question topic, BASE = 1/2/3,
    source difficulty = question difficulty; rounding follows Math.round);
  * takes each gate as soon as it is eligible (§3.5: tier N−1 open) and passes it —
    gate submissions earn nothing (§3.2), the gate just opens the tier;
  * unlocks topics greedily: locked topics in open tiers are tried in map order
    (tier ord, topic ord), each via its cheapest *satisfiable* recipe (smallest total
    quantity, then recipe order), spending per §3.3 (qualifying buckets debited in
    ascending difficulty, items in listed order, all-or-nothing).
  * with --with-builds, also passes every accessible component build step
    (§3.2: BASE[step difficulty] tokens of the component's topic; dependencies first).
  * with --hint-heavy, before solving a question that has a token-cost hint it reveals
    the ladder up to that hint when it can afford it (§3.6: the token cost is spent from
    the question's highest-weight topic via §3.3, and the score costs of the lower rungs
    reduce that question's award).

It must end with every tier open and every topic unlocked. Afterwards an
exhaustive search explores *every* unlock order and recipe choice from every
reachable state and reports any dead end. Exit status is non-zero on a deadlock.
"""
import argparse
import sys

from common import BASE, DIFFICULTIES, js_round, load_loop, load_questions, topo_order


def token_hint_plan(q):
    """(topic, token cost, score penalty of the rungs below it) for the first token-cost hint, or None."""
    penalty = 0
    for h in q['hints']:
        if h['cost_kind'] == 'token':
            topic = max(q['topics'], key=lambda tp: tp['weight'])['slug']
            return topic, h['cost_amount'], min(100, penalty)
        penalty += h['cost_amount']
    return None


class Loop:
    def __init__(self, loop, questions, with_builds, hint_heavy=False):
        self.hint_plans = {q['slug']: token_hint_plan(q) for _, q in questions} if hint_heavy else {}
        self.tier_ord = {t['slug']: t['ord'] for t in loop['tiers']}
        self.tier_title = {t['ord']: t['title'] for t in loop['tiers']}
        self.topics = sorted(loop['topics'], key=lambda t: (self.tier_ord[t['tier']], t['ord']))
        self.topic_tier = {t['slug']: self.tier_ord[t['tier']] for t in self.topics}
        self.topic_title = {t['slug']: t['title'] for t in self.topics}
        self.recipes = {}
        for rc in loop['recipes']:
            self.recipes.setdefault(rc['topic'], []).append(rc)
        self.gates = {self.tier_ord[g['tier']]: g for g in loop['gates']}
        self.max_tier = max(self.tier_ord.values())
        self.questions = sorted(
            ((q['slug'], q['difficulty'], [(tp['slug'], tp['weight']) for tp in q['topics']]) for _, q in questions),
            key=lambda q: (max(self.topic_tier[t] for t, _ in q[2]), DIFFICULTIES.index(q[1]), q[0]))
        self.builds = []
        if with_builds:
            comps = {c['slug']: c for c in loop['components']}
            for slug in topo_order(loop['components']):
                c = comps[slug]
                for i, step in enumerate(c['build_steps']):
                    if step['kind'] == 'build':
                        self.builds.append((f'{slug}#{i}', slug, c['topic'], step['difficulty'], c['depends_on']))

    def initial(self):
        return {
            'tiers': {0},
            'unlocked': {t['slug'] for t in self.topics if self.topic_tier[t['slug']] == 0},
            'bal': {},
            'solved': set(),
            'built': set(),
        }

    @staticmethod
    def copy(s):
        return {'tiers': set(s['tiers']), 'unlocked': set(s['unlocked']), 'bal': dict(s['bal']),
                'solved': set(s['solved']), 'built': set(s['built'])}

    def earn(self, s):
        """Solve every accessible question (and build step); return [(label, {topic: amount})]."""
        events = []
        for slug, diff, tps in self.questions:
            if slug in s['solved'] or not all(t in s['unlocked'] for t, _ in tps):
                continue
            s['solved'].add(slug)
            penalty = 0
            plan = self.hint_plans.get(slug)
            if plan:
                topic, cost, score_penalty = plan
                paid = self.spend(s['bal'], {'items': [{'topic': topic, 'quantity': cost, 'min_difficulty': 'Easy'}]})
                if paid is not None:
                    s['bal'] = paid[0]
                    penalty = score_penalty
                    events.append((f'hint:{slug}', {topic: -cost}))
            got = {}
            for t, w in tps:
                amount = js_round(BASE[diff] * w * (1 - penalty / 100))
                if amount > 0:
                    s['bal'][(t, diff)] = s['bal'].get((t, diff), 0) + amount
                    got[t] = got.get(t, 0) + amount
            events.append((slug, got))
        progress = True
        while progress:
            progress = False
            for key, comp, topic, diff, deps in self.builds:
                if key in s['built'] or topic not in s['unlocked']:
                    continue
                if not all(any(k.startswith(d + '#') for k in s['built']) for d in deps):
                    continue
                s['built'].add(key)
                s['bal'][(topic, diff)] = s['bal'].get((topic, diff), 0) + BASE[diff]
                events.append((f'build:{comp}', {topic: BASE[diff]}))
                progress = True
        return events

    def open_gates(self, s):
        opened = []
        changed = True
        while changed:
            changed = False
            for n in sorted(self.gates):
                if n not in s['tiers'] and n - 1 in s['tiers']:
                    s['tiers'].add(n)
                    opened.append(n)
                    changed = True
        return opened

    @staticmethod
    def spend(bal, recipe):
        """§3.3: returns (new balances, debits) or None on shortfall."""
        b = dict(bal)
        debits = []
        for it in recipe['items']:
            need = it['quantity']
            for d in DIFFICULTIES[DIFFICULTIES.index(it['min_difficulty']):]:
                take = min(need, b.get((it['topic'], d), 0))
                if take:
                    b[(it['topic'], d)] -= take
                    debits.append((it['topic'], d, take))
                    need -= take
            if need:
                return None
        return b, debits

    def options(self, s):
        """Every satisfiable (topic, recipe index, new balances, debits) for locked topics in open tiers."""
        out = []
        for t in self.topics:
            slug = t['slug']
            if slug in s['unlocked'] or self.topic_tier[slug] not in s['tiers']:
                continue
            for i, rc in enumerate(self.recipes.get(slug, [])):
                res = self.spend(s['bal'], rc)
                if res is not None:
                    out.append((slug, i, res[0], res[1]))
        return out

    def settle(self, s):
        """Earn and open gates until nothing changes."""
        log = []
        while True:
            events = self.earn(s)
            if events:
                log.append(('earn', events))
            opened = self.open_gates(s)
            for n in opened:
                log.append(('gate', n))
            if not events and not opened:
                return log

    def done(self, s):
        return len(s['tiers']) == self.max_tier + 1 and len(s['unlocked']) == len(self.topics)


def fmt_tokens(got):
    return ', '.join(f'{t} +{a}' for t, a in got.items())


def greedy(sim, quiet):
    s = sim.initial()
    steps = []
    order = []
    while True:
        for kind, payload in sim.settle(s):
            if kind == 'earn':
                total = {}
                for _, got in payload:
                    for t, a in got.items():
                        total[t] = total.get(t, 0) + a
                n_q = sum(1 for l, _ in payload if ':' not in l)
                n_b = sum(1 for l, _ in payload if l.startswith('build:'))
                n_h = sum(1 for l, _ in payload if l.startswith('hint:'))
                steps.append(f'solve {n_q} question(s)'
                             + (f' and {n_b} build step(s)' if n_b else '')
                             + (f', buying {n_h} token hint(s)' if n_h else '')
                             + f': {", ".join(l for l, _ in payload)} → {fmt_tokens(total)}')
            else:
                g = sim.gates[payload]
                steps.append(f'pass gate "{g["title"]}" → tier {payload} ({sim.tier_title[payload]}) open')
                order.append(f'tier {payload} ({sim.tier_title[payload]}) via gate')
        opts = sim.options(s)
        if not opts:
            break
        # Map order across topics; cheapest satisfiable recipe within a topic.
        first_topic = opts[0][0]
        mine = [o for o in opts if o[0] == first_topic]
        slug, i, bal, debits = min(mine, key=lambda o: (sum(it['quantity'] for it in sim.recipes[o[0]][o[1]]['items']), o[1]))
        rc = sim.recipes[slug][i]
        s['bal'] = bal
        s['unlocked'].add(slug)
        spent = ', '.join(f'{t}×{q} ({d})' for t, d, q in debits)
        steps.append(f'unlock {slug} via "{rc["title"]}" — spent {spent}')
        order.append(f'{slug} via "{rc["title"]}"')
    if not quiet:
        print('Greedy learner:')
        for n, line in enumerate(steps, 1):
            print(f'  {n:2}. {line}')
    left = {}
    for (t, d), v in sorted(s['bal'].items(), key=lambda kv: (sim.topic_tier[kv[0][0]], kv[0][0], DIFFICULTIES.index(kv[0][1]))):
        if v:
            left.setdefault(t, []).append(f'{v} {d}')
    total_left = sum(s['bal'].values())
    print('Unlock order: ' + ' → '.join(order))
    print(f'Leftover tokens: {total_left} — ' + '; '.join(f'{t}: {", ".join(v)}' for t, v in left.items()))
    locked = [t['slug'] for t in sim.topics if t['slug'] not in s['unlocked']]
    closed = [n for n in range(sim.max_tier + 1) if n not in s['tiers']]
    return sim.done(s), locked, closed, s


def exhaustive(sim):
    seen = set()
    stats = {'states': 0, 'terminal': 0}
    deadlocks = []

    def key(s):
        return (frozenset(s['tiers']), frozenset(s['unlocked']),
                tuple(sorted((k, v) for k, v in s['bal'].items() if v)))

    stack = [(sim.initial(), [])]
    while stack:
        s, path = stack.pop()
        sim.settle(s)
        k = key(s)
        if k in seen:
            continue
        seen.add(k)
        stats['states'] += 1
        opts = sim.options(s)
        if not opts:
            stats['terminal'] += 1
            if not sim.done(s):
                deadlocks.append((path, sorted(set(t['slug'] for t in sim.topics) - s['unlocked'])))
            continue
        for slug, i, bal, _ in opts:
            nxt = sim.copy(s)
            nxt['bal'] = bal
            nxt['unlocked'].add(slug)
            stack.append((nxt, path + [f'{slug}#{i}']))
    return stats, deadlocks


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--with-builds', action='store_true', help='the learner also passes every accessible build step')
    ap.add_argument('--hint-heavy', action='store_true', help='the learner buys every affordable token-cost hint')
    ap.add_argument('--quiet', action='store_true', help='only print the summary')
    args = ap.parse_args()

    sim = Loop(load_loop(), load_questions(), args.with_builds, args.hint_heavy)
    ok, locked, closed, _ = greedy(sim, args.quiet)
    if ok:
        print('Greedy learner: every tier open, every topic unlocked.')
    else:
        print(f'DEADLOCK (greedy): locked topics {locked}, closed tiers {closed}')

    stats, deadlocks = exhaustive(sim)
    print(f'Exhaustive: {stats["states"]} reachable states, {stats["terminal"]} terminal, {len(deadlocks)} deadlock(s)')
    for path, missing in deadlocks[:10]:
        print(f'  DEADLOCK after {" → ".join(path) or "(start)"}: still locked {missing}')
    return 0 if ok and not deadlocks else 1


if __name__ == '__main__':
    sys.exit(main())
