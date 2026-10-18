import React, { useState } from 'react';
import { Modal } from './ui';
import { formatNaira, NOT_ALLOWED_TASKS, type MarketplaceSettings } from '../config/marketplace';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="font-bold text-ink dark:text-white text-sm">{title}</h4>
      <p>{children}</p>
    </div>
  );
}

export function TermsModal({
  open,
  onClose,
  initialTab = 'terms',
  settings,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: 'terms' | 'privacy';
  settings: MarketplaceSettings;
}) {
  const [tab, setTab] = useState<'terms' | 'privacy'>(initialTab);
  const feePct = Math.round(settings.platformFeeRate * 100);

  return (
    <Modal open={open} onClose={onClose} title="Terms & Privacy" eyebrow="Legal" wide>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
        {(['terms', 'privacy'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-10 rounded-full text-sm font-bold cursor-pointer transition-all ${
              tab === t ? 'bg-white dark:bg-zinc-800 text-ink dark:text-white shadow-sm' : 'text-zinc-500'
            }`}
          >
            {t === 'terms' ? 'Terms of Service' : 'Privacy Policy (NDPR)'}
          </button>
        ))}
      </div>

      <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-3.5 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed no-scrollbar border-y border-zinc-100 dark:border-zinc-800 py-3">
        {tab === 'terms' ? (
          <>
            <Section title="1. Free to join, one account per person">
              TaskPulse is a micro-task marketplace. Joining is free and we will never ask you for a deposit. Each person may
              hold exactly one account and link one bank account. Multiple accounts, fake proofs or automated submissions lead
              to rejected tasks and may lead to suspension.
            </Section>
            <Section title="2. How workers earn">
              You earn only when a task you completed is approved by the business that posted it (or by a TaskPulse admin).
              The reward shown on the task is paid from that business's pre-funded campaign budget into your withdrawable
              balance. Rejected submissions are not paid.
            </Section>
            <Section title="3. Withdrawals">
              Withdrawals go to your verified Nigerian bank account through Paystack. The minimum withdrawal is{' '}
              {formatNaira(settings.minWithdrawal)}, you can withdraw up to {formatNaira(settings.dailyWithdrawalLimit)} (and at
              most {settings.maxWithdrawalsPerDay} withdrawals) per day, and your first withdrawal is available{' '}
              {settings.payoutCooldownHours} hours after your first approved task.
            </Section>
            <Section title="4. Referral bonus">
              When someone joins with your code and gets at least {settings.referralQualifyingTasks} tasks approved by
              businesses other than you, you receive {formatNaira(settings.referralBonusReferrer)}
              {settings.referralBonusReferee > 0 ? <> and they receive {formatNaira(settings.referralBonusReferee)}</> : null}.
              {settings.referralRequireFeeCover
                ? ` The bonus is paid once the platform fees from their approved tasks reach the bonus amount (at ${formatNaira(
                    Math.ceil((settings.referralBonusReferrer + settings.referralBonusReferee) / settings.referralQualifyingTasks / settings.platformFeeRate)
                  )} or more per task, that is after ${settings.referralQualifyingTasks} tasks).`
                : ''}{' '}
              Referral bonuses are capped per referrer and are withheld for self-referrals or duplicate accounts.
            </Section>
            <Section title="5. Businesses">
              Businesses pay the full campaign cost up front: reward per completion × number of slots, plus a {feePct}%
              platform fee. The worker receives the full reward; the fee is on top, not deducted. Businesses must review
              submissions fairly and promptly. When a campaign is ended, the rewards for unused slots
              {settings.refundFeeOnUnused ? ' and their share of the platform fee are' : ' are'} refunded to the card or account
              used to pay. Tasks must be lawful and must not ask workers for passwords, payments or personal data.
            </Section>
            <div className="space-y-1">
              <h4 className="font-bold text-ink dark:text-white text-sm">6. Tasks that are not allowed</h4>
              <p>
                TaskPulse pays real people for honest work. Feedback tasks collect private, honest opinions for the business;
                they are never public reviews. Businesses may not post, and workers must not complete:
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {NOT_ALLOWED_TASKS.map(t => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p>
                We remove campaigns that break these rules, refund the unused budget, and may suspend the account.
              </p>
            </div>
            <Section title="7. Paystack">
              All card payments and bank payouts run on Paystack. TaskPulse never sees or stores card numbers, CVVs or online
              banking passwords.
            </Section>
          </>
        ) : (
          <>
            <Section title="1. Nigeria Data Protection Act (NDPA)">
              We process your personal information lawfully and only to run the marketplace, pay you and prevent fraud.
            </Section>
            <Section title="2. What we collect">
              Name, username, phone number, email, how you heard about us (optional), task proofs you submit, and your bank
              payout details. For KYC we store only the type and last 4 digits of your ID.
            </Section>
            <Section title="3. Who sees your proofs">
              Proof screenshots are stored privately. Only you, the business that posted the task and TaskPulse admins can
              view them.
            </Section>
            <Section title="4. Your rights">
              You can ask to inspect, export or delete your data at any time by emailing support@taskpulse.website.
            </Section>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full h-12 rounded-full bg-ink dark:bg-white text-white dark:text-ink font-bold text-[15px] transition-all hover:opacity-95 cursor-pointer"
      >
        I understand
      </button>
    </Modal>
  );
}
