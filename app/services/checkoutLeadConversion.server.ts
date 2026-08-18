import db from "../db.server";
import { normalizeBuilderEmail } from "../features/builder/builder-email";

/**
 * CheckoutLead conversion (13J).
 *
 * Marks an existing pre-checkout lead as converted when a real first
 * Mileyo subscription order is confirmed. Capture (13H) never writes
 * convertedAt; this helper never creates a lead.
 */

export type ConvertCheckoutLeadReason =
  | "invalid_email"
  | "missing_shop"
  | "not_found_or_already_converted";

export type ConvertCheckoutLeadResult =
  | { converted: true }
  | { converted: false; reason: ConvertCheckoutLeadReason };

export type CheckoutLeadConversionWriter = {
  markConvertedIfUnconverted: (input: {
    convertedAt: Date;
    email: string;
    shop: string;
  }) => Promise<{ updatedCount: number }>;
};

const prismaCheckoutLeadWriter: CheckoutLeadConversionWriter = {
  markConvertedIfUnconverted: async ({ convertedAt, email, shop }) => {
    const result = await db.checkoutLead.updateMany({
      data: { convertedAt },
      where: {
        convertedAt: null,
        email,
        shop,
      },
    });

    return { updatedCount: result.count };
  },
};

export const shouldConvertCheckoutLead = ({
  isCreateFirstSubscription,
  isFirstOrderReplay,
  isResumeRenewal,
}: {
  isCreateFirstSubscription: boolean;
  isFirstOrderReplay: boolean;
  isResumeRenewal: boolean;
}) => {
  if (isResumeRenewal) {
    return false;
  }

  return isCreateFirstSubscription || isFirstOrderReplay;
};

export const convertCheckoutLead = async ({
  convertedAt = new Date(),
  email,
  shop,
  writer = prismaCheckoutLeadWriter,
}: {
  convertedAt?: Date;
  email: unknown;
  shop: string | null;
  writer?: CheckoutLeadConversionWriter;
}): Promise<ConvertCheckoutLeadResult> => {
  if (!shop) {
    return { converted: false, reason: "missing_shop" };
  }

  const normalizedEmail = normalizeBuilderEmail(email);
  if (!normalizedEmail.valid) {
    return { converted: false, reason: "invalid_email" };
  }

  const result = await writer.markConvertedIfUnconverted({
    convertedAt,
    email: normalizedEmail.value,
    shop,
  });

  if (result.updatedCount < 1) {
    return { converted: false, reason: "not_found_or_already_converted" };
  }

  return { converted: true };
};
