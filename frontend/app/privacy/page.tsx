import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Pokefin",
  description: "How Pokefin collects, uses, and protects your data.",
};

const LAST_UPDATED = "2026-05-27";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-6 text-gray-800 dark:text-gray-100">
      <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-6 text-xs text-gray-500">Last updated: {LAST_UPDATED}</p>

      <p className="mb-4">
        This policy describes how Pokefin handles personal data. Pokefin is
        operated as a personal project; the operator is the data controller
        for the purposes of GDPR / UK GDPR. The legal basis for processing
        is your consent and the performance of the service you signed up for.
      </p>

      <h2 className="mt-8 mb-2 text-xl font-semibold">Data we collect</h2>
      <ul className="ml-6 list-disc space-y-1">
        <li>
          <strong>Account data</strong>: your email address, an optional
          username, and an encrypted password (managed by Supabase Auth).
        </li>
        <li>
          <strong>Portfolio data</strong>: products you add to your
          portfolio, quantities, purchase prices and dates, and any free-form
          notes you choose to write.
        </li>
        <li>
          <strong>Box-calculator data</strong>: recipes you save, including
          their names and pack compositions.
        </li>
        <li>
          <strong>Operational data</strong>: timestamps of authentication
          events (signup, password change, account deletion) in an audit log
          accessible only to the operator.
        </li>
      </ul>

      <h2 className="mt-8 mb-2 text-xl font-semibold">What we do not collect</h2>
      <ul className="ml-6 list-disc space-y-1">
        <li>No advertising or third-party analytics cookies.</li>
        <li>No payment information; the service is free.</li>
        <li>No tracking across other websites.</li>
      </ul>

      <h2 className="mt-8 mb-2 text-xl font-semibold">How we use it</h2>
      <p>
        Personal data is used solely to operate the service: authenticate
        you, render your portfolio, calculate values, and provide the box
        calculator. Aggregated, non-identifiable usage data may be used to
        improve the application.
      </p>

      <h2 className="mt-8 mb-2 text-xl font-semibold">Sub-processors</h2>
      <ul className="ml-6 list-disc space-y-1">
        <li>
          <strong>Supabase</strong> (database, authentication, file storage).
        </li>
        <li>
          <strong>Vercel</strong> (hosting, edge functions, application logs).
        </li>
        <li>
          <strong>Cloudflare Turnstile</strong> (bot protection on signup
          and login).
        </li>
        <li>
          <strong>Sentry</strong> (error reporting, when configured;
          PII is scrubbed before events leave the server).
        </li>
      </ul>

      <h2 className="mt-8 mb-2 text-xl font-semibold">Retention</h2>
      <p>
        Personal data is retained for as long as your account exists. When
        you delete your account, all per-user rows (profile, portfolios,
        holdings, lots, box recipes) are removed atomically. An audit log
        entry recording the deletion is kept indefinitely for security
        purposes; it contains your user id and event type, not your email
        or content.
      </p>

      <h2 className="mt-8 mb-2 text-xl font-semibold">Your rights</h2>
      <p className="mb-2">
        Under GDPR / UK GDPR you can:
      </p>
      <ul className="ml-6 list-disc space-y-1">
        <li>
          <strong>Access &amp; portability</strong> — export every record we
          hold about you as a single JSON file from your{" "}
          <Link href="/account" className="text-blue-600 underline">
            account page
          </Link>
          .
        </li>
        <li>
          <strong>Rectification</strong> — edit your username and portfolio
          fields directly in the app.
        </li>
        <li>
          <strong>Erasure</strong> — delete your account from your{" "}
          <Link href="/account" className="text-blue-600 underline">
            account page
          </Link>
          ; this triggers a cascading delete across all per-user tables.
        </li>
        <li>
          <strong>Restriction &amp; objection</strong> — contact the operator
          to discuss.
        </li>
        <li>
          <strong>Complaint</strong> — you may lodge a complaint with your
          local supervisory authority.
        </li>
      </ul>

      <h2 className="mt-8 mb-2 text-xl font-semibold">Security</h2>
      <p>
        Data is transmitted over TLS, stored encrypted at rest by Supabase,
        and isolated per-user by Postgres row-level security. Sessions are
        held in HttpOnly, SameSite=Lax cookies and rotated on every request.
        Destructive endpoints require an origin allowlist and a custom
        request header to defeat CSRF.
      </p>

      <h2 className="mt-8 mb-2 text-xl font-semibold">Contact</h2>
      <p>
        For privacy questions, reach the operator via the contact channel
        listed on the Pokefin GitHub repository.
      </p>
    </main>
  );
}
