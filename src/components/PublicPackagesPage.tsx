import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Clock, GraduationCap, Moon, PackageCheck, ShieldCheck, Sun, Users } from 'lucide-react';
import { Card, EmptyState, ErrorPanel } from './ui';
import { PriceBreakdown } from './PriceBreakdown';
import { navigate } from '../lib/router';
import { fetchPublicPackages } from '../lib/packages';
import { daysLabel, deliverableFor, packageSignupHref, studentsLabel, type PublicPackage } from '../lib/publicPackages';

const btn =
  'tactile inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full font-bold text-[15px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950';
const btnPrimary = `${btn} bg-pulse-500 hover:bg-pulse-600 text-ink`;
const btnGhost = `${btn} border border-zinc-300 dark:border-zinc-700 text-ink dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900`;

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; packages: PublicPackage[] };

/**
 * Public catalog of ready-made packages at /packages (signed in or not).
 * One all-in price per package (total_price); worker pay only inside "See breakdown".
 */
export function PublicPackagesPage({
  isDarkMode,
  signedIn,
  onToggleTheme,
  onGetStarted,
  onWorkerSignUp,
  onSignIn,
  onOpenLegal,
  preview,
}: {
  isDarkMode: boolean;
  signedIn: boolean;
  onToggleTheme: () => void;
  /** slug = the package picked, or null for the page-level CTA. */
  onGetStarted: (slug: string | null) => void;
  onWorkerSignUp: () => void;
  onSignIn: () => void;
  onOpenLegal: (tab: 'terms' | 'privacy') => void;
  /** Dev preview only: render these instead of loading. */
  preview?: PublicPackage[];
}) {
  const [state, setState] = useState<LoadState>(preview ? { kind: 'ok', packages: preview } : { kind: 'loading' });

  const load = useCallback(async () => {
    if (preview) return;
    setState({ kind: 'loading' });
    const res = await fetchPublicPackages();
    setState(res.status === 'ok' ? { kind: 'ok', packages: res.packages } : { kind: 'error', message: res.message });
  }, [preview]);

  useEffect(() => {
    load();
  }, [load]);

  const cta = (slug: string | null, label: string, className: string, ariaLabel?: string) => (
    <a
      href={packageSignupHref(slug)}
      aria-label={ariaLabel}
      onClick={e => {
        e.preventDefault();
        onGetStarted(slug);
      }}
      className={className}
    >
      {label} <ArrowRight className="w-4 h-4" />
    </a>
  );

  return (
    <div className={`h-[100dvh] w-full overflow-y-auto ${isDarkMode ? 'dark bg-ink' : 'bg-white'}`}>
      <div className="min-h-full flex flex-col bg-white dark:bg-ink text-ink dark:text-white">
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
              <a
                href="/"
                onClick={e => {
                  e.preventDefault();
                  navigate('/');
                }}
                className="hidden sm:inline-flex h-10 items-center px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white"
              >
                Home
              </a>
              <a
                href="/business"
                onClick={e => {
                  e.preventDefault();
                  navigate('/business');
                }}
                className="hidden sm:inline-flex h-10 items-center px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white"
              >
                Custom tasks
              </a>
              <a
                href="/packages"
                onClick={e => {
                  e.preventDefault();
                  navigate('/packages');
                }}
                className="hidden sm:inline-flex h-10 items-center px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white"
              >
                Packages
              </a>
              <button
                type="button"
                onClick={onToggleTheme}
                className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center cursor-pointer"
                aria-label="Toggle theme"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              {!signedIn && (
                <button type="button" onClick={onSignIn} className="h-10 px-3 rounded-full text-zinc-600 dark:text-zinc-300 hover:text-ink dark:hover:text-white cursor-pointer">
                  Sign in
                </button>
              )}
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-14 pb-6 sm:pb-10 space-y-5">
            <p className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-pulse-50 dark:bg-pulse-500/10 text-pulse-800 dark:text-pulse-400 text-sm font-bold">
              <PackageCheck className="w-4 h-4" /> Ready-made packages
            </p>
            <h1 className="text-[32px] sm:text-[48px] leading-[1.08] font-extrabold tracking-tight max-w-3xl">
              Pick a package. <span className="text-pulse-600 dark:text-pulse-500">Verified students do the work.</span>
            </h1>
            <p className="text-base sm:text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed">
              Fixed-price bundles for content, feedback and events. Tell us about your product, pay once via Paystack, and review every piece of work before
              it is paid.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              {cta(null, signedIn ? 'Open packages in your dashboard' : 'Get started', btnPrimary)}
              <a
                href="/business"
                onClick={e => {
                  e.preventDefault();
                  navigate('/business');
                }}
                className={btnGhost}
              >
                Need something custom?
              </a>
            </div>
          </section>

          <section aria-label="Packages" className="max-w-6xl mx-auto px-5 sm:px-8 pb-12 sm:pb-16">
            {state.kind === 'loading' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading packages">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-[340px] rounded-3xl bg-zinc-100 dark:bg-zinc-900 animate-pulse motion-reduce:animate-none" />
                ))}
              </div>
            ) : state.kind === 'error' ? (
              <div className="max-w-xl">
                <ErrorPanel title="Packages did not load" message={state.message} actionLabel="Try again" onAction={load} />
              </div>
            ) : state.packages.length === 0 ? (
              <EmptyState
                mascot="thinking"
                title="No packages available right now."
                subtitle="You can still post your own custom task."
                action={
                  <a
                    href="/business"
                    onClick={e => {
                      e.preventDefault();
                      navigate('/business');
                    }}
                    className={btnPrimary}
                  >
                    See custom tasks
                  </a>
                }
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.packages.map(p => (
                  <li key={p.id}>
                    <Card className="h-full flex flex-col !space-y-0 gap-4">
                      <div className="space-y-3 flex-1">
                        {p.category && <p className="text-xs font-bold uppercase tracking-wider text-pulse-700 dark:text-pulse-400">{p.category}</p>}
                        <h2 className="text-lg font-extrabold leading-tight text-ink dark:text-white">{p.name}</h2>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{p.description}</p>
                        <dl className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <dt className="sr-only">What you get</dt>
                            <PackageCheck className="w-4 h-4 mt-0.5 shrink-0 text-pulse-600 dark:text-pulse-500" aria-hidden="true" />
                            <dd className="font-semibold text-ink dark:text-white">{deliverableFor(p)}</dd>
                          </div>
                          <div className="flex items-start gap-2">
                            <dt className="sr-only">Who does it</dt>
                            <Users className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
                            <dd className="text-zinc-700 dark:text-zinc-300">{studentsLabel(p.slots)}</dd>
                          </div>
                          <div className="flex items-start gap-2">
                            <dt className="sr-only">Delivery</dt>
                            <Clock className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
                            <dd className="text-zinc-700 dark:text-zinc-300">{daysLabel(p.estimatedDeliveryDays)}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3">
                        <PriceBreakdown total={p.totalPrice} slots={p.slots} reward={p.rewardPerCompletion} feeRate={p.platformFeeRate} />
                        {cta(p.slug, 'Get started', `${btnPrimary} w-full`, `Get started with ${p.name}`)}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-pulse-600 dark:text-pulse-500" /> You review every submission before it is paid
              </li>
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-pulse-600 dark:text-pulse-500" /> Paid once via Paystack, no subscription
              </li>
              <li className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-pulse-600 dark:text-pulse-500" /> One price, nothing added at checkout
              </li>
            </ul>

            {/* How Packages Work & Package Types */}
            <div className="mt-14 space-y-12 border-t border-zinc-100 dark:border-zinc-800/80 pt-12">
              <div className="space-y-4 max-w-2xl">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-ink dark:text-white">
                  How ready-made packages work
                </h2>
                <p className="text-zinc-600 dark:text-zinc-400 text-sm sm:text-base leading-relaxed">
                  Packages are fixed bundles of work done by verified Nigerian students. Each package opens for orders once enough students have joined TaskPulse to deliver it.
                </p>
                <div className="grid sm:grid-cols-3 gap-4 pt-2">
                  <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <span className="w-8 h-8 rounded-full bg-pulse-500/15 text-pulse-700 dark:text-pulse-400 text-xs font-black flex items-center justify-center">1</span>
                    <h3 className="font-bold text-ink dark:text-white text-sm">Choose deliverable</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      Pick private product feedback, a content test, or campus event support, each with one clear price.
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <span className="w-8 h-8 rounded-full bg-pulse-500/15 text-pulse-700 dark:text-pulse-400 text-xs font-black flex items-center justify-center">2</span>
                    <h3 className="font-bold text-ink dark:text-white text-sm">Verified students</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      Verified students on TaskPulse work through your brief and send their proof.
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <span className="w-8 h-8 rounded-full bg-pulse-500/15 text-pulse-700 dark:text-pulse-400 text-xs font-black flex items-center justify-center">3</span>
                    <h3 className="font-bold text-ink dark:text-white text-sm">Review & approve</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      Review each submission in your dashboard before it is paid. Unused slots are refunded, fee included.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-ink dark:text-white">
                  Package types
                </h2>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="p-5 rounded-3xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <h3 className="font-extrabold text-ink dark:text-white text-base">Private Product Feedback</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      Detailed user feedback panels from targeted Nigerian students sharing honest thoughts and usability observations in private.
                    </p>
                  </div>
                  <div className="p-5 rounded-3xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <h3 className="font-extrabold text-ink dark:text-white text-base">Content Tests</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      Objective clarity, messaging, and appeal ratings on your landing pages, ad creatives, or copy before you spend on marketing.
                    </p>
                  </div>
                  <div className="p-5 rounded-3xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    <h3 className="font-extrabold text-ink dark:text-white text-base">Event Coverage</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      In-person student brand teams for campus activations, event attendance check-ins, and raw mobile footage transfers.
                    </p>
                  </div>
                </div>
              </div>

              {/* Student verification and review rules */}
              <div className="rounded-3xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 p-6 space-y-3">
                <h3 className="font-extrabold text-ink dark:text-white text-base">How the work is delivered</h3>
                <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Every package is done by verified students in Nigeria. You receive the work through your TaskPulse dashboard, and payment for each slot is held until you review and approve the submission. Unused slots are refunded to the card or account you paid with.
                </p>
              </div>
            </div>
          </section>

          {/* Worker strip */}
          <section className="border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950">
            <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-ink dark:text-white">
                <GraduationCap className="w-5 h-5 shrink-0 text-pulse-600 dark:text-pulse-500" />
                <span>
                  Are you a student? Earn from real tasks. <span className="text-pulse-700 dark:text-pulse-400">No deposit, ever.</span>
                </span>
              </p>
              <a
                href="/"
                onClick={e => {
                  e.preventDefault();
                  onWorkerSignUp();
                }}
                className="text-sm font-bold text-pulse-700 dark:text-pulse-400 underline-offset-4 hover:underline"
              >
                Join as a student
              </a>
            </div>
          </section>
        </main>

        <footer className="border-t border-zinc-100 dark:border-zinc-900">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between text-sm text-zinc-500">
            <p className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> © {new Date().getFullYear()} TaskPulse by GEOSAN NEXGEN INNOVATIONS
            </p>
            <div className="flex flex-wrap gap-4 font-semibold">
              <a
                href="/"
                onClick={e => {
                  e.preventDefault();
                  navigate('/');
                }}
                className="hover:text-ink dark:hover:text-white"
              >
                Home
              </a>
              <a
                href="/business"
                onClick={e => {
                  e.preventDefault();
                  navigate('/business');
                }}
                className="hover:text-ink dark:hover:text-white"
              >
                For Businesses
              </a>
              <a
                href="/packages"
                onClick={e => {
                  e.preventDefault();
                  navigate('/packages');
                }}
                className="hover:text-ink dark:hover:text-white"
              >
                Packages
              </a>
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
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
