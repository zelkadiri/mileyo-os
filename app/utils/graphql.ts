export const getGraphqlUserErrors = (
  userErrors?: { message?: string | null }[] | null,
) =>
  userErrors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ") ?? "";
