import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      if (event.request?.cookies) {
        delete event.request.cookies;
      }
      if (event.extra) {
        delete (event.extra as Record<string, unknown>).details;
        delete (event.extra as Record<string, unknown>).hint;
      }
      return event;
    },
  });
}
