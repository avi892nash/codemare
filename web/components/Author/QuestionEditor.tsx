'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  deleteDraftAction,
  publishAction,
  runReferenceAction,
  saveDraftAction,
  unpublishAction,
} from '@/app/(workspace)/author/actions';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';
import { stripKeys, withKeys, type SectionProps } from './kit';
import {
  computeChecklist,
  draftSignature,
  fillExpectedFromRun,
  generateStub,
  IDENTIFIER_RE,
  LANGUAGE_NAMES,
  providedReferences,
  referenceFingerprint,
  slugify,
  type CheckItem,
  type CheckKey,
  type DraftMeta,
  type QuestionDraft,
  type ReferenceRun,
} from './model';
import { PublishRail, type RailBusy } from './PublishRail';
import { BasicsSection, type TopicOption } from './sections/BasicsSection';
import { EditorialSection, HintsSection } from './sections/HintsSection';
import { ReferenceSection } from './sections/ReferenceSection';
import { SignatureSection } from './sections/SignatureSection';
import { StarterSection } from './sections/StarterSection';
import { ExamplesSection, StatementSection } from './sections/StatementSection';
import { TestsSection } from './sections/TestsSection';
import s from './author.module.css';

export interface QuestionEditorProps {
  initial: QuestionDraft;
  meta: DraftMeta;
  topics: TopicOption[];
  suggestions: { tags: string[]; companies: string[] };
  /** Set when staff edit someone else's question. */
  ownerNote?: string | null;
}

type Edited = Record<SupportedLanguage, boolean>;
interface State {
  draft: QuestionDraft;
  /** Starter stubs the author changed by hand (kept when the signature changes). */
  edited: Edited;
}
type Action =
  | { type: 'update'; fn: (d: QuestionDraft) => QuestionDraft }
  | { type: 'starter'; lang: SupportedLanguage; code: string }
  | { type: 'regenerate'; langs: SupportedLanguage[] };

const sigKey = (d: QuestionDraft) => JSON.stringify([d.functionName, d.params.map((p) => [p.name, p.type]), d.returns]);

function stub(d: QuestionDraft, lang: SupportedLanguage) {
  return generateStub(lang, d.functionName, draftSignature(d));
}

function initialEdited(d: QuestionDraft): Edited {
  const valid = IDENTIFIER_RE.test(d.functionName);
  return Object.fromEntries(
    LANGUAGES.map((l) => [l, d.starterCode[l].trim() !== '' && (!valid || d.starterCode[l] !== stub(d, l))])
  ) as Edited;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'update': {
      const next = action.fn(state.draft);
      // Keep untouched stubs in sync with the signature.
      if (sigKey(next) === sigKey(state.draft) || !IDENTIFIER_RE.test(next.functionName)) return { ...state, draft: next };
      const starterCode = { ...next.starterCode };
      for (const l of LANGUAGES) if (!state.edited[l]) starterCode[l] = stub(next, l);
      return { ...state, draft: { ...next, starterCode } };
    }
    case 'starter': {
      const generated = IDENTIFIER_RE.test(state.draft.functionName) ? stub(state.draft, action.lang) : null;
      return {
        draft: { ...state.draft, starterCode: { ...state.draft.starterCode, [action.lang]: action.code } },
        edited: { ...state.edited, [action.lang]: action.code.trim() !== '' && action.code !== generated },
      };
    }
    case 'regenerate': {
      if (!IDENTIFIER_RE.test(state.draft.functionName)) return state;
      const starterCode = { ...state.draft.starterCode };
      const edited = { ...state.edited };
      for (const l of action.langs) {
        starterCode[l] = stub(state.draft, l);
        edited[l] = false;
      }
      return { draft: { ...state.draft, starterCode }, edited };
    }
  }
}

/** Content identity for the unsaved-changes check (client-only keys excluded). */
const snapshot = (d: QuestionDraft) => JSON.stringify(stripKeys(d));

interface EditorError {
  message: string;
  details: string[];
  fields: { path: string; message: string }[];
}

/**
 * The authoring editor (artboard A1): nine sections on the left, the sticky
 * publish rail on the right. Holds the draft in memory; Save draft / Publish
 * send it to the server actions, which validate it again.
 */
export function QuestionEditor({ initial, meta: initialMeta, topics, suggestions, ownerNote }: QuestionEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, dispatch] = useReducer(reducer, initial, (d) => ({ draft: withKeys(d), edited: initialEdited(d) }));
  const { draft } = state;
  const [meta, setMeta] = useState(initialMeta);
  const [saved, setSaved] = useState(() => snapshot(initial));
  const [runs, setRuns] = useState<Partial<Record<SupportedLanguage, ReferenceRun>>>({});
  const [running, setRunning] = useState<SupportedLanguage | 'all' | null>(null);
  const [busy, setBusy] = useState<RailBusy>(null);
  const [error, setError] = useState<EditorError | null>(null);
  const [slugLinked, setSlugLinked] = useState(() => !initial.id || slugify(initial.title) === initial.slug);
  const [confirm, setConfirm] = useState<'unpublish' | 'delete' | null>(null);

  const update = useCallback((fn: (d: QuestionDraft) => QuestionDraft) => dispatch({ type: 'update', fn }), []);
  const knownTopics = useMemo(() => new Set(topics.map((t) => t.slug)), [topics]);
  const checklist = useMemo(() => computeChecklist(draft, { runs, knownTopics }), [draft, runs, knownTopics]);
  const checks = useMemo(() => Object.fromEntries(checklist.map((c) => [c.key, c])) as Record<CheckKey, CheckItem>, [checklist]);
  const dirty = snapshot(draft) !== saved;
  const isNew = !draft.id;
  const published = meta.status === 'published';
  const freshRun = useMemo(() => {
    for (const l of LANGUAGES) {
      const r = runs[l];
      if (r && r.fingerprint === referenceFingerprint(draft, l)) return r;
    }
    return null;
  }, [runs, draft]);

  // Keep the latest draft for async handlers without re-binding them.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const failWith = (message: string, res?: { fieldErrors?: { path: string; message: string }[] }) => {
    const fields = res?.fieldErrors ?? [];
    setError({ message, details: fields.map((f) => f.message).filter((m) => m !== message), fields });
    toast({ title: message, tone: 'err' });
  };

  const onSaved = (sent: QuestionDraft, res: { id: string; status: DraftMeta['status']; updatedAt: string }) => {
    setSaved(snapshot({ ...sent, id: res.id }));
    if (!sent.id) {
      update((d) => ({ ...d, id: res.id }));
      // Same page, new URL: keeps in-memory reference runs (no remount).
      window.history.replaceState(null, '', `/author/${res.id}/edit`);
    }
    document.title = `Edit · ${sent.title || 'Untitled'} · Codemare`;
    setMeta((m) => ({ ...m, status: res.status, updatedAt: res.updatedAt }));
  };

  const save = useCallback(async () => {
    if (busy) return;
    if (published) {
      toast({ title: 'Published questions change through “Publish changes”.', tone: 'info' });
      return;
    }
    const sent = stripKeys(draftRef.current);
    setBusy('save');
    setError(null);
    try {
      const res = await saveDraftAction(sent);
      if (res.ok) {
        onSaved(sent, res);
        toast({ title: 'Draft saved', tone: 'ok', id: 'author-save' });
      } else failWith(res.error, res);
    } catch {
      failWith('Could not reach the server. Your changes are still here — try again.');
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, published]);

  const publish = async () => {
    if (busy) return;
    const sent = stripKeys(draftRef.current);
    setBusy('publish');
    setError(null);
    try {
      const res = await publishAction(sent);
      if (res.runs?.length) setRuns((r) => ({ ...r, ...Object.fromEntries(res.runs!.map((x) => [x.language, x])) }));
      if (res.ok) {
        onSaved(sent, res);
        toast({
          title: published ? 'Changes published' : 'Published',
          description: `Live at /problems/${res.slug}`,
          tone: 'ok',
        });
      } else failWith(res.error, res);
    } catch {
      failWith('Could not reach the server. Nothing was published — try again.');
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (!draft.id) return;
    setConfirm(null);
    setBusy('unpublish');
    try {
      const res = await unpublishAction(draft.id);
      if (res.ok) {
        setMeta((m) => ({ ...m, status: res.status, updatedAt: res.updatedAt }));
        toast({ title: 'Unpublished', description: 'Back to draft: hidden from learners.', tone: 'ok' });
      } else failWith(res.error, res);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    setConfirm(null);
    setBusy('delete');
    try {
      const res = await deleteDraftAction(draft.id);
      if (res.ok) {
        setSaved(snapshot(draftRef.current)); // nothing left to lose
        toast({ title: 'Draft deleted', tone: 'ok' });
        router.push('/author');
      } else failWith(res.error);
    } finally {
      setBusy(null);
    }
  };

  const runOne = async (lang: SupportedLanguage): Promise<boolean> => {
    const res = await runReferenceAction({ draft: stripKeys(draftRef.current), language: lang });
    if (res.ok) {
      setRuns((r) => ({ ...r, [lang]: res.run }));
      return true;
    }
    toast({ title: `Couldn’t run the ${LANGUAGE_NAMES[lang]} reference`, description: res.error, tone: 'err' });
    return false;
  };

  const runReference = async (lang: SupportedLanguage) => {
    if (running) return;
    setRunning(lang);
    try {
      await runOne(lang);
    } catch {
      toast({ title: 'Could not reach the server', tone: 'err' });
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    if (running) return;
    setRunning('all');
    try {
      for (const lang of providedReferences(draftRef.current)) if (!(await runOne(lang))) break;
    } catch {
      toast({ title: 'Could not reach the server', tone: 'err' });
    } finally {
      setRunning(null);
    }
  };

  const fill = (lang: SupportedLanguage, only?: number[]) => {
    const run = runs[lang];
    if (!run) return;
    const next = fillExpectedFromRun(draftRef.current, run, only);
    update(() => next.draft);
    setRuns((r) => ({ ...r, [lang]: next.run }));
  };

  // ⌘S / Ctrl+S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const slugError = error?.fields.find((f) => f.path === 'slug')?.message ?? null;
  const props: SectionProps = { draft, update, checks };

  return (
    <main className={`${s.page} scroll`}>
      <div className={s.wrap}>
        <Breadcrumb
          items={[
            { label: 'Author', href: '/author', icon: 'edit' },
            { label: isNew ? 'New question' : draft.title || 'Untitled question' },
          ]}
        />
        <header className={s.head}>
          <div style={{ minWidth: 0 }}>
            <p className={s.eyebrow}>{isNew ? 'New question' : 'Edit question'}</p>
            <h1 className={s.title}>{draft.title || <span className={s.titleMuted}>Untitled question</span>}</h1>
            <div className={s.headMeta}>
              <DifficultyPill level={draft.difficulty} />
              {draft.slug && <span className="mono">/problems/{draft.slug}</span>}
              {ownerNote && <span>· {ownerNote}</span>}
            </div>
          </div>
        </header>

        <div className={s.layout}>
          <div className={s.form}>
            <BasicsSection
              {...props}
              topics={topics}
              suggestions={suggestions}
              slugLinked={slugLinked}
              onSlugLinked={setSlugLinked}
              slugLocked={published}
              slugError={slugError && error ? slugError : null}
            />
            <StatementSection {...props} />
            <ExamplesSection {...props} />
            <SignatureSection {...props} />
            <StarterSection
              {...props}
              edited={state.edited}
              onEdit={(lang, code) => dispatch({ type: 'starter', lang, code })}
              onRegenerate={(langs) => dispatch({ type: 'regenerate', langs })}
            />
            <TestsSection {...props} freshRun={freshRun} onFill={(idx) => freshRun && fill(freshRun.language, idx)} />
            <ReferenceSection
              {...props}
              runs={runs}
              running={running}
              onRun={runReference}
              onRunAll={runAll}
              onFillAll={(lang) => fill(lang)}
            />
            <HintsSection {...props} />
            <EditorialSection {...props} />
          </div>
          <div className={s.railWrap}>
            <PublishRail
              status={meta.status}
              savedAt={meta.updatedAt}
              dirty={dirty}
              isNew={isNew}
              slug={draft.slug}
              checklist={checklist}
              busy={busy}
              runningReferences={running !== null}
              error={error}
              onSave={() => void save()}
              onPublish={() => void publish()}
              onUnpublish={() => setConfirm('unpublish')}
              onDelete={() => setConfirm('delete')}
              onRunReferences={() => void runAll()}
            />
          </div>
        </div>
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        role="alertdialog"
        size="sm"
        title={confirm === 'delete' ? 'Delete this draft?' : 'Unpublish this question?'}
        description={
          confirm === 'delete'
            ? 'The question, its tests, hints and reference solutions are deleted for good.'
            : 'Learners lose it right away. Their past submissions are kept; you can publish it again later.'
        }
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" icon={confirm === 'delete' ? 'trash' : 'eye-off'} onClick={() => void (confirm === 'delete' ? remove() : unpublish())}>
              {confirm === 'delete' ? 'Delete draft' : 'Unpublish'}
            </Button>
          </>
        }
      />
    </main>
  );
}
