/**
 * Friction maths — Protocol v2 §8.1 (LFI) and §8.2 (FIDPM)
 * ------------------------------------------------------------------
 * Grounded Linear Friction Index (LFI), weights calibrated to the
 * Form-Field Unit (1 field = 4.1% relative conversion loss, HubSpot):
 *
 *   F = 1.0·C + 6.6·H + 1.0·Fld_excess + 1.7·P + 9.8·I − 3.7·A − 5.4·Acc
 *
 * Term semantics (v2 — note P and I are REDEFINED vs v1):
 *   C   clicks to payment                          (count)
 *   H   domain handoffs                            (count)
 *   Fld form fields at payment step                (count); Fld_excess = max(0, Fld − 8)
 *   P   distinct page loads on the path            (count)   — load/step friction, measurable in v1 + v2
 *   I   interactive interruptions                  (count: CAPTCHA / bot-challenge / mandatory account wall)
 *   A   address-autocomplete present               (0/1)
 *   Acc accelerated checkout present               (0/1: Shop Pay / Apple Pay / Google Pay / UCP)
 *
 * P is page-count (not seconds) so the score is computable from both the v1 276-run
 * dataset and fresh v2 runs; cumulative latency is recorded separately as a secondary
 * metric. Anchor: checkout length/complexity drives 17–18% of cart abandonment.
 *
 * Friction-Induced Drop-off Probability Model (FIDPM) — completion %:
 *   logit(p_abandon) = 0.856 + 0.565·H + 0.476·I + 0.058·Fld_excess + 0.247·P − 0.751·A − 0.540·Acc
 *   completion = 1 / (1 + e^{logit})      (baseline abandonment 70.19%)
 */

export const LFI_WEIGHTS = { C: 1.0, H: 6.6, Fld: 1.0, P: 1.0, I: 9.8, A: -3.7, Acc: -5.4 };
const FIELD_BASELINE = 8; // optimal friction-free field count

export function lfi(m) {
  const fldExcess = Math.max(0, (m.fields || 0) - FIELD_BASELINE);
  return (
    LFI_WEIGHTS.C * (m.clicks || 0) +
    LFI_WEIGHTS.H * (m.handoffs || 0) +
    LFI_WEIGHTS.Fld * fldExcess +
    LFI_WEIGHTS.P * (m.pageCount || 0) +
    LFI_WEIGHTS.I * (m.interruptions || 0) +
    LFI_WEIGHTS.A * (m.autocomplete ? 1 : 0) +
    LFI_WEIGHTS.Acc * (m.accelerated ? 1 : 0)
  );
}

export function fidpmCompletionPct(m) {
  const fldExcess = Math.max(0, (m.fields || 0) - FIELD_BASELINE);
  const logit =
    0.856 +
    0.565 * (m.handoffs || 0) +
    0.476 * (m.interruptions || 0) +
    0.058 * fldExcess +
    0.247 * (m.pageCount || 0) -
    0.751 * (m.autocomplete ? 1 : 0) -
    0.540 * (m.accelerated ? 1 : 0);
  const completion = 1 / (1 + Math.exp(logit));
  return completion * 100;
}

// ITT penalty for agent-blocked / redirected runs (Protocol §7). Friction-equivalent
// of a timeout so a system that blocks agents is not rewarded with a low score.
export const ITT_TIMEOUT_PENALTY_SEC = 30;
export function ittPenaltyLfi() {
  // treat as: max clicks, 1+ handoff, max latency = timeout, 1 interruption
  return lfi({ clicks: 0, handoffs: 1, fields: 0, latencySec: ITT_TIMEOUT_PENALTY_SEC, interruptions: 1, autocomplete: false, accelerated: false });
}
