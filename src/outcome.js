/**
 * Outcome classifier — Protocol v2 §6.
 * Every run ends in exactly one of:
 *   reached-payment | redirected-off-domain | agent-blocked | errored
 */
export function classifyOutcome(ctx) {
  // ctx: { paymentReached, redirected, captcha, botWall, mandatoryAccountWall, error }
  if (ctx.error && !ctx.paymentReached && !ctx.captcha && !ctx.botWall) {
    return { outcome: 'errored', reason: ctx.error };
  }
  if (ctx.captcha || ctx.botWall || ctx.mandatoryAccountWall) {
    return { outcome: 'agent-blocked', reason: ctx.botWall ? 'bot-wall' : ctx.mandatoryAccountWall ? 'mandatory-account-or-id' : 'captcha' };
  }
  if (ctx.paymentReached && ctx.redirected) {
    return { outcome: 'redirected-off-domain', reason: 'payment-on-third-party-domain' };
  }
  if (ctx.paymentReached) {
    return { outcome: 'reached-payment', reason: 'ok' };
  }
  return { outcome: 'errored', reason: 'did-not-reach-payment' };
}
