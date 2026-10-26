import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock, ExternalLink, ImagePlus, Loader2, Users } from 'lucide-react';
import { Card, EmptyState, ErrorPanel, ErrorText, inputClass, Label, primaryButtonClass, Segmented, StatusPill, textareaClass } from './ui';
import { formatNaira, timeLeftLabel, WORKER_REVIEW_TIMING } from '../config/marketplace';
import { requestProofHash, startTaskRpc, submitTaskProofRpc, uploadTaskProofImage, type DbTask, type TaskStart } from '../lib/supabaseClient';
import { celebrate } from '../lib/celebrate';
import { markSeen } from '../lib/motion';
import { PulseEmote } from './PulseEmote';
import { formatDateTime, type MySubmission, type UserProfile } from '../types';
import { AcceptTaskPanel, isTaskFull, TaskSpotsBar, TaskSpotsStatus, useHasSpot } from './SpotsBar';
import { useTaskFeed } from '../lib/spots';

export function TasksTab({
  user,
  tasks: taskRows,
  submissions,
  selected,
  onSelect,
  onSubmitted,
  initialView = 'available',
}: {
  initialView?: 'available' | 'mine';
  user: UserProfile;
  tasks: DbTask[];
  submissions: MySubmission[];
  selected: DbTask | null;
  onSelect: (t: DbTask | null) => void;
  onSubmitted: () => Promise<void>;
}) {
  const [view, setView] = useState<'available' | 'mine'>(initialView);
  const [category, setCategory] = useState('All');
  // Open tasks + full ones I already hold a spot on, with fresh counts.
  const tasks = useTaskFeed(taskRows);
  const submittedTaskIds = useMemo(() => new Set(submissions.map(s => s.taskId)), [submissions]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(tasks.map(t => t.category)))], [tasks]);
  const visible = tasks.filter(t => category === 'All' || t.category === category);
  const pendingCount = submissions.filter(s => s.status === 'pending').length;

  if (selected) {
    return (
      <TaskWorkspace
        task={selected}
        user={user}
        alreadySubmitted={submittedTaskIds.has(selected.id)}
        onBack={() => onSelect(null)}
        onDone={async () => {
          onSelect(null);
          setView('mine');
          await onSubmitted();
        }}
      />
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <h1 className="text-2xl font-extrabold text-ink dark:text-white px-1 pt-1">Tasks</h1>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { id: 'available', label: 'Available' },
          { id: 'mine', label: `My work${submissions.length ? ` (${submissions.length})` : ''}` },
        ]}
      />

      {view === 'available' ? (
        <>
          {categories.length > 2 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {categories.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`tactile px-4 h-9 rounded-full text-sm font-semibold whitespace-nowrap cursor-pointer ${
                    category === c ? 'bg-ink text-white dark:bg-white dark:text-ink' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <EmptyState emote="wink" title="Be first in line for paid tasks." subtitle="No open tasks right now. New ones appear here as businesses post them." />
          ) : (
            <div className="space-y-3">
              {visible.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t)}
                  className={`tactile w-full text-left p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 cursor-pointer ${isTaskFull(t) ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <p className="text-[15px] font-bold text-ink dark:text-white leading-snug">{t.title}</p>
                      <p className="text-sm text-zinc-500">{t.company}</p>
                    </div>
                    <p className="text-lg font-extrabold text-pulse-700 dark:text-pulse-400 shrink-0">{formatNaira(t.reward)}</p>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs font-medium text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {t.time}
                    </span>
                    {submittedTaskIds.has(t.id) && <span className="ml-auto text-zinc-400">Submitted</span>}
                  </div>
                  <TaskSpotsBar task={t} className="mt-3" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : submissions.length === 0 ? (
        <EmptyState
          emote="determined"
          emoteAnimate="none"
          title="Do your first task"
          subtitle="Finish a task and send proof to get paid."
          action={
            tasks.length > 0 ? (
              <button type="button" className={`${primaryButtonClass} max-w-[220px] mx-auto`} onClick={() => setView('available')}>
                See open tasks
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
        {pendingCount > 0 && (
          <div className="flex items-center gap-3 p-3 pr-4 rounded-3xl bg-zinc-100 dark:bg-zinc-900">
            <PulseEmote name="searching" size={56} animate="bob" alt="" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-ink dark:text-white">
                {pendingCount === 1 ? '1 proof under review' : `${pendingCount} proofs under review`}
              </p>
              <p className="text-xs text-zinc-500">The business is checking it. We'll update this list when they do.</p>
            </div>
          </div>
        )}
        <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
          {submissions.map(s => (
            <div key={s.id} className="px-5 py-4 bg-white dark:bg-zinc-900 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-bold text-ink dark:text-white min-w-0">{s.taskTitle}</p>
                <p className="text-[15px] font-extrabold text-ink dark:text-white shrink-0">{formatNaira(s.paidAmount ?? s.reward)}</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">{formatDateTime(s.completedAt)}</p>
                <StatusPill status={s.status} kind="submission" />
              </div>
              <SubmissionPayoutLine s={s} />
              {s.reviewNote && <p className="text-sm text-zinc-500">“{s.reviewNote}”</p>}
            </div>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}

/** "Approved, ₦X pending, withdrawable in Xh" and friends. */
function SubmissionPayoutLine({ s }: { s: MySubmission }) {
  const amount = formatNaira(s.paidAmount ?? s.reward);
  if (s.status === 'approved' && s.payoutStatus === 'held') {
    const left = timeLeftLabel(s.reviewDeadlineAt);
    return (
      <p className="text-sm font-semibold text-pulse-700 dark:text-pulse-400">
        Approved, {amount} pending{left && left !== 'now' ? `, withdrawable in ${left}` : ', withdrawable shortly'}
      </p>
    );
  }
  if (s.status === 'approved' && s.payoutStatus === 'released') {
    return <p className="text-sm text-zinc-500">{amount} is in your withdrawable balance</p>;
  }
  if (s.status === 'pending' && s.reviewDeadlineAt) {
    const left = timeLeftLabel(s.reviewDeadlineAt);
    // Past the deadline but still pending: being processed, or (if the platform
    // holds flagged items) waiting for a person.
    return <p className="text-sm text-zinc-500">{left && left !== 'now' ? `Approved automatically in ${left} if not reviewed` : 'Waiting for review'}</p>;
  }
  return null;
}

/** Task link with the worker's TaskPulse reference added (per-worker completion codes). */
function taskLinkWithRef(url: string, ref: string | undefined) {
  if (!ref) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('tp_ref', ref);
    return u.toString();
  } catch {
    return url;
  }
}

function TaskWorkspace({
  task,
  user,
  alreadySubmitted,
  onBack,
  onDone,
}: {
  task: DbTask;
  user: UserProfile;
  alreadySubmitted: boolean;
  onBack: () => void;
  onDone: () => Promise<void>;
}) {
  const hasSpot = useHasSpot(task);
  const [proofText, setProofText] = useState('');
  const [code, setCode] = useState('');
  const [start, setStart] = useState<TaskStart | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isOwnTask = Boolean(task.company && user.businessName && task.company === user.businessName && user.role === 'business');

  // Opening a task counts as starting it (used for the minimum-time check
  // and per-worker completion codes). Idempotent on the server.
  useEffect(() => {
    if (alreadySubmitted || isOwnTask) return;
    let cancelled = false;
    startTaskRpc(task.id).then(r => {
      if (!cancelled) setStart(r);
    });
    return () => {
      cancelled = true;
    };
  }, [task.id, alreadySubmitted, isOwnTask]);

  const needsCode = Boolean(start?.needs_code);
  // The human window applies to anything a person reviews; the shorter auto
  // window only to instant, system-verified approvals (not screenshot proof).
  const humanHours = start?.review_window_human_hours ?? 48;

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
    setFailed(null);
    if (task.proofType === 'screenshot' && !file) {
      setError('Please attach a screenshot.');
      return;
    }
    if (task.proofType === 'link' && !/^https:\/\//i.test(proofText.trim())) {
      setError('Please paste a link that starts with https://');
      return;
    }
    if (task.proofType === 'text' && proofText.trim().length < 2 && !(needsCode && code.trim())) {
      setError('Please type your answer.');
      return;
    }
    if (needsCode && !code.trim()) {
      setError('Please enter the completion code shown at the end of the task.');
      return;
    }
    setSubmitting(true);
    try {
      let path: string | undefined;
      if (file) {
        path = await uploadTaskProofImage(file, user.id);
        await requestProofHash(path);
      }
      const res = await submitTaskProofRpc({
        taskId: task.id,
        proofText: proofText.trim() || undefined,
        proofScreenshotPath: path,
        completionCode: code.trim() || undefined,
      });
      if (res?.instant) {
        const left = timeLeftLabel(res.release_at) || `${res.review_window_kind === 'auto' ? start?.review_window_auto_hours ?? 24 : humanHours}h`;
        // This celebration covers the instant approval, so the later
        // "Task approved!" reward toast for the same submission is skipped.
        if (res.completion_id) markSeen(`approved:${res.completion_id}`);
        celebrate('Approved!', `${formatNaira(res.credited ?? task.reward)} pending, withdrawable in ${left}.`, {
          emote: 'success',
          effect: 'confetti',
          id: `approved:${res.completion_id ?? `${task.id}:${user.id}`}`,
        });
      } else {
        celebrate('Proof sent!', `${task.company} reviews it within ${humanHours}h. If they don't, it's approved automatically.`, {
          emote: 'searching',
          effect: 'bob',
          id: `proof:${task.id}:${user.id}`,
        });
      }
      await onDone();
    } catch (err: any) {
      setFailed(err?.message || 'Could not submit proof. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const isOwn = isOwnTask;
  const linkHref = task.targetUrl ? taskLinkWithRef(task.targetUrl, start?.code_mode === 'unique' ? start.start_ref : undefined) : null;

  return (
    <div className="space-y-5 pb-8">
      <button type="button" onClick={onBack} className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center cursor-pointer" aria-label="Back">
        <ArrowLeft className="w-5 h-5 text-ink dark:text-white" />
      </button>

      <div className="space-y-2 px-1">
        <p className="text-sm text-zinc-500">{task.company}</p>
        <h1 className="text-2xl font-extrabold text-ink dark:text-white leading-tight">{task.title}</h1>
        <div className="flex items-center gap-4 text-sm text-zinc-500 pt-1">
          <span className="text-xl font-extrabold text-pulse-700 dark:text-pulse-400">{formatNaira(task.reward)}</span>
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" /> {task.time}
          </span>
        </div>
        <TaskSpotsStatus task={task} />
        {task.campaignId && <p className="text-xs text-zinc-500">{WORKER_REVIEW_TIMING}</p>}
      </div>

      <Card>
        {(!task.campaignId || task.steps.length === 0) && (
          <p className="text-[15px] text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed">{task.description}</p>
        )}
        {task.steps.length > 0 && (
          <ol className="space-y-3">
            {task.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-[15px] text-zinc-700 dark:text-zinc-300">
                <span className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-bold flex items-center justify-center shrink-0 text-ink dark:text-white">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        )}
        {linkHref && (
          <a href={linkHref} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 text-sm font-bold text-pulse-700 dark:text-pulse-400">
            Open task link <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </Card>

      {alreadySubmitted ? (
        <div className="flex flex-col items-center gap-2 text-center px-6">
          <PulseEmote name="searching" size={80} alt="" />
          <p className="text-sm text-zinc-500">You've already sent proof for this task. Check "My work" for the result.</p>
        </div>
      ) : isOwn ? (
        <p className="text-sm text-zinc-500 text-center px-6">This is your own task, so you can't complete it.</p>
      ) : !hasSpot ? (
        <AcceptTaskPanel task={task} />
      ) : (
        <div className="space-y-4">
          {task.proofType === 'screenshot' && (
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full p-6 rounded-3xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 flex flex-col items-center gap-2 cursor-pointer"
              >
                {preview ? (
                  <img src={preview} alt="Proof preview" className="max-h-56 rounded-2xl object-contain" />
                ) : (
                  <>
                    <ImagePlus className="w-7 h-7" />
                    <span className="text-sm font-semibold">Add a screenshot</span>
                  </>
                )}
              </button>
            </div>
          )}
          {needsCode && (
            <div>
              <Label hint="Shown at the end of the task">Completion code</Label>
              <input className={inputClass} value={code} onChange={e => setCode(e.target.value)} maxLength={128} autoComplete="off" placeholder="e.g. BLUE42" />
              {start?.code_mode === 'unique' && (
                <p className="text-xs text-zinc-500 mt-1.5 px-1">Open the task with the link above: your code is unique to you.</p>
              )}
            </div>
          )}
          <div>
            <Label hint={task.proofType === 'screenshot' || (task.proofType === 'text' && needsCode) ? 'Optional' : undefined}>
              {task.proofType === 'link' ? 'Link to your proof' : task.proofType === 'text' ? 'Your answer' : 'Note'}
            </Label>
            {task.proofType === 'link' ? (
              <input className={inputClass} value={proofText} onChange={e => setProofText(e.target.value)} placeholder="https://" inputMode="url" />
            ) : (
              <textarea className={textareaClass} rows={3} value={proofText} onChange={e => setProofText(e.target.value)} maxLength={2000} />
            )}
          </div>
          <ErrorText>{error}</ErrorText>
          {failed && !submitting && <ErrorPanel title="Proof not sent" message={failed} actionLabel="Try again" onAction={submit} />}
          <button type="button" className={primaryButtonClass} onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
            Send proof
          </button>
          <p className="text-xs text-zinc-400 text-center">Fake proofs are rejected.</p>
        </div>
      )}
    </div>
  );
}
