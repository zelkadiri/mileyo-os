import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import {
  isRouteErrorResponse,
  ServerRouter,
  type EntryContext,
  type HandleErrorFunction,
} from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { captureTechnicalError } from "./services/observability/captureTechnicalError.server";
import { initSentry } from "./services/observability/sentry.server";
import { addDocumentResponseHeaders } from "./shopify.server";

initSentry();

export const streamTimeout = 5000;

/**
 * React Router 7 server error hook — unhandled loader/action/SSR route errors.
 * Expected 4xx RouteErrorResponses are not reported. SSR onError stays log-only
 * to avoid double-capturing the same exception.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) {
    return;
  }

  if (isRouteErrorResponse(error) && error.status < 500) {
    return;
  }

  let route: string | undefined;
  try {
    route = new URL(request.url).pathname;
  } catch {
    route = undefined;
  }

  captureTechnicalError(error, {
    route,
    source: "entry.server",
  });

  console.error(error);
};

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          // Log only — Sentry capture is owned by handleError (one event per error).
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
