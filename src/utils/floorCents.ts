export default function floorCents(usd: bigint) {
  return usd - (usd % 10n ** 16n);
}
