// FR-22: how many other clients in the user's own saved results share each trust detail.
// Clients are counted once each, by companyId (D-20); nothing outside the saved results is used.

import type { ClientProfile, Result } from '../core/types';

export type PeerField = 'country' | 'city' | 'industry' | 'size' | 'memberSinceYear';

export const PEER_FIELDS: readonly PeerField[] = ['country', 'city', 'industry', 'size', 'memberSinceYear'];

export type PeerCounts = Record<PeerField, number | null>;

const clientKey = (r: Result): string => r.profile?.companyId ?? `job:${r.jobId}`;

const same = (a: ClientProfile, b: ClientProfile, field: PeerField): boolean => {
  const x = a[field];
  const y = b[field];
  if (x === null || y === null) return false;
  return typeof x === 'string' && typeof y === 'string' ? x.trim().toLowerCase() === y.trim().toLowerCase() : x === y;
};

/** For each field: the number of other saved clients with the same value, or null when this client has none. */
export function peerCounts(target: Result, saved: readonly Result[]): PeerCounts {
  const out = { country: null, city: null, industry: null, size: null, memberSinceYear: null } as PeerCounts;
  const profile = target.profile;
  if (!profile) return out;

  const others = new Map<string, ClientProfile>();
  for (const r of saved) {
    if (!r.profile || clientKey(r) === clientKey(target)) continue;
    others.set(clientKey(r), r.profile);
  }
  for (const field of PEER_FIELDS) {
    if (profile[field] === null) continue;
    out[field] = [...others.values()].filter((p) => same(profile, p, field)).length;
  }
  return out;
}
