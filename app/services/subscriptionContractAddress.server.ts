import {
  isPortalAddressSupportedCountryCode,
  PORTAL_ADDRESS_FIELD_MAX,
  PORTAL_ADDRESS_UNSUPPORTED_METHOD_MESSAGE,
} from "../constants/subscriptionContractAddress";
import { getGraphqlUserErrors } from "../utils/graphql";
import { toSubscriptionContractGid } from "../utils/shopifyIds.server";
import type { ShopifyAdminGraphql } from "./subscriptionBillingWorker.server";

export type SubscriptionShippingAddress = {
  address1: string;
  address2: string | null;
  city: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  provinceCode: string | null;
  zip: string;
};

export type FetchSubscriptionShippingAddressResult =
  | { kind: "shipping"; address: SubscriptionShippingAddress }
  | { kind: "unsupported_method" }
  | { kind: "missing_contract" }
  | { kind: "error"; error: string };

export type PortalDeliveryAddressInput = {
  address1: string;
  address2: string | null;
  city: string;
  countryCode: string;
  firstName: string;
  lastName: string;
  zip: string;
};

export type AddressFieldValidationError = {
  field: keyof PortalDeliveryAddressInput | "form";
  message: string;
};

export type ValidatePortalDeliveryAddressResult =
  | { ok: true; address: PortalDeliveryAddressInput }
  | { ok: false; errors: AddressFieldValidationError[] };

export type UpdateSubscriptionShippingAddressResult =
  | { ok: true; contractId: string }
  | {
      ok: false;
      code:
        | "missing_contract"
        | "not_shipping"
        | "shopify_update"
        | "shopify_draft"
        | "shopify_commit"
        | "shopify_graphql";
      error: string;
    };

const subscriptionContractShippingAddressQuery = `#graphql
  query SubscriptionContractShippingAddress($id: ID!) {
    subscriptionContract(id: $id) {
      id
      deliveryMethod {
        __typename
        ... on SubscriptionDeliveryMethodShipping {
          address {
            address1
            address2
            city
            countryCode
            firstName
            lastName
            provinceCode
            zip
          }
        }
      }
    }
  }
`;

const subscriptionContractUpdateMutation = `#graphql
  mutation SubscriptionContractUpdateForAddress($contractId: ID!) {
    subscriptionContractUpdate(contractId: $contractId) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const subscriptionDraftUpdateMutation = `#graphql
  mutation SubscriptionDraftUpdateForAddress(
    $draftId: ID!
    $input: SubscriptionDraftInput!
  ) {
    subscriptionDraftUpdate(draftId: $draftId, input: $input) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const subscriptionDraftCommitMutation = `#graphql
  mutation SubscriptionDraftCommitForAddress($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type ShippingAddressNode = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  countryCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
};

type SubscriptionContractShippingAddressResponse = {
  data?: {
    subscriptionContract?: {
      id?: string | null;
      deliveryMethod?: {
        __typename?: string | null;
        address?: ShippingAddressNode | null;
      } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SubscriptionContractUpdateResponse = {
  data?: {
    subscriptionContractUpdate?: {
      draft?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SubscriptionDraftUpdateResponse = {
  data?: {
    subscriptionDraftUpdate?: {
      draft?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SubscriptionDraftCommitResponse = {
  data?: {
    subscriptionDraftCommit?: {
      contract?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

const trimOrEmpty = (value: unknown) => String(value ?? "").trim();

const normalizeOptional = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toShippingAddress = (
  node: ShippingAddressNode | null | undefined,
): SubscriptionShippingAddress | null => {
  if (!node) {
    return null;
  }

  const address1 = trimOrEmpty(node.address1);
  const city = trimOrEmpty(node.city);
  const countryCode = trimOrEmpty(node.countryCode).toUpperCase();
  const firstName = trimOrEmpty(node.firstName);
  const lastName = trimOrEmpty(node.lastName);
  const zip = trimOrEmpty(node.zip);

  if (!address1 && !city && !zip && !firstName && !lastName) {
    return null;
  }

  return {
    address1,
    address2: normalizeOptional(trimOrEmpty(node.address2)),
    city,
    countryCode,
    firstName,
    lastName,
    provinceCode: normalizeOptional(trimOrEmpty(node.provinceCode)),
    zip,
  };
};

const graphqlErrorMessage = (
  errors: { message?: string | null }[] | undefined,
  fallback: string,
) =>
  errors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ") || fallback;

export const fetchSubscriptionContractShippingAddress = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<FetchSubscriptionShippingAddressResult> => {
  const response = await admin.graphql(subscriptionContractShippingAddressQuery, {
    variables: {
      id: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json =
    (await response.json()) as SubscriptionContractShippingAddressResponse;

  if (json.errors?.length) {
    return {
      error: graphqlErrorMessage(
        json.errors,
        "Impossible de lire l’adresse de livraison.",
      ),
      kind: "error",
    };
  }

  const contract = json.data?.subscriptionContract;

  if (!contract?.id) {
    return { kind: "missing_contract" };
  }

  const deliveryMethod = contract.deliveryMethod;
  const typename = deliveryMethod?.__typename ?? null;

  if (typename !== "SubscriptionDeliveryMethodShipping") {
    return { kind: "unsupported_method" };
  }

  const address = toShippingAddress(deliveryMethod?.address);

  if (!address) {
    return {
      address: {
        address1: "",
        address2: null,
        city: "",
        countryCode: "FR",
        firstName: "",
        lastName: "",
        provinceCode: null,
        zip: "",
      },
      kind: "shipping",
    };
  }

  return { address, kind: "shipping" };
};

const pushRequired = (
  errors: AddressFieldValidationError[],
  field: AddressFieldValidationError["field"],
  value: string,
  label: string,
  max: number,
) => {
  if (!value) {
    errors.push({ field, message: `${label} est requis.` });
    return;
  }

  if (value.length > max) {
    errors.push({
      field,
      message: `${label} est trop long (${max} caractères max).`,
    });
  }
};

/** Server-side validation — never trust HTML alone. France zip = 5 digits. */
export const validatePortalDeliveryAddressInput = (
  raw: Record<string, unknown>,
): ValidatePortalDeliveryAddressResult => {
  const errors: AddressFieldValidationError[] = [];

  const firstName = trimOrEmpty(raw.firstName);
  const lastName = trimOrEmpty(raw.lastName);
  const address1 = trimOrEmpty(raw.address1);
  const address2Raw = trimOrEmpty(raw.address2);
  const zip = trimOrEmpty(raw.zip);
  const city = trimOrEmpty(raw.city);
  const countryCode = trimOrEmpty(raw.countryCode).toUpperCase();

  pushRequired(
    errors,
    "firstName",
    firstName,
    "Le prénom",
    PORTAL_ADDRESS_FIELD_MAX.firstName,
  );
  pushRequired(
    errors,
    "lastName",
    lastName,
    "Le nom",
    PORTAL_ADDRESS_FIELD_MAX.lastName,
  );
  pushRequired(
    errors,
    "address1",
    address1,
    "L’adresse",
    PORTAL_ADDRESS_FIELD_MAX.address1,
  );

  if (address2Raw.length > PORTAL_ADDRESS_FIELD_MAX.address2) {
    errors.push({
      field: "address2",
      message: `Le complément d’adresse est trop long (${PORTAL_ADDRESS_FIELD_MAX.address2} caractères max).`,
    });
  }

  pushRequired(errors, "zip", zip, "Le code postal", PORTAL_ADDRESS_FIELD_MAX.zip);
  pushRequired(errors, "city", city, "La ville", PORTAL_ADDRESS_FIELD_MAX.city);

  if (!isPortalAddressSupportedCountryCode(countryCode)) {
    errors.push({
      field: "countryCode",
      message: "Pays non supporté pour la livraison.",
    });
  } else if (countryCode === "FR" && !/^\d{5}$/.test(zip)) {
    errors.push({
      field: "zip",
      message: "Le code postal doit contenir 5 chiffres.",
    });
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  return {
    address: {
      address1,
      address2: normalizeOptional(address2Raw),
      city,
      countryCode,
      firstName,
      lastName,
      zip,
    },
    ok: true,
  };
};

/**
 * Updates SubscriptionContract shipping address only.
 * Refuses non-shipping delivery methods — never converts pickup/localDelivery.
 */
export const updateSubscriptionContractShippingAddress = async ({
  address,
  admin,
  subscriptionContractId,
}: {
  address: PortalDeliveryAddressInput;
  admin: ShopifyAdminGraphql;
  subscriptionContractId: string;
}): Promise<UpdateSubscriptionShippingAddressResult> => {
  const current = await fetchSubscriptionContractShippingAddress(
    admin,
    subscriptionContractId,
  );

  if (current.kind === "missing_contract") {
    return {
      code: "missing_contract",
      error: "Contrat d’abonnement Shopify introuvable.",
      ok: false,
    };
  }

  if (current.kind === "unsupported_method") {
    return {
      code: "not_shipping",
      error: PORTAL_ADDRESS_UNSUPPORTED_METHOD_MESSAGE,
      ok: false,
    };
  }

  if (current.kind === "error") {
    return {
      code: "shopify_graphql",
      error: current.error,
      ok: false,
    };
  }

  const updateResponse = await admin.graphql(subscriptionContractUpdateMutation, {
    variables: {
      contractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const updateJson =
    (await updateResponse.json()) as SubscriptionContractUpdateResponse;

  if (updateJson.errors?.length) {
    return {
      code: "shopify_graphql",
      error: graphqlErrorMessage(
        updateJson.errors,
        "Impossible de préparer la mise à jour de l’adresse.",
      ),
      ok: false,
    };
  }

  const draftId = updateJson.data?.subscriptionContractUpdate?.draft?.id;
  const updateUserError = getGraphqlUserErrors(
    updateJson.data?.subscriptionContractUpdate?.userErrors,
  );

  if (updateUserError || !draftId) {
    return {
      code: "shopify_update",
      error:
        updateUserError || "Shopify n’a pas créé de brouillon de contrat.",
      ok: false,
    };
  }

  const draftResponse = await admin.graphql(subscriptionDraftUpdateMutation, {
    variables: {
      draftId,
      input: {
        deliveryMethod: {
          shipping: {
            address: {
              address1: address.address1,
              address2: address.address2,
              city: address.city,
              countryCode: address.countryCode,
              firstName: address.firstName,
              lastName: address.lastName,
              zip: address.zip,
            },
          },
        },
      },
    },
  });
  const draftJson =
    (await draftResponse.json()) as SubscriptionDraftUpdateResponse;

  if (draftJson.errors?.length) {
    return {
      code: "shopify_graphql",
      error: graphqlErrorMessage(
        draftJson.errors,
        "Impossible de mettre à jour l’adresse sur le contrat.",
      ),
      ok: false,
    };
  }

  const draftUserError = getGraphqlUserErrors(
    draftJson.data?.subscriptionDraftUpdate?.userErrors,
  );

  if (draftUserError || !draftJson.data?.subscriptionDraftUpdate?.draft?.id) {
    return {
      code: "shopify_draft",
      error:
        draftUserError ||
        "Shopify n’a pas confirmé la mise à jour de l’adresse.",
      ok: false,
    };
  }

  const commitResponse = await admin.graphql(subscriptionDraftCommitMutation, {
    variables: { draftId },
  });
  const commitJson =
    (await commitResponse.json()) as SubscriptionDraftCommitResponse;

  if (commitJson.errors?.length) {
    return {
      code: "shopify_graphql",
      error: graphqlErrorMessage(
        commitJson.errors,
        "Impossible de valider la mise à jour de l’adresse.",
      ),
      ok: false,
    };
  }

  const commitUserError = getGraphqlUserErrors(
    commitJson.data?.subscriptionDraftCommit?.userErrors,
  );
  const committedId = commitJson.data?.subscriptionDraftCommit?.contract?.id;

  if (commitUserError || !committedId) {
    return {
      code: "shopify_commit",
      error:
        commitUserError ||
        "Shopify n’a pas confirmé la validation de l’adresse.",
      ok: false,
    };
  }

  return { contractId: committedId, ok: true };
};
