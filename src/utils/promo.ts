export const PROMO = {
  id: "may-2026-zero-apr",
  installments: [1, 2, 3] as readonly number[],
  expiresAt: new Date("2026-06-01T00:00:00Z"),
} as const;

export const isPromoActive = () => process.env.EXPO_PUBLIC_ENV !== "e2e" && Date.now() < PROMO.expiresAt.getTime();
export const isPromoted = (installment: number) => isPromoActive() && PROMO.installments.includes(installment);
