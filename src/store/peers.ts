// FR-22: how many other clients in the user's own history share each trust detail. Counted in the
// database (`peer_counts`, supabase/migrations); clients are counted once each, by companyId (D-20).

export type PeerField = 'country' | 'city' | 'industry' | 'size' | 'memberSinceYear';

export const PEER_FIELDS: readonly PeerField[] = ['country', 'city', 'industry', 'size', 'memberSinceYear'];

/** For each field: the number of other saved clients with the same value, or null when this client has none. */
export type PeerCounts = Record<PeerField, number | null>;
