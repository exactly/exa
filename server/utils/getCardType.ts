import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";

/**
 * Maps a card product ID to a human-readable card type string.
 *
 * @param productId - The product ID from the card (SIGNATURE_PRODUCT_ID or PLATINUM_PRODUCT_ID)
 * @returns "VISA_SIGNATURE" for signature cards, "PLATINUM" for platinum or unknown cards
 */
export default function getCardType(productId: string): string {
  if (productId === SIGNATURE_PRODUCT_ID) return "VISA_SIGNATURE";
  if (productId === PLATINUM_PRODUCT_ID) return "PLATINUM";
  return "PLATINUM";
}
