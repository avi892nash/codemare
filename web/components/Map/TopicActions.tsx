'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { unlockTopicAction, type ActionError } from '@/app/(workspace)/map/actions';
import { plural, toastBadges } from '@/components/Loop/awards';
import { Button } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import type { RecipeCard, TopicCardState } from '@/lib/server/loopViews';
import type { Difficulty } from '@/lib/types';
import s from './map.module.css';

/** topic id → its title and current balance (for spend summaries and shortfalls). */
export type BalanceIndex = Record<string, { title: string; total: number }>;

interface TopicActionsProps {
  topic: { id: string; title: string; state: TopicCardState };
  /** The topic's recipes (only needed while it is unlockable). */
  recipes: RecipeCard[];
  balances: BalanceIndex;
  /** The card heading — focused after a successful unlock. */
  titleId: string;
}

const minText = (d: Difficulty) => (d === 'Easy' ? '' : ` (${d}+)`);

function errorContent(error: ActionError, balances: BalanceIndex): ReactNode {
  if (error.error === 'insufficient_tokens' && error.shortfalls?.length) {
    return (
      <>
        Not enough tokens for this recipe any more:
        <ul>
          {error.shortfalls.map((f) => (
            <li key={`${f.topicId}-${f.minDifficulty}`}>
              {balances[f.topicId]?.title ?? 'A topic'}: needs {f.need}
              {minText(f.minDifficulty)}, you have {f.have} — {f.need - f.have} short.
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (error.error === 'tier_locked') return 'This tier is closed — pass its gate first.';
  return error.message;
}

/**
 * The action row under a topic card: Unlock, with the recipe-choosing
 * confirmation, while the topic is unlockable. After an unlock, focus
 * moves to the card's heading (the card now lists its problems).
 */
export function TopicActions({ topic, recipes, balances, titleId }: TopicActionsProps) {
  const [open, setOpen] = useState(false);
  const justUnlocked = useRef(false);

  useEffect(() => {
    if (topic.state === 'unlocked' && justUnlocked.current) {
      justUnlocked.current = false;
      document.getElementById(titleId)?.focus();
    }
  }, [topic.state, titleId]);

  return (
    <>
      {topic.state === 'unlockable' && (
        <div className={s.topicFoot}>
          <Button variant="primary" size="sm" icon="lock-open" onClick={() => setOpen(true)} data-testid="unlock-button">
            Unlock {topic.title}
          </Button>
        </div>
      )}
      {/* Stays mounted while open, so a failure can still be read after the map refreshes. */}
      {(open || topic.state === 'unlockable') && (
        <UnlockDialog
          open={open}
          onClose={() => setOpen(false)}
          topic={topic}
          recipes={recipes}
          balances={balances}
          onUnlocked={() => {
            justUnlocked.current = true;
          }}
        />
      )}
    </>
  );
}

function UnlockDialog({
  open,
  onClose,
  topic,
  recipes,
  balances,
  onUnlocked,
}: {
  open: boolean;
  onClose: () => void;
  topic: TopicActionsProps['topic'];
  recipes: RecipeCard[];
  balances: BalanceIndex;
  onUnlocked: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const firstReady = recipes.find((r) => r.ready)?.id ?? '';
  const [choice, setChoice] = useState(firstReady);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReactNode>(null);

  // Recipes arrive cheapest first: default to the cheapest ready one each time the dialog opens…
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setError(null);
      setChoice(firstReady);
    }
    wasOpen.current = open;
  }, [open, firstReady]);
  // …and move off a choice that fresh data says is no longer spendable.
  useEffect(() => {
    if (choice !== firstReady && !recipes.some((r) => r.id === choice && r.ready)) setChoice(firstReady);
  }, [recipes, choice, firstReady]);

  const selected = recipes.find((r) => r.id === choice && r.ready) ?? null;
  const total = selected?.spend?.reduce((sum, l) => sum + l.amount, 0) ?? 0;
  const after = new Map<string, number>();
  for (const l of selected?.spend ?? []) after.set(l.topic.id, (after.get(l.topic.id) ?? 0) + l.amount);

  const close = () => {
    if (!pending) onClose();
  };

  const confirm = async () => {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await unlockTopicAction(topic.id, selected.id);
      if (!res.ok) {
        setError(errorContent(res.error, balances));
        // The map behind the dialog is stale (tokens spent elsewhere, a tier closed…): refresh it.
        router.refresh();
        return;
      }
      onUnlocked();
      onClose();
      const spent = new Map<string, number>();
      for (const d of res.spent) spent.set(d.topicId, (spent.get(d.topicId) ?? 0) + d.amount);
      toast({
        tone: 'ok',
        title: `${topic.title} unlocked`,
        description:
          res.status === 'already_unlocked'
            ? 'It was already open — nothing was spent.'
            : `Spent ${[...spent].map(([id, n]) => `${n} ${balances[id]?.title ?? 'tokens'}`).join(' · ')}. Its problems and components are open.`,
      });
      toastBadges(toast, res.badges);
      router.refresh();
    } catch {
      setError('Couldn’t reach the server. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      role="alertdialog"
      title={`Unlock ${topic.title}?`}
      description={`Spend one recipe. Tokens come out of your cheapest qualifying buckets first, and ${topic.title} stays open for good.`}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" icon="lock-open" loading={pending} disabled={!selected} onClick={() => void confirm()} data-testid="confirm-unlock">
            {selected ? `Unlock · spend ${total}` : 'Unlock'}
          </Button>
        </>
      }
    >
      <fieldset className={s.choices}>
        <legend className="sr-only">Recipe to spend</legend>
        {recipes.map((r) => (
          <label key={r.id} className={s.choice} data-disabled={!r.ready || undefined}>
            <input
              type="radio"
              name={`recipe-${topic.id}`}
              value={r.id}
              checked={choice === r.id}
              disabled={!r.ready || pending}
              onChange={() => setChoice(r.id)}
            />
            <span className={s.choiceBody}>
              <span className={s.choiceTitle}>{r.title}</span>
              <span className={s.choiceItems}>
                {r.items.map((i) => `${i.need} ${i.topic.title}${minText(i.minDifficulty)}`).join(' · ')}
              </span>
            </span>
            {r.ready ? (
              <Pill tone="ok" size="xs" icon="check">
                Ready
              </Pill>
            ) : (
              <Pill tone="muted" size="xs">
                {r.missing} missing
              </Pill>
            )}
          </label>
        ))}
      </fieldset>

      {selected?.spend && (
        <div className={s.spend} data-testid="unlock-spend">
          <p className={s.label}>You’ll spend {plural(total, 'token')}</p>
          <ul className={s.spendList}>
            {selected.spend.map((line) => (
              <li key={`${line.topic.id}-${line.difficulty}`} className={s.spendRow}>
                <span className={s.spendAmount}>−{line.amount}</span>
                <Icon name={line.topic.icon} size={12} />
                <span>{line.topic.title}</span>
                <DifficultyPill level={line.difficulty} size="xs" />
              </li>
            ))}
          </ul>
          <p className={s.spendAfter}>
            Balance after:{' '}
            {[...after]
              .map(([id, n]) => {
                const b = balances[id];
                return b ? `${b.title} ${b.total} → ${b.total - n}` : null;
              })
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}

      {error && (
        <div className={s.formError} role="alert" data-testid="unlock-error">
          <Icon name="alert-circle" size={14} />
          <div>{error}</div>
        </div>
      )}
    </Modal>
  );
}
