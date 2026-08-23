/**
 * Business regression — EMAIL-6C Resend transport idempotency.
 *
 * sendEmail options + provider error mapping. Mocked Resend client only.
 * No EmailEvent, no Prisma, no domain trySend*.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResendClient } from "../../app/services/email/email-client.server";
import {
  EMAIL_FROM_ENV,
  RESEND_API_KEY_ENV,
  __resetSendEmailTestDeps,
  __setSendEmailTestDeps,
  mapResendSendError,
  resolveSendEmailIdempotencyKey,
  sendEmail,
} from "../../app/services/email/email.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const basePayload = () => ({
  template: "test" as const,
  subject: "Idempotency transport check",
  to: { email: "customer@example.com" },
  data: { message: "email-6c-marker" },
});

type MockSendCall = {
  payload: Record<string, unknown>;
  options: { idempotencyKey?: string } | undefined;
};

const createMockClient = (
  handler: (
    payload: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ) => Promise<{
    data: { id: string } | null;
    error: {
      message: string;
      name: string;
      statusCode: number | null;
    } | null;
  }>,
  calls: MockSendCall[],
): ResendClient =>
  ({
    emails: {
      send: async (
        payload: Record<string, unknown>,
        options?: { idempotencyKey?: string },
      ) => {
        calls.push({ payload, options });
        return handler(payload, options);
      },
    },
  }) as unknown as ResendClient;

const runSuite = async () => {
  const ctx = createBusinessTestContext("63-email-transport-idempotency");
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];

  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  const serverSource = readRepoFile("app/services/email/email.server.ts");
  const eventServiceSource = readRepoFile(
    "app/services/email/email-event.server.ts",
  );

  ctx.scenario("A. Backward compatibility");
  {
    const calls: MockSendCall[] = [];
    __setSendEmailTestDeps({
      createClient: () =>
        createMockClient(async () => ({
          data: { id: "re_success_1" },
          error: null,
        }), calls),
    });

    const result = await sendEmail(basePayload());
    ctx.assertTrue("sendEmail(payload) sans options ok", result.ok);
    if (result.ok) {
      ctx.assertEqual("success retourne provider id", result.id, "re_success_1");
    }
    ctx.assertEqual(
      "sans options → pas de 2e arg idempotency",
      calls[0]?.options,
      undefined,
    );

    __resetSendEmailTestDeps();
  }

  delete process.env[RESEND_API_KEY_ENV];
  {
    const result = await sendEmail(basePayload());
    ctx.assertFalse("missing api key inchangé", result.ok);
    if (!result.ok) {
      ctx.assertEqual("missing api key reason", result.reason, "missing_api_key");
    }
  }

  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  delete process.env[EMAIL_FROM_ENV];
  {
    const result = await sendEmail(basePayload());
    ctx.assertFalse("missing sender inchangé", result.ok);
    if (!result.ok) {
      ctx.assertEqual("missing sender reason", result.reason, "missing_sender");
    }
  }

  process.env[EMAIL_FROM_ENV] = "Mileyo <hello@mileyo.test>";

  ctx.scenario("B. Idempotency — validation + transmission");
  {
    const calls: MockSendCall[] = [];
    __setSendEmailTestDeps({
      createClient: () =>
        createMockClient(async () => ({
          data: { id: "re_idem_1" },
          error: null,
        }), calls),
    });

    const key = "shop:evt:payment_failed:sub_123";
    const result = await sendEmail(basePayload(), { idempotencyKey: key });
    ctx.assertTrue("clé normale → success", result.ok);
    ctx.assertEqual(
      "idempotencyKey transmise au SDK",
      calls[0]?.options?.idempotencyKey,
      key,
    );
    ctx.assertTrue(
      "client.emails.send(payload, options) dans le source",
      /client\.emails\.send\([\s\S]*requestOptions/.test(serverSource),
    );

    __resetSendEmailTestDeps();
  }

  {
    __setSendEmailTestDeps({
      createClient: () =>
        createMockClient(async () => ({
          data: { id: "re_should_not_run" },
          error: null,
        }), []),
    });

    const empty = await sendEmail(basePayload(), { idempotencyKey: "" });
    ctx.assertFalse("clé vide → erreur contrôlée", empty.ok);
    if (!empty.ok) {
      ctx.assertEqual("clé vide reason", empty.reason, "invalid_idempotency_key");
    }

    const whitespace = await sendEmail(basePayload(), { idempotencyKey: "   " });
    ctx.assertFalse("clé whitespace → erreur contrôlée", whitespace.ok);
    if (!whitespace.ok) {
      ctx.assertEqual(
        "clé whitespace reason",
        whitespace.reason,
        "invalid_idempotency_key",
      );
    }

    __resetSendEmailTestDeps();
  }

  {
    const absent = resolveSendEmailIdempotencyKey(undefined);
    ctx.assertTrue(
      "pas de clé → absent",
      !("ok" in absent) && absent.mode === "absent",
    );

    const present = resolveSendEmailIdempotencyKey("  keep-me  ");
    ctx.assertTrue(
      "clé normale inchangée",
      !("ok" in present) && present.mode === "present",
    );
    if (!("ok" in present) && present.mode === "present") {
      ctx.assertEqual("clé non trimée", present.key, "  keep-me  ");
    }
  }

  ctx.scenario("C. Provider errors — mapping Resend");
  {
    const mappedInvalidKey = mapResendSendError({
      name: "invalid_idempotency_key",
      message: "Idempotency key is invalid",
      statusCode: 422,
    });
    ctx.assertEqual(
      "invalid_idempotency_key reason",
      mappedInvalidKey.reason,
      "invalid_idempotency_key",
    );
    ctx.assertEqual(
      "invalid_idempotency_key provider code",
      mappedInvalidKey.providerErrorCode,
      "invalid_idempotency_key",
    );

    const mappedInvalidRequest = mapResendSendError({
      name: "invalid_idempotent_request",
      message: "Same key, different payload",
      statusCode: 409,
    });
    ctx.assertEqual(
      "invalid_idempotent_request reason",
      mappedInvalidRequest.reason,
      "invalid_idempotent_request",
    );

    const mappedConcurrent = mapResendSendError({
      name: "concurrent_idempotent_requests",
      message: "Another request is in flight",
      statusCode: 409,
    });
    ctx.assertEqual(
      "concurrent_idempotent_requests reason",
      mappedConcurrent.reason,
      "concurrent_idempotent_requests",
    );

    const mappedGeneric = mapResendSendError({
      name: "application_error",
      message: "Resend is unavailable",
      statusCode: 500,
    });
    ctx.assertEqual("erreur transport générique reason", mappedGeneric.reason, "send_error");
    ctx.assertEqual(
      "message provider conservé",
      mappedGeneric.message,
      "Resend is unavailable",
    );
    ctx.assertEqual(
      "provider code conservé sur send_error",
      mappedGeneric.providerErrorCode,
      "application_error",
    );
  }

  {
    __setSendEmailTestDeps({
      createClient: () =>
        createMockClient(async () => ({
          data: null,
          error: {
            name: "invalid_idempotent_request",
            message: "Payload mismatch for idempotency key",
            statusCode: 409,
          },
        }), []),
    });

    const result = await sendEmail(basePayload(), {
      idempotencyKey: "shop:evt:upcoming:abc",
    });
    ctx.assertFalse("erreur Resend remontée", result.ok);
    if (!result.ok) {
      ctx.assertEqual(
        "invalid_idempotent_request via sendEmail",
        result.reason,
        "invalid_idempotent_request",
      );
      ctx.assertEqual(
        "message Resend propagé",
        result.message,
        "Payload mismatch for idempotency key",
      );
      ctx.assertEqual(
        "providerErrorCode propagé",
        result.providerErrorCode,
        "invalid_idempotent_request",
      );
    }

    __resetSendEmailTestDeps();
  }

  ctx.scenario("D. No side effects");
  ctx.assertFalse(
    "aucun EmailEvent créé (sendEmail)",
    /ensureEmailEvent|claimEmailEvent|emailEvent/.test(serverSource),
  );
  ctx.assertFalse(
    "aucun Prisma access dans sendEmail",
    /prisma|Prisma/.test(serverSource),
  );
  ctx.assertFalse(
    "aucun retry dans sendEmail",
    /retry|requeue|nextAttemptAt/.test(serverSource),
  );
  ctx.assertFalse(
    "email-event service n'importe pas sendEmail",
    /import\s*\{[^}]*sendEmail/.test(eventServiceSource),
  );

  if (previousApiKey === undefined) {
    delete process.env[RESEND_API_KEY_ENV];
  } else {
    process.env[RESEND_API_KEY_ENV] = previousApiKey;
  }

  if (previousEmailFrom === undefined) {
    delete process.env[EMAIL_FROM_ENV];
  } else {
    process.env[EMAIL_FROM_ENV] = previousEmailFrom;
  }

  __resetSendEmailTestDeps();

  return finishSuite("63-email-transport-idempotency", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
