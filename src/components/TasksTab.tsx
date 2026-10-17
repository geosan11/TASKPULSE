import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, ImagePlus, ListChecks, Loader2, Search } from 'lucide-react';
import { Card, EmptyState, inputClass, primaryButtonClass, StatusPill, textareaClass, Label } from './ui';
import { formatNaira } from '../config/marketplace';
import { submitTaskProofRpc, uploadTaskProofImage, type DbTask } from '../lib/supabaseClient';
import { formatDateTime, type MySubmission, type UserProfile } from '../types';

export function TasksTab({
  user,
  tasks,
  submissions,
  onSubmitted,
  notify,
}: {
  user: UserProfile;
  tasks: DbTask[];
  submissions: MySubmission[];
  onSubmitted: () => Promise<void>;
  notify: (title: string, subtitle: string) => void;
}) {
  const [view, setView] = useState<'available' | 'mine'>('available');
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DbTask | null>(null);

  const submittedTaskIds = useMemo(() => new Set(submissions.map(s => s.taskId)), [submissions]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(tasks.map(t => t.category)))], [tasks]);
  const visible = tasks.filter(
    t =>
      (category === 'All' || t.category === category) &&
      (!query.trim() || `${t.title} ${t.company}`.toLowerCase().includes(query.trim().toLowerCase()))
  );

  if (selected) {
    return (
      <TaskWorkspace
        task={selected}
        user={user}
        alreadySubmitted={submittedTaskIds.has(selected.id)}
        onBack={() => setSelected(null)}
        onDone={async () => {
          setSelected(null);
          setView('mine');
          await onSubmitted();
        }}
        notify={notify}
      />
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-slate-100 dark:bg-zinc-800">
        {(['available', 'mine'] as const).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`h-9 rounded-full text-[11px] font-black cursor-pointer transition-all ${
              view === v ? 'bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
            }`}
          >
            {v === 'available' ? `Available (${tasks.length})` : `My submissions (${submissions.length})`}
          </button>
        ))}
      </div>

      {view === 'available' ? (
        <>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${inputClass} pl-10`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {categories.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-3 h-8 rounded-full text-[11px] font-black whitespace-nowrap cursor-pointer border ${
                  category === c
                    ? 'bg-sky-500 text-white border-sky-500'
                    : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 border-slate-200 dark:border-white/[0.08]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="w-6 h-6" />}
              title="No tasks right now"
              subtitle="New business-funded tasks are posted often. Check back soon."
            />
          ) : (
            <div className="space-y-2">
              {visible.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className="w-full text-left p-4 rounded-3xl bg-white dark:bg-zinc-900/70 border border-slate-200/80 dark:border-white/[0.06] card-interactive cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-widest text-sky-600 dark:text-cyan-400">{t.category}</p>
                      <p className="text-sm font-black text-slate-900 dark:text-white leading-tight mt-0.5">{t.title}</p>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                        {t.company} · {t.time} · {t.spotsLeft} of {t.spotsTotal} slots left
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-black text-emerald-600 dark:text-emerald-400">{formatNaira(t.reward)}</p>
                      {submittedTaskIds.has(t.id) && <StatusPill status="pending" />}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : submissions.length === 0 ? (
        <EmptyState icon={<ListChecks className="w-6 h-6" />} title="No submissions yet" subtitle="Complete a task and submit proof to get paid." />
      ) : (
        <div className="space-y-2">
          {submissions.map(s => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-900 dark:text-white">{s.taskTitle}</p>
                  <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                    {s.company} · {formatDateTime(s.completedAt)} (WAT)
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-sm font-black text-slate-900 dark:text-white">{formatNaira(s.paidAmount ?? s.reward)}</p>
                  <StatusPill status={s.status} />
                </div>
              </div>
              {s.reviewNote && <p className="text-[11px] text-slate-500 dark:text-zinc-400 italic">Reviewer: {s.reviewNote}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskWorkspace({
  task,
  user,
  alreadySubmitted,
  onBack,
  onDone,
  notify,
}: {
  task: DbTask;
  user: UserProfile;
  alreadySubmitted: boolean;
  onBack: () => void;
  onDone: () => Promise<void>;
  notify: (title: string, subtitle: string) => void;
}) {
  const [proofText, setProofText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('Screenshot must be smaller than 5MB.');
      return;
    }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    setError(null);
    if (task.proofType === 'screenshot' && !file) {
      setError('Please attach a screenshot.');
      return;
    }
    if (task.proofType === 'link' && !/^https:\/\//i.test(proofText.trim())) {
      setError('Please paste a link that starts with https://');
      return;
    }
    if (task.proofType === 'text' && proofText.trim().length < 2) {
      setError('Please type your answer.');
      return;
    }
    setSubmitting(true);
    try {
      let path: string | undefined;
      if (file) path = await uploadTaskProofImage(file, user.id);
      await submitTaskProofRpc({ taskId: task.id, proofText: proofText.trim() || undefined, proofScreenshotPath: path });
      notify('Proof submitted', `${task.company} will review it. You'll be paid ${formatNaira(task.reward)} once approved.`);
      await onDone();
    } catch (err: any) {
      setError(err.message || 'Could not submit proof.');
    } finally {
      setSubmitting(false);
    }
  };

  const isOwn = task.company && user.businessName && task.company === user.businessName && user.role === 'business';

  return (
    <div className="space-y-4 pb-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[11px] font-black text-slate-500 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Back to tasks
      </button>

      <Card>
        <p className="text-[10px] font-black uppercase tracking-widest text-sky-600 dark:text-cyan-400">{task.category}</p>
        <h2 className="text-lg font-black text-slate-900 dark:text-white leading-tight">{task.title}</h2>
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
          <span>
            {task.company} · {task.spotsLeft} slots left
          </span>
          <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{formatNaira(task.reward)}</span>
        </div>
        {(!task.campaignId || task.steps.length === 0) && (
          <p className="text-xs text-slate-600 dark:text-zinc-300 whitespace-pre-line leading-relaxed">{task.description}</p>
        )}
        {task.steps.length > 0 && (
          <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-600 dark:text-zinc-300">
            {task.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {task.targetUrl && (
          <a
            href={task.targetUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 text-[11px] font-black text-sky-600 dark:text-cyan-400"
          >
            Open task link <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </Card>

      <Card>
        <p className="text-xs font-black text-slate-900 dark:text-white">Submit your proof</p>
        {alreadySubmitted ? (
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">You have already submitted proof for this task. Check "My submissions" for its status.</p>
        ) : isOwn ? (
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">This is your own campaign, so you can't complete it.</p>
        ) : (
          <>
            {task.proofType === 'screenshot' && (
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full p-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-white/[0.12] text-slate-500 dark:text-zinc-400 flex flex-col items-center gap-2 cursor-pointer"
                >
                  {preview ? (
                    <img src={preview} alt="Proof preview" className="max-h-48 rounded-xl object-contain" />
                  ) : (
                    <>
                      <ImagePlus className="w-6 h-6" />
                      <span className="text-[11px] font-bold">Tap to attach a screenshot (max 5MB)</span>
                    </>
                  )}
                </button>
              </div>
            )}
            <div>
              <Label hint={task.proofType === 'screenshot' ? 'Optional note' : undefined}>
                {task.proofType === 'link' ? 'Link to your proof' : task.proofType === 'text' ? 'Your answer' : 'Note for the reviewer'}
              </Label>
              {task.proofType === 'link' ? (
                <input className={inputClass} value={proofText} onChange={e => setProofText(e.target.value)} placeholder="https://" inputMode="url" />
              ) : (
                <textarea className={textareaClass} rows={3} value={proofText} onChange={e => setProofText(e.target.value)} maxLength={2000} />
              )}
            </div>
            {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
            <button type="button" className={primaryButtonClass} onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit proof
            </button>
            <p className="text-[10px] text-slate-400 text-center">Fake or copied proofs are rejected and can get your account suspended.</p>
          </>
        )}
      </Card>
    </div>
  );
}
