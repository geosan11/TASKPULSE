import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Loader2, Sparkles, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { initializeCampaignFunding } from '../lib/api';
import { fetchPackages, type PackageItem } from '../lib/packages';
import { Card, EmptyState, ErrorText, inputClass, Label, Modal, primaryButtonClass, textareaClass } from './ui';
import { PriceBreakdown } from './PriceBreakdown';

const PACKAGE_TAGS: Record<string, { label: string; cls: string }> = {
  '10-local-ugc-reels': { label: 'UGC Video', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20' },
  'campus-feedback-panel': { label: 'Private Feedback', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20' },
  'product-seeding-pack': { label: 'Product Seeding', cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-purple-500/20' },
  'content-test-panel': { label: 'Content Test', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20' },
  'event-ground-squad': { label: 'Event Team', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20' },
};

const PACKAGE_ERRORS: Record<string, string> = {
  business_account_required: 'Switch to a business account to order a package.',
  package_not_found: 'This package is no longer available.',
  invalid_product_name: 'Product name must be 3 to 80 characters.',
  invalid_product_link: 'Link must start with http:// or https://',
  invalid_location: 'Location must be 100 characters or fewer.',
  invalid_brief: 'Brief must be 1,500 characters or fewer.',
  'prohibited_task:public_review': 'Paid public store or map reviews are not allowed on TaskPulse.',
  'prohibited_task:social_engagement': 'Paid follows, likes or subscribers are not allowed on TaskPulse.',
  'prohibited_task:fake_engagement': 'Fake engagement is not allowed on TaskPulse.',
  prohibited_task: 'This request is not allowed on TaskPulse. See the Not allowed list.',
  not_enough_workers: 'Not enough students have joined yet to fill this package.',
  not_authenticated: 'You must be signed in.',
};

function friendlyError(message: string) {
  const key = Object.keys(PACKAGE_ERRORS).find(k => message.includes(k));
  return key ? PACKAGE_ERRORS[key] : message;
}

export function PackagesStorefront({
  onBack,
  notify,
  preview,
  openSlug,
}: {
  onBack?: () => void;
  /** Open this package's order form once loaded (picked on the public /packages page). */
  openSlug?: string | null;
  notify?: (title: string, subtitle: string) => void;
  /** Dev preview only: render these instead of loading from Supabase. */
  preview?: PackageItem[];
}) {
  const [packages, setPackages] = useState<PackageItem[]>(preview ?? []);
  const [loading, setLoading] = useState(!preview);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PackageItem | null>(null);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      const res = await fetchPackages();
      if (cancelled) return;
      // 'missing' = migration 015 not run yet: show the empty state, not an error.
      if (res.status === 'ok') {
        setPackages(res.packages);
        const picked = openSlug ? res.packages.find(p => p.slug === openSlug) : undefined;
        if (picked?.available) setSelected(picked);
      }
      else if (res.status === 'error') setLoadError(res.message);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // openSlug is only read on first load on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  return (
    <div className="space-y-5 pb-8">
      {onBack && (
        <button type="button" onClick={onBack} className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center cursor-pointer" aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-ink dark:text-white" />
        </button>
      )}
      <div className="px-1">
        <h1 className="text-2xl font-extrabold text-ink dark:text-white leading-tight">Packages</h1>
        <p className="text-sm text-zinc-500">Ready-made task bundles done by verified students. Pick one, tell us about your product, and pay.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : loadError ? (
        <ErrorText>{loadError}</ErrorText>
      ) : packages.length === 0 ? (
        <EmptyState mascot="thinking" title="No packages yet." subtitle="Check back soon." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {packages.map(p => {
            const tag = PACKAGE_TAGS[p.slug];
            return (
              <Card key={p.id} className="relative flex flex-col justify-between hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    {tag && (
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full ring-1 ring-inset ${tag.cls}`}>
                        <Sparkles className="w-3 h-3" /> {tag.label}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs font-semibold text-zinc-500 ml-auto">
                      <Clock className="w-3.5 h-3.5" /> ~{p.estimatedDeliveryDays} days
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-lg font-extrabold text-ink dark:text-white leading-tight">{p.name}</h2>
                    <p className="text-sm text-zinc-500 leading-relaxed">{p.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                      <Users className="w-3.5 h-3.5 text-pulse-600 dark:text-pulse-400" /> {p.slots} verified students
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3">
                  <PriceBreakdown total={p.totalPrice} slots={p.slots} reward={p.rewardPerCompletion} feeRate={p.platformFeeRate} label="Total charge" />
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    disabled={!p.available}
                    aria-disabled={!p.available}
                    className={`${primaryButtonClass} disabled:!bg-zinc-200 disabled:!text-zinc-500 dark:disabled:!bg-zinc-800 dark:disabled:!text-zinc-400`}
                  >
                    {p.available ? 'Order This Package' : `Available once ${p.slots} students have joined`}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <OrderModal pkg={selected} onClose={() => setSelected(null)} notify={notify} />
    </div>
  );
}

function OrderModal({
  pkg,
  onClose,
  notify,
}: {
  pkg: PackageItem | null;
  onClose: () => void;
  notify?: (title: string, subtitle: string) => void;
}) {
  const [productName, setProductName] = useState('');
  const [productLink, setProductLink] = useState('');
  const [location, setLocation] = useState('Lagos / Campus Wide');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!pkg || busy) return;
    if (!supabase) {
      setError('Database is not connected.');
      return;
    }
    if (productName.trim().length < 3) {
      setError('Enter your product or brand name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('create_package_campaign', {
        p_package_id: pkg.id,
        p_product_name: productName.trim(),
        p_product_link: productLink.trim() || null,
        p_target_location: location.trim() || null,
        p_custom_brief: brief.trim() || null,
      });
      if (rpcErr) throw new Error(friendlyError(rpcErr.message));
      const campaignId = (data as any)?.campaign_id as string | undefined;
      if (!campaignId) throw new Error('Could not create your order. Please try again.');
      try {
        // Same checkout as BusinessTab: server picks the reference and the amount.
        const pay = await initializeCampaignFunding(campaignId);
        window.location.href = pay.data.authorization_url;
      } catch (payErr: any) {
        // The campaign exists as pending_payment; the owner can pay from the Campaigns list.
        notify?.('Order saved', 'Pay for it from your Campaigns list to go live.');
        onClose();
        return;
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!pkg} onClose={busy ? () => undefined : onClose} title={pkg ? pkg.name : 'Order'} wide>
      {pkg && (
        <>
          <div className="p-3.5 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 space-y-1.5 -mt-1">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
              <span>{pkg.slots} verified students</span>
              <span className="flex items-center gap-1 text-pulse-600 dark:text-pulse-400 font-bold">
                <ShieldCheck className="w-3.5 h-3.5" /> Escrow protected
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
              Approved work is paid to real Nigerian bank accounts via Paystack checkout.
            </p>
          </div>

          <div>
            <Label>Product or brand name</Label>
            <input className={inputClass} value={productName} onChange={e => setProductName(e.target.value)} maxLength={80} placeholder="e.g. Kuda, Chowdeck, MyStore App" />
          </div>
          <div>
            <Label hint="Optional">Product link</Label>
            <input className={inputClass} value={productLink} onChange={e => setProductLink(e.target.value)} maxLength={500} placeholder="https://..." inputMode="url" />
          </div>
          <div>
            <Label>Target Location / Campus</Label>
            <input className={inputClass} value={location} onChange={e => setLocation(e.target.value)} maxLength={100} placeholder="e.g. UniLag, Lagos Island, Nationwide" />
          </div>
          <div>
            <Label hint="Optional">Brief for students</Label>
            <textarea className={textareaClass} rows={3} value={brief} onChange={e => setBrief(e.target.value)} maxLength={1500} placeholder="Key points to show or questions you want answered" />
          </div>
          <div className="p-3 rounded-2xl bg-pulse-500/8 border border-pulse-500/20">
            <PriceBreakdown total={pkg.totalPrice} slots={pkg.slots} reward={pkg.rewardPerCompletion} feeRate={pkg.platformFeeRate} label="Total charge" size="md" />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <button type="button" onClick={submit} disabled={busy} className={primaryButtonClass}>
            {busy && <Loader2 className="w-5 h-5 animate-spin" />} Continue to payment
          </button>
        </>
      )}
    </Modal>
  );
}
