import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Ban, Check, Clock, Image as ImageIcon, Loader2, Pause, Play, Plus, X, Zap } from 'lucide-react';
import { EmptyState, ErrorText, inputClass, Label, Modal, primaryButtonClass, secondaryButtonClass, Segmented, StatusPill, textareaClass } from './ui';
import { SpotsBar } from './SpotsBar';
import { spotsState } from '../lib/spots';
import {
  approvalModeCopy,
  approvalModeOptions,
  CATEGORY_HINTS,
  CHECK_FLAG_LABELS,
  instantWindowHours,
  REVIEW_REASON_LABELS,
  reviewWindowsFrom,
  timeLeftLabel,
  type ApprovalMode,
  type CodeMode,
  type ReviewWindows,
  computeCampaignCost,
  computeCancelRefund,
  formatNaira,
  NOT_ALLOWED_TASKS,
  PROHIBITED_MESSAGES,
  prohibitedTaskReason,
  PROOF_TYPES,
  TASK_CATEGORIES,
  type MarketplaceSettings,
  type ProofType,
  type TaskCategory,
} from '../config/marketplace';
import {
  becomeBusinessRpc,
  createCampaignRpc,
  fetchMyCampaigns,
  fetchLatestPendingCampaignPayment,
  fetchReviewSubmissions,
  getProofSignedUrl,
  reviewSubmissionRpc,
  setCampaignStatusRpc,
  type Campaign,
  type ReviewListStatus,
  type ReviewSubmission,
} from '../lib/marketplace';
import { initializeCampaignFunding, verifyPayment } from '../lib/api';
import { formatDateTime, type UserProfile } from '../types';

export function BusinessTab({
  user,
  settings,
  onChanged,
  notify,
}: {
  user: UserProfile;
  settings: MarketplaceSettings;
  onChanged: () => Promise<void>;
  notify: (title: string, subtitle: string) => void;
}) {
  const isBusiness = user.role === 'business' || user.role === 'admin';
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<{ campaignId: string | null; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!isBusiness) return;
    setLoading(true);
    setCampaigns(await fetchMyCampaigns());
    setLoading(false);
  }, [isBusiness]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isBusiness) return <BecomeBusiness onDone={onChanged} notify={notify} />;

  if (reviewing) {
    return (
      <ReviewPanel
        campaignId={reviewing.campaignId}
        title={reviewing.title}
        windows={reviewWindowsFrom(settings)}
        onBack={() => {
          setReviewing(null);
          load();
        }}
        notify={notify}
      />
    );
  }

  const toReview = campaigns.reduce((n, c) => n + c.slotsPending, 0);

  return (
    <div className="space-y-6 pb-8">
      <div className="px-1 pt-1">
        <p className="text-sm text-zinc-500">{user.businessName || 'Your business'}</p>
        <h1 className="text-2xl font-extrabold text-ink dark:text-white">Campaigns</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setCreating(true)} className={primaryButtonClass}>
          <Plus className="w-5 h-5" /> Post a task
        </button>
        <button
          type="button"
          onClick={() => setReviewing({ campaignId: null, title: user.role === 'admin' ? 'All submissions' : 'To review' })}
          className={secondaryButtonClass}
        >
          Review{toReview > 0 ? ` (${toReview})` : ''}
        </button>
      </div>

      {loading && campaigns.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState mascot="thinking" title="No campaigns yet." subtitle="Post a task and real people will start on it." />
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <CampaignCard key={c.id} campaign={c} settings={settings} onReview={() => setReviewing({ campaignId: c.id, title: c.title })} onChanged={load} notify={notify} />
          ))}
        </div>
      )}

      <CreateCampaignModal
        open={creating}
        settings={settings}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          await load();
        }}
        notify={notify}
      />
    </div>
  );
}

function BecomeBusiness({ onDone, notify }: { onDone: () => Promise<void>; notify: (t: string, s: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-5 pb-8 pt-4">
      <EmptyState mascot="happy" title="Post tasks for your business" subtitle="Pay once. Only approved work gets paid." />
      <div>
        <Label>Business name</Label>
        <input className={inputClass} value={name} onChange={e => setName(e.target.value)} maxLength={100} />
      </div>
      <ErrorText>{error}</ErrorText>
      <button
        type="button"
        className={primaryButtonClass}
        disabled={busy || name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await becomeBusinessRpc(name.trim());
            notify('Business mode on', 'You can now post tasks.');
            await onDone();
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} Turn on business mode
      </button>
    </div>
  );
}

function CampaignCard({
  campaign: c,
  settings,
  onReview,
  onChanged,
  notify,
}: {
  campaign: Campaign;
  settings: MarketplaceSettings;
  onReview: () => void;
  onChanged: () => Promise<void>;
  notify: (t: string, s: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelRefund = computeCancelRefund(c, settings.platformFeeRate, settings.refundFeeOnUnused);
  const refundOwed = Math.max(0, c.refundDue - c.refundedAmount);

  const fund = async () => {
    setBusy('fund');
    try {
      // If an earlier checkout was paid but the redirect back never happened
      // (tab closed, network drop), settle that one instead of charging the
      // business a second time.
      const earlierRef = await fetchLatestPendingCampaignPayment(c.id);
      if (earlierRef) {
        try {
          const v = await verifyPayment(earlierRef);
          if (v?.status) {
            notify('Payment found', 'Your earlier payment went through. Your task is live.');
            await onChanged();
            setBusy(null);
            return;
          }
        } catch {
          // Not paid: fall through to a fresh checkout.
        }
      }
      const res = await initializeCampaignFunding(c.id);
      window.location.href = res.data.authorization_url;
    } catch (err: any) {
      notify('Payment could not start', err.message || 'Please try again.');
      setBusy(null);
    }
  };

  const setStatus = async (status: 'active' | 'paused' | 'cancelled') => {
    setBusy(status);
    try {
      await setCampaignStatusRpc(c.id, status);
      notify(
        'Campaign updated',
        status === 'cancelled'
          ? c.status === 'pending_payment'
            ? 'Draft deleted.'
            : 'TaskPulse will refund your unused budget to the card or account you paid with.'
          : status === 'paused'
          ? 'Paused.'
          : 'Live again.'
      );
      await onChanged();
    } catch (err: any) {
      notify('Update failed', err.message);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };

  return (
    <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-ink dark:text-white leading-snug">{c.title}</p>
          <p className="text-sm text-zinc-500 mt-0.5">
            {formatNaira(c.rewardPerCompletion)} × {c.slots} · {approvalModeCopy(c.approvalMode, reviewWindowsFrom(settings)).label}
            {c.completionCodeMode ? ' · code check' : ''}
          </p>
        </div>
        <StatusPill status={c.status} kind="campaign" />
      </div>

      {c.status === 'pending_payment' ? (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-zinc-500">To pay</span>
            <span className="text-xl font-extrabold text-ink dark:text-white">{formatNaira(c.totalCharge)}</span>
          </div>
          <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={fund}>
            {busy === 'fund' && <Loader2 className="w-5 h-5 animate-spin" />} Pay with Paystack
          </button>
          <button type="button" className="w-full text-sm font-semibold text-zinc-500 cursor-pointer" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
            Delete draft
          </button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <SpotsBar
              left={c.slots - c.slotsApproved - c.slotsPending - c.slotsHeld}
              total={c.slots}
              label={`${c.slotsApproved} of ${c.slots} done`}
              trailing={<span className="text-zinc-500">{formatNaira(c.escrowBalance)} left</span>}
            />
            <p className="text-xs text-zinc-500">
              {[
                c.slotsPending > 0 && `${c.slotsPending} in review`,
                c.slotsHeld > 0 && `${c.slotsHeld} working on it`,
                spotsState(c.slots - c.slotsApproved - c.slotsPending - c.slotsHeld, c.slots).label,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {refundOwed > 0 && <p className="text-sm text-zinc-500">Refund on its way: {formatNaira(refundOwed)}</p>}
            {c.refundedAmount > 0 && <p className="text-sm text-zinc-500">Refunded: {formatNaira(c.refundedAmount)}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" className={`${primaryButtonClass} flex-1`} onClick={onReview}>
              Review{c.slotsPending > 0 ? ` (${c.slotsPending})` : ''}
            </button>
            {c.status === 'active' && (
              <button type="button" aria-label="Pause" className="tactile w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0" disabled={busy !== null} onClick={() => setStatus('paused')}>
                {busy === 'paused' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Pause className="w-5 h-5 text-ink dark:text-white" />}
              </button>
            )}
            {c.status === 'paused' && (
              <button type="button" aria-label="Resume" className="tactile w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0" disabled={busy !== null} onClick={() => setStatus('active')}>
                {busy === 'active' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 text-ink dark:text-white" />}
              </button>
            )}
          </div>
          {(c.status === 'active' || c.status === 'paused') && (
            <button type="button" className="w-full text-sm font-semibold text-zinc-500 cursor-pointer" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              End campaign
            </button>
          )}
        </>
      )}

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title={c.status === 'pending_payment' ? 'Delete this draft?' : 'End this campaign?'}>
        <p className="text-[15px] text-zinc-600 dark:text-zinc-300">
          {c.status === 'pending_payment'
            ? "It hasn't been paid for, so nothing is charged."
            : `No one new can start it. Work already sent (${c.slotsPending}) can still be reviewed. We'll refund ${formatNaira(cancelRefund.total)} for unused slots${
                cancelRefund.fee > 0 ? ` (${formatNaira(cancelRefund.reward)} rewards + ${formatNaira(cancelRefund.fee)} fee)` : ' (rewards only; the platform fee is kept)'
              } to the card or account you paid with. Anything you reject from here on is refunded too.`}
        </p>
        <button
          type="button"
          className="tactile w-full h-12 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
          disabled={busy !== null}
          onClick={() => setStatus('cancelled')}
        >
          {busy === 'cancelled' && <Loader2 className="w-5 h-5 animate-spin" />} {c.status === 'pending_payment' ? 'Delete' : 'End campaign'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => setConfirmCancel(false)}>
          Keep it
        </button>
      </Modal>
    </div>
  );
}

function CreateCampaignModal({
  open,
  settings,
  onClose,
  onCreated,
  notify,
}: {
  open: boolean;
  settings: MarketplaceSettings;
  onClose: () => void;
  onCreated: () => Promise<void>;
  notify: (t: string, s: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [category, setCategory] = useState<TaskCategory>(TASK_CATEGORIES[0]);
  const [proofType, setProofType] = useState<ProofType>('screenshot');
  // Category and proof start unselected: the values above are placeholders
  // and can't be submitted until the business picks each one.
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [proofChosen, setProofChosen] = useState(false);
  const [tried, setTried] = useState(false);
  const [reward, setReward] = useState('');
  const [slots, setSlots] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [modeChoice, setModeChoice] = useState<ApprovalMode | null>(null);
  const [completionCode, setCompletionCode] = useState('');
  const [codeMode, setCodeMode] = useState<CodeMode>('shared');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewardNum = Number(reward) || 0;
  const slotsNum = Number(slots) || 0;
  const cost = computeCampaignCost(rewardNum, slotsNum, settings.platformFeeRate);
  const feePct = Math.round(settings.platformFeeRate * 100);
  const prohibited = prohibitedTaskReason(title, instructions);
  const hasCode = completionCode.trim().length > 0;
  const modeOptions = approvalModeOptions({ category, proofType, hasCode, hasTargetUrl: /^https?:\/\//i.test(targetUrl.trim()) });
  const approvalMode: ApprovalMode = modeChoice && modeOptions.allowed.includes(modeChoice) ? modeChoice : modeOptions.defaultMode;
  const windows = reviewWindowsFrom(settings);

  const validate = () => {
    if (!categoryChosen && !proofChosen) return 'Choose a task category and how workers send proof.';
    if (!categoryChosen) return 'Choose a task category.';
    if (!proofChosen) return 'Choose how workers send proof.';
    if (title.trim().length < 5) return 'Title must be at least 5 characters.';
    if (instructions.trim().length < 20) return 'Add clear steps (at least 20 characters).';
    if (!Number.isInteger(rewardNum) || rewardNum < settings.minRewardPerTask || rewardNum > settings.maxRewardPerTask)
      return `Reward must be ${formatNaira(settings.minRewardPerTask)} to ${formatNaira(settings.maxRewardPerTask)}.`;
    if (!Number.isInteger(slotsNum) || slotsNum < settings.minCampaignSlots || slotsNum > settings.maxCampaignSlots)
      return `People needed must be ${settings.minCampaignSlots} to ${settings.maxCampaignSlots.toLocaleString()}.`;
    if (targetUrl.trim() && !/^https?:\/\//i.test(targetUrl.trim())) return 'Link must start with http:// or https://';
    if (prohibited) return PROHIBITED_MESSAGES[prohibited];
    if (hasCode && codeMode === 'shared' && (completionCode.trim().length < 4 || completionCode.trim().length > 64))
      return 'Completion code must be 4 to 64 characters.';
    if (hasCode && codeMode === 'unique' && (completionCode.trim().length < 16 || completionCode.trim().length > 128))
      return 'The per-worker code secret must be 16 to 128 characters.';
    if (hasCode && codeMode === 'unique' && !targetUrl.trim()) return 'Per-worker codes need a task link.';
    return null;
  };

  const submit = async (payNow: boolean) => {
    setTried(true);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createCampaignRpc({
        title: title.trim(),
        instructions: instructions.trim(),
        category,
        proofType,
        reward: rewardNum,
        slots: slotsNum,
        targetUrl: targetUrl.trim() || undefined,
        approvalMode,
        completionCode: completionCode.trim() || undefined,
        codeMode,
      });
      if (payNow) {
        const pay = await initializeCampaignFunding(res.campaign_id);
        window.location.href = pay.data.authorization_url;
        return;
      }
      notify('Draft saved', 'Pay for it to go live.');
      setTitle('');
      setInstructions('');
      setReward('');
      setSlots('');
      setTargetUrl('');
      setCompletionCode('');
      setModeChoice(null);
      await onCreated();
    } catch (err: any) {
      setError(err.message || 'Could not create the campaign.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Post a task" wide>
      <div>
        <Label>Title</Label>
        <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Install our app and sign up" />
      </div>
      <div>
        <Label hint="One step per line">Steps</Label>
        <textarea className={textareaClass} rows={4} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={4000} placeholder={'Download the app\nSign up with your phone\nScreenshot your home screen'} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Reward (₦)</Label>
          <input className={inputClass} inputMode="numeric" value={reward} onChange={e => setReward(e.target.value.replace(/\D/g, ''))} placeholder="200" />
        </div>
        <div>
          <Label>People needed</Label>
          <input className={inputClass} inputMode="numeric" value={slots} onChange={e => setSlots(e.target.value.replace(/\D/g, ''))} placeholder="100" />
        </div>
      </div>
      <div>
        <Label>Proof</Label>
        <Segmented
          value={(proofChosen ? proofType : '') as ProofType}
          onChange={v => {
            setProofType(v);
            setProofChosen(true);
          }}
          options={PROOF_TYPES.map(p => ({ id: p.id, label: p.label.replace(' answer', '') }))}
        />
        {tried && !proofChosen && <p className="text-[13px] font-medium text-red-600 dark:text-red-400 px-1 mt-1.5">Choose how workers send proof.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Category</Label>
          <select
            className={`${inputClass} ${categoryChosen ? '' : 'text-zinc-400 dark:text-zinc-500'} ${tried && !categoryChosen ? 'border-red-500/70' : ''}`}
            value={categoryChosen ? category : ''}
            required
            aria-invalid={tried && !categoryChosen ? true : undefined}
            onChange={e => {
              setCategory(e.target.value as TaskCategory);
              setCategoryChosen(true);
            }}
          >
            <option value="" disabled>
              Choose one
            </option>
            {TASK_CATEGORIES.map(c => (
              <option key={c} value={c} className="text-ink dark:text-white">
                {c}
              </option>
            ))}
          </select>
          {tried && !categoryChosen && <p className="text-[13px] font-medium text-red-600 dark:text-red-400 px-1 mt-1.5">Choose a task category.</p>}
        </div>
        <div>
          <Label hint="Optional">Link</Label>
          <input className={inputClass} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://" inputMode="url" />
        </div>
      </div>
      {categoryChosen && <p className="text-xs text-zinc-500 -mt-1 px-1">{CATEGORY_HINTS[category]}</p>}
      {prohibited && <ErrorText>{PROHIBITED_MESSAGES[prohibited]}</ErrorText>}

      <div>
        <Label hint="Optional, recommended for surveys and app tests">Completion code</Label>
        <Segmented
          value={codeMode}
          onChange={setCodeMode}
          options={[
            { id: 'shared', label: 'Same code for everyone' },
            { id: 'unique', label: 'Unique per worker' },
          ]}
        />
        <input
          className={`${inputClass} mt-2`}
          value={completionCode}
          onChange={e => setCompletionCode(e.target.value)}
          maxLength={128}
          autoComplete="off"
          placeholder={codeMode === 'shared' ? 'e.g. BLUE42' : 'A long secret only you know (16+ characters)'}
        />
        <p className="text-xs text-zinc-500 mt-1.5 px-1">
          {codeMode === 'shared'
            ? 'Show this code (or secret word) on the last screen of your form or app. Workers type it in and TaskPulse checks it automatically. We store only a scrambled (hashed) copy; workers never see it in the app.'
            : 'Advanced: we add tp_ref=<worker reference> to your task link. Your end screen shows the first 8 characters of sha256(secret + ":" + tp_ref), in capitals. Each worker gets a different code, so a leaked code is useless to others.'}
        </p>
      </div>

      <div>
        <Label>How submissions are approved</Label>
        <div className="space-y-2">
          {(['instant', 'auto', 'manual'] as ApprovalMode[]).map(m => {
            const copy = approvalModeCopy(m, windows);
            const allowed = modeOptions.allowed.includes(m);
            const selected = approvalMode === m;
            return (
              <button
                key={m}
                type="button"
                disabled={!allowed}
                onClick={() => setModeChoice(m)}
                className={`w-full text-left p-3.5 rounded-2xl border cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                  selected ? 'border-pulse-500 bg-pulse-500/8' : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <p className="text-sm font-bold text-ink dark:text-white flex items-center gap-1.5">
                  {m === 'instant' ? <Zap className="w-4 h-4" /> : <Clock className="w-4 h-4" />} {copy.title}
                  {m === modeOptions.defaultMode && <span className="text-[11px] font-semibold text-zinc-500">(suggested)</span>}
                </p>
                <p className="text-xs text-zinc-500 mt-1">{allowed || m !== 'instant' ? copy.body : modeOptions.instantBlockedReason}</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-zinc-500 mt-2 px-1">
          Always sent to you, in every mode: a worker's first {settings.trustedAfterTasks} approved tasks, rewards above{' '}
          {formatNaira(settings.humanReviewRewardAbove)}, Product Feedback and Field Audits, and anything our checks flag (reused answers, links or
          screenshots, wrong codes, submitting too fast). You have {windows.humanHours}h to review those.{' '}
          {approvalMode === 'instant'
            ? `Instantly approved rewards stay pending for ${instantWindowHours(proofType, windows)}h so you can still reject them.`
            : `Rewards you approve stay pending until ${windows.humanHours}h after submission, so you can still reject them.`}{' '}
          {windows.holdFlagged
            ? 'Flagged items are never approved automatically.'
            : `Flagged items are also approved after ${windows.humanHours}h if you don't act.`}
        </p>
      </div>

      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink dark:text-white">
          <Ban className="w-4 h-4" /> Not allowed
        </p>
        <ul className="list-disc pl-4 space-y-0.5">
          {NOT_ALLOWED_TASKS.map(t => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p>Campaigns that break these rules are removed and unpaid rewards are refunded.</p>
      </div>

      <div className="p-4 rounded-2xl bg-zinc-100 dark:bg-zinc-900 space-y-1.5 text-sm">
        <div className="flex justify-between text-zinc-500">
          <span>Rewards</span>
          <span>{formatNaira(cost.rewardBudget)}</span>
        </div>
        <div className="flex justify-between text-zinc-500">
          <span>Fee ({feePct}%)</span>
          <span>{formatNaira(cost.platformFee)}</span>
        </div>
        <div className="flex justify-between font-extrabold text-ink dark:text-white text-base pt-1.5">
          <span>Total</span>
          <span>{formatNaira(cost.total)}</span>
        </div>
        {rewardNum > 0 && (
          <p className="text-xs text-zinc-500 pt-1.5">
            Each approved response costs you {formatNaira(cost.costPerResponse)}: the worker gets the full {formatNaira(rewardNum)}, plus our{' '}
            {feePct}% fee ({formatNaira(cost.feePerResponse)}). Unused slots are refunded{settings.refundFeeOnUnused ? ' with their fee' : ''} if you end the campaign.
          </p>
        )}
      </div>

      <ErrorText>{error}</ErrorText>
      <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => submit(true)}>
        {busy && <Loader2 className="w-5 h-5 animate-spin" />} Pay {cost.total > 0 ? formatNaira(cost.total) : ''} and go live
      </button>
      <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => submit(false)}>
        Save draft
      </button>
    </Modal>
  );
}

function ReviewPanel({
  campaignId,
  title,
  windows,
  onBack,
  notify,
}: {
  campaignId: string | null;
  title: string;
  windows: ReviewWindows;
  onBack: () => void;
  notify: (t: string, s: string) => void;
}) {
  const [status, setStatus] = useState<ReviewListStatus>('pending');
  const [items, setItems] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchReviewSubmissions(campaignId, status);
    // Manual campaigns: plain arrival order. Otherwise flagged items first.
    if (status === 'pending') {
      list.sort((a, b) => {
        const fa = a.approvalMode !== 'manual' && a.checkFlags.length > 0 ? 0 : 1;
        const fb = b.approvalMode !== 'manual' && b.checkFlags.length > 0 ? 0 : 1;
        return fa - fb || new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
      });
    }
    setItems(list);
    setLoading(false);
  }, [campaignId, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5 pb-8">
      <button type="button" onClick={onBack} className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center cursor-pointer" aria-label="Back">
        <ArrowLeft className="w-5 h-5 text-ink dark:text-white" />
      </button>
      <h1 className="text-2xl font-extrabold text-ink dark:text-white leading-tight px-1">{title}</h1>
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { id: 'pending', label: 'To review' },
          { id: 'held', label: 'Can still reject' },
          { id: 'approved', label: 'Approved' },
          { id: 'rejected', label: 'Rejected' },
        ]}
      />
      <p className="text-xs text-zinc-500 px-1">
        {status === 'pending'
          ? windows.holdFlagged
            ? `Anything you don't review within ${windows.humanHours}h of submission is approved automatically, except flagged items, which wait for you.`
            : `Anything you don't review within ${windows.humanHours}h of submission is approved automatically, flagged items included.`
          : status === 'held'
            ? `Approved work (by you or automatically) whose review window is still open: ${windows.autoHours}h for instantly checked items, ${windows.humanHours}h for everything else. The worker's reward is pending; rejecting returns it to your campaign budget.`
            : null}
      </p>
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState mascot="thinking" title={status === 'pending' || status === 'held' ? 'All caught up.' : 'Nothing here yet.'} subtitle={status === 'pending' ? 'New work shows up here.' : undefined} />
      ) : (
        <div className="space-y-3">
          {items.map(s => (
            <SubmissionCard key={s.id} item={s} holdFlagged={windows.holdFlagged} onReviewed={load} notify={notify} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({
  item,
  holdFlagged,
  onReviewed,
  notify,
}: {
  item: ReviewSubmission;
  holdFlagged: boolean;
  onReviewed: () => Promise<void>;
  notify: (t: string, s: string) => void;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loadingImg, setLoadingImg] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const showImage = async () => {
    if (!item.proofScreenshotPath) return;
    setLoadingImg(true);
    const url = await getProofSignedUrl(item.proofScreenshotPath);
    setLoadingImg(false);
    if (url) setImgUrl(url);
    else notify('Could not load screenshot', 'Please try again.');
  };

  const review = async (approve: boolean) => {
    if (!approve && note.trim().length < 3) {
      notify('Add a reason', 'Tell the worker why it was rejected.');
      return;
    }
    setBusy(approve ? 'approve' : 'reject');
    try {
      await reviewSubmissionRpc(item.id, approve, note.trim() || undefined);
      notify(
        approve ? 'Approved' : 'Rejected',
        approve
          ? `${formatNaira(item.rewardAmount)} is pending for @${item.workerUsername} and becomes withdrawable when the review window closes.`
          : item.status === 'approved'
            ? `${formatNaira(item.rewardAmount)} went back to your campaign budget. The worker can see your note.`
            : 'The worker can see your note.'
      );
      await onReviewed();
    } catch (err: any) {
      notify('Review failed', err.message);
    } finally {
      setBusy(null);
    }
  };

  const isLink = item.proofText && /^https?:\/\//i.test(item.proofText.trim());
  const held = item.status === 'approved' && item.payoutStatus === 'held';
  const left = timeLeftLabel(item.reviewDeadlineAt);
  const windowOpen = Boolean(left) && left !== 'now';

  return (
    <div className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-ink dark:text-white">@{item.workerUsername}</p>
          <p className="text-xs text-zinc-500">
            {item.campaignTitle} · {formatDateTime(item.completedAt)}
          </p>
        </div>
        <span className="text-[15px] font-extrabold text-ink dark:text-white shrink-0">{formatNaira(item.rewardAmount)}</span>
      </div>
      {(item.status === 'pending' || held) && item.reviewDeadlineAt && (
        <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {held
            ? windowOpen
              ? `${item.approvalSource === 'instant' ? 'Auto-approved by checks' : 'Approved'} · reject within ${left}`
              : 'Window closed, reward being released'
            : holdFlagged && item.checkFlags.length > 0
              ? 'Flagged: waits for your decision (not auto-approved)'
              : windowOpen
                ? `Auto-approves in ${left}`
                : 'Auto-approving now'}
        </p>
      )}
      {item.checkFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.checkFlags.map(f => (
            <span key={f} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-red-500/10 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-3 h-3" /> {CHECK_FLAG_LABELS[f] ?? f}
            </span>
          ))}
        </div>
      )}
      {item.status === 'pending' && item.reviewReasons.length > 0 && (
        <p className="text-[11px] text-zinc-500">
          Why it's here: {item.reviewReasons.map(r => REVIEW_REASON_LABELS[r] ?? r).join(' · ')}
        </p>
      )}
      {item.codeStatus === 'match' && <p className="text-[11px] font-semibold text-pulse-700 dark:text-pulse-400">Completion code correct</p>}
      {item.proofText &&
        (isLink ? (
          <a href={item.proofText.trim()} target="_blank" rel="noopener noreferrer nofollow" className="block text-sm font-semibold text-pulse-700 dark:text-pulse-400 break-all">
            {item.proofText.trim()}
          </a>
        ) : (
          <p className="text-[15px] text-zinc-700 dark:text-zinc-200 whitespace-pre-line break-words p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800">{item.proofText}</p>
        ))}
      {item.proofScreenshotPath &&
        (imgUrl ? (
          <a href={imgUrl} target="_blank" rel="noopener noreferrer">
            <img src={imgUrl} alt="Submitted proof" className="w-full max-h-80 object-contain rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          </a>
        ) : (
          <button type="button" className={secondaryButtonClass} onClick={showImage} disabled={loadingImg}>
            {loadingImg ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />} View screenshot
          </button>
        ))}
      {held && windowOpen && (
        <>
          <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Reason (needed to reject)" />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => review(false)}
            className="tactile w-full h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 text-ink dark:text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
          >
            {busy === 'reject' ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />} Reject and return {formatNaira(item.rewardAmount)}
          </button>
        </>
      )}
      {item.status !== 'pending' && (
        <div className="flex items-center justify-between gap-3">
          <StatusPill status={item.status} kind="submission" />
          {item.reviewNote && <p className="text-sm text-zinc-500 truncate">“{item.reviewNote}”</p>}
        </div>
      )}
      {item.status === 'pending' && (
        <>
          <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Note (needed to reject)" />
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => review(false)}
              className="tactile h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 text-ink dark:text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
            >
              {busy === 'reject' ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />} Reject
            </button>
            <button type="button" disabled={busy !== null} onClick={() => review(true)} className={primaryButtonClass}>
              {busy === 'approve' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Approve
            </button>
          </div>
        </>
      )}
    </div>
  );
}
