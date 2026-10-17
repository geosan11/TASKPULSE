/** Pure pricing checks for the display maths (server is the source of truth). Run: npm run test:pricing */
import { computeCampaignCost, computeCancelRefund, referralOffer, DEFAULT_MARKETPLACE_SETTINGS } from '../../src/config/marketplace';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

// Owner's pitch: 100 x N300 + 25% = N37,500; worker gets N300, business pays N375 per response
const pitch = computeCampaignCost(300, 100, 0.25);
check('pitch 100 x 300 @25%', pitch.rewardBudget === 30000 && pitch.platformFee === 7500 && pitch.total === 37500, pitch);
check('pitch per response 375 (300 + 75)', pitch.costPerResponse === 375 && pitch.feePerResponse === 75, pitch);
check('pitch kobo', pitch.total * 100 === 3_750_000);

// Matches SQL ceil(budget * (1 + rate)) for awkward rates (float trap 100 x 1.07)
check('rate 0.07 no float drift', computeCampaignCost(100, 1, 0.07).total === 107, computeCampaignCost(100, 1, 0.07));
check('rate 0.15', computeCampaignCost(100, 1, 0.15).total === 115);
check('N50 x 5 rounds fee up', computeCampaignCost(50, 5, 0.25).total === 313);
check('max 5000 x 10000', computeCampaignCost(5000, 10000, 0.25).total === 62_500_000);
check('garbage input -> 0', computeCampaignCost(NaN, -5, 0.25).total === 0 && computeCampaignCost(-300, 10, 0.25).total === 0);

// Cancel refund preview mirrors set_campaign_status() in 009
const c = { escrowBalance: 29700, slotsPending: 1, slotsApproved: 1, rewardPerCompletion: 300, platformFee: 7500, feeRefundDue: 0 };
const r = computeCancelRefund(c, 0.25, true);
check('cancel refund 98 x 375', r.reward === 29400 && r.fee === 7350 && r.total === 36750, r);
check('cancel refund rewards only when fee kept', computeCancelRefund(c, 0.25, false).total === 29400);
check('never-used campaign refunds whole fee',
  computeCancelRefund({ ...c, escrowBalance: 250, slotsPending: 0, slotsApproved: 0, rewardPerCompletion: 50, platformFee: 63 }, 0.25, true).total === 313);

check('referral copy with N0 friend bonus', referralOffer(DEFAULT_MARKETPLACE_SETTINGS) === 'Invite a friend, get ₦200', referralOffer(DEFAULT_MARKETPLACE_SETTINGS));
check('referral copy both', referralOffer({ ...DEFAULT_MARKETPLACE_SETTINGS, referralBonusReferee: 200 }) === 'Invite a friend, you both get ₦200');

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('pricing tests: PASS');
