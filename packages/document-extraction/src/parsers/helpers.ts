export function normalizePostalCode(input: string): string | undefined {
  const m = input
    .toUpperCase()
    .replace(/\s+/g, "")
    .match(/^[A-Z]\d[A-Z]\d[A-Z]\d$/);
  if (!m) return undefined;
  const c = m[0];
  return `${c.slice(0, 3)} ${c.slice(3)}`;
}

export function normalizeProvince(input: string): string | undefined {
  const map: Record<string, string> = {
    AB: "AB",
    ALBERTA: "AB",
    BC: "BC",
    ON: "ON",
    QC: "QC",
  };
  const key = input.trim().toUpperCase();
  return map[key];
}

export function normalizeVin(input: string): { normalized: string; display: string } | null {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length !== 17) return null;
  // Exclude I, O, Q per VIN spec
  if (/[IOQ]/.test(stripped)) return null;
  const display = `${stripped.slice(0, 4)}••••${stripped.slice(stripped.length - 4)}`;
  return { normalized: stripped, display };
}

export function parseMoneyCents(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, "").replace(/^\$/, "");
  if (!cleaned || cleaned === "0") return 0;
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function parseDateIso(input: string): string | null {
  // Try "Month DD, YYYY" or "YYYY-MM-DD"
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = input.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const month = monthNames.indexOf(m[1].toLowerCase()) + 1;
  if (month === 0) return null;
  const day = m[2].padStart(2, "0");
  const year = m[3];
  return `${year}-${month.toString().padStart(2, "0")}-${day}`;
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function findLineAfter(label: string, lines: string[]): string | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].toLowerCase().includes(label.toLowerCase()) && lines[i + 1].trim().length > 0) {
      return lines[i + 1].trim();
    }
  }
  return null;
}

export function findAllMatches(pattern: RegExp, text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
  }
  return out;
}
