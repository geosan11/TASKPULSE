import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, Loader2, Lock } from 'lucide-react';
import { EmptyState, ErrorText, inputClass, Label, Modal, primaryButtonClass, secondaryButtonClass, StatusPill } from './ui';
import { formatNaira, type MarketplaceSettings } from '../config/marketplace';
import { PAYSTACK_BANKS } from '../config/banks';
import { linkBankAccount, requestDisbursement, resolveBankAccount, verifyPayment } from '../lib/api';
import { celebrate } from '../lib/celebrate';
import { formatDateTime, isDebit, txTypeLabel, type SavedBank, type TxItem, type UserProfile } from '../types';

function startOfLagosDay() {
  const lagosDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  return new Date(`${lagosDate}T00:00:00+01:00`).getTime();
}

export function WalletTab({
  user,
  settings,
  banks,
  transactions,
  onChanged,
  notify,
}: {
  user: UserProfile;
  settings: MarketplaceSettings;
  banks: SavedBank[];
  transactions: TxItem[];
  onChanged: () => Promise<void>;
  notify: (title: string, subtitle: string) => void;
}) {
  const bank = banks[0];
  const [bankModal, setBankModal] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [receipt, setReceipt] = useState<TxItem | null>(null);
  const [checking, setChecking] = useState(false);

  // Older activation deposits can be stuck at "pending" if Paystack's redirect
  // or webhook never reached us. Let the owner of the row re-check it; the
  // server verifies with Paystack and credits it at most once.
  const recheckPayment = async (t: TxItem) => {
    if (!t.reference) return;
    setChecking(true);
    try {
      const res = await verifyPayment(t.reference);
      notify('Payment confirmed', res.message || 'Credited to your wallet.');
      setReceipt(null);
      await onChanged();
    } catch (err: any) {
      notify('Not confirmed', err?.message || 'Paystack has no completed payment for this reference.');
    } finally {
      setChecking(false);
    }
  };
  const [, forceTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const dayStart = startOfLagosDay();
  const todays = transactions.filter(
    t => t.type.toLowerCase() === 'cashout' && ['pending', 'disbursed', 'settled'].includes(t.status.toLowerCase()) && new Date(t.createdAt).getTime() >= dayStart
  );
  const usedToday = todays.reduce((s, t) => s + t.amount, 0);
  const remainingToday = Math.max(0, settings.dailyWithdrawalLimit - usedToday);
  const countLeft = Math.max(0, settings.maxWithdrawalsPerDay - todays.length);

  const eligibleFrom = user.payoutEligibleFrom ? new Date(user.payoutEligibleFrom).getTime() : null;
  const cooldownDone = eligibleFrom !== null && eligibleFrom <= Date.now();
  const hoursLeft = eligibleFrom !== null && !cooldownDone ? Math.ceil((eligibleFrom - Date.now()) / 3_600_000) : 0;

  // Only show what is still blocking a withdrawal, in plain words.
  const blockers: string[] = [];
  if (eligibleFrom === null) blockers.push('Get your first task approved');
  else if (!cooldownDone) blockers.push(`Withdrawals open in about ${hoursLeft}h`);
  if (!bank) blockers.push('Add your bank account');
  if (user.withdrawableBalance < settings.minWithdrawal) blockers.push(`Minimum withdrawal is ${formatNaira(settings.minWithdrawal)}`);
  if (countLeft === 0 || remainingToday < settings.minWithdrawal) blockers.push("You've reached today's withdrawal limit");
  const canWithdraw = blockers.length === 0;

  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-2xl font-extrabold text-ink dark:text-white px-1 pt-1">Wallet</h1>

      <div className="rounded-[28px] bg-ink dark:bg-zinc-900 dark:border dark:border-zinc-800 text-white p-6 space-y-5">
        <div>
          <p className="text-sm text-zinc-400">Available to withdraw</p>
          <p className="text-[40px] leading-none font-extrabold tracking-tight mt-2">{formatNaira(user.withdrawableBalance)}</p>
          <p className="text-sm text-zinc-400 mt-3">
            Pending <span className="text-white font-semibold ml-1">{formatNaira(user.pendingBalance)}</span>
          </p>
          {user.pendingBalance > 0 && (
            <p className="text-xs text-zinc-500 mt-1">
              Approved rewards stay pending for the {settings.reviewWindowHours}h review window, then move to Available automatically.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={!canWithdraw}
          onClick={() => setWithdrawOpen(true)}
          className={`${primaryButtonClass} disabled:!opacity-100 disabled:!bg-zinc-800 disabled:!text-zinc-500`}
        >
          {!canWithdraw && <Lock className="w-4 h-4" />} Withdraw
        </button>
        {!canWithdraw && (
          <ul className="space-y-1">
            {blockers.map(b => (
              <li key={b} className="text-sm text-zinc-400">
                • {b}
              </li>
            ))}
          </ul>
        )}
      </div>

      {user.isLegacyMember && user.withdrawableBalance > 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1">Your earlier balance was carried over in full.</p>
      )}

      <button
        type="button"
        onClick={() => setBankModal(true)}
        className="tactile w-full flex items-center gap-4 p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-left cursor-pointer"
      >
        <div className="w-11 h-11 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
          <Landmark className="w-5 h-5 text-ink dark:text-white" />
        </div>
        <div className="min-w-0 flex-1">
          {bank ? (
            <>
              <p className="text-[15px] font-bold text-ink dark:text-white truncate">{bank.bankName}</p>
              <p className="text-sm text-zinc-500 truncate">
                {bank.accountName} · {bank.accountNumber.slice(-4).padStart(bank.accountNumber.length > 4 ? 6 : 4, '•')}
              </p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-bold text-ink dark:text-white">Add bank account</p>
              <p className="text-sm text-zinc-500">Where your money goes</p>
            </>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-zinc-400" />
      </button>

      <section className="space-y-3">
        <h2 className="text-base font-extrabold text-ink dark:text-white px-1">History</h2>
        {transactions.length === 0 ? (
          <EmptyState mascot={null} icon={<ArrowDownLeft className="w-6 h-6" />} title="No activity yet" subtitle="Earnings and withdrawals show up here." />
        ) : (
          <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            {transactions.slice(0, 30).map(t => {
              const debit = isDebit(t.type);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setReceipt(t)}
                  className="w-full text-left flex items-center gap-3 px-5 py-4 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-ink dark:text-white">
                    {debit ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4 text-pulse-700 dark:text-pulse-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-ink dark:text-white truncate">{txTypeLabel(t.type)}</p>
                    <p className="text-xs text-zinc-500">{formatDateTime(t.createdAt)}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className={`text-[15px] font-bold ${debit ? 'text-ink dark:text-white' : 'text-pulse-700 dark:text-pulse-400'}`}>
                      {debit ? '−' : '+'}
                      {formatNaira(Math.abs(t.amount))}
                    </p>
                    <StatusPill status={t.status} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        bank={bank}
        balance={user.withdrawableBalance}
        remainingToday={remainingToday}
        settings={settings}
        onDone={async () => {
          setWithdrawOpen(false);
          await onChanged();
        }}
      />

      <Modal open={Boolean(receipt)} onClose={() => setReceipt(null)} title={receipt ? txTypeLabel(receipt.type) : ''}>
        {receipt && (
          <dl className="space-y-3 text-sm">
            {[
              ['Amount', formatNaira(Math.abs(receipt.amount))],
              ['Status', <StatusPill key="s" status={receipt.status} />],
              ['Date', `${formatDateTime(receipt.createdAt)} WAT`],
              ['Details', receipt.title || receipt.description || '—'],
              ...(receipt.destinationBank ? [['Bank', receipt.destinationBank]] : []),
              ['Reference', receipt.reference || '—'],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="font-semibold text-ink dark:text-white text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {receipt &&
          receipt.type.toLowerCase() === 'deposit' &&
          receipt.status.toLowerCase() === 'pending' &&
          /^dep_/.test(receipt.reference || '') && (
            <button
              type="button"
              className={`${secondaryButtonClass} mt-5`}
              disabled={checking}
              onClick={() => recheckPayment(receipt)}
            >
              {checking && <Loader2 className="w-5 h-5 animate-spin" />} Check payment with Paystack
            </button>
          )}
      </Modal>

      <BankModal
        open={bankModal}
        current={bank}
        onClose={() => setBankModal(false)}
        onLinked={async () => {
          setBankModal(false);
          notify('Bank saved', 'Your payout account is verified.');
          await onChanged();
        }}
      />
    </div>
  );
}

function WithdrawModal({
  open,
  onClose,
  bank,
  balance,
  remainingToday,
  settings,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  bank?: SavedBank;
  balance: number;
  remainingToday: number;
  settings: MarketplaceSettings;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const max = Math.floor(Math.min(balance, remainingToday));
  const amountNum = Number(amount);

  const validate = () => {
    if (!Number.isInteger(amountNum) || amountNum <= 0) return 'Enter an amount.';
    if (amountNum < settings.minWithdrawal) return `Minimum is ${formatNaira(settings.minWithdrawal)}.`;
    if (amountNum > remainingToday) return `You can withdraw up to ${formatNaira(remainingToday)} more today.`;
    if (amountNum > balance) return 'That is more than your balance.';
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!bank) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestDisbursement({ amount: amountNum, bankAccountId: bank.id, idempotencyKey: idemKey });
      celebrate('Money on the way!', `${formatNaira(amountNum)} to ${bank.bankName}.`);
      setAmount('');
      setIdemKey(crypto.randomUUID());
      await onDone();
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Withdraw">
      <div className="text-center py-2">
        <input
          autoFocus
          inputMode="numeric"
          value={amount ? `₦${Number(amount).toLocaleString('en-NG')}` : ''}
          onChange={e => setAmount(e.target.value.replace(/\D/g, ''))}
          placeholder="₦0"
          className="w-full bg-transparent text-center text-5xl font-extrabold text-ink dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-700 focus:outline-none"
          aria-label="Amount"
        />
        <button type="button" onClick={() => setAmount(String(max))} className="mt-3 text-sm font-bold text-pulse-700 dark:text-pulse-400 cursor-pointer">
          Max {formatNaira(max)}
        </button>
      </div>
      {bank && (
        <p className="text-sm text-zinc-500 text-center">
          To {bank.accountName} · {bank.bankName}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <button type="button" className={primaryButtonClass} disabled={submitting || !amount} onClick={submit}>
        {submitting && <Loader2 className="w-5 h-5 animate-spin" />} Withdraw {amount ? formatNaira(amountNum) : ''}
      </button>
      <p className="text-xs text-zinc-400 text-center">
        Min {formatNaira(settings.minWithdrawal)} · up to {formatNaira(settings.dailyWithdrawalLimit)} a day
      </p>
    </Modal>
  );
}

function BankModal({
  open,
  current,
  onClose,
  onLinked,
}: {
  open: boolean;
  current?: SavedBank;
  onClose: () => void;
  onLinked: () => Promise<void>;
}) {
  const [bankCode, setBankCode] = useState<string>(current?.bankCode || PAYSTACK_BANKS[0].code);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccountName(null);
    setError(null);
    if (accountNumber.length !== 10) return;
    let cancelled = false;
    setResolving(true);
    resolveBankAccount(accountNumber, bankCode)
      .then(res => {
        if (!cancelled) setAccountName(res.data.account_name);
      })
      .catch(err => {
        if (!cancelled) setError(err.message || 'Could not verify this account.');
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountNumber, bankCode]);

  const save = async () => {
    const bankName = PAYSTACK_BANKS.find(b => b.code === bankCode)?.name || '';
    setSaving(true);
    setError(null);
    try {
      await linkBankAccount({ accountNumber, bankCode, bankName });
      await onLinked();
    } catch (err: any) {
      setError(err.message || 'Could not save this account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={current ? 'Bank account' : 'Add bank account'}>
      {current && (
        <p className="text-sm text-zinc-500">
          You can have one bank account. Current: {current.bankName} ••{current.accountNumber.slice(-4)}
        </p>
      )}
      <div>
        <Label>Bank</Label>
        <select className={inputClass} value={bankCode} onChange={e => setBankCode(e.target.value)}>
          {PAYSTACK_BANKS.map(b => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Account number</Label>
        <input
          className={inputClass}
          inputMode="numeric"
          maxLength={10}
          value={accountNumber}
          onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="10 digits"
        />
      </div>
      <div className="min-h-[24px] px-1 text-sm">
        {resolving && (
          <span className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking account…
          </span>
        )}
        {accountName && <span className="font-bold text-pulse-700 dark:text-pulse-400">✓ {accountName}</span>}
      </div>
      <ErrorText>{error}</ErrorText>
      <button type="button" className={primaryButtonClass} disabled={!accountName || saving} onClick={save}>
        {saving && <Loader2 className="w-5 h-5 animate-spin" />} Save
      </button>
      <button type="button" className={secondaryButtonClass} onClick={onClose}>
        Cancel
      </button>
    </Modal>
  );
}
