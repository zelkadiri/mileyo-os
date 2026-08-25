const BUILDER_CHECKOUT_THROW_MESSAGE_MAX = 300;

const asPlainObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
};

const truncateThrownMessage = (message: unknown): string | undefined => {
  if (typeof message !== "string") {
    return undefined;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= BUILDER_CHECKOUT_THROW_MESSAGE_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, BUILDER_CHECKOUT_THROW_MESSAGE_MAX)}…`;
};

const readHeaderValue = (
  headers: unknown,
  headerName: string,
): string | undefined => {
  const record = asPlainObject(headers);
  if (!record) {
    return undefined;
  }

  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== target) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find(
        (entry): entry is string =>
          typeof entry === "string" && Boolean(entry.trim()),
      );
      if (first) {
        return first.trim();
      }
    }
  }

  return undefined;
};

/**
 * Safe diagnostic fields for Storefront cartCreate exceptions.
 * Reads HttpResponseError / GraphqlQueryError shapes without logging secrets.
 */
export const describeBuilderCheckoutThrownError = (
  error: unknown,
): {
  message?: string;
  name: string;
  requestId?: string;
  status?: number;
} => {
  const name =
    error instanceof Error && error.name
      ? error.name
      : typeof asPlainObject(error)?.name === "string"
        ? String(asPlainObject(error)?.name)
        : "unknown";

  const message = truncateThrownMessage(
    error instanceof Error ? error.message : asPlainObject(error)?.message,
  );

  const root = asPlainObject(error);
  const response = asPlainObject(root?.response);
  const status =
    typeof response?.code === "number"
      ? response.code
      : typeof root?.code === "number"
        ? root.code
        : undefined;

  // GraphqlQueryError.headers | HttpResponseError.response.headers
  const requestId =
    readHeaderValue(root?.headers, "x-request-id") ??
    readHeaderValue(response?.headers, "x-request-id");

  return {
    name,
    ...(message ? { message } : {}),
    ...(typeof status === "number" ? { status } : {}),
    ...(requestId ? { requestId } : {}),
  };
};
