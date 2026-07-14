/**
 * RFC 5545 TEXT value escaping. Values travel through calknit in wire
 * encoding; these helpers convert at the edges (extraction, comparison,
 * synthesis) so round-tripped properties stay byte-identical.
 */

/** Resolve TEXT escapes: `\\n`/`\\N` -> newline, `\\,` `\\;` `\\\\` -> literal. */
export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      const n = value[i + 1];
      if (n === "n" || n === "N") {
        out += "\n";
        i++;
        continue;
      }
      if (n === "\\" || n === "," || n === ";") {
        out += n;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** Encode a plain string as an RFC 5545 TEXT value. */
export function escapeText(value: string): string {
  let out = "";
  for (const c of value) {
    if (c === "\\") out += "\\\\";
    else if (c === ";") out += "\\;";
    else if (c === ",") out += "\\,";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") continue; // CRLF in source text collapses to \n
    else out += c;
  }
  return out;
}
