// Plain-text extraction for source articles (HTML -> text). Deterministic and dependency-free so tests can run it unchanged.
// Used only to build the text that WhatsApp excerpts are checked against; the approval checksum is computed in the database from the raw body.
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", middot: "·", hellip: "…" };
export function htmlToPlainText(html: string): string {
  let s = html.replace(/\r\n/g, "\n");
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|h[1-6]|li|ul|ol|div|blockquote)>/gi, "\n").replace(/<hr\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
  return s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
}
