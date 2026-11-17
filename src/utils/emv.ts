const currencies: Record<string, "ARS" | "BRL" | undefined> = { "032": "ARS", "986": "BRL" };

export default function emv(code: string) {
  if (!code.startsWith("000201")) return;
  const fields = new Map<string, string>();
  for (let index = 0; index + 4 <= code.length; ) {
    const tag = code.slice(index, index + 2);
    const digits = code.slice(index + 2, index + 4);
    if (!/^\d{2}$/.test(digits)) return;
    const length = Number(digits);
    if (index + 4 + length > code.length) return;
    fields.set(tag, code.slice(index + 4, index + 4 + length));
    index += 4 + length;
  }
  return { currency: currencies[fields.get("53") ?? ""], merchant: fields.get("59") };
}
