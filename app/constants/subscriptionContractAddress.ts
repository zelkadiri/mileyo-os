/**
 * Portal self-serve delivery address (SubscriptionContract.deliveryMethod.shipping).
 * France-only — matches current Mileyo shipping perimeter.
 */

export const PORTAL_ADDRESS_SUPPORTED_COUNTRY_CODES = ["FR"] as const;

export type PortalAddressSupportedCountryCode =
  (typeof PORTAL_ADDRESS_SUPPORTED_COUNTRY_CODES)[number];

export const PORTAL_ADDRESS_COUNTRY_LABELS: Record<
  PortalAddressSupportedCountryCode,
  string
> = {
  FR: "France",
};

export const PORTAL_ADDRESS_FIELD_MAX = {
  address1: 255,
  address2: 255,
  city: 100,
  firstName: 100,
  lastName: 100,
  zip: 12,
} as const;

/** Cutoff / billing / recovery — current delivery is frozen for self-serve. */
export const PORTAL_ADDRESS_PREPARATION_MESSAGE =
  "Votre prochaine livraison est déjà en préparation. Pour modifier son adresse de livraison, contactez-nous au plus vite.";

/** BoxOrder / billing coverage already locks the current delivery cycle. */
export const PORTAL_ADDRESS_ORDER_LOCKED_MESSAGE =
  "Votre prochaine livraison est déjà en préparation. Besoin de changer l’adresse pour cette livraison ? Contactez-nous.";

export const PORTAL_ADDRESS_UNSUPPORTED_METHOD_MESSAGE =
  "Cette livraison n’utilise pas une adresse postale modifiable ici.";

export const PORTAL_ADDRESS_UNAVAILABLE_MESSAGE =
  "Adresse de livraison indisponible pour le moment.";

export const PORTAL_ADDRESS_SUCCESS_MESSAGE =
  "Votre adresse de livraison a bien été mise à jour.";

export const PORTAL_PAYMENT_UPDATE_HINT =
  "Gérez de manière sécurisée la carte utilisée pour votre abonnement.";

export const isPortalAddressSupportedCountryCode = (
  value: string,
): value is PortalAddressSupportedCountryCode =>
  (PORTAL_ADDRESS_SUPPORTED_COUNTRY_CODES as readonly string[]).includes(value);
