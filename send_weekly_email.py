#!/usr/bin/env python3
"""
Email one edition of The Pokefin Weekly.

Invoked by run_weekly_report.sh after a run that actually produced a PDF, with
the paths that run emitted:

    python send_weekly_email.py <pdf-path> [summary-json-path]

Plain SMTP, so the provider is configuration rather than code — Brevo and
Amazon SES both speak it, and switching between them is four env vars. Nothing
here is provider-specific.

Configuration comes from the environment, which run_weekly_report.sh has
already populated from ~/.config/pokefin/env (the same file the scraper's
credentials live in). No secret is ever read from the repo:

    REPORT_EMAIL_TO      required. Comma-separated for more than one recipient.
    REPORT_EMAIL_FROM    required. Must be a sender the provider has verified.
    SMTP_HOST            required. Brevo: smtp-relay.brevo.com
                                   SES:   email-smtp.<region>.amazonaws.com
    SMTP_PORT            default 587 (STARTTLS). 465 switches to implicit TLS.
    SMTP_USER            required. Brevo: the SMTP login (not the account email)
                                   SES:   the SMTP username from IAM
    SMTP_PASS            required. The SMTP key/password.

Exit codes: 0 sent, 1 send failed, 2 not configured. The wrapper treats a
non-zero exit as a warning rather than a failed report — the PDF on disk is the
deliverable, and email is delivery.
"""

from __future__ import annotations

import json
import mimetypes
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


REQUIRED = ("REPORT_EMAIL_TO", "REPORT_EMAIL_FROM", "SMTP_HOST", "SMTP_USER",
            "SMTP_PASS")


def pct(value) -> str:
    return "n/a" if value is None else f"{value:+.0f}%"


def money(value) -> str:
    return "n/a" if value is None else f"${value:,.2f}"


def build_body(summary: dict | None, pdf_name: str) -> tuple[str, str]:
    """
    Return (plain_text, html) for the message body.

    Deliberately short. The PDF is the report; this is the glance-on-a-phone
    version, so it carries the same marquee figures the front page leads with
    and nothing else. Every number comes from the summary the generator wrote,
    so the email cannot drift away from the edition it is attached to.
    """
    if not summary:
        text = (f"The Pokefin Weekly is attached: {pdf_name}\n\n"
                "(No summary file accompanied this edition.)\n")
        return text, f"<p>The Pokéfin Weekly is attached: <b>{pdf_name}</b></p>"

    anchor = summary.get("anchor", "—")
    n = summary.get("n_products", "—")
    excluded = summary.get("excluded", 0)
    fastest = summary.get("fastest_category")
    slowest = summary.get("slowest_category")
    best_set = summary.get("best_set_1y")
    tops = summary.get("top_1y") or []

    lines = [f"The Pokefin Weekly — data as of {anchor}",
             f"{n} products tracked, {excluded} excluded as illiquid.", ""]
    if fastest:
        lines.append(f"Fastest category (6M): {fastest['category']} "
                     f"{pct(fastest.get('m6'))} (n={fastest.get('n')})")
    if slowest:
        lines.append(f"Slowest category (6M): {slowest['category']} "
                     f"{pct(slowest.get('m6'))} (n={slowest.get('n')})")
    if best_set:
        lines.append(f"Best set (1Y avg): {best_set['set_name']} "
                     f"{pct(best_set.get('avg_1y'))}")
    if tops:
        lines.append("")
        lines.append("Top movers (1Y):")
        for t in tops:
            variant = f" [{t['variant']}]" if t.get("variant") else ""
            lines.append(f"  {t['name']}{variant} — {pct(t.get('return'))} "
                         f"at {money(t.get('end_price'))}")
    lines += ["", f"Full edition attached: {pdf_name}"]
    text = "\n".join(lines)

    def row(label, value):
        return (f"<tr><td style='padding:2px 12px 2px 0;color:#555'>{label}</td>"
                f"<td style='padding:2px 0'><b>{value}</b></td></tr>")

    rows = []
    if fastest:
        rows.append(row("Fastest category (6M)",
                        f"{fastest['category']} {pct(fastest.get('m6'))}"))
    if slowest:
        rows.append(row("Slowest category (6M)",
                        f"{slowest['category']} {pct(slowest.get('m6'))}"))
    if best_set:
        rows.append(row("Best set (1Y avg)",
                        f"{best_set['set_name']} {pct(best_set.get('avg_1y'))}"))

    movers = "".join(
        f"<li>{t['name']}"
        f"{(' [' + t['variant'] + ']') if t.get('variant') else ''} — "
        f"<b>{pct(t.get('return'))}</b> at {money(t.get('end_price'))}</li>"
        for t in tops
    )

    html_body = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111">
  <h2 style="margin:0 0 2px">The Pokéfin Weekly</h2>
  <div style="color:#666;margin-bottom:12px">Data as of {anchor} &middot;
    {n} products tracked &middot; {excluded} excluded as illiquid</div>
  <table style="border-collapse:collapse;margin-bottom:12px">{"".join(rows)}</table>
  {f"<div style='margin-bottom:4px;color:#555'>Top movers (1Y)</div><ul style='margin:0 0 12px 18px;padding:0'>{movers}</ul>" if movers else ""}
  <div style="color:#666">Full edition attached: <b>{pdf_name}</b></div>
</div>"""
    return text, html_body


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: send_weekly_email.py <pdf-path> [summary-json]",
              file=sys.stderr)
        return 2

    pdf_path = argv[1]
    summary_path = argv[2] if len(argv) > 2 else None

    if not os.path.isfile(pdf_path):
        print(f"! No PDF at {pdf_path}; nothing to send.", file=sys.stderr)
        return 2

    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        # Not an error: email is opt-in. Someone who has not configured it
        # should keep getting reports on disk without a failing job every week.
        print(f"Email not configured (missing {', '.join(missing)}); skipping.")
        return 2

    summary = None
    if summary_path and os.path.isfile(summary_path):
        try:
            with open(summary_path) as f:
                summary = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"WARN: could not read summary {summary_path}: {exc}",
                  file=sys.stderr)

    pdf_name = os.path.basename(pdf_path)
    anchor = (summary or {}).get("anchor")
    subject = f"The Pokéfin Weekly — {anchor}" if anchor else \
              f"The Pokéfin Weekly — {pdf_name}"

    text, html_body = build_body(summary, pdf_name)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ["REPORT_EMAIL_FROM"]
    recipients = [a.strip() for a in os.environ["REPORT_EMAIL_TO"].split(",")
                  if a.strip()]
    msg["To"] = ", ".join(recipients)
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")

    ctype, _ = mimetypes.guess_type(pdf_path)
    maintype, subtype = (ctype or "application/pdf").split("/", 1)
    with open(pdf_path, "rb") as f:
        msg.add_attachment(f.read(), maintype=maintype, subtype=subtype,
                           filename=pdf_name)

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASS"]
    context = ssl.create_default_context()

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=60) as s:
                s.login(user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=60) as s:
                s.starttls(context=context)
                s.login(user, password)
                s.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        # The provider's rejection text is the useful part — a sender that is
        # not verified, or a sandboxed SES account, both say so here.
        print(f"! Email send failed via {host}:{port}: {exc}", file=sys.stderr)
        return 1

    print(f"Emailed {pdf_name} to {msg['To']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
