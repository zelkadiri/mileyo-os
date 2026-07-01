import { RECOVERY_STATUS } from "../constants/subscriptionPaymentRecovery";
import {
  derivePortalSubscriptionState,
  isRecentBillingAttempt,
  isResumeAttemptInFlight,
  toSubscriptionContractGid,
  type ShopifyAdminGraphql,
} from "./subscriptionBillingWorker.server";
import type { TrustedBoxProduct } from "./subscriptionBoxCatalog.server";

export type BoxChangeBlockReason =
  | "billing_processing"
  | "missing_contract"
  | "recovery_processing"
  | "resume_processing";

const subscriptionContractLinesQuery = `#graphql
  query SubscriptionContractLinesForBoxChange($id: ID!) {
    subscriptionContract(id: $id) {
      id
      nextBillingDate
      lines(first: 10) {
        nodes {
          id
          productId
          variantId
        }
      }
    }
  }
`;

const subscriptionContractUpdateMutation = `#graphql
  mutation SubscriptionContractUpdateForBoxChange($contractId: ID!) {
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

const subscriptionDraftLineUpdateMutation = `#graphql
  mutation SubscriptionDraftLineUpdateForBoxChange(
    $draftId: ID!
    $lineId: ID!
    $input: SubscriptionLineUpdateInput!
  ) {
    subscriptionDraftLineUpdate(draftId: $draftId, lineId: $lineId, input: $input) {
      draft {
        id
      }
      lineUpdated {
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
  mutation SubscriptionDraftCommitForBoxChange($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract {
        id
        nextBillingDate
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type SubscriptionContractLinesResponse = {
  data?: {
    subscriptionContract?: {
      id: string;
      nextBillingDate?: string | null;
      lines?: {
        nodes?: {
          id: string;
          productId?: string | null;
          variantId?: string | null;
        }[];
      };
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

type SubscriptionDraftLineUpdateResponse = {
  data?: {
    subscriptionDraftLineUpdate?: {
      draft?: { id?: string | null } | null;
      lineUpdated?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SubscriptionDraftCommitResponse = {
  data?: {
    subscriptionDraftCommit?: {
      contract?: {
        id?: string | null;
        nextBillingDate?: string | null;
      } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

const getGraphqlUserErrors = (
  userErrors: { message?: string | null }[] | undefined,
) =>
  userErrors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ") ?? "";

export const getSubscriptionBoxChangeBlockReason = (
  selection: {
    active: boolean;
    lastBillingAttemptAt: Date | null;
    lastBillingAttemptStatus: string | null;
    resumeAttemptOrderId: string | null;
    resumeAttemptStatus: string | null;
    status: string;
    subscriptionContractId: string | null;
  },
  recovery?: {
    status: string;
  } | null,
): BoxChangeBlockReason | null => {
  if (!selection.subscriptionContractId) {
    return "missing_contract";
  }

  if (
    isResumeAttemptInFlight(selection) ||
    derivePortalSubscriptionState(selection) === "resume_processing"
  ) {
    return "resume_processing";
  }

  if (recovery?.status === RECOVERY_STATUS.PROCESSING) {
    return "recovery_processing";
  }

  if (isRecentBillingAttempt(selection.lastBillingAttemptAt)) {
    const status = selection.lastBillingAttemptStatus;

    if (
      status === "submitted" ||
      status === "challenged" ||
      status === "processing"
    ) {
      return "billing_processing";
    }
  }

  return null;
};

export const getSubscriptionBoxChangeBlockMessage = (
  reason: BoxChangeBlockReason,
) => {
  switch (reason) {
    case "resume_processing":
      return "Un paiement de reprise est en cours. Réessayez une fois la confirmation terminée.";
    case "billing_processing":
      return "Un prélèvement est en cours de traitement. Réessayez dans quelques minutes.";
    case "recovery_processing":
      return "Une tentative de paiement automatique est en cours. Réessayez dans quelques minutes.";
    case "missing_contract":
      return "Contrat d’abonnement Shopify manquant.";
    default:
      return "Changement de box indisponible pour le moment.";
  }
};

const fetchPrimarySubscriptionLine = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractLinesQuery, {
    variables: {
      id: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractLinesResponse;

  if (json.errors?.length) {
    throw new Error(
      json.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(" ") || "Impossible de lire le contrat d’abonnement Shopify.",
    );
  }

  const contract = json.data?.subscriptionContract;

  if (!contract?.id) {
    throw new Error("Contrat d’abonnement Shopify introuvable.");
  }

  const line = contract.lines?.nodes?.[0];

  if (!line?.id) {
    throw new Error("Aucune ligne d’abonnement trouvée sur le contrat Shopify.");
  }

  return {
    contractId: contract.id,
    lineId: line.id,
    nextBillingDate: contract.nextBillingDate ?? null,
  };
};

export const updateSubscriptionContractBoxViaDraft = async ({
  admin,
  box,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  box: TrustedBoxProduct;
  subscriptionContractId: string;
}) => {
  const contract = await fetchPrimarySubscriptionLine(
    admin,
    subscriptionContractId,
  );

  const updateResponse = await admin.graphql(subscriptionContractUpdateMutation, {
    variables: {
      contractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const updateJson =
    (await updateResponse.json()) as SubscriptionContractUpdateResponse;

  if (updateJson.errors?.length) {
    throw new Error(
      updateJson.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(" ") || "Impossible de préparer la mise à jour du contrat.",
    );
  }

  const draftId = updateJson.data?.subscriptionContractUpdate?.draft?.id;
  const updateUserError = getGraphqlUserErrors(
    updateJson.data?.subscriptionContractUpdate?.userErrors,
  );

  if (updateUserError || !draftId) {
    throw new Error(
      updateUserError || "Shopify n’a pas créé de brouillon de contrat.",
    );
  }

  const lineUpdateResponse = await admin.graphql(
    subscriptionDraftLineUpdateMutation,
    {
      variables: {
        draftId,
        input: {
          currentPrice: box.subscriptionPrice,
          productVariantId: box.variantId,
          quantity: 1,
          sellingPlanId: box.sellingPlanId,
          sellingPlanName: "Abonnement hebdomadaire",
        },
        lineId: contract.lineId,
      },
    },
  );
  const lineUpdateJson =
    (await lineUpdateResponse.json()) as SubscriptionDraftLineUpdateResponse;

  if (lineUpdateJson.errors?.length) {
    throw new Error(
      lineUpdateJson.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(" ") || "Impossible de mettre à jour la box sur le contrat.",
    );
  }

  const lineUpdateUserError = getGraphqlUserErrors(
    lineUpdateJson.data?.subscriptionDraftLineUpdate?.userErrors,
  );

  if (
    lineUpdateUserError ||
    !lineUpdateJson.data?.subscriptionDraftLineUpdate?.lineUpdated?.id
  ) {
    throw new Error(
      lineUpdateUserError ||
        "Shopify n’a pas confirmé la mise à jour de la ligne d’abonnement.",
    );
  }

  const commitResponse = await admin.graphql(subscriptionDraftCommitMutation, {
    variables: { draftId },
  });
  const commitJson =
    (await commitResponse.json()) as SubscriptionDraftCommitResponse;

  if (commitJson.errors?.length) {
    throw new Error(
      commitJson.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(" ") || "Impossible de valider la mise à jour du contrat.",
    );
  }

  const commitUserError = getGraphqlUserErrors(
    commitJson.data?.subscriptionDraftCommit?.userErrors,
  );

  if (commitUserError || !commitJson.data?.subscriptionDraftCommit?.contract?.id) {
    throw new Error(
      commitUserError || "Shopify n’a pas confirmé la validation du contrat.",
    );
  }

  return {
    contractId: commitJson.data.subscriptionDraftCommit.contract.id,
    previousNextBillingDate: contract.nextBillingDate,
  };
};
