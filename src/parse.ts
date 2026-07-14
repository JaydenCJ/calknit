/**
 * iCalendar wire-format reader: RFC 5545 line unfolding, content-line
 * parsing (name, parameters, value) and BEGIN/END component-tree
 * assembly. The parser is tolerant where real-world feeds are sloppy
 * (bare LF, stray blank lines, unknown components) and strict where
 * tolerance would corrupt data (unterminated components, malformed
 * content lines).
 */

import { Component, ParseError, Property } from "./types.js";

/** Split raw feed text into unfolded logical lines (RFC 5545 §3.1). */
export function unfoldLines(text: string): string[] {
  // Physical lines may be separated by CRLF (spec) or bare LF (common).
  const physical = text.split(/\r\n|\n|\r/);
  const logical: string[] = [];
  for (const line of physical) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      // Continuation of the previous logical line; the first octet is dropped.
      if (logical.length === 0) {
        // A feed starting with a continuation is broken but salvageable.
        logical.push(line.slice(1));
        continue;
      }
      logical[logical.length - 1] += line.slice(1);
      continue;
    }
    if (line === "") continue; // blank separator lines are noise
    logical.push(line);
  }
  return logical;
}

/**
 * Parse one unfolded content line into name, parameters and value.
 * Handles quoted parameter values (which may contain `:`, `;` and `,`)
 * and multi-valued parameters (`MEMBER=a,b`).
 */
export function parseContentLine(line: string): Property {
  let i = 0;
  const readName = (): string => {
    const start = i;
    while (i < line.length && /[A-Za-z0-9-]/.test(line[i]!)) i++;
    if (i === start) throw new ParseError(`malformed content line: ${clip(line)}`);
    return line.slice(start, i).toUpperCase();
  };

  const name = readName();
  const params: Record<string, string[]> = {};

  while (i < line.length && line[i] === ";") {
    i++; // consume ';'
    const pname = readName();
    if (line[i] !== "=") throw new ParseError(`parameter without value in: ${clip(line)}`);
    i++; // consume '='
    const values: string[] = [];
    for (;;) {
      values.push(readParamValue());
      if (line[i] === ",") {
        i++;
        continue;
      }
      break;
    }
    params[pname] = values;
  }

  if (line[i] !== ":") throw new ParseError(`content line missing ':': ${clip(line)}`);
  const value = line.slice(i + 1);
  return { name, params, value };

  function readParamValue(): string {
    if (line[i] === '"') {
      i++; // opening quote
      const start = i;
      while (i < line.length && line[i] !== '"') i++;
      if (i >= line.length) throw new ParseError(`unterminated quoted parameter: ${clip(line)}`);
      const v = line.slice(start, i);
      i++; // closing quote
      return v;
    }
    const start = i;
    while (i < line.length && line[i] !== ";" && line[i] !== ":" && line[i] !== ",") i++;
    return line.slice(start, i);
  }
}

/** First parameter value for `name`, or null. Case-insensitive key. */
export function paramValue(prop: Property, name: string): string | null {
  const values = prop.params[name.toUpperCase()];
  return values && values.length > 0 ? values[0]! : null;
}

/** First property with `name` inside `component`, or null. */
export function findProperty(component: Component, name: string): Property | null {
  const upper = name.toUpperCase();
  for (const p of component.properties) if (p.name === upper) return p;
  return null;
}

/** All properties with `name` inside `component` (EXDATE, RDATE, ATTENDEE...). */
export function findProperties(component: Component, name: string): Property[] {
  const upper = name.toUpperCase();
  return component.properties.filter((p) => p.name === upper);
}

export interface ParsedFeed {
  /** Every VCALENDAR found in the file (some exporters concatenate several). */
  calendars: Component[];
  /** Recoverable oddities, phrased for the CLI report. */
  warnings: string[];
}

/**
 * Parse a whole .ics file into its VCALENDAR components. Content outside
 * any component and unknown component types survive as warnings, not
 * errors; mismatched or unterminated BEGIN/END is fatal.
 */
export function parseFeed(text: string, source: string): ParsedFeed {
  const lines = unfoldLines(text);
  const warnings: string[] = [];
  const calendars: Component[] = [];
  const stack: Component[] = [];

  for (const line of lines) {
    const prop = parseContentLine(line);
    if (prop.name === "BEGIN") {
      const comp: Component = { name: prop.value.toUpperCase(), properties: [], components: [] };
      if (stack.length === 0) {
        if (comp.name !== "VCALENDAR") {
          warnings.push(`${source}: top-level ${comp.name} outside VCALENDAR`);
        }
        calendars.push(comp);
      } else {
        stack[stack.length - 1]!.components.push(comp);
      }
      stack.push(comp);
      continue;
    }
    if (prop.name === "END") {
      const expected = stack.pop();
      if (!expected || expected.name !== prop.value.toUpperCase()) {
        throw new ParseError(
          `${source}: END:${prop.value} does not match open ${expected ? expected.name : "(nothing)"}`
        );
      }
      continue;
    }
    if (stack.length === 0) {
      warnings.push(`${source}: property ${prop.name} outside any component ignored`);
      continue;
    }
    stack[stack.length - 1]!.properties.push(prop);
  }

  if (stack.length > 0) {
    throw new ParseError(`${source}: unterminated ${stack[stack.length - 1]!.name}`);
  }
  if (calendars.length === 0) {
    throw new ParseError(`${source}: no VCALENDAR component found`);
  }
  return { calendars, warnings };
}

function clip(line: string): string {
  return line.length > 60 ? line.slice(0, 57) + "..." : line;
}
