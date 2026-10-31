import React from 'react';
import { renderToString } from 'react-dom/server';
import { DEFAULT_MARKETPLACE_SETTINGS } from './config/marketplace';
import { Landing } from './components/Landing';
import { BusinessPage } from './components/BusinessPage';
import { PublicPackagesPage } from './components/PublicPackagesPage';
import { LegalPage } from './components/LegalPage';

export { ROUTE_META, canonicalFor, SITE_URL } from './lib/seo-routes';

export function render(path: string): string {
  switch (path) {
    case '/':
      return renderToString(
        <div className="h-[100dvh] w-full overflow-hidden flex justify-center bg-white text-ink">
          <div className="relative w-full max-w-md h-full flex flex-col bg-white text-ink sm:border-x sm:border-zinc-200">
            <header className="px-5 h-16 flex items-center justify-between shrink-0 z-40 bg-white/90 backdrop-blur">
              <a href="/" aria-label="TaskPulse home" className="h-11 flex items-center">
                <img
                  src="/brand/logo-lockup-light.png"
                  alt="TaskPulse"
                  className="h-11 w-auto -ml-1 logo-on-light"
                  draggable={false}
                />
              </a>
              <div className="flex items-center gap-2">
                <a
                  href="/?for=worker"
                  className="tactile h-10 px-4 rounded-full bg-ink text-white text-sm font-bold flex items-center"
                >
                  Sign in
                </a>
              </div>
            </header>
            <main className="flex-1 overflow-y-auto no-scrollbar px-5 pt-2">
              <Landing
                settings={DEFAULT_MARKETPLACE_SETTINGS}
                tasks={[]}
                onStartEarning={() => {}}
                onPostTasks={() => {}}
                onSignIn={() => {}}
                onSeePricing={() => {}}
                onSeePackages={() => {}}
                onOpenTerms={() => {}}
              />
            </main>
          </div>
        </div>
      );

    case '/business':
      return renderToString(
        <BusinessPage
          settings={DEFAULT_MARKETPLACE_SETTINGS}
          isDarkMode={false}
          signedIn={false}
          onSignUpBusiness={() => {}}
          onSignIn={() => {}}
          onOpenLegal={() => {}}
        />
      );

    case '/packages':
      return renderToString(
        <PublicPackagesPage
          isDarkMode={false}
          signedIn={false}
          onToggleTheme={() => {}}
          onGetStarted={() => {}}
          onWorkerSignUp={() => {}}
          onSignIn={() => {}}
          onOpenLegal={() => {}}
        />
      );

    case '/terms':
      return renderToString(
        <LegalPage type="terms" settings={DEFAULT_MARKETPLACE_SETTINGS} isDarkMode={false} />
      );

    case '/privacy':
      return renderToString(
        <LegalPage type="privacy" settings={DEFAULT_MARKETPLACE_SETTINGS} isDarkMode={false} />
      );

    default:
      return '';
  }
}
