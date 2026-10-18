import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * Shared form choice controls.
 *  - Combobox: searchable dropdown for long lists (banks, states, schools).
 *  - ChoiceButtons: tap buttons (radio group) for 2 to ~7 options.
 * Both start empty when value is '' / null, show an inline error, have 44px+
 * touch targets, full keyboard support and work in light and dark mode.
 */

export interface ComboOption {
  value: string;
  label: string;
  /** Extra search terms, e.g. abbreviations ("UNILAG"). */
  keywords?: string;
}

const baseField =
  'w-full h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border-2 border-transparent text-[16px] font-medium text-ink dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none focus:border-pulse-500 focus:bg-white dark:focus:bg-zinc-950 transition-colors aria-[invalid=true]:border-red-500/70';

function FieldLabel({ htmlFor, id, label, hint }: { htmlFor?: string; id?: string; label: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1 mb-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} id={id} className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      ) : (
        <span id={id} className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {label}
        </span>
      )}
      {hint && <span className="text-xs text-zinc-400 text-right">{hint}</span>}
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-[13px] font-medium text-red-600 dark:text-red-400 px-1 mt-1.5">
      {children}
    </p>
  );
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ');

export function Combobox({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyText = 'No matches',
  error,
  required,
  className = '',
  pinned,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Option values always kept at the bottom of results (e.g. "Other"). */
  pinned?: string[];
}) {
  const id = useId();
  const listId = `${id}-list`;
  const errId = `${id}-err`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find(o => o.value === value);

  const results = useMemo(() => {
    const q = norm(query).trim();
    const pins = options.filter(o => pinned?.includes(o.value));
    const rest = options.filter(o => !pinned?.includes(o.value));
    if (!q) return [...rest, ...pins];
    const words = q.split(/\s+/);
    const hit = rest
      .map(o => {
        const hay = norm(`${o.label} ${o.keywords || ''}`);
        if (!words.every(w => hay.includes(w))) return null;
        const starts = norm(o.label).startsWith(q) || norm(o.keywords || '').split(/\s+/).some(k => k.startsWith(q));
        return { o, score: starts ? 0 : 1 };
      })
      .filter((x): x is { o: ComboOption; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map(x => x.o);
    return [...hit, ...pins];
  }, [options, query, pinned]);

  // Close on outside tap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  });

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (open) return;
    setOpen(true);
    setQuery('');
    const idx = selected ? results.findIndex(o => o.value === selected.value) : 0;
    setActive(Math.max(0, idx));
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (o: ComboOption) => {
    onChange(o.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (results.length ? (a + d + results.length) % results.length : 0));
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === 'Enter') {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      } else if (!open) {
        e.preventDefault();
        openList();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className={className} ref={wrapRef}>
      <FieldLabel htmlFor={id} label={label} hint={hint} />
      <div className="relative">
        <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none ${open ? '' : 'hidden'}`} />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          aria-required={required || undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className={`${baseField} ${open ? 'pl-10' : 'pl-4'} pr-11 cursor-pointer truncate`}
          placeholder={open ? (selected ? selected.label : 'Type to search') : placeholder}
          value={open ? query : selected?.label ?? ''}
          onChange={e => {
            setQuery(open ? e.target.value : '');
            setActive(0);
            if (!open) setOpen(true);
          }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? `Close ${label} list` : `Open ${label} list`}
          onClick={() => (open ? close() : inputRef.current?.focus())}
          className="absolute inset-y-0 right-1 w-11 flex items-center justify-center text-zinc-500 cursor-pointer"
        >
          <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-30 left-0 right-0 mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-1"
          >
            {results.length === 0 ? (
              <li className="px-4 py-3 text-sm text-zinc-500">{emptyText}</li>
            ) : (
              results.map((o, i) => {
                const isSel = o.value === value;
                return (
                  <li
                    key={o.value}
                    id={`${id}-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSel}
                    onPointerDown={e => e.preventDefault()}
                    onClick={() => pick(o)}
                    onMouseMove={() => setActive(i)}
                    className={`flex items-center justify-between gap-2 min-h-11 px-3 py-2 rounded-xl text-[15px] cursor-pointer ${
                      i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''
                    } ${isSel ? 'font-bold text-ink dark:text-white' : 'text-zinc-700 dark:text-zinc-200'}`}
                  >
                    <span className="min-w-0">{o.label}</span>
                    {isSel && <Check className="w-4 h-4 shrink-0 text-pulse-600 dark:text-pulse-400" />}
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}

export function ChoiceButtons<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  error,
  required,
  columns,
  className = '',
}: {
  label: string;
  hint?: string;
  value: T | '' | null;
  onChange: (value: T) => void;
  options: readonly { id: T; label: string }[];
  error?: string;
  required?: boolean;
  /** Grid columns; default wraps buttons as chips. */
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selIdx = options.findIndex(o => o.id === value);

  const move = (from: number, d: number) => {
    const next = (from + d + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].id);
  };

  const layout = columns ? (columns === 2 ? 'grid grid-cols-2' : columns === 3 ? 'grid grid-cols-3' : 'grid grid-cols-2 sm:grid-cols-4') : 'flex flex-wrap';

  return (
    <div className={className}>
      <FieldLabel id={`${id}-label`} label={label} hint={hint} />
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        aria-required={required || undefined}
        className={`${layout} gap-2 rounded-2xl ${error ? 'ring-2 ring-red-500/60 ring-offset-2 ring-offset-white dark:ring-offset-ink' : ''}`}
      >
        {options.map((o, i) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              ref={el => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (selIdx === -1 && i === 0) ? 0 : -1}
              onClick={() => onChange(o.id)}
              onKeyDown={e => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={`tactile min-h-11 px-4 rounded-full border-2 text-sm font-bold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-500 ${
                on
                  ? 'border-pulse-500 bg-pulse-500/12 text-ink dark:text-white'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}
