/**
 * Merging one identity group down to a single VEVENT. The freshest copy
 * wins (SEQUENCE, then LAST-MODIFIED, then DTSTAMP, then feed order);
 * losers donate fields the winner lacks and their EXDATE/RDATE sets, and
 * every disagreement on a visible field is recorded as a conflict so the
 * report never hides an editorial decision.
 */

import { findProperties, findProperty } from "./parse.js";
import { CalEvent, Component, FieldConflict, MatchGroup, Property } from "./types.js";

/** Fields a loser may donate when the winner lacks them, in fill order. */
const FILLABLE = [
  "LOCATION",
  "DESCRIPTION",
  "URL",
  "GEO",
  "CATEGORIES",
  "ORGANIZER",
  "CLASS",
  "STATUS",
] as const;

/** Fields whose disagreement is worth reporting. */
const CONFLICT_PROPS = ["SUMMARY", "LOCATION", "DTSTART", "DTEND", "STATUS"] as const;

export interface MergedEvent {
  component: Component;
  winner: CalEvent;
  group: MatchGroup;
  /** `PROP<feed` notes for the report, e.g. `LOCATION<personal.ics`. */
  filled: string[];
  conflicts: FieldConflict[];
}

/** Order merge candidates: freshest copy first, deterministic throughout. */
export function orderCandidates(events: CalEvent[]): CalEvent[] {
  return [...events].sort((a, b) => {
    if (a.sequence !== b.sequence) return b.sequence - a.sequence;
    const lm = compareStamp(a.lastModified, b.lastModified);
    if (lm !== 0) return lm;
    const ds = compareStamp(a.dtstamp, b.dtstamp);
    if (ds !== 0) return ds;
    return a.feedIndex - b.feedIndex; // Array.prototype.sort is stable
  });
}

/** Collapse a group to one component, tracking fills and conflicts. */
export function mergeGroup(group: MatchGroup): MergedEvent {
  const ordered = orderCandidates(group.events);
  const winner = ordered[0]!;
  const losers = ordered.slice(1);
  const component = cloneComponent(winner.component);
  const filled: string[] = [];
  const conflicts: FieldConflict[] = [];

  for (const loser of losers) {
    for (const prop of FILLABLE) {
      if (hasValue(component, prop)) continue;
      const donor = findProperty(loser.component, prop);
      if (donor && donor.value.trim() !== "") {
        component.properties.push(cloneProperty(donor));
        filled.push(`${prop}<${loser.feedName}`);
      }
    }
    for (const prop of CONFLICT_PROPS) {
      const kept = findProperty(winner.component, prop);
      const dropped = findProperty(loser.component, prop);
      if (kept && dropped && kept.value !== dropped.value) {
        conflicts.push({
          prop,
          kept: kept.value,
          dropped: dropped.value,
          droppedFeed: loser.feedName,
        });
      }
    }
  }

  // Recurring masters: union EXDATE/RDATE across every copy, so an
  // exception recorded in only one feed survives the merge.
  if (winner.rrule !== null || winner.rruleRaw !== null) {
    unionDateProperties(component, group.events, "EXDATE");
    unionDateProperties(component, group.events, "RDATE");
  }

  return { component, winner, group, filled, conflicts };
}

/**
 * Replace `name` properties on `component` with the deduplicated union
 * from every event in the group. Multi-valued properties are split to
 * one value per line; parameters are preserved; order is deterministic.
 */
function unionDateProperties(component: Component, events: CalEvent[], name: string): void {
  const seen = new Set<string>();
  const union: Property[] = [];
  for (const ev of events) {
    for (const prop of findProperties(ev.component, name)) {
      for (const piece of prop.value.split(",")) {
        const value = piece.trim();
        if (value === "") continue;
        const single: Property = { name: prop.name, params: cloneParams(prop.params), value };
        const key = propertyKey(single);
        if (seen.has(key)) continue;
        seen.add(key);
        union.push(single);
      }
    }
  }
  union.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  component.properties = component.properties.filter((p) => p.name !== name.toUpperCase());
  component.properties.push(...union);
}

function propertyKey(p: Property): string {
  const params = Object.keys(p.params)
    .sort()
    .map((k) => `${k}=${p.params[k]!.join(",")}`)
    .join(";");
  return `${params}:${p.value}`;
}

function hasValue(component: Component, name: string): boolean {
  const prop = findProperty(component, name);
  return prop !== null && prop.value.trim() !== "";
}

export function cloneComponent(comp: Component): Component {
  return {
    name: comp.name,
    properties: comp.properties.map(cloneProperty),
    components: comp.components.map(cloneComponent),
  };
}

function cloneProperty(prop: Property): Property {
  return { name: prop.name, params: cloneParams(prop.params), value: prop.value };
}

function cloneParams(params: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(params)) out[k] = [...params[k]!];
  return out;
}

/** Compare LAST-MODIFIED / DTSTAMP stamps, freshest first; absent last. */
function compareStamp(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}
