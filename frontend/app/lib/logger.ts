/**
 * Structured logging helpers.
 *
 * The audit found that ~15 sites still passed raw Supabase error
 * objects to console.error, leaking the `details` and `hint` fields
 * that can include schema fragments. logSupabaseError formats only
 * the safe shape.
 *
 * Also serves as the integration point for Sentry: when SENTRY_DSN is
 * set in the environment, Sentry's beforeSend hook scrubs PII; the
 * captureException call is added by the Sentry wiring in a later
 * commit and is a no-op until then.
 */

interface SupabaseLikeError {
  message?: unknown;
  code?: unknown;
  name?: unknown;
}

export function logSupabaseError(label: string, err: SupabaseLikeError | null | undefined) {
  if (!err) {
    console.error(label, { code: "unknown", message: "no error object" });
    return;
  }
  // Only the safe fields. message + code are normally short; cap
  // message length defensively in case a future SDK version expands it.
  const message =
    typeof err.message === "string" ? err.message.slice(0, 300) : null;
  const code = typeof err.code === "string" ? err.code : null;
  const name = typeof err.name === "string" ? err.name : null;
  console.error(label, { code, name, message });
}

/**
 * For caught Error instances (e.g. fetch/network failures).
 * Keeps message + name; drops stack to avoid leaking source paths
 * via client-side console exfiltration.
 */
export function logCaughtError(label: string, err: unknown) {
  if (err instanceof Error) {
    console.error(label, { name: err.name, message: err.message.slice(0, 300) });
  } else if (typeof err === "string") {
    console.error(label, { message: err.slice(0, 300) });
  } else {
    console.error(label, { message: "non-error thrown" });
  }
}
