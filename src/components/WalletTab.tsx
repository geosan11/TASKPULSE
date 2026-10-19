import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Landmark, Loader2, Lock } from 'lucide-react';
import { AnimatedNaira, EmptyState, ErrorPanel, ErrorText, inputClass, Label, Modal, primaryButtonClass, secondaryButtonClass, StatusPill } from './ui';
import { formatNaira, type MarketplaceSettings } from '../config/marketplace';
import { PAYSTACK_BANKS } from '../config/banks';
import { Combobox } from './Select';

const BANK_OPTIONS = PAYSTACK_BANKS.map(b => ({ value: b.code, label: b.name }));
import { linkBankAccount, requestDisbursement as requestDisbursementApi, resolveBankAccount, verifyPayment } from '../lib/api';
import { bankSavedNotice, isIdRequiredError, withdrawIdPrompt, type WithdrawIdPrompt } from '../lib/withdrawId';
import { celebrate } from '../lib/celebrate';
import { PulseEmote } from './PulseEmote';
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
  // Withdrawals need a verified ID (the server enforces it; this is the friendly
  // prompt). Saving the bank account is what verifies it (name check).
  const [idGate, setIdGate] = useState<WithdrawIdPrompt | null>(null);
  const [withdrawKey, setWithdrawKey] = useState(0);
  const [checkingBank, setCheckingBank] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const idPrompt = withdrawIdPrompt(user.kycStatus, Boolean(bank));
  const openIdGate = (p: WithdrawIdPrompt) => {
    setCheckError(null);
    setIdGate(p);
  };
  // Re-run the name check on the saved account (also how older accounts get verified).
  const checkSavedBank = async () => {
    if (!bank) return;
    setCheckingBank(true);
    setCheckError(null);
    try {
      const res = await linkBankAccount({ accountNumber: bank.accountNumber, bankCode: bank.bankCode, bankName: bank.bankName });
      const n = bankSavedNotice(res.identity?.kyc_status);
      setIdGate(null);
      notify(n.title, n.subtitle);
      await onChanged();
    } catch (err: any) {
      setCheckError(err?.message || 'Could not check your account. Try again.');
    } finally {
      setCheckingBank(false);
    }
  };
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
  const limitReached = countLeft === 0 || remainingToday < settings.minWithdrawal;
  if (limitReached) blockers.push("You've reached today's withdrawal limit");
  const canWithdraw = blockers.length === 0;

  return (
    <div className="space-y-6 pb-8">
      <h1 className="text-2xl font-extrabold text-ink dark:text-white px-1 pt-1">Wallet</h1>

      <div className="rounded-[28px] bg-ink dark:bg-zinc-900 dark:border dark:border-zinc-800 text-white p-6 space-y-5">
        <div>
          <p className="text-sm text-zinc-400">Available to withdraw</p>
          <p data-coin-target className="inline-block origin-left text-[40px] leading-none font-extrabold tracking-tight mt-2 tabular-nums">
            <AnimatedNaira value={user.withdrawableBalance} format={formatNaira} />
          </p>
          <p className="text-sm text-zinc-400 mt-3">
            Pending <span className="text-white font-semibold ml-1">{formatNaira(user.pendingBalance)}</span>
          </p>
          {user.pendingBalance > 0 && (
            <p className="text-xs text-zinc-500 mt-1">
              Approved rewards stay pending while the business can still check them ({settings.reviewWindowAutoHours}h for automatically
              checked tasks, {settings.reviewWindowHumanHours}h for ones a person reviews), then move to Available automatically.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={!canWithdraw}
          onClick={() => (idPrompt ? openIdGate(idPrompt) : setWithdrawOpen(true))}
          className={`${primaryButtonClass} disabled:!opacity-100 disabled:!bg-zinc-800 disabled:!text-zinc-500`}
        >
          {!canWithdraw && <Lock className="w-4 h-4" />} Withdraw
        </button>
        {!canWithdraw && (
          <div className="flex items-center gap-3">
            <ul className="space-y-1 flex-1 min-w-0">
              {blockers.map(b => (
                <li key={b} className="text-sm text-zinc-400">
                  • {b}
                </li>
              ))}
            </ul>
            {limitReached && (
              <div className="shrink-0 text-center">
                <PulseEmote name="tired" size={64} alt="" />
                <p className="text-[11px] font-semibold text-zinc-500">Back tomorrow</p>
              </div>
            )}
          </div>
        )}
      </div>

      {idPrompt && (
        <button
          type="button"
          onClick={() => openIdGate(idPrompt)}
          className="tactile w-full text-left px-5 py-4 rounded-3xl bg-pulse-50 dark:bg-zinc-900 border border-pulse-200 dark:border-zinc-800 cursor-pointer"
        >
          <p className="text-[15px] font-bold text-ink dark:text-white">{idPrompt.title}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{idPrompt.body}</p>
        </button>
      )}

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
        key={withdrawKey}
        onNeedsId={() => {
          setWithdrawOpen(false);
          setWithdrawKey(k => k + 1);
          openIdGate(withdrawIdPrompt(user.kycStatus === 'verified' ? 'unverified' : user.kycStatus, Boolean(bank))!);
          void onChanged();
        }}
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        bank={bank}
        balance={user.withdrawableBalance}
        remainingToday={remainingToday}
        settings={settings}
        firstPayout={user.totalWithdrawnLifetime <= 0 && !transactions.some(t => t.type.toLowerCase() === 'cashout')}
        userId={user.id}
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

      <Modal open={Boolean(idGate)} onClose={() => setIdGate(null)} title={idGate?.title || ''}>
        <p className="text-[15px] text-zinc-600 dark:text-zinc-300">{idGate?.body}</p>
        <ErrorText>{checkError}</ErrorText>
        {idGate?.action === 'add_bank' ? (
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              setIdGate(null);
              setBankModal(true);
            }}
          >
            {idGate.actionLabel}
          </button>
        ) : idGate?.action === 'check_bank' ? (
          <button type="button" className={primaryButtonClass} disabled={checkingBank} onClick={checkSavedBank}>
            {checkingBank && <Loader2 className="w-5 h-5 animate-spin" />} {idGate.actionLabel}
          </button>
        ) : (
          <button type="button" className={secondaryButtonClass} onClick={() => setIdGate(null)}>
            OK
          </button>
        )}
      </Modal>

      <BankModal
        open={bankModal}
        current={bank}
        onClose={() => setBankModal(false)}
        onLinked={async kycStatus => {
          setBankModal(false);
          const n = bankSavedNotice(kycStatus);
          notify(n.title, n.subtitle);
          await onChanged();
        }}
      />
    </div>
  );
}

function WithdrawModal({
  open,
  onNeedsId,
  onClose,
  bank,
  balance,
  remainingToday,
  settings,
  firstPayout,
  userId,
  onDone,
}: {
  open: boolean;
  /** The server said "verify your ID first". */
  onNeedsId: () => void;
  onClose: () => void;
  bank?: SavedBank;
  balance: number;
  remainingToday: number;
  settings: MarketplaceSettings;
  firstPayout: boolean;
  userId: string;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const max = Math.floor(Math.min(balance, remainingToday));
  const amountNum = Number(amount);

  // lib/api's requestDisbursement, plus: if the server answers "verify your ID
  // first", close this sheet and show the Verify ID prompt instead of a raw error.
  const requestDisbursement = async (params: Parameters<typeof requestDisbursementApi>[0]) => {
    try {
      return await requestDisbursementApi(params);
    } catch (err) {
      if (isIdRequiredError(err)) onNeedsId();
      throw err;
    }
  };

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
    setFailed(null);
    try {
      await requestDisbursement({ amount: amountNum, bankAccountId: bank.id, idempotencyKey: idemKey });
      const bigMoment =
        firstPayout &&
        celebrate('Your first payout!', `${formatNaira(amountNum)} is on the way to ${bank.bankName}.`, {
          emote: 'shocked',
          then: 'done',
          effect: 'check',
          id: `first-payout:${userId}`,
        });
      if (!bigMoment) celebrate('Money on the way!', `${formatNaira(amountNum)} to ${bank.bankName}.`, { emote: 'done', effect: 'check', id: `withdraw:${idemKey}` });
      setAmount('');
      setIdemKey(crypto.randomUUID());
      await onDone();
    } catch (err: any) {
      setFailed(err?.message || 'Withdrawal failed. Your balance has not changed.');
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
      {failed && !submitting && <ErrorPanel title="Withdrawal not sent" message={failed} actionLabel="Try again" onAction={submit} />}
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
  /** kyc_status after the server's bank-name check ('verified', 'pending', ...). */
  onLinked: (kycStatus: string | null) => Promise<void>;
}) {
  // Starts empty so nobody saves (or name-checks against) a bank they didn't pick.
  const [bankCode, setBankCode] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccountName(null);
    setError(null);
    if (accountNumber.length !== 10 || !bankCode) return;
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
      const res = await linkBankAccount({ accountNumber, bankCode, bankName });
      await onLinked(res.identity?.kyc_status ?? null);
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
      <Combobox
        label="Bank"
        value={bankCode}
        onChange={setBankCode}
        options={BANK_OPTIONS}
        placeholder="Select your bank"
        emptyText="Bank not listed yet."
        required
        error={!bankCode && accountNumber.length === 10 ? 'Bank is required. Select your bank to check the account name.' : undefined}
      />
      <div>
        <Label hint="10-digit NUBAN">Account number</Label>
        <input
          className={inputClass}
          type="text"
          inputMode="numeric"
          pattern="[0-9]{10}"
          autoComplete="off"
          aria-label="Account number"
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
