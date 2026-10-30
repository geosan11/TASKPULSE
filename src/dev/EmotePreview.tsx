/**
 * DEV-ONLY gallery for the Pulse emotes and celebration moments, at /__preview.
 * App.tsx only imports this when import.meta.env.DEV or VITE_UI_PREVIEW=1,
 * so it is compiled out of normal production builds. Renders the real
 * components with fake data; nothing here talks to Supabase.
 */
import { useEffect, useState } from 'react';
import { EMOTES, PulseEmote, type EmoteName } from '../components/PulseEmote';
import { ErrorPanel, primaryButtonClass, secondaryButtonClass } from '../components/ui';
import { HomeTab } from '../components/HomeTab';
import { TasksTab } from '../components/TasksTab';
import { WalletTab } from '../components/WalletTab';
import { CreateCampaignModal, PackagesEntry } from '../components/BusinessTab';
import { PackagesStorefront } from '../components/PackagesStorefront';
import type { PackageItem } from '../lib/packages';
import { celebrate, showReward } from '../lib/celebrate';
import { DEFAULT_MARKETPLACE_SETTINGS } from '../config/marketplace';
import type { DbTask } from '../lib/supabaseClient';
import type { MySubmission, TxItem, UserProfile } from '../types';

const settings = DEFAULT_MARKETPLACE_SETTINGS;
const now = new Date().toISOString();

const user: UserProfile = {
  id: 'preview-user',
  username: 'ada_k',
  fullName: 'Ada Kalu',
  email: 'ada@example.com',
  phone: '08012345678',
  role: 'worker',
  businessName: null,
  emailConfirmed: true,
  kycStatus: 'unverified',
  withdrawableBalance: 2400,
  pendingBalance: 600,
  totalWithdrawnLifetime: 0,
  streakDays: 3,
  checkedInToday: false,
  referralCode: 'ADA200',
  approvedTaskCount: 0,
  firstTaskApprovedAt: null,
  payoutEligibleFrom: null,
  isLegacyMember: false,
  createdAt: now,
};

const task = (id: string, title: string, company: string, reward: number): DbTask => ({
  id,
  title,
  company,
  reward,
  category: 'Surveys',
  time: '5 min',
  SLA: '48h',
  spotsLeft: 42,
  spotsTotal: 100,
  description: 'Answer 8 quick questions about how you shop for groceries.',
  steps: ['Open the survey link', 'Answer all 8 questions', 'Screenshot the thank-you page'],
  proofType: 'screenshot',
  campaignId: 'c1',
  targetUrl: 'https://example.com',
});
const tasks = [task('t1', 'Grocery habits survey', 'FreshCart', 300), task('t2', 'Test our sign-up flow', 'PayLite', 500), task('t3', 'Rate 5 product photos', 'Shoply', 150)];

// Mirrors the 015 seed; prices = slots x reward x 1.15 (016). Content test shown as
// not yet fillable (worker-count gate).
const pkg = (slug: string, name: string, description: string, slots: number, reward: number, days: number, available = true): PackageItem => ({
  id: slug,
  slug,
  name,
  description,
  slots,
  rewardPerCompletion: reward,
  platformFeeRate: 0.15,
  totalPrice: Math.ceil(slots * reward * 1.15),
  estimatedDeliveryDays: days,
  available,
});
const previewPackages: PackageItem[] = [
  pkg('10-local-ugc-reels', '10 Local UGC Videos', 'Get 10 authentic vertical videos (unboxings, demos or reactions) made by real Nigerian university students and delivered to you as raw files.', 10, 3500, 4),
  pkg('campus-feedback-panel', 'Campus Feedback Panel', '25 verified Nigerian students use your product and send private, honest feedback and a short survey. Nothing is posted publicly.', 25, 1500, 3),
  pkg('product-seeding-pack', 'Product Seeding & Lifestyle Content', 'High-resolution lifestyle product placement photos and short reaction videos from 5 verified students.', 5, 7000, 5),
  pkg('content-test-panel', 'Content Test Panel', '50 verified students watch your ad, reel or sound and rate how clear, memorable and convincing it is, before you spend on promotion.', 50, 500, 2, false),
  pkg('event-ground-squad', 'Event Coverage Micro-Team', 'On-the-ground team of verified students covering your activation, pop-up stall, or campus booth with photos, video clips and attendance notes.', 4, 10000, 3),
];
const packageTask: DbTask = {
  ...task('cmp_pkg', 'Campus Feedback Panel: Acme App', 'Acme', 1500),
  category: 'Product Feedback',
  spotsLeft: 18,
  spotsTotal: 25,
  description: '',
  steps: [
    'PROJECT: Acme App',
    'LOCATION: UniLag',
    'Use the product for at least 10 minutes. Answer the survey and write 3 honest sentences on what worked, what confused you and whether you\'d use it again. Submit your answers and one screenshot showing you used it. Do not post a review anywhere.',
  ],
  targetUrl: 'https://acme.example/app',
};

const subs: MySubmission[] = [
  { id: 's1', taskId: 't9', taskTitle: 'Grocery habits survey', company: 'FreshCart', reward: 300, paidAmount: null, status: 'pending', reviewNote: null, completedAt: now, payoutStatus: null, reviewDeadlineAt: new Date(Date.now() + 40 * 3600e3).toISOString(), approvalSource: null },
  { id: 's2', taskId: 't8', taskTitle: 'Test our sign-up flow', company: 'PayLite', reward: 500, paidAmount: null, status: 'pending', reviewNote: null, completedAt: now, payoutStatus: null, reviewDeadlineAt: new Date(Date.now() + 40 * 3600e3).toISOString(), approvalSource: null },
  { id: 's3', taskId: 't7', taskTitle: 'Rate 5 product photos', company: 'Shoply', reward: 150, paidAmount: 150, status: 'approved', reviewNote: null, completedAt: now, payoutStatus: 'held', reviewDeadlineAt: new Date(Date.now() + 20 * 3600e3).toISOString(), approvalSource: 'auto' },
];

const cashouts: TxItem[] = [1, 2].map(i => ({
  id: `w${i}`,
  type: 'cashout',
  title: 'Withdrawal',
  description: '',
  amount: 1000,
  status: 'disbursed',
  reference: `wd_${i}`,
  createdAt: now,
  destinationBank: 'Opay',
}));

const SCENES = [
  'gallery',
  'home-first',
  'home-empty',
  'reward',
  'tasks-review',
  'rejected',
  'errors',
  'wallet-limit',
  'loading',
  'create-campaign',
  'signup',
  'withdraw',
  'first-payout',
  'referral',
  'campaign-live',
  'proof-sent',
  'packages-entry',
  'packages',
  'package-feed',
  'package-task',
] as const;
type Scene = (typeof SCENES)[number];

function fire(scene: Scene) {
  if (scene === 'signup') celebrate('Welcome, Ada!', 'Pick a task and start earning.', { emote: 'excited', then: 'clap', effect: 'confetti' });
  if (scene === 'withdraw') celebrate('Money on the way!', '₦2,000 to Opay.', { emote: 'done', effect: 'check' });
  if (scene === 'first-payout') celebrate('Your first payout!', '₦1,000 is on the way to Opay.', { emote: 'shocked', then: 'done', effect: 'check' });
  if (scene === 'referral') celebrate('₦200 referral bonus!', 'Someone you invited finished their tasks. Thanks for spreading the word.', { emote: 'love', effect: 'hearts' });
  if (scene === 'campaign-live') celebrate('Your task is live!', '₦34,500 received. People can start now.', { emote: 'clap', effect: 'confetti' });
  if (scene === 'proof-sent') celebrate('Proof sent!', "You'll get ₦300 once FreshCart approves it.", { emote: 'searching', effect: 'bob' });
  if (scene === 'reward') showReward({ title: 'Task approved!', subtitle: 'Grocery habits survey', amount: 300, emote: 'success' });
}

export default function EmotePreview({ isDarkMode, onToggleTheme }: { isDarkMode: boolean; onToggleTheme: () => void }) {
  const [scene, setScene] = useState<Scene>(() => {
    const s = new URLSearchParams(window.location.search).get('scene') as Scene | null;
    return s && SCENES.includes(s) ? s : 'gallery';
  });
  const [balance, setBalance] = useState(user.withdrawableBalance);

  useEffect(() => {
    const t = window.setTimeout(() => {
      fire(scene);
      if (scene === 'reward') setBalance(b => b + 300);
    }, 250);
    return () => window.clearTimeout(t);
  }, [scene]);

  const go = (s: Scene) => {
    window.history.replaceState({}, '', `/__preview?scene=${s}`);
    setScene(s);
  };

  return (
    <div className="relative w-full max-w-md h-full flex flex-col bg-white dark:bg-ink text-ink dark:text-white sm:border-x sm:border-zinc-200 dark:sm:border-zinc-900">
      <div data-preview-controls className="shrink-0 flex gap-2 overflow-x-auto no-scrollbar px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <button type="button" onClick={onToggleTheme} className="shrink-0 h-8 px-3 rounded-full bg-zinc-100 dark:bg-zinc-900 text-xs font-bold">
          {isDarkMode ? 'Light' : 'Dark'}
        </button>
        {SCENES.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => go(s)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold ${s === scene ? 'bg-pulse-500 text-ink' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500'}`}
          >
            {s}
          </button>
        ))}
      </div>
      <main key={scene} className="tab-enter flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-10">
        {scene === 'gallery' && (
          <div className="grid grid-cols-3 gap-3">
            {(Object.keys(EMOTES) as EmoteName[]).map(n => (
              <div key={n} className="flex flex-col items-center gap-1 p-2 rounded-2xl bg-zinc-100 dark:bg-zinc-900">
                <PulseEmote name={n} size={88} eager />
                <span className="text-xs font-semibold text-zinc-500">{n}</span>
              </div>
            ))}
          </div>
        )}
        {(scene === 'home-first' || scene === 'reward' || scene === 'rejected') && (
          <>
            {scene === 'rejected' && (
              <div className="mb-5">
                <ErrorPanel
                  emote="sad"
                  title="Proof not accepted: Grocery habits survey"
                  message="Reason: “Screenshot doesn't show the thank-you page.”"
                  actionLabel="Find another task"
                  onAction={() => {}}
                />
              </div>
            )}
            <HomeTab
              user={{ ...user, withdrawableBalance: balance, approvedTaskCount: scene === 'reward' ? 1 : 0 }}
              settings={settings}
              tasks={tasks}
              businessMode={false}
              hasSubmissions={scene !== 'home-first'}
              newTaskCount={scene === 'home-first' ? 2 : 0}
              onCheckIn={async () => {}}
              onOpenTask={() => {}}
              onGoto={() => {}}
            />
          </>
        )}
        {scene === 'home-empty' && (
          <HomeTab user={user} settings={settings} tasks={[]} businessMode={false} hasSubmissions={false} newTaskCount={0} onCheckIn={async () => {}} onOpenTask={() => {}} onGoto={() => {}} />
        )}
        {scene === 'tasks-review' && <TasksTab user={user} tasks={tasks} submissions={subs} selected={null} onSelect={() => {}} onSubmitted={async () => {}} initialView="mine" />}
        {scene === 'errors' && (
          <div className="space-y-4">
            <ErrorPanel title="Proof not sent" message="Network request failed. Check your connection." actionLabel="Try again" onAction={() => {}} />
            <ErrorPanel title="Withdrawal not sent" message="Too many attempts. Please wait a minute and try again." actionLabel="Try again" onAction={() => {}} />
          </div>
        )}
        {scene === 'wallet-limit' && (
          <WalletTab
            user={{ ...user, payoutEligibleFrom: '2026-01-01T00:00:00Z', approvedTaskCount: 4, totalWithdrawnLifetime: 2000 }}
            settings={settings}
            banks={[{ id: 'b1', bankCode: '999992', bankName: 'Opay', accountName: 'ADA KALU', accountNumber: '8012345678' }]}
            transactions={cashouts}
            onChanged={async () => {}}
            notify={() => {}}
          />
        )}
        {scene === 'loading' && (
          <div className="h-full min-h-[60vh] flex flex-col items-center justify-center gap-2 text-sm text-zinc-400">
            <PulseEmote name="determined" size={88} animate="pop" eager alt="" />
            Loading…
          </div>
        )}
        {scene === 'packages-entry' && (
          <div className="space-y-6">
            <div className="px-1 pt-1">
              <p className="text-sm text-zinc-500">Acme Ltd</p>
              <h1 className="text-2xl font-extrabold text-ink dark:text-white">Campaigns</h1>
            </div>
            <PackagesEntry onOpen={() => go('packages')} />
          </div>
        )}
        {scene === 'packages' && <PackagesStorefront preview={previewPackages} onBack={() => go('packages-entry')} />}
        {scene === 'package-feed' && (
          <TasksTab user={user} tasks={[packageTask, ...tasks]} submissions={[]} selected={null} onSelect={() => {}} onSubmitted={async () => {}} />
        )}
        {scene === 'package-task' && (
          <TasksTab user={user} tasks={[packageTask, ...tasks]} submissions={[]} selected={packageTask} onSelect={() => {}} onSubmitted={async () => {}} />
        )}
        {scene === 'create-campaign' && <CreateCampaignModal open settings={settings} onClose={() => {}} onCreated={async () => {}} notify={() => {}} />}
        {['signup', 'withdraw', 'first-payout', 'referral', 'campaign-live', 'proof-sent'].includes(scene) && (
          <div className="space-y-3 pt-10 text-center">
            <p className="text-sm text-zinc-500">Celebration: {scene}</p>
            <button type="button" className={primaryButtonClass} onClick={() => fire(scene)}>
              Play again
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => go('gallery')}>
              Back to gallery
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
