/**
 * Safe greeting for transactional emails.
 * Never renders undefined / null / empty placeholders.
 */
export const formatEmailGreeting = (
  customerName?: string | null,
): string => {
  const trimmed = customerName?.trim();
  if (!trimmed) {
    return "Bonjour,";
  }

  return `Bonjour ${trimmed},`;
};
