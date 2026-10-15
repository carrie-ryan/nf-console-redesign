/**
 * The canvas legend's entries: every chip, marker and line style the service canvas
 * can show, by section. The service view decides which are PRESENT (and which cards,
 * edges and services carry each — what hovering an entry keeps at full strength);
 * the legend card renders each entry's real marker beside its label.
 */

import type { CanvasLayer } from './canvas-layers';

export type LegendSection = 'lines' | 'verdict' | 'cards' | 'draft' | 'hosts' | 'service';

export const LEGEND_SECTIONS: readonly { id: LegendSection; title: string }[] = [
  { id: 'lines', title: 'Lines' },
  { id: 'verdict', title: 'Verdict' },
  { id: 'cards', title: 'Policy cards' },
  { id: 'draft', title: 'Draft and live' },
  { id: 'hosts', title: 'Hosts' },
  { id: 'service', title: 'Service card' },
];

export interface LegendEntryDef {
  id: string;
  section: LegendSection;
  label: string;
  /** Hidden with this "Show on canvas" layer. */
  layer?: CanvasLayer;
}

/** In section order, then the order each section lists them. */
export const LEGEND_ENTRIES: readonly LegendEntryDef[] = [
  { id: 'line-ok', section: 'lines', label: 'All reachable' },
  { id: 'line-warn', section: 'lines', label: 'Routers offline' },
  { id: 'line-bad', section: 'lines', label: 'No shared router' },
  { id: 'line-none', section: 'lines', label: 'No identities yet' },
  { id: 'line-all', section: 'lines', label: 'Through #all' },

  { id: 'verdict-ok', section: 'verdict', label: 'Someone can connect' },
  { id: 'verdict-bad', section: 'verdict', label: 'No one can connect' },
  { id: 'verdict-waiting', section: 'verdict', label: 'No host serving yet' },
  { id: 'verdict-ready', section: 'verdict', label: 'Hosts start serving after commit' },
  { id: 'verdict-blank', section: 'verdict', label: 'Nothing set up yet' },
  { id: 'verdict-gap', section: 'verdict', label: 'Dotted underline: see why' },

  { id: 'card-rule', section: 'cards', label: 'Rule: identities by attribute' },
  { id: 'card-named', section: 'cards', label: 'Named identities' },
  { id: 'card-box', section: 'cards', label: 'One policy, several groups' },
  { id: 'card-empty', section: 'cards', label: 'Policy with no identities yet' },
  { id: 'card-cover', section: 'cards', label: 'Covers other services too' },
  { id: 'card-all', section: 'cards', label: 'Applies to all services' },
  { id: 'card-router', section: 'cards', label: 'Router identity' },
  { id: 'card-check', section: 'cards', label: 'Requires a posture check', layer: 'posture' },
  { id: 'card-blocked', section: 'cards', label: 'Members failing posture', layer: 'posture' },
  { id: 'card-bypass', section: 'cards', label: 'Checks skipped elsewhere', layer: 'posture' },
  { id: 'card-expiry', section: 'cards', label: 'Time-limited access', layer: 'expiry' },
  { id: 'card-expiry-soon', section: 'cards', label: 'Expires within the hour', layer: 'expiry' },

  { id: 'draft-edited', section: 'draft', label: 'Edited in this draft' },
  { id: 'draft-new', section: 'draft', label: 'New in this draft' },
  { id: 'draft-proposed', section: 'draft', label: 'Proposed by the assistant' },
  { id: 'draft-live', section: 'draft', label: 'Changed in live meanwhile' },
  { id: 'draft-routing', section: 'draft', label: 'Routing changed in this draft' },

  { id: 'host-serving', section: 'hosts', label: 'Serving this service now', layer: 'hosts' },
  { id: 'host-standby', section: 'hosts', label: 'Standby: traffic if others fail', layer: 'hosts' },
  { id: 'host-blocked', section: 'hosts', label: 'Fails posture: no traffic', layer: 'hosts' },
  { id: 'host-edit', section: 'hosts', label: 'Hosting defaults', layer: 'hosts' },

  { id: 'svc-attr', section: 'service', label: 'Attribute an edge matched' },
  { id: 'svc-hosting', section: 'service', label: 'Hosts · edit traffic sharing' },
  { id: 'svc-traffic', section: 'service', label: 'Hosts from several policies' },
  { id: 'svc-overlap', section: 'service', label: 'Intercepts overlap' },
  { id: 'svc-routing', section: 'service', label: 'Eligible routers online' },
  { id: 'svc-outage', section: 'service', label: 'Every eligible router offline' },
  { id: 'svc-norouting', section: 'service', label: 'No eligible router yet' },
  { id: 'svc-menu', section: 'service', label: 'Details and access report' },
  { id: 'svc-remove', section: 'service', label: 'Remove from the canvas' },
];

/** What carries one entry on the canvas — kept at full strength while it is hovered. */
export interface LegendMatch {
  groups: Set<string>;
  services: Set<string>;
  /** `${groupId}|${serviceId}` */
  edges: Set<string>;
  /** Policies shown as an empty rule (no identities yet). */
  rules: Set<string>;
}

export const emptyMatch = (): LegendMatch => ({ groups: new Set(), services: new Set(), edges: new Set(), rules: new Set() });

export const matchSize = (m: LegendMatch) => m.groups.size + m.services.size + m.edges.size + m.rules.size;

/** One row of the legend card. */
export interface LegendEntry extends LegendEntryDef {
  /** On the current canvas (its layer on). */
  present: boolean;
  /** Its layer is off: not on the canvas, listed only under "Show all". */
  hidden: boolean;
}
