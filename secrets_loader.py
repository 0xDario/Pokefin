"""
Credential loader for the scrapers.

Prefers environment variables (the deploy path) and falls back to the
gitignored secretsFile.py module for local development.

Audit follow-up DB-1: don't commit a service-role key into a flat
secrets file. Set the env var on the scraper host instead.
"""

import os
from typing import Optional


def _from_env_or_file(env_name: str, file_attr: str) -> Optional[str]:
    value = os.environ.get(env_name)
    if value:
        return value
    try:
        # Imported lazily so missing secretsFile.py doesn't crash in
        # environments that supply credentials via env only.
        import secretsFile  # type: ignore[import-not-found]
        return getattr(secretsFile, file_attr, None)
    except ImportError:
        return None


def load_supabase_credentials() -> tuple[str, str]:
    url = _from_env_or_file("SUPABASE_URL", "SUPABASE_URL")
    key = _from_env_or_file("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY") or \
          _from_env_or_file("SUPABASE_KEY", "SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing Supabase credentials. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in the environment, or populate "
            "secretsFile.py for local development."
        )
    return url, key


def load_shopify_credentials() -> tuple[str, str, str]:
    domain = _from_env_or_file("SHOPIFY_STORE_DOMAIN", "SHOPIFY_STORE_DOMAIN")
    token = _from_env_or_file("SHOPIFY_ADMIN_API_TOKEN", "SHOPIFY_ADMIN_API_TOKEN")
    version = _from_env_or_file("SHOPIFY_API_VERSION", "SHOPIFY_API_VERSION") or "2024-10"
    if not domain or not token:
        raise RuntimeError(
            "Missing Shopify credentials. Set SHOPIFY_STORE_DOMAIN and "
            "SHOPIFY_ADMIN_API_TOKEN in the environment."
        )
    return domain, token, version
