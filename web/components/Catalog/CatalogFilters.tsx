'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import type { CatalogFacets } from '@/lib/server/catalog';
import { DIFFICULTIES, type Difficulty } from '@/lib/types';
import {
  CATALOG_STATUSES,
  CATALOG_STATUS_LABEL,
  EMPTY_CATALOG_QUERY,
  catalogHref,
  countFacetFilters,
  hasActiveFilters,
  normalizeSearch,
  type CatalogQuery,
  type CatalogStatus,
} from './query';
import { useFilterNav, useSettledState } from './FilterNav';
import s from './Catalog.module.css';

const SEARCH_DEBOUNCE_MS = 300;

export interface CatalogFiltersProps {
  /** The filters the page was rendered with (parsed from the URL). */
  query: CatalogQuery;
  facets: CatalogFacets;
  /** Rows matching `query`. */
  total: number;
}

/**
 * Search, difficulty chips and status / topic / tag / company selects. Every
 * change is a URL change (components/Catalog/query.ts), made in a transition
 * so the current results stay up, dimmed, until the new ones render. Choices
 * made while a navigation is in flight build on each other, not on the stale
 * URL. Below 640 px the facets fold behind a "Filters" toggle.
 */
export function CatalogFilters({ query, facets, total }: CatalogFiltersProps) {
  const { navigate, pending } = useFilterNav();
  const panelId = useId();
  const [open, setOpen] = useState(false);

  // Optimistic copy of the URL state; adopts the server's version whenever a
  // navigation settles (or the URL changes from elsewhere, e.g. ⌘K search).
  const [local, setLocal, localRef] = useSettledState(query, pending);

  const apply = (patch: Partial<CatalogQuery>, opts?: { replace?: boolean }) => {
    const next = { ...localRef.current, ...patch, page: 1 };
    setLocal(next);
    navigate(catalogHref(next), opts);
  };

  // ── search: debounced, replaces history instead of stacking entries ──
  const [text, setText] = useState(query.q);
  const sentQ = useRef(query.q);
  useEffect(() => {
    // Only an outside change (not our own echo) overwrites what is typed.
    if (normalizeSearch(query.q) !== normalizeSearch(sentQ.current)) {
      sentQ.current = query.q;
      setText(query.q);
    }
  }, [query.q]);
  const commitSearch = (value: string) => {
    const q = normalizeSearch(value);
    if (q === normalizeSearch(localRef.current.q)) return;
    sentQ.current = q;
    apply({ q }, { replace: true });
  };
  const commitRef = useRef(commitSearch);
  commitRef.current = commitSearch;
  useEffect(() => {
    const t = setTimeout(() => commitRef.current(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    commitSearch(text);
  };

  const toggleDifficulty = (d: Difficulty, on: boolean) =>
    apply({ difficulties: DIFFICULTIES.filter((x) => (x === d ? on : localRef.current.difficulties.includes(x))) });

  const clearAll = () => {
    sentQ.current = '';
    setText('');
    apply({ ...EMPTY_CATALOG_QUERY });
  };

  const facetCount = countFacetFilters(local);
  const tiers = groupTopics(facets.topics);
  const tagOptions = facets.tags.filter((t) => !local.tags.includes(t.value));
  const companyOptions = facets.companies.filter(
    (c) => !local.companies.some((x) => x.toLowerCase() === c.value.toLowerCase())
  );

  return (
    <div className={s.filters}>
      <div className={s.searchRow}>
        <form role="search" aria-label="Problems" className={s.searchForm} onSubmit={onSearchSubmit}>
          <Input
            icon="search"
            full
            aria-label="Search problems by title or tag"
            placeholder="Search by title or tag"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={100}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && text) {
                e.preventDefault();
                setText('');
                commitSearch('');
              }
            }}
            trailing={
              text ? (
                <Button
                  variant="ghost"
                  size="xs"
                  icon="x"
                  aria-label="Clear search"
                  onClick={() => {
                    setText('');
                    commitSearch('');
                  }}
                />
              ) : undefined
            }
          />
        </form>
        <Button
          className={s.toggle}
          icon="filter"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          Filters
          {facetCount > 0 && (
            <span className={s.toggleCount}>
              {facetCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </Button>
      </div>

      <div id={panelId} className={s.panel} data-open={open || undefined}>
        <div role="group" aria-label="Difficulty" className={s.chips}>
          {DIFFICULTIES.map((d) => (
            <Chip
              key={d}
              selected={local.difficulties.includes(d)}
              onToggle={(on) => toggleDifficulty(d, on)}
              count={facets.difficulty[d]}
            >
              {d}
            </Chip>
          ))}
        </div>
        <span className={s.divider} aria-hidden="true" />
        <Select
          className={s.facet}
          size="sm"
          icon="target"
          aria-label="Status"
          value={local.status ?? ''}
          onChange={(e) => apply({ status: (e.target.value || null) as CatalogStatus | null })}
        >
          <option value="">Any status</option>
          {CATALOG_STATUSES.map((st) => (
            <option key={st} value={st}>
              {CATALOG_STATUS_LABEL[st]} ({facets.status[st]})
            </option>
          ))}
        </Select>
        <Select
          className={s.facet}
          size="sm"
          icon="layers"
          aria-label="Topic"
          value={local.topic ?? ''}
          onChange={(e) => apply({ topic: e.target.value || null })}
        >
          <option value="">All topics</option>
          {tiers.map((tier) => (
            <optgroup key={tier.ord} label={`Tier ${tier.ord} · ${tier.title}`}>
              {tier.topics.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.title} ({t.count})
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select
          className={s.facet}
          size="sm"
          icon="hash"
          aria-label="Add a tag filter"
          placeholder="Tag"
          value=""
          disabled={tagOptions.length === 0}
          onChange={(e) => e.target.value && apply({ tags: [...localRef.current.tags, e.target.value] })}
        >
          {tagOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.value} ({t.count})
            </option>
          ))}
        </Select>
        <Select
          className={s.facet}
          size="sm"
          icon="bookmark"
          aria-label="Add a company filter"
          placeholder="Company"
          value=""
          disabled={companyOptions.length === 0}
          onChange={(e) => e.target.value && apply({ companies: [...localRef.current.companies, e.target.value] })}
        >
          {companyOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.value} ({c.count})
            </option>
          ))}
        </Select>
      </div>

      {(local.tags.length > 0 || local.companies.length > 0) && (
        <div className={s.active} role="group" aria-label="Tag and company filters">
          {local.tags.map((t) => (
            <Chip
              key={`tag-${t}`}
              size="sm"
              icon="hash"
              selected
              removable
              removeLabel={`Remove tag filter ${t}`}
              onRemove={() => apply({ tags: localRef.current.tags.filter((x) => x !== t) })}
            >
              {t}
            </Chip>
          ))}
          {local.companies.map((c) => (
            <Chip
              key={`company-${c}`}
              size="sm"
              icon="bookmark"
              selected
              removable
              removeLabel={`Remove company filter ${c}`}
              onRemove={() => apply({ companies: localRef.current.companies.filter((x) => x !== c) })}
            >
              {c}
            </Chip>
          ))}
        </div>
      )}

      <div className={s.meta}>
        <p className={s.metaCount} role="status">
          <span>
            <strong>{total}</strong> {total === 1 ? 'problem' : 'problems'}
          </span>
          {pending && <Spinner size={12} label="Updating results" />}
        </p>
        <span className={s.metaSpacer} />
        {hasActiveFilters(local) && (
          <Button variant="ghost" size="xs" icon="x" onClick={clearAll}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

function groupTopics(topics: CatalogFacets['topics']) {
  const tiers: Array<{ ord: number; title: string; topics: CatalogFacets['topics'] }> = [];
  for (const t of topics) {
    let tier = tiers.find((x) => x.ord === t.tierOrd);
    if (!tier) {
      tier = { ord: t.tierOrd, title: t.tierTitle, topics: [] };
      tiers.push(tier);
    }
    tier.topics.push(t);
  }
  return tiers;
}
