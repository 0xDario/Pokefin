/**
 * Sentry client init. No-op when NEXT_PUBLIC_SENTRY_DSN is unset, so
 * this file is safe to ship before you provision a Sentry project.
 *
 * PII scrubbing in beforeSend strips Supabase error `details`/`hint`,
 * email addresses, and known cookie names. The list is conservative
 * - extend it if you start sending more event payloads.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    enabled: true,
    environment: process.env.NODE_ENV,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      // Drop any extra fields named details/hint (Supabase error shape).
      if (event.extra) {
        delete (event.extra as Record<string, unknown>).details;
        delete (event.extra as Record<string, unknown>).hint;
      }
      return event;
    },
  });
}
