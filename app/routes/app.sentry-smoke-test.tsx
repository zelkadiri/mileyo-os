/**
 * TEMPORARY — SENTRY-1 controlled prod smoke test.
 * Not linked in navigation. Admin-only. No business data / PII.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData } from "react-router";

import { captureTechnicalError } from "../services/observability/captureTechnicalError.server";
import { authenticate } from "../shopify.server";

const SMOKE_TEST_ERROR_CODE = "MILEYO_SENTRY_SMOKE_TEST";
const SMOKE_TEST_ROUTE = "/app/sentry-smoke-test";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  captureTechnicalError(new Error(SMOKE_TEST_ERROR_CODE), {
    source: "admin",
    route: SMOKE_TEST_ROUTE,
    errorCode: SMOKE_TEST_ERROR_CODE,
  });

  return { message: "Événement Sentry envoyé." };
};

export default function SentrySmokeTestPage() {
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Sentry smoke test">
      <s-section>
        <p>Sentry smoke test</p>
        {actionData?.message ? <p>{actionData.message}</p> : null}
        <Form method="post">
          <button type="submit">Envoyer une erreur test Sentry</button>
        </Form>
      </s-section>
    </s-page>
  );
}
