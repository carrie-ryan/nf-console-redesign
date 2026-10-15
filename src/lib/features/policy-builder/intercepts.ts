/**
 * INTERCEPTS — what a service captures on a dialing identity's device, and where two
 * services capture the same traffic. Two services whose intercepts overlap, both
 * dialable by one identity, compete for the same connections on that device.
 *
 * A service's intercept is its `intercept` when set, else derived from its
 * interceptAddress ('api.corp:443' → api.corp, 443–443, tcp). Pure and headless;
 * authorization comes from the world index, observed state is not involved.
 */

import type { TrifectaWorld } from '../authorization/trifecta-resolver';
import { indexFor } from '../authorization/world-index';
import type { Intercept, Policy, PortRange, Service } from '../../shared/services/mock-data.service';
import type { ReasonPart } from './access-tests';

const ALL_PORTS: PortRange = { low: 0, high: 65535 };

/** The service's intercept: its own, or parsed from interceptAddress ('host:port' or
 *  'host:low-high'; no port means every port). http/https intercept tcp. */
export function interceptOf(service: Pick<Service, 'intercept' | 'interceptAddress' | 'protocol'>): Intercept {
  if (service.intercept) return service.intercept;
  const raw = (service.interceptAddress ?? '').trim();
  const protocols: Intercept['protocols'] = [service.protocol === 'udp' ? 'udp' : 'tcp'];
  if (!raw) return { addresses: [], portRanges: [], protocols };
  const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(raw);
  if (!m) return { addresses: [raw], portRanges: [ALL_PORTS], protocols };
  const low = Number(m[2]);
  return { addresses: [m[1]], portRanges: [{ low, high: m[3] ? Number(m[3]) : low }], protocols };
}

// ─── addresses ────────────────────────────────────────────────────────────────

type Addr =
  | { kind: 'name'; name: string }
  | { kind: 'wildcard'; domain: string } // '*.corp.internal' → 'corp.internal'
  | { kind: 'ip'; low: number; high: number }; // an IP is a /32

function ipv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

function parseAddr(raw: string): Addr {
  const s = raw.trim().toLowerCase();
  const [base, bits] = s.split('/');
  const ip = ipv4(base);
  if (ip !== null) {
    const prefix = bits === undefined ? 32 : Number(bits);
    if (Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
      const size = 2 ** (32 - prefix);
      const low = Math.floor(ip / size) * size;
      return { kind: 'ip', low, high: low + size - 1 };
    }
  }
  if (s.startsWith('*.')) return { kind: 'wildcard', domain: s.slice(2) };
  return { kind: 'name', name: s };
}

const inDomain = (name: string, domain: string) => name.endsWith(`.${domain}`);

/** The addresses both cover — the narrower one, as written — or null. */
function addressOverlap(a: string, b: string): string | null {
  const x = parseAddr(a);
  const y = parseAddr(b);
  if (x.kind === 'ip' || y.kind === 'ip') {
    if (x.kind !== 'ip' || y.kind !== 'ip') return null;
    if (x.low > y.high || y.low > x.high) return null;
    return x.high - x.low <= y.high - y.low ? a : b;
  }
  if (x.kind === 'name' && y.kind === 'name') return x.name === y.name ? a : null;
  if (x.kind === 'name' && y.kind === 'wildcard') return inDomain(x.name, y.domain) ? a : null;
  if (x.kind === 'wildcard' && y.kind === 'name') return inDomain(y.name, x.domain) ? b : null;
  // Two wildcards: one domain within (or equal to) the other.
  const xd = (x as { domain: string }).domain;
  const yd = (y as { domain: string }).domain;
  if (xd === yd || inDomain(xd, yd)) return a;
  return inDomain(yd, xd) ? b : null;
}

// ─── overlap ──────────────────────────────────────────────────────────────────

export interface InterceptOverlap {
  /** The first shared address — the narrower of the two, as written. */
  address: string;
  /** The first shared port range. */
  ports: PortRange;
  /** Every shared protocol. */
  protocols: Intercept['protocols'];
}

/** Where two intercepts overlap: a shared address, port range and protocol — or null. */
export function overlapOf(a: Intercept, b: Intercept): InterceptOverlap | null {
  const protocols = a.protocols.filter((p) => b.protocols.includes(p));
  if (!protocols.length) return null;
  let ports: PortRange | null = null;
  for (const p of a.portRanges) {
    for (const q of b.portRanges) {
      const low = Math.max(p.low, q.low);
      const high = Math.min(p.high, q.high);
      if (low <= high) {
        ports = { low, high };
        break;
      }
    }
    if (ports) break;
  }
  if (!ports) return null;
  for (const x of a.addresses) {
    for (const y of b.addresses) {
      const address = addressOverlap(x, y);
      if (address !== null) return { address, ports, protocols };
    }
  }
  return null;
}

/** True when the intercepts share an address, a port range and a protocol. */
export function overlaps(a: Intercept, b: Intercept): boolean {
  return overlapOf(a, b) !== null;
}

// ─── conflicts ────────────────────────────────────────────────────────────────

export interface ServiceOverlap extends InterceptOverlap {
  /** The two services, world order. */
  serviceIds: [string, string];
  serviceNames: [string, string];
}

export interface InterceptConflict {
  identityId: string;
  identityName: string;
  /** Pairs of services it may dial whose intercepts overlap, world order. */
  overlaps: ServiceOverlap[];
}

/** One overlapping service pair, with every identity that may dial both. */
export interface PairConflict extends ServiceOverlap {
  /** World order. */
  identityIds: string[];
}

/** Dialers per service, from the Dial policies (memoised per world). */
function dialersOf(world: TrifectaWorld): Map<string, Set<string>> {
  const ix = indexFor(world);
  return ix.memo('intercepts:dialers', () => {
    const dialers = new Map<string, Set<string>>();
    for (const p of world.policies) {
      if (p.type !== 'dial') continue;
      const ids = ix.identityIdsMatching(p.identityRoles, p.semantic);
      if (!ids.size) continue;
      for (const sid of ix.serviceIdsMatching(p.serviceRoles, p.semantic)) {
        const set = dialers.get(sid) ?? new Set<string>();
        for (const id of ids) set.add(id);
        dialers.set(sid, set);
      }
    }
    return dialers;
  });
}

/**
 * Every pair of services (world order) whose intercepts overlap and that some
 * identity may dial both of — with those identities. Memoised per world.
 */
export function pairConflicts(world: TrifectaWorld): PairConflict[] {
  return indexFor(world).memo('intercepts:pairs', () => {
    const dialers = dialersOf(world);
    const order = new Map(world.identities.map((i, n) => [i.id, n]));
    const dialable = world.services.filter((s) => dialers.has(s.id));
    const intercepts = dialable.map(interceptOf);
    const out: PairConflict[] = [];
    for (let i = 0; i < dialable.length; i++) {
      for (let j = i + 1; j < dialable.length; j++) {
        const o = overlapOf(intercepts[i], intercepts[j]);
        if (!o) continue;
        const a = dialable[i];
        const b = dialable[j];
        const bDialers = dialers.get(b.id)!;
        const identityIds = [...dialers.get(a.id)!].filter((id) => bDialers.has(id)).sort((x, y) => order.get(x)! - order.get(y)!);
        if (identityIds.length) out.push({ ...o, serviceIds: [a.id, b.id], serviceNames: [a.name, b.name], identityIds });
      }
    }
    return out;
  });
}

/**
 * Per identity (world order), the pairs of services it may dial — selected by a Dial
 * policy of each — whose intercepts overlap. Identities without any are left out.
 * Memoised per world.
 */
export function interceptConflicts(world: TrifectaWorld): InterceptConflict[] {
  return indexFor(world).memo('intercepts:conflicts', () => {
    const byIdentity = new Map<string, ServiceOverlap[]>();
    for (const { identityIds, ...pair } of pairConflicts(world)) {
      for (const id of identityIds) byIdentity.set(id, [...(byIdentity.get(id) ?? []), pair]);
    }
    return world.identities
      .filter((i) => byIdentity.has(i.id))
      .map((i) => ({ identityId: i.id, identityName: i.name, overlaps: byIdentity.get(i.id)! }));
  });
}

// ─── wording, warnings, per-service view ─────────────────────────────────────

/** "api-prod.corp.internal:443/tcp" (a range: ":8000-8100"; both protocols: "/tcp+udp"). */
export function overlapLabel(o: InterceptOverlap): string {
  const ports = o.ports.low === o.ports.high ? `${o.ports.low}` : `${o.ports.low}-${o.ports.high}`;
  return `${o.address}:${ports}/${o.protocols.join('+')}`;
}

/** Names listed before "and N others". */
const NAMES_SHOWN = 5;

const joinAnd = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function namesText(names: readonly string[]): string {
  if (names.length <= NAMES_SHOWN) return joinAnd(names);
  const rest = names.length - (NAMES_SHOWN - 1);
  return `${names.slice(0, NAMES_SHOWN - 1).join(', ')} and ${rest.toLocaleString('en-US')} others`;
}

export interface ConflictWarning {
  serviceIds: [string, string];
  /** The identities the draft newly puts in this conflict, world order. */
  identityIds: string[];
  /** The Dial policies responsible — the ones this draft made or changed, if any. */
  policies: { id: string; name: string }[];
  /** "alice@corp.com, … can now dial both api-prod and reports-svc, whose … means." */
  text: string;
  /** `text`, then "Granted by <policy>." with the policy linked. */
  parts: ReasonPart[];
}

const sameDialRule = (a: Policy, b: Policy | undefined) =>
  !!b && a.type === b.type && a.semantic === b.semantic &&
  a.identityRoles.join('\n') === b.identityRoles.join('\n') && a.serviceRoles.join('\n') === b.serviceRoles.join('\n');

/** The Dial policies granting `serviceId` to any of `identityIds`, world order. */
function dialGrants(world: TrifectaWorld, serviceId: string, identityIds: readonly string[]): Policy[] {
  const ix = indexFor(world);
  return ix
    .policiesForService(serviceId)
    .filter((p) => p.type === 'dial' && identityIds.some((id) => ix.identityIdsMatching(p.identityRoles, p.semantic).has(id)));
}

/**
 * The intercept conflicts the draft creates: per overlapping service pair, the
 * identities in it in the draft but not live. Conflicts live already has aren't
 * repeated. A warning, never a block.
 */
export function newConflictWarnings(live: TrifectaWorld, draft: TrifectaWorld): ConflictWarning[] {
  if (live === draft) return [];
  const key = (ids: readonly string[]) => ids.join('|');
  const before = new Map(pairConflicts(live).map((c) => [key(c.serviceIds), new Set(c.identityIds)]));
  const liveIx = indexFor(live);
  const draftIx = indexFor(draft);
  const out: ConflictWarning[] = [];
  for (const c of pairConflicts(draft)) {
    const was = before.get(key(c.serviceIds));
    const identityIds = was ? c.identityIds.filter((id) => !was.has(id)) : c.identityIds;
    if (!identityIds.length) continue;
    const granting = [...new Set([...dialGrants(draft, c.serviceIds[0], identityIds), ...dialGrants(draft, c.serviceIds[1], identityIds)])];
    const changed = granting.filter((p) => !sameDialRule(p, liveIx.policy(p.id)));
    const policies = draft.policies.filter((p) => (changed.length ? changed : granting).includes(p)).map((p) => ({ id: p.id, name: p.name }));
    const names = identityIds.map((id) => draftIx.identity(id)?.name ?? id);
    const one = identityIds.length === 1;
    const text =
      `${namesText(names)} can now dial both ${c.serviceNames[0]} and ${c.serviceNames[1]}, whose intercepts overlap on ${overlapLabel(c)}. ` +
      `${one ? 'Its tunneller' : 'Their tunnellers'} can't tell which service a connection means.`;
    const parts: ReasonPart[] = [{ text }];
    if (policies.length) {
      parts.push({ text: ' Granted by ' });
      policies.forEach((p, i) => {
        if (i) parts.push({ text: i === policies.length - 1 ? ' and ' : ', ' });
        parts.push({ text: p.name, link: { kind: 'policy', id: p.id } });
      });
      parts.push({ text: '.' });
    }
    out.push({ serviceIds: c.serviceIds, identityIds, policies, text, parts });
  }
  return out;
}

export interface ServiceOverlapView {
  otherId: string;
  otherName: string;
  /** "Overlaps with api-prod · 3 identities" */
  badge: string;
  /** "api-prod.corp.internal:443/tcp" */
  label: string;
  identities: { id: string; name: string }[];
  /** The Dial policies granting each side to those identities. */
  thisPolicies: { id: string; name: string }[];
  otherPolicies: { id: string; name: string }[];
}

/** The services whose intercepts overlap this one's for some identity that may dial both. */
export function serviceOverlaps(world: TrifectaWorld, serviceId: string): ServiceOverlapView[] {
  const ix = indexFor(world);
  const ref = (p: Policy) => ({ id: p.id, name: p.name });
  return pairConflicts(world)
    .filter((c) => c.serviceIds.includes(serviceId))
    .map((c) => {
      const other = c.serviceIds[0] === serviceId ? 1 : 0;
      const n = c.identityIds.length;
      return {
        otherId: c.serviceIds[other],
        otherName: c.serviceNames[other],
        badge: `Overlaps with ${c.serviceNames[other]} · ${n.toLocaleString('en-US')} ${n === 1 ? 'identity' : 'identities'}`,
        label: overlapLabel(c),
        identities: c.identityIds.map((id) => ({ id, name: ix.identity(id)?.name ?? id })),
        thisPolicies: dialGrants(world, serviceId, c.identityIds).map(ref),
        otherPolicies: dialGrants(world, c.serviceIds[other], c.identityIds).map(ref),
      };
    });
}

/** For one identity: per service it may dial, the services it overlaps with (names). */
export function identityOverlaps(world: TrifectaWorld, identityId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of pairConflicts(world)) {
    if (!c.identityIds.includes(identityId)) continue;
    out.set(c.serviceIds[0], [...(out.get(c.serviceIds[0]) ?? []), c.serviceNames[1]]);
    out.set(c.serviceIds[1], [...(out.get(c.serviceIds[1]) ?? []), c.serviceNames[0]]);
  }
  return out;
}
