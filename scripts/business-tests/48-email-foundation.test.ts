/**
 * Business regression — EMAIL-1 internal email foundation.
 *
 * Structure + renderer + missing API key / sender. No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEmailClient,
  EMAIL_FROM_ENV,
  getEmailFrom,
  getResendApiKey,
  RESEND_API_KEY_ENV,
  renderEmailTemplate,
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

const runSuite = async () => {
  const ctx = createBusinessTestContext("48-email-foundation");
  const previousApiKey = process.env[RESEND_API_KEY_ENV];
  const previousEmailFrom = process.env[EMAIL_FROM_ENV];

  ctx.scenario("A. Structure — fichiers fondation présents");
  const structureFiles = [
    "app/services/email/email.server.ts",
    "app/services/email/email.types.ts",
    "app/services/email/email-client.server.ts",
    "app/services/email/email-render.server.ts",
    "app/services/email/templates/TestEmail.tsx",
  ];

  for (const relativePath of structureFiles) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(`${relativePath} non vide`, source.trim().length > 0);
  }

  const clientSource = readRepoFile(
    "app/services/email/email-client.server.ts",
  );
  const serverSource = readRepoFile("app/services/email/email.server.ts");

  ctx.assertTrue(
    "email.server exports sendEmail",
    serverSource.includes("export const sendEmail"),
  );
  ctx.assertTrue(
    "client lit RESEND_API_KEY",
    clientSource.includes(RESEND_API_KEY_ENV),
  );
  ctx.assertTrue(
    "client lit EMAIL_FROM",
    clientSource.includes(EMAIL_FROM_ENV),
  );
  ctx.assertFalse(
    "aucun fallback onboarding@resend.dev",
    clientSource.includes("onboarding@resend.dev") ||
      serverSource.includes("onboarding@resend.dev"),
  );
  ctx.assertTrue(
    "missing_sender reason présent",
    serverSource.includes("missing_sender"),
  );

  ctx.scenario("B. Client — absence de clé");
  delete process.env[RESEND_API_KEY_ENV];
  ctx.assertNull("getResendApiKey null sans clé", getResendApiKey());
  ctx.assertNull("createEmailClient null sans clé", createEmailClient());

  const missingKeyResult = await sendEmail({
    template: "test",
    subject: "Foundation check",
    to: { email: "test@example.com" },
    data: { message: "should not send" },
  });
  ctx.assertFalse("sendEmail fails without key", missingKeyResult.ok);
  if (!missingKeyResult.ok) {
    ctx.assertEqual(
      "reason is missing_api_key",
      missingKeyResult.reason,
      "missing_api_key",
    );
  }

  process.env[RESEND_API_KEY_ENV] = "   ";
  ctx.assertNull("blank key treated as missing", getResendApiKey());

  ctx.scenario("C. Client — absence de EMAIL_FROM");
  process.env[RESEND_API_KEY_ENV] = "re_test_key_not_used";
  delete process.env[EMAIL_FROM_ENV];
  ctx.assertNull("getEmailFrom null sans EMAIL_FROM", getEmailFrom());

  const missingSenderResult = await sendEmail({
    template: "test",
    subject: "Foundation check",
    to: { email: "test@example.com" },
    data: { message: "should not send" },
  });
  ctx.assertFalse("sendEmail fails without EMAIL_FROM", missingSenderResult.ok);
  if (!missingSenderResult.ok) {
    ctx.assertEqual(
      "reason is missing_sender",
      missingSenderResult.reason,
      "missing_sender",
    );
  }

  process.env[EMAIL_FROM_ENV] = "   ";
  ctx.assertNull("blank EMAIL_FROM treated as missing", getEmailFrom());

  const blankSenderResult = await sendEmail({
    template: "test",
    subject: "Foundation check",
    to: { email: "test@example.com" },
  });
  ctx.assertFalse("sendEmail fails with blank EMAIL_FROM", blankSenderResult.ok);
  if (!blankSenderResult.ok) {
    ctx.assertEqual(
      "blank EMAIL_FROM reason is missing_sender",
      blankSenderResult.reason,
      "missing_sender",
    );
  }

  ctx.scenario("D. Renderer — TestEmail → HTML");
  const rendered = await renderEmailTemplate("test", {
    message: "email-foundation-marker",
  });
  ctx.assertTrue("html non vide", rendered.html.length > 0);
  ctx.assertTrue(
    "html contient le message",
    rendered.html.includes("email-foundation-marker"),
  );
  ctx.assertTrue(
    "html contient le titre test",
    rendered.html.includes("Email test — Mileyo OS"),
  );
  ctx.assertTrue("text non vide", rendered.text.length > 0);
  ctx.assertTrue(
    "text contient le message",
    rendered.text.includes("email-foundation-marker"),
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

  return finishSuite("48-email-foundation", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
