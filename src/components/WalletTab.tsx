import { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Circle, Info, Landmark, Loader2 } from 'lucide-react';
import { Card, inputClass, Label, Modal, primaryButtonClass, secondaryButtonClass } from './ui';
import { formatNaira, type MarketplaceSettings } from '../config/marketplace';
import { PAYSTACK_BANKS } from '../config/banks';
import { linkBankAccount, requestDisbursement, resolveBankAccount } from '../lib/api';
import { formatDateTime, type SavedBank, type TxItem, type UserProfile } from '../types';

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
  const [amount, setAmount] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
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

  const checks = [
    {
      ok: eligibleFrom !== null,
      label: user.isLegacyMember && eligibleFrom !== null ? 'Existing member balance carried over' : 'Complete your first approved task',
    },
    {
      ok: cooldownDone,
      label:
        eligibleFrom === null
          ? `${settings.payoutCooldownHours}h security cooldown starts after your first approved task`
          : cooldownDone
          ? 'Security cooldown complete'
          : `Security cooldown: about ${hoursLeft}h left`,
    },
    { ok: Boolean(bank), label: bank ? `Bank verified: ${bank.bankName}` : 'Link one verified bank account' },
    { ok: user.withdrawableBalance >= settings.minWithdrawal, label: `Minimum withdrawal ${formatNaira(settings.minWithdrawal)}` },
  ];
  const canWithdraw = checks.every(c => c.ok) && countLeft > 0 && remainingToday >= settings.minWithdrawal;

  const amountNum = Number(amount);
  const validateAmount = () => {
    if (!Number.isInteger(amountNum) || amountNum <= 0) return 'Enter a whole Naira amount.';
    if (amountNum < settings.minWithdrawal) return `Minimum withdrawal is ${formatNaira(settings.minWithdrawal)}.`;
    if (amountNum > remainingToday) return `You can withdraw up to ${formatNaira(remainingToday)} more today.`;
    if (amountNum > user.withdrawableBalance) return 'Amount is more than your balance.';
    return null;
  };

  const doWithdraw = async () => {
    if (!bank) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestDisbursement({ amount: amountNum, bankAccountId: bank.id, idempotencyKey: idemKey });
      notify('Withdrawal requested', res.message || `${formatNaira(amountNum)} is on its way to ${bank.bankName}.`);
      setConfirmOpen(false);
      setAmount('');
      setIdemKey(crypto.randomUUID());
      await onChanged();
    } catch (err: any) {
      setError(err.message || 'Withdrawal failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="p-5 rounded-[30px] bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-xl shadow-emerald-500/20">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/80">Withdrawable balance</p>
        <p className="text-3xl font-black mt-1">{formatNaira(user.withdrawableBalance)}</p>
        <p className="text-[11px] text-white/80 mt-1">
          Today: {formatNaira(remainingToday)} left of {formatNaira(settings.dailyWithdrawalLimit)} · {countLeft} withdrawal{countLeft === 1 ? '' : 's'} left
        </p>
      </div>

      {user.isLegacyMember && user.withdrawableBalance > 0 && (
        <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex gap-2.5 text-[11px] text-sky-800 dark:text-sky-200 leading-snug">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            TaskPulse is now free to join. Your existing balance has been carried over in full and stays withdrawable under the
            rules below. Tiers and deposits have been retired.
          </span>
        </div>
      )}

      <Card>
        <p className="text-xs font-black text-slate-900 dark:text-white">Withdrawal checklist</p>
        <ul className="space-y-1.5">
          {checks.map(c => (
            <li key={c.label} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-zinc-300">
              {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-300 shrink-0" />}
              {c.label}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-900 dark:text-white">Payout bank</p>
          {bank && (
            <button type="button" onClick={() => setBankModal(true)} className="text-[11px] font-black text-sky-600 dark:text-cyan-400 cursor-pointer">
              Re-verify
            </button>
          )}
        </div>
        {bank ? (
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/80">
            <Landmark className="w-5 h-5 text-slate-500" />
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-900 dark:text-white truncate">{bank.accountName}</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                {bank.bankName} · ****{bank.accountNumber.slice(-4)}
              </p>
            </div>
          </div>
        ) : (
          <button type="button" className={secondaryButtonClass} onClick={() => setBankModal(true)}>
            <Landmark className="w-4 h-4" /> Link bank account
          </button>
        )}
        <p className="text-[10px] text-slate-400">One bank account per user. The name must match your Paystack-verified NUBAN.</p>
      </Card>

      <Card>
        <Label hint={`Min ${formatNaira(settings.minWithdrawal)}`}>Amount (₦)</Label>
        <input
          className={inputClass}
          inputMode="numeric"
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/\D/g, ''))}
          placeholder={String(settings.minWithdrawal)}
          disabled={!canWithdraw}
        />
        {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
        <button
          type="button"
          className={primaryButtonClass}
          disabled={!canWithdraw || !amount}
          onClick={() => {
            const v = validateAmount();
            if (v) {
              setError(v);
              return;
            }
            setError(null);
            setConfirmOpen(true);
          }}
        >
          <Banknote className="w-4 h-4" /> Withdraw
        </button>
      </Card>

      <Card>
        <p className="text-xs font-black text-slate-900 dark:text-white">Recent withdrawals</p>
        {transactions.filter(t => t.type.toLowerCase() === 'cashout').length === 0 ? (
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">No withdrawals yet.</p>
        ) : (
          transactions
            .filter(t => t.type.toLowerCase() === 'cashout')
            .slice(0, 5)
            .map(t => (
              <div key={t.id} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-600 dark:text-zinc-300">{formatDateTime(t.createdAt)} WAT</span>
                <span className="font-black text-slate-900 dark:text-white">
                  {formatNaira(t.amount)} · {t.status}
                </span>
              </div>
            ))
        )}
      </Card>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm withdrawal" eyebrow="Paystack transfer">
        <p className="text-xs text-slate-600 dark:text-zinc-300">
          Send <strong>{formatNaira(amountNum)}</strong> to <strong>{bank?.accountName}</strong> ({bank?.bankName}, ****
          {bank?.accountNumber.slice(-4)})?
        </p>
        {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
        <button type="button" className={primaryButtonClass} disabled={submitting} onClick={doWithdraw}>
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Confirm
        </button>
      </Modal>

      <BankModal
        open={bankModal}
        onClose={() => setBankModal(false)}
        onLinked={async () => {
          setBankModal(false);
          notify('Bank linked', 'Your payout account is verified.');
          await onChanged();
        }}
      />
    </div>
  );
}

function BankModal({ open, onClose, onLinked }: { open: boolean; onClose: () => void; onLinked: () => Promise<void> }) {
  const [bankCode, setBankCode] = useState<string>(PAYSTACK_BANKS[0].code);
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
      setError(err.message || 'Could not link this account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Link your bank" eyebrow="NUBAN verification">
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
          placeholder="0123456789"
        />
      </div>
      <div className="min-h-[20px] text-[11px]">
        {resolving && (
          <span className="flex items-center gap-1.5 text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying with Paystack…
          </span>
        )}
        {accountName && <span className="font-black text-emerald-600 dark:text-emerald-400">✓ {accountName}</span>}
        {error && <span className="text-rose-500 font-semibold">{error}</span>}
      </div>
      <button type="button" className={primaryButtonClass} disabled={!accountName || saving} onClick={save}>
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save bank account
      </button>
    </Modal>
  );
}
