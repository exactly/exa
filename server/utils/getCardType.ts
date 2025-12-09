import { SIGNATURE_PRODUCT_ID, type PLATINUM_PRODUCT_ID } from "@exactly/common/panda";

export type CardType = "VISA_SIGNATURE" | "PLATINUM";

/**
 * Maps a card product ID to a human-readable card type string.
 *
 * @param productId - The product ID from the card (SIGNATURE_PRODUCT_ID or PLATINUM_PRODUCT_ID)
 * @returns "VISA_SIGNATURE" for signature cards, "PLATINUM" for platinum or unknown cards
 */
export default function getCardType(productId: typeof SIGNATURE_PRODUCT_ID | typeof PLATINUM_PRODUCT_ID): CardType {
  return productId === SIGNATURE_PRODUCT_ID ? "VISA_SIGNATURE" : "PLATINUM";
}
