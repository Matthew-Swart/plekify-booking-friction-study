/**
 * Environment + utility helpers — Protocol v2 §9 (egress recorded per run).
 */
import { execSync } from 'node:child_process';
import os from 'node:os';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const UA = {
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

export function getCommitHash() {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; }
}

// Determine egress type. Explicit env override wins; else auto-detect:
//   server (cwd under /var/www) => 'datacenter'; laptop => 'residential'.
export function getEgress() {
  if (process.env.EGRESS) return process.env.EGRESS;
  const cwd = process.cwd();
  if (cwd.startsWith('/var/www/') || os.hostname().toLowerCase().includes('hetzner')) return 'datacenter';
  return 'residential';
}

export function getGeo() {
  return process.env.GEO || (getEgress() === 'datacenter' ? 'EU-DE' : 'ZA'); // overridden after IP lookup
}

// Best-effort public-IP + geo lookup (honest egress record). Non-fatal.
export async function lookupEgressIP() {
  try {
    const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      return { ip: j.ip, city: j.city, region: j.region, country: j.country, org: j.org };
    }
  } catch { /* offline/allowed */ }
  return { ip: null, city: null, region: null, country: null, org: null };
}

export function nowIso() {
  return new Date().toISOString();
}

// Rolling Study-B dates: check-in T+45d, check-out T+47d (Protocol §4).
export function rollingStudyBDates(from = new Date()) {
  const cin = new Date(from.getTime() + 45 * 86400000);
  const cout = new Date(from.getTime() + 47 * 86400000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { checkin: fmt(cin), checkout: fmt(cout), cin, cout };
}

export function safeSlug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
