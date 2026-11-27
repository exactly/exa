import MAX_INSTALLMENTS from "./MAX_INSTALLMENTS";

export default function maxCardInstallments(maxFuturePools: number) {
  return Math.min(MAX_INSTALLMENTS, maxFuturePools - 1);
}
