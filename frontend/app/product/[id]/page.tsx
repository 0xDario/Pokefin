import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CardRinkPromo from "../../components/CardRinkPromo";
import ProductImage from "../../components/ProductPrices/shared/ProductImage";
import ExpansionTypeBadge from "../../components/ProductPrices/shared/ExpansionTypeBadge";
import VariantBadge from "../../components/ProductPrices/shared/VariantBadge";
import {
  getCagrPercent,
  getMaxDrawdownPercent,
  getVolatilityPercent,
} from "../../components/MarketView/returns";
import { getCachedProductDetail } from "../../lib/serverMarketData";
import { Product } from "../../components/ProductPrices/types";
import ProductDetailChart from "./ProductDetailChart";

const DAY_MS = 24 * 60 * 60 * 1000;

function getProductLabel(product: Product) {
  return (
    product.product_types?.label ||
    product.product_types?.name ||
    "Unknown Product"
  );
}

function getReleaseMs(releaseDate?: string | null): number | null {
  if (!releaseDate) return null;
  const dateKey = releaseDate.split("T")[0].split(" ")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDate(releaseDate?: string | null): string {
  const ms = getReleaseMs(releaseDate);
  if (ms === null) return "Unknown";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function ReturnValue({
  value,
  signed = true,
}: {
  value: number | null;
  signed?: boolean;
}) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-slate-400">--</span>;
  }
  const sign = signed && value > 0 ? "+" : "";
  const tone = !signed
    ? "text-slate-900"
    : value > 0
    ? "text-[var(--pf-gain)]"
    : value < 0
    ? "text-[var(--pf-loss)]"
    : "text-slate-500";
  return (
    <span className={`font-bold tabular-nums ${tone}`}>
      {sign}
      {value.toFixed(2)}%
    </span>
  );
}

function MetricTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const productId = Number(id);
  const detail = Number.isFinite(productId)
    ? await getCachedProductDetail(productId)
    : null;

  if (!detail) {
    return { title: "Product Not Found · Pokéfin" };
  }

  const { product } = detail;
  const setName = product.sets?.name ?? "Unknown Set";
  const label = getProductLabel(product);
  return {
    title: `${setName} — ${label} · Pokéfin`,
    description: `Live price, return metrics, and one-year price history for ${setName} ${label} sealed product.`,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const detail = await getCachedProductDetail(productId);
  if (!detail) notFound();

  const { product, history, siblings } = detail;

  const setName = product.sets?.name ?? "Unknown Set";
  const setCode = product.sets?.code ?? "N/A";
  const generation = product.sets?.generations?.name ?? "Unknown Generation";
  const label = getProductLabel(product);

  const releaseMs = getReleaseMs(product.sets?.release_date);
  const todayUtcMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  const daysSinceRelease =
    releaseMs === null
      ? null
      : Math.max(0, Math.floor((todayUtcMs - releaseMs) / DAY_MS));
  const pricePerDay =
    product.usd_price > 0 && daysSinceRelease && daysSinceRelease > 0
      ? product.usd_price / daysSinceRelease
      : null;

  const identity = (usd: number) => usd;
  const cagr = getCagrPercent(history, identity);
  const maxDrawdown = getMaxDrawdownPercent(history, identity);
  const volatility = getVolatilityPercent(history, identity, 30);

  return (
    <main className="p-3 md:p-6">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-slate-500">
        <Link href="/market" className="hover:text-[var(--pf-pokeball)]">
          Market View
        </Link>
        <span className="mx-2 text-slate-300">/</span>
        <span className="text-slate-700">{setName}</span>
      </nav>

      {/* Hero */}
      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <ProductImage
            imageUrl={product.image_url}
            productName={`${setName} ${label}`}
            className="w-full h-72"
          />
        </div>

        <div className="flex flex-col">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
            {generation}
          </p>
          <h1 className="mt-1 text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
            {label}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-sm font-medium text-slate-700">{setName}</span>
            <span className="text-xs font-mono text-slate-400">{setCode}</span>
            <ExpansionTypeBadge type={product.sets?.expansion_type} />
            {product.variant && <VariantBadge variant={product.variant} />}
          </div>

          <div className="mt-4">
            <span className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums">
              {formatUsd(product.usd_price)}
            </span>
            <span className="ml-1.5 text-sm font-semibold text-slate-400">USD</span>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <MetricTile label="Release Date">
              <span className="font-semibold text-slate-900">
                {formatDate(product.sets?.release_date)}
              </span>
            </MetricTile>
            <MetricTile label="Days Since Release">
              <span className="font-semibold text-slate-900 tabular-nums">
                {daysSinceRelease ?? "--"}
              </span>
            </MetricTile>
            <MetricTile label="Price / Day">
              <span className="font-semibold text-slate-900 tabular-nums">
                {formatUsd(pricePerDay)}
              </span>
            </MetricTile>
          </div>

          {product.url && (
            <a
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-fit items-center rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] text-white px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            >
              View on TCGPlayer →
            </a>
          )}
        </div>
      </div>

      {/* Return metrics */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Return Metrics</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <MetricTile label="7D">
            <ReturnValue value={product.returns?.["7D"] ?? null} />
          </MetricTile>
          <MetricTile label="1M">
            <ReturnValue value={product.returns?.["1M"] ?? null} />
          </MetricTile>
          <MetricTile label="3M">
            <ReturnValue value={product.returns?.["3M"] ?? null} />
          </MetricTile>
          <MetricTile label="6M">
            <ReturnValue value={product.returns?.["6M"] ?? null} />
          </MetricTile>
          <MetricTile label="1Y">
            <ReturnValue value={product.returns?.["1Y"] ?? null} />
          </MetricTile>
          <MetricTile label="CAGR">
            <ReturnValue value={cagr} />
          </MetricTile>
          <MetricTile label="Max Drawdown">
            <ReturnValue
              value={maxDrawdown === null ? null : maxDrawdown * -1}
            />
          </MetricTile>
          <MetricTile label="Volatility 30D">
            <ReturnValue value={volatility} signed={false} />
          </MetricTile>
        </div>
      </section>

      {/* Price chart */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <ProductDetailChart
          history={history}
          releaseDate={product.sets?.release_date}
        />
      </section>

      {/* Siblings */}
      {siblings.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Other products in {setName}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {siblings.map((sib) => (
              <Link
                key={sib.id}
                href={`/product/${sib.id}`}
                className="group rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
              >
                <ProductImage
                  imageUrl={sib.image_url}
                  productName={getProductLabel(sib)}
                  className="w-full h-28"
                />
                <div className="mt-2 text-xs font-semibold text-slate-900 leading-tight group-hover:text-[var(--pf-pokeball)] transition-colors line-clamp-2">
                  {getProductLabel(sib)}
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900 tabular-nums">
                  {formatUsd(sib.usd_price)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <CardRinkPromo variant="footer" />
    </main>
  );
}
