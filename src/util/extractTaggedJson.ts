export function extractTaggedJson(text: string, tag: string): unknown | undefined {
  const start = `<<<${tag}>>>`;
  const end = "<<<END>>>";

  const i = text.indexOf(start);
  if (i < 0) return undefined;

  const j = text.indexOf(end, i + start.length);
  if (j < 0) return undefined;

  const raw = text.slice(i + start.length, j).trim();
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    return { parseError: String(e), raw };
  }
}
