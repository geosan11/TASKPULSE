import { useState } from 'react';
import { ArrowRight, Ban, Check, ChevronDown, ClipboardCheck, CreditCard, Mail, Megaphone, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Mascot } from './ui';
import { PulseEmote } from './PulseEmote';
import { CATEGORY_HINTS, computeCampaignCost, formatNaira, NOT_ALLOWED_TASKS, TASK_CATEGORIES, type MarketplaceSettings } from '../config/marketplace';
import { navigate } from '../lib/router';
import { IntlNote } from './IntlNote';

export const BUSINESS_CONTACT_EMAIL = 'geoflashsanni@gmail.com';
/** Suggested reward for one survey response or app test (a recommendation, not a rule). */
export const RECOMMENDED_REWARD = 300;
const EXAMPLE_SLOTS = 100;

const mailto = (subject: string) => `mailto:${BUSINESS_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

const btn =
  'tactile inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full font-bold text-[15px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-500 focus-visible:ring-offset-2';
const btnPrimary = `${btn} bg-pulse-500 hover:bg-pulse-600 text-ink`;
const btnGhost = `${btn} border border-zinc-300 dark:border-zinc-700 text-ink dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900`;

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl space-y-2">
      <p className="text-sm font-bold uppercase tracking-wider text-pulse-700 dark:text-pulse-400">{eyebrow}</p>
      <h2 className="text-[28px] sm:text-4xl font-extrabold leading-tight text-ink dark:text-white">{title}</h2>
      {children && <p className="text-[15px] sm:text-base text-zinc-600 dark:text-zinc-400">{children}</p>}
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 open:pb-4">
      <summary className="flex items-center justify-between gap-4 py-4 cursor-pointer list-none font-bold text-ink dark:text-white [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown className="w-5 h-5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed space-y-2">{children}</div>
    </details>
  );
}

export function BusinessPage({
  settings,
  isDarkMode,
  signedIn,
  onSignUpBusiness,
  onSignIn,
  onOpenLegal,
}: {
  settings: MarketplaceSettings;
  isDarkMode: boolean;
  signedIn: boolean;
  onSignUpBusiness: () => void;
  onSignIn: () => void;
  onOpenLegal: (tab: 'terms' | 'privacy') => void;
}) {
  const feePct = Math.round(settings.platformFeeRate * 100);
  const example = computeCampaignCost(RECOMMENDED_REWARD, EXAMPLE_SLOTS, settings.platformFeeRate);
  const [reward, setReward] = useState(String(RECOMMENDED_REWARD));
  const [people, setPeople] = useState(String(EXAMPLE_SLOTS));
  const r = Number(reward) || 0;
  const n = Number(people) || 0;
  const calc = computeCampaignCost(r, n, settings.platformFeeRate);
  const rewardOk = r >= settings.minRewardPerTask && r <= settings.maxRewardPerTask;
  const peopleOk = n >= settings.minCampaignSlots && n <= settings.maxCampaignSlots;

  // Real link to the existing ?for=business sign-up flow; handled in-app when JS runs.
  const signUpLink = (label: string, className: string) => (
    <a
      href="/?for=business"
      className={className}
      onClick={e => {
        e.preventDefault();
        onSignUpBusiness();
      }}
    >
      {label} <ArrowRight className="w-4 h-4" />
    </a>
  );
  const ctaLabel = signedIn ? 'Open business dashboard' : 'Create a business account';

  const steps = [
    { icon: <Megaphone className="w-5 h-5" />, title: 'Create a campaign', body: 'Write clear steps, pick the proof you need (screenshot, text answer or link), set the reward and how many people.' },
    { icon: <CreditCard className="w-5 h-5" />, title: 'Fund it via Paystack', body: `Pay once by card or bank: rewards plus our ${feePct}% fee. The reward budget is held for your campaign, and it goes live.` },
    { icon: <Users className="w-5 h-5" />, title: 'Real people submit proof', body: 'Workers across Nigeria complete your task and upload proof. One account per person, payouts only to a verified Nigerian bank account.' },
    { icon: <ClipboardCheck className="w-5 h-5" />, title: 'Approve and pay', body: 'You review every submission. Approve and the worker is paid the full reward; reject and they are not paid and the slot reopens.' },
  ];

  return (
    <div className={`h-[100dvh] w-full overflow-y-auto ${isDarkMode ? 'dark bg-ink' : 'bg-white'}`}>
      <div className="min-h-full bg-white dark:bg-ink text-ink dark:text-white">
        {/* Nav */}
        <header className="sticky top-0 z-40 bg-white/90 dark:bg-ink/90 backdrop-blur border-b border-zinc-100 dark:border-zinc-900">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
            <a
              href="/"
              aria-label="TaskPulse home"
              onClick={e => {
                e.preventDefault();
                navigate('/');
              }}
              className="h-11 flex items-center"
            >
              <img
                src={isDarkMode ? '/brand/logo-lockup-dark.png' : '/brand/logo-lockup-light.png'}
                alt="TaskPulse"
                className={`h-11 w-auto -ml-1 ${isDarkMode ? 'logo-on-dark' : 'logo-on-light'}`}
                draggable={false}
              />
            </a>
            <nav className="flex items-center gap-1 sm:gap-2 text-sm font-semibold">
              <a href="#pricing" className="hidden sm:inline-flex h-10 items-center px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white">
                Pricing
              </a>
              <a href="#faq" className="hidden sm:inline-flex h-10 items-center px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white">
                FAQ
              </a>
              {!signedIn && (
                <button type="button" onClick={onSignIn} className="h-10 px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white cursor-pointer">
                  Sign in
                </button>
              )}
              <a
                href="/?for=business"
                onClick={e => {
                  e.preventDefault();
                  onSignUpBusiness();
                }}
                className="tactile inline-flex h-10 items-center px-4 rounded-full bg-ink text-white dark:bg-white dark:text-ink font-bold"
              >
                {signedIn ? 'Dashboard' : 'Get started'}
              </a>
            </nav>
          </div>
        </header>

        <main>
          {/* Hero */}
          <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 sm:pt-16 pb-12 sm:pb-20 grid lg:grid-cols-[1.15fr_1fr] gap-10 lg:gap-14 items-center">
            <div className="space-y-6">
              <p className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-pulse-50 dark:bg-pulse-500/10 text-pulse-800 dark:text-pulse-400 text-sm font-bold">
                <Sparkles className="w-4 h-4" /> TaskPulse for Businesses
              </p>
              <IntlNote audience="business" className="max-w-md" />
              <h1 className="text-[38px] sm:text-[56px] leading-[1.05] font-extrabold tracking-tight">
                Real Nigerian people. Real actions.{' '}
                <span className="text-pulse-600 dark:text-pulse-500">Pay only for approved work.</span>
              </h1>
              <p className="text-base sm:text-lg text-zinc-600 dark:text-zinc-400 max-w-xl">
                Get survey responses, app tests, honest product feedback and field checks from real people across Nigeria. Fund once with Paystack, review
                every proof, and only approved work is paid.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                {signUpLink(ctaLabel, btnPrimary)}
                <a href={mailto('TaskPulse for Businesses')} className={btnGhost}>
                  <Mail className="w-4 h-4" /> Talk to us
                </a>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                {['No subscription', `Rewards from ${formatNaira(settings.minRewardPerTask)}`, 'Unused slots refunded'].map(t => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-pulse-600 dark:text-pulse-500" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Worked example card */}
            <div className="relative">
              <PulseEmote name="wink" size={112} animate="pop" eager alt="" className="hidden sm:block absolute -top-14 -right-2 z-10" />
              <div className="rounded-[28px] bg-ink text-white p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.25)] border border-zinc-800">
                <p className="text-sm font-bold text-pulse-400">Worked example</p>
                <p className="mt-1 text-xl font-extrabold">
                  {EXAMPLE_SLOTS} survey responses at {formatNaira(RECOMMENDED_REWARD)}
                </p>
                <dl className="mt-5 space-y-3 text-[15px]">
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-400">
                      Rewards ({EXAMPLE_SLOTS} × {formatNaira(RECOMMENDED_REWARD)})
                    </dt>
                    <dd className="font-bold">{formatNaira(example.rewardBudget)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-400">Platform fee ({feePct}%)</dt>
                    <dd className="font-bold">{formatNaira(example.platformFee)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 pt-3 border-t border-zinc-800 text-lg">
                    <dt className="font-extrabold">You pay</dt>
                    <dd className="font-extrabold text-pulse-400">{formatNaira(example.total)}</dd>
                  </div>
                </dl>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-zinc-900 p-3">
                    <p className="text-zinc-400">Per response</p>
                    <p className="text-lg font-extrabold">{formatNaira(example.costPerResponse)}</p>
                  </div>
                  <div className="rounded-2xl bg-zinc-900 p-3">
                    <p className="text-zinc-400">Worker receives</p>
                    <p className="text-lg font-extrabold">{formatNaira(RECOMMENDED_REWARD)} (100%)</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* How it works */}
          <section className="bg-zinc-50 dark:bg-zinc-950 border-y border-zinc-100 dark:border-zinc-900">
            <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 space-y-10">
              <SectionHead eyebrow="How it works" title="Four steps from brief to results" />
              <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {steps.map((s, i) => (
                  <li key={s.title} className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="w-10 h-10 rounded-full bg-pulse-500 text-ink flex items-center justify-center">{s.icon}</span>
                      <span className="text-sm font-extrabold text-zinc-300 dark:text-zinc-700">0{i + 1}</span>
                    </div>
                    <h3 className="text-lg font-extrabold">{s.title}</h3>
                    <p className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Pricing */}
          <section id="pricing" className="scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 space-y-10">
            <SectionHead eyebrow="Pricing" title="You set the reward. We add a flat fee.">
              No subscription and no setup cost. You pay per campaign, and only approved work is paid out.
            </SectionHead>
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-2">
                <p className="text-sm font-bold text-zinc-500">1. Reward you choose</p>
                <p className="text-3xl font-extrabold">
                  {formatNaira(settings.minRewardPerTask)}–{formatNaira(settings.maxRewardPerTask)}
                </p>
                <p className="text-[15px] text-zinc-600 dark:text-zinc-400">
                  Per approved task. We recommend <strong className="text-ink dark:text-white">{formatNaira(RECOMMENDED_REWARD)}</strong> per survey response or
                  app test. Campaigns start at {settings.minCampaignSlots} people.
                </p>
              </div>
              <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-2">
                <p className="text-sm font-bold text-zinc-500">2. Platform fee on top</p>
                <p className="text-3xl font-extrabold">{feePct}%</p>
                <p className="text-[15px] text-zinc-600 dark:text-zinc-400">
                  Added to the rewards, never taken from them. <strong className="text-ink dark:text-white">The worker gets 100% of the reward.</strong>
                </p>
              </div>
              <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-2">
                <p className="text-sm font-bold text-zinc-500">3. Unused slots</p>
                <p className="text-3xl font-extrabold">Refunded{settings.refundFeeOnUnused ? ' + fee' : ''}</p>
                <p className="text-[15px] text-zinc-600 dark:text-zinc-400">
                  End a campaign early and the rewards for unused slots
                  {settings.refundFeeOnUnused ? ', plus their share of the fee,' : ''} are refunded to the card or account you paid with.
                </p>
              </div>
            </div>

            {/* Calculator */}
            <div className="rounded-3xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 grid md:grid-cols-[1fr_1fr_1.3fr] gap-5 items-end">
              <label className="block space-y-1.5">
                <span className="text-sm font-bold">Reward per person (₦)</span>
                <input
                  className="w-full h-12 px-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-pulse-500"
                  inputMode="numeric"
                  value={reward}
                  onChange={e => setReward(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  aria-invalid={!rewardOk}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-bold">People needed</span>
                <input
                  className="w-full h-12 px-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-pulse-500"
                  inputMode="numeric"
                  value={people}
                  onChange={e => setPeople(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  aria-invalid={!peopleOk}
                />
              </label>
              <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4" aria-live="polite">
                {rewardOk && peopleOk ? (
                  <>
                    <p className="text-sm text-zinc-500">
                      {formatNaira(calc.rewardBudget)} rewards + {formatNaira(calc.platformFee)} fee
                    </p>
                    <p className="text-2xl font-extrabold">
                      {formatNaira(calc.total)} <span className="text-sm font-semibold text-zinc-500">({formatNaira(calc.costPerResponse)} each)</span>
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                    Reward {formatNaira(settings.minRewardPerTask)}–{formatNaira(settings.maxRewardPerTask)}, {settings.minCampaignSlots}–
                    {settings.maxCampaignSlots.toLocaleString()} people.
                  </p>
                )}
              </div>
            </div>

            {/* First-campaign offer */}
            <div className="rounded-3xl bg-pulse-500 text-ink p-6 sm:p-8 grid md:grid-cols-[1fr_auto] gap-6 items-center">
              <div className="space-y-2">
                <p className="text-sm font-extrabold uppercase tracking-wider">First-campaign offer for new businesses. Contact us</p>
                <p className="text-2xl sm:text-3xl font-extrabold leading-tight">Your first campaign with zero platform fee. Pay only for approved responses, and get every unused naira back.</p>
                <p className="text-[15px] font-medium text-ink/80">
                  Your first responses arrive within 72 hours of going live. We agree the offer with you by email before you pay, and the fee is refunded once the campaign ends. It isn't applied automatically at checkout.
                </p>
              </div>
              <a href={mailto('TaskPulse first-campaign offer')} className={`${btn} bg-ink text-white hover:bg-zinc-800`}>
                <Mail className="w-4 h-4" /> Ask about the offer
              </a>
            </div>
          </section>

          {/* Allowed / not allowed */}
          <section className="bg-zinc-50 dark:bg-zinc-950 border-y border-zinc-100 dark:border-zinc-900">
            <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 grid lg:grid-cols-[1.4fr_1fr] gap-8">
              <div className="space-y-6">
                <SectionHead eyebrow="What you can post" title="Honest tasks with checkable proof" />
                <ul className="grid sm:grid-cols-2 gap-3">
                  {TASK_CATEGORIES.map(c => (
                    <li key={c} className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 space-y-1">
                      <p className="font-extrabold flex items-center gap-2">
                        <Check className="w-4 h-4 text-pulse-600 dark:text-pulse-500" /> {c}
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{CATEGORY_HINTS[c]}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4 self-start lg:mt-[76px]">
                <p className="flex items-center gap-2 text-lg font-extrabold">
                  <Ban className="w-5 h-5" /> Not allowed
                </p>
                <ul className="space-y-3 text-[15px] text-zinc-700 dark:text-zinc-300">
                  {NOT_ALLOWED_TASKS.map(t => (
                    <li key={t} className="flex gap-2">
                      <span aria-hidden="true" className="mt-2 w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-zinc-500">
                  Campaigns that break these rules are removed and the unused budget is refunded. It protects you, the workers and the platforms you
                  rely on.
                </p>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-20 max-w-3xl mx-auto px-5 sm:px-8 py-14 sm:py-20 space-y-8">
            <SectionHead eyebrow="FAQ" title="Questions businesses ask" />
            <div className="space-y-3">
              <Faq q="Who completes my tasks?">
                <p>
                  Real people in Nigeria who signed up as TaskPulse workers. Joining is free, each person may hold one account, and payouts only go to a
                  verified Nigerian bank account in their name.
                </p>
              </Faq>
              <Faq q="What if a submission is poor or fake?">
                <p>
                  You review every proof before anyone is paid. Reject it and the worker is not paid; the slot reopens for someone else. Only approved
                  work is paid from your budget.
                </p>
              </Faq>
              <Faq q="How much does it cost?">
                <p>
                  Reward × people + {feePct}% platform fee, paid once. For example {EXAMPLE_SLOTS} × {formatNaira(RECOMMENDED_REWARD)} ={' '}
                  {formatNaira(example.rewardBudget)} + {formatNaira(example.platformFee)} fee = {formatNaira(example.total)}, which is{' '}
                  {formatNaira(example.costPerResponse)} per approved response. There is no subscription.
                </p>
              </Faq>
              <Faq q="How do I pay?">
                <p>By card or bank through Paystack when you publish a campaign. TaskPulse never sees or stores your card details.</p>
              </Faq>
              <Faq q="Can I get money back?">
                <p>
                  Yes. If you end a campaign before every slot is used, the rewards for unused slots
                  {settings.refundFeeOnUnused ? ' and their share of the platform fee' : ''} are refunded to the card or account you paid with.
                </p>
              </Faq>
              <Faq q="Can I pay for app store or Google reviews, or followers?">
                <p>
                  No. Paid public reviews, star ratings and bought followers, likes or subscribers break those platforms' rules. Use Product Feedback to
                  collect honest opinions privately, or App Tests to have people try your app and report what happened.
                </p>
              </Faq>
              <Faq q="What is the first-campaign offer?">
                <p>
                  On your first campaign we charge zero platform fee, so you pay only the rewards for responses you approve, and every unused naira comes back to you. First responses arrive within 72 hours of going live. Email{' '}
                  <a className="font-bold underline underline-offset-2" href={mailto('TaskPulse first-campaign offer')}>
                    {BUSINESS_CONTACT_EMAIL}
                  </a>{' '}
                  to agree it before you pay. It isn't applied automatically, and the {feePct}% fee is refunded after the campaign ends.
                </p>
              </Faq>
            </div>
          </section>

          {/* Final CTA */}
          <section className="px-5 sm:px-8 pb-16">
            <div className="max-w-6xl mx-auto rounded-[32px] bg-ink text-white p-8 sm:p-12 grid md:grid-cols-[auto_1fr_auto] gap-6 items-center">
              <Mascot pose="celebrating" className="w-24 h-24 hidden md:block" />
              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight">Launch your first campaign today.</h2>
                <p className="text-zinc-400">Real people. Real actions. Pay only for approved work.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                {signUpLink(ctaLabel, btnPrimary)}
                <a href={mailto('TaskPulse for Businesses')} className={`${btn} border border-zinc-700 text-white hover:bg-zinc-900`}>
                  <Mail className="w-4 h-4" /> {BUSINESS_CONTACT_EMAIL}
                </a>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-zinc-100 dark:border-zinc-900">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between text-sm text-zinc-500">
            <p className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> © {new Date().getFullYear()} TaskPulse by GEOSAN NEXGEN INNOVATIONS
            </p>
            <div className="flex gap-4 font-semibold">
              <a
                href="/terms"
                onClick={e => {
                  e.preventDefault();
                  onOpenLegal('terms');
                }}
                className="hover:text-ink dark:hover:text-white"
              >
                Terms
              </a>
              <a
                href="/privacy"
                onClick={e => {
                  e.preventDefault();
                  onOpenLegal('privacy');
                }}
                className="hover:text-ink dark:hover:text-white"
              >
                Privacy
              </a>
              <a href={mailto('TaskPulse')} className="hover:text-ink dark:hover:text-white">
                Contact
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
