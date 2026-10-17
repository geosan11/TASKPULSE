import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Briefcase, CheckCircle2, CreditCard, Image as ImageIcon, Inbox, Loader2, Pause, Play, Plus, XCircle } from 'lucide-react';
import { Card, EmptyState, inputClass, Label, Modal, primaryButtonClass, secondaryButtonClass, StatusPill, textareaClass } from './ui';
import {
  computeCampaignCost,
  formatNaira,
  PROOF_TYPES,
  TASK_CATEGORIES,
  type MarketplaceSettings,
  type ProofType,
} from '../config/marketplace';
import {
  becomeBusinessRpc,
  createCampaignRpc,
  fetchMyCampaigns,
  fetchReviewSubmissions,
  getProofSignedUrl,
  reviewSubmissionRpc,
  setCampaignStatusRpc,
  type Campaign,
  type ReviewSubmission,
} from '../lib/marketplace';
import { initializeCampaignFunding } from '../lib/api';
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
        onBack={() => {
          setReviewing(null);
          load();
        }}
        notify={notify}
      />
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="p-5 rounded-[30px] bg-gradient-to-br from-indigo-500 to-violet-700 text-white shadow-xl shadow-indigo-500/20 space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/80">For businesses</p>
        <h2 className="text-xl font-black leading-tight">{user.businessName || 'Your business'}</h2>
        <p className="text-[11px] text-white/85 leading-snug">
          Fund a campaign once via Paystack. Workers are paid from your campaign budget only when you approve their proof.
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={() => setCreating(true)} className="h-10 rounded-full bg-white text-indigo-700 font-black text-[11px] uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Post tasks
          </button>
          <button
            type="button"
            onClick={() => setReviewing({ campaignId: null, title: user.role === 'admin' ? 'All pending submissions' : 'All my submissions' })}
            className="h-10 rounded-full bg-slate-900/30 border border-white/40 font-black text-[11px] uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1"
          >
            <Inbox className="w-3.5 h-3.5" /> Review queue
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">My campaigns</p>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>

      {campaigns.length === 0 && !loading ? (
        <EmptyState icon={<Briefcase className="w-6 h-6" />} title="No campaigns yet" subtitle="Create your first campaign to get real people completing your tasks." />
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onReview={() => setReviewing({ campaignId: c.id, title: c.title })}
              onChanged={load}
              notify={notify}
            />
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
    <div className="space-y-4 pb-6">
      <Card>
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">For businesses</p>
        <h2 className="text-lg font-black text-slate-900 dark:text-white leading-tight">Get real people to test, review and promote your product</h2>
        <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-snug">
          Open a business account to post tasks. You set the reward and number of completions, pay once via Paystack, and only approved work is paid out.
        </p>
        <Label>Business name</Label>
        <input className={inputClass} value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="Acme Foods Ltd" />
        {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy || name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await becomeBusinessRpc(name.trim());
              notify('Business account ready', 'You can now post tasks.');
              await onDone();
            } catch (err: any) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Open business account
        </button>
      </Card>
    </div>
  );
}

function CampaignCard({
  campaign: c,
  onReview,
  onChanged,
  notify,
}: {
  campaign: Campaign;
  onReview: () => void;
  onChanged: () => Promise<void>;
  notify: (t: string, s: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pct = c.slots > 0 ? Math.round((c.slotsApproved / c.slots) * 100) : 0;

  const fund = async () => {
    setBusy('fund');
    try {
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
      notify('Campaign updated', status === 'cancelled' ? 'Unused budget is marked for refund.' : `Campaign is now ${status}.`);
      await onChanged();
    } catch (err: any) {
      notify('Update failed', err.message);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">{c.category}</p>
          <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">{c.title}</p>
          <p className="text-[10px] text-slate-500 dark:text-zinc-400">
            {formatNaira(c.rewardPerCompletion)} × {c.slots} slots · created {formatDateTime(c.createdAt)} WAT
          </p>
        </div>
        <StatusPill status={c.status} />
      </div>

      {c.status !== 'pending_payment' && (
        <>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div>
              <p className="font-black text-sm text-slate-900 dark:text-white">{c.slotsApproved}</p>
              <p className="text-slate-500">approved</p>
            </div>
            <div>
              <p className="font-black text-sm text-amber-600">{c.slotsPending}</p>
              <p className="text-slate-500">to review</p>
            </div>
            <div>
              <p className="font-black text-sm text-slate-900 dark:text-white">{formatNaira(c.escrowBalance)}</p>
              <p className="text-slate-500">budget left</p>
            </div>
          </div>
          {c.refundDue > 0 && <p className="text-[11px] text-slate-500">Refund due to you: {formatNaira(c.refundDue)} (processed by TaskPulse support).</p>}
        </>
      )}

      {c.status === 'pending_payment' ? (
        <>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">
            Total to pay: <strong>{formatNaira(c.totalCharge)}</strong> ({formatNaira(c.rewardBudget)} rewards + {formatNaira(c.platformFee)} platform fee)
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={fund}>
              {busy === 'fund' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Pay with Paystack
            </button>
            <button type="button" className="px-4 h-11 rounded-full text-[11px] font-black text-rose-500 cursor-pointer" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              Delete
            </button>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onReview}>
            <Inbox className="w-4 h-4" /> Submissions
          </button>
          {c.status === 'active' && (
            <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={() => setStatus('paused')}>
              {busy === 'paused' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />} Pause
            </button>
          )}
          {c.status === 'paused' && (
            <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={() => setStatus('active')}>
              {busy === 'active' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Resume
            </button>
          )}
          {(c.status === 'active' || c.status === 'paused') && (
            <button type="button" className="col-span-2 text-[11px] font-black text-rose-500 cursor-pointer" disabled={busy !== null} onClick={() => setConfirmCancel(true)}>
              Cancel campaign
            </button>
          )}
        </div>
      )}

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel this campaign?" eyebrow={c.title}>
        <p className="text-xs text-slate-600 dark:text-zinc-300">
          {c.status === 'pending_payment'
            ? 'This campaign has not been paid for. It will be closed and nothing will be charged.'
            : 'No new workers can start it. Submissions already waiting can still be reviewed and paid; the rest of the budget is marked as a refund due to you.'}
        </p>
        <button type="button" className={primaryButtonClass} disabled={busy !== null} onClick={() => setStatus('cancelled')}>
          {busy === 'cancelled' && <Loader2 className="w-4 h-4 animate-spin" />} Yes, cancel
        </button>
      </Modal>
    </Card>
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
  const [category, setCategory] = useState<string>(TASK_CATEGORIES[0]);
  const [proofType, setProofType] = useState<ProofType>('screenshot');
  const [reward, setReward] = useState('');
  const [slots, setSlots] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewardNum = Number(reward) || 0;
  const slotsNum = Number(slots) || 0;
  const cost = computeCampaignCost(rewardNum, slotsNum, settings.platformFeeRate);
  const feePct = Math.round(settings.platformFeeRate * 100);

  const validate = () => {
    if (title.trim().length < 5) return 'Title must be at least 5 characters.';
    if (instructions.trim().length < 20) return 'Instructions must be at least 20 characters so workers know exactly what to do.';
    if (!Number.isInteger(rewardNum) || rewardNum < settings.minRewardPerTask || rewardNum > settings.maxRewardPerTask)
      return `Reward must be a whole amount between ${formatNaira(settings.minRewardPerTask)} and ${formatNaira(settings.maxRewardPerTask)}.`;
    if (!Number.isInteger(slotsNum) || slotsNum < settings.minCampaignSlots || slotsNum > settings.maxCampaignSlots)
      return `Slots must be between ${settings.minCampaignSlots} and ${settings.maxCampaignSlots.toLocaleString()}.`;
    if (targetUrl.trim() && !/^https?:\/\//i.test(targetUrl.trim())) return 'Link must start with http:// or https://';
    return null;
  };

  const submit = async (payNow: boolean) => {
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
      });
      if (payNow) {
        const pay = await initializeCampaignFunding(res.campaign_id);
        window.location.href = pay.data.authorization_url;
        return;
      }
      notify('Campaign saved', 'Pay for it from your campaign list to make it live.');
      setTitle('');
      setInstructions('');
      setReward('');
      setSlots('');
      setTargetUrl('');
      await onCreated();
    } catch (err: any) {
      setError(err.message || 'Could not create the campaign.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Post a task" eyebrow="New campaign" wide>
      <div>
        <Label>Title</Label>
        <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Install our app and create an account" />
      </div>
      <div>
        <Label hint={`${instructions.length}/4000`}>Instructions</Label>
        <textarea
          className={textareaClass}
          rows={5}
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          maxLength={4000}
          placeholder={'One step per line, e.g.\nDownload the app from the Play Store\nSign up with your phone number\nScreenshot your home screen'}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Category</Label>
          <select className={inputClass} value={category} onChange={e => setCategory(e.target.value)}>
            {TASK_CATEGORIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Proof type</Label>
          <select className={inputClass} value={proofType} onChange={e => setProofType(e.target.value as ProofType)}>
            {PROOF_TYPES.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 -mt-2">{PROOF_TYPES.find(p => p.id === proofType)?.hint}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Reward per completion (₦)</Label>
          <input className={inputClass} inputMode="numeric" value={reward} onChange={e => setReward(e.target.value.replace(/\D/g, ''))} placeholder={String(settings.minRewardPerTask * 2)} />
        </div>
        <div>
          <Label>Slots</Label>
          <input className={inputClass} inputMode="numeric" value={slots} onChange={e => setSlots(e.target.value.replace(/\D/g, ''))} placeholder="100" />
        </div>
      </div>
      <div>
        <Label hint="Optional">Link for workers</Label>
        <input className={inputClass} value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://play.google.com/store/apps/…" inputMode="url" />
      </div>

      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] space-y-1 text-[11px]">
        <div className="flex justify-between text-slate-600 dark:text-zinc-300">
          <span>Rewards ({formatNaira(rewardNum)} × {slotsNum})</span>
          <span>{formatNaira(cost.rewardBudget)}</span>
        </div>
        <div className="flex justify-between text-slate-600 dark:text-zinc-300">
          <span>Platform fee ({feePct}%)</span>
          <span>{formatNaira(cost.platformFee)}</span>
        </div>
        <div className="flex justify-between font-black text-slate-900 dark:text-white text-xs pt-1 border-t border-slate-200 dark:border-white/[0.08]">
          <span>Total to pay</span>
          <span>{formatNaira(cost.total)}</span>
        </div>
      </div>

      {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
      <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => submit(true)}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Create & pay {cost.total > 0 ? formatNaira(cost.total) : ''}
      </button>
      <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => submit(false)}>
        Save, pay later
      </button>
    </Modal>
  );
}

function ReviewPanel({
  campaignId,
  title,
  onBack,
  notify,
}: {
  campaignId: string | null;
  title: string;
  onBack: () => void;
  notify: (t: string, s: string) => void;
}) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [items, setItems] = useState<ReviewSubmission[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setItems(await fetchReviewSubmissions(campaignId, status));
    setLoading(false);
  }, [campaignId, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4 pb-6">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[11px] font-black text-slate-500 cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Back to campaigns
      </button>
      <h2 className="text-lg font-black text-slate-900 dark:text-white leading-tight px-1">{title}</h2>
      <div className="grid grid-cols-3 gap-1 p-1 rounded-full bg-slate-100 dark:bg-zinc-800">
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`h-8 rounded-full text-[11px] font-black capitalize cursor-pointer ${
              status === s ? 'bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Inbox className="w-6 h-6" />} title={`No ${status} submissions`} subtitle="Submissions appear here as workers complete your task." />
      ) : (
        <div className="space-y-2">
          {items.map(s => (
            <SubmissionCard key={s.id} item={s} onReviewed={load} notify={notify} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ item, onReviewed, notify }: { item: ReviewSubmission; onReviewed: () => Promise<void>; notify: (t: string, s: string) => void }) {
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
      notify('Add a reason', 'Tell the worker why their proof was rejected.');
      return;
    }
    setBusy(approve ? 'approve' : 'reject');
    try {
      await reviewSubmissionRpc(item.id, approve, note.trim() || undefined);
      notify(approve ? 'Approved and paid' : 'Submission rejected', approve ? `@${item.workerUsername} received ${formatNaira(item.rewardAmount)}.` : 'The worker has been notified.');
      await onReviewed();
    } catch (err: any) {
      notify('Review failed', err.message);
    } finally {
      setBusy(null);
    }
  };

  const isLink = item.proofText && /^https?:\/\//i.test(item.proofText.trim());

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black text-slate-900 dark:text-white">@{item.workerUsername}</p>
          <p className="text-[10px] text-slate-500 dark:text-zinc-400">
            {item.campaignTitle} · {formatDateTime(item.completedAt)} WAT
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-black text-slate-900 dark:text-white">{formatNaira(item.rewardAmount)}</p>
          <StatusPill status={item.status} />
        </div>
      </div>
      {item.proofText &&
        (isLink ? (
          <a href={item.proofText.trim()} target="_blank" rel="noopener noreferrer nofollow" className="block text-[11px] font-bold text-sky-600 dark:text-cyan-400 break-all">
            {item.proofText.trim()}
          </a>
        ) : (
          <p className="text-[11px] text-slate-700 dark:text-zinc-200 whitespace-pre-line break-words p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/80">{item.proofText}</p>
        ))}
      {item.proofScreenshotPath &&
        (imgUrl ? (
          <a href={imgUrl} target="_blank" rel="noopener noreferrer">
            <img src={imgUrl} alt="Submitted proof" className="w-full max-h-72 object-contain rounded-xl bg-slate-100 dark:bg-zinc-800" />
          </a>
        ) : (
          <button type="button" className={secondaryButtonClass} onClick={showImage} disabled={loadingImg}>
            {loadingImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />} View screenshot
          </button>
        ))}
      {item.reviewNote && <p className="text-[11px] italic text-slate-500">Note: {item.reviewNote}</p>}
      {item.status === 'pending' && (
        <>
          <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Note to worker (required to reject)" />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => review(false)}
              className="h-11 rounded-full border border-rose-500/40 text-rose-600 dark:text-rose-400 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {busy === 'reject' ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Reject
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => review(true)}
              className="h-11 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {busy === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Approve & pay
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
