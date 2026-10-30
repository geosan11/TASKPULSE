/** Pure pricing checks for the display maths (server is the source of truth). Run: npm run test:pricing */
import { computeCampaignCost, computeCancelRefund, referralOffer, DEFAULT_MARKETPLACE_SETTINGS } from '../../src/config/marketplace';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

// Owner's pitch at the 15% fee (016): 100 x N300 + 15% = N34,500; worker gets N300, business pays N345 per response
check('default fee is 15%', DEFAULT_MARKETPLACE_SETTINGS.platformFeeRate === 0.15);
const pitch = computeCampaignCost(300, 100, DEFAULT_MARKETPLACE_SETTINGS.platformFeeRate);
check('pitch 100 x 300 @15%', pitch.rewardBudget === 30000 && pitch.platformFee === 4500 && pitch.total === 34500, pitch);
check('pitch per response 345 (300 + 45)', pitch.costPerResponse === 345 && pitch.feePerResponse === 45, pitch);
check('pitch kobo', pitch.total * 100 === 3_450_000);
// Package catalog at 15% (same ceil as create_package_campaign)
const pk: [number, number, number][] = [[10, 3500, 40250], [25, 1500, 43125], [5, 7000, 40250], [50, 500, 28750], [4, 10000, 46000]];
for (const [n, rw, want] of pk) check(`package ${n} x ${rw} @15% = ${want}`, computeCampaignCost(rw, n, 0.15).total === want, computeCampaignCost(rw, n, 0.15));

// Matches SQL ceil(budget * (1 + rate)) for awkward rates (float trap 100 x 1.07)
check('rate 0.07 no float drift', computeCampaignCost(100, 1, 0.07).total === 107, computeCampaignCost(100, 1, 0.07));
check('rate 0.15', computeCampaignCost(100, 1, 0.15).total === 115);
check('N50 x 5 rounds fee up', computeCampaignCost(50, 5, 0.15).total === 288);
check('old 25% rate still computes', computeCampaignCost(50, 5, 0.25).total === 313);
check('max 5000 x 10000', computeCampaignCost(5000, 10000, 0.15).total === 57_500_000);
check('garbage input -> 0', computeCampaignCost(NaN, -5, 0.15).total === 0 && computeCampaignCost(-300, 10, 0.15).total === 0);

// Cancel refund preview mirrors set_campaign_status() in 009
const c = { escrowBalance: 29700, slotsPending: 1, slotsApproved: 1, rewardPerCompletion: 300, platformFee: 4500, feeRefundDue: 0 };
const r = computeCancelRefund(c, 0.15, true);
check('cancel refund 98 x 345', r.reward === 29400 && r.fee === 4410 && r.total === 33810, r);
check('cancel refund rewards only when fee kept', computeCancelRefund(c, 0.15, false).total === 29400);
check('never-used campaign refunds whole fee',
  computeCancelRefund({ ...c, escrowBalance: 250, slotsPending: 0, slotsApproved: 0, rewardPerCompletion: 50, platformFee: 38 }, 0.15, true).total === 288);
// A campaign created before 016 is refunded at its own stored 25% rate.
const old = { escrowBalance: 29700, slotsPending: 1, slotsApproved: 1, rewardPerCompletion: 300, platformFee: 7500, feeRefundDue: 0 };
check('pre-016 campaign refunds 25% fee share', computeCancelRefund(old, 0.25, true).fee === 7350);

check('referral copy with N0 friend bonus', referralOffer(DEFAULT_MARKETPLACE_SETTINGS) === 'Invite a friend, get ₦200', referralOffer(DEFAULT_MARKETPLACE_SETTINGS));
check('referral copy both', referralOffer({ ...DEFAULT_MARKETPLACE_SETTINGS, referralBonusReferee: 200 }) === 'Invite a friend, you both get ₦200');

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('pricing tests: PASS');
