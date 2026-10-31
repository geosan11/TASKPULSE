import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { type MarketplaceSettings, DEFAULT_MARKETPLACE_SETTINGS } from '../config/marketplace';
import { PrivacyContent, TermsContent } from './TermsModal';

export function LegalPage({
  type,
  settings = DEFAULT_MARKETPLACE_SETTINGS,
  isDarkMode = false,
}: {
  type: 'terms' | 'privacy';
  settings?: MarketplaceSettings;
  isDarkMode?: boolean;
}) {
  return (
    <div className={`h-[100dvh] w-full overflow-y-auto ${isDarkMode ? 'dark bg-ink' : 'bg-white'}`}>
      <div className="min-h-full flex flex-col bg-white dark:bg-ink text-ink dark:text-white">
        <header className="sticky top-0 z-40 bg-white/90 dark:bg-ink/90 backdrop-blur border-b border-zinc-100 dark:border-zinc-900">
          <div className="max-w-4xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
            <a href="/" aria-label="TaskPulse home" className="h-11 flex items-center">
              <img
                src={isDarkMode ? '/brand/logo-lockup-dark.png' : '/brand/logo-lockup-light.png'}
                alt="TaskPulse"
                className={`h-11 w-auto -ml-1 ${isDarkMode ? 'logo-on-dark' : 'logo-on-light'}`}
                draggable={false}
              />
            </a>
            <nav className="flex items-center gap-2 text-sm font-semibold">
              <a href="/" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300">
                Home
              </a>
              <a href="/business" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300">
                For Businesses
              </a>
              <a href="/packages" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300">
                Packages
              </a>
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-4xl mx-auto px-5 sm:px-8 py-10 sm:py-14 space-y-8">
          <div className="space-y-3">
            <p className="text-sm font-bold uppercase tracking-wider text-pulse-700 dark:text-pulse-400">
              {type === 'terms' ? 'Rules & Policies' : 'Data Protection'}
            </p>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
              {type === 'terms' ? 'Terms of Service' : 'Privacy Policy (NDPA)'}
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm sm:text-base leading-relaxed">
              {type === 'terms'
                ? 'The rules for workers and businesses on TaskPulse: earning, withdrawals, referral bonus, campaign fees, refunds and tasks that are not allowed.'
                : 'How TaskPulse collects, uses and protects your personal data under the Nigeria Data Protection Act, and how to exercise your rights.'}
            </p>
          </div>

          <div className="space-y-6 text-[15px] sm:text-base text-zinc-700 dark:text-zinc-300 leading-relaxed border-t border-zinc-100 dark:border-zinc-800 pt-6">
            {type === 'terms' ? <TermsContent settings={settings} /> : <PrivacyContent />}
          </div>
        </main>

        <footer className="border-t border-zinc-100 dark:border-zinc-900 mt-12">
          <div className="max-w-4xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between text-sm text-zinc-500">
            <p className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> © {new Date().getFullYear()} TaskPulse by GEOSAN NEXGEN INNOVATIONS
            </p>
            <div className="flex flex-wrap gap-4 font-semibold">
              <a href="/" className="hover:text-ink dark:hover:text-white">
                Home
              </a>
              <a href="/business" className="hover:text-ink dark:hover:text-white">
                For Businesses
              </a>
              <a href="/packages" className="hover:text-ink dark:hover:text-white">
                Packages
              </a>
              <a href="/terms" className="hover:text-ink dark:hover:text-white">
                Terms
              </a>
              <a href="/privacy" className="hover:text-ink dark:hover:text-white">
                Privacy
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
