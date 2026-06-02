export const PROMO = {
  id: "jun-2026-zero-apr",
  installments: [1, 2, 3] as readonly number[],
  expiresAt: new Date("2026-07-01T00:00:00Z"),
} as const;

export const isPromoActive = () => process.env.EXPO_PUBLIC_ENV !== "e2e" && Date.now() < PROMO.expiresAt.getTime();
export const isPromoted = (installment: number) => isPromoActive() && PROMO.installments.includes(installment);

export function getPromoMonths(language: string) {
  const refundDate = PROMO.expiresAt;
  const promoEndDate = new Date(refundDate.getTime() - 1);
  const format = new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" });
  return { promoEnd: format.format(promoEndDate), refund: format.format(refundDate) };
}
