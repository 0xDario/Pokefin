import Link from "next/link";
import CardRinkPromo from "./components/CardRinkPromo";
import ProductImage from "./components/ProductPrices/shared/ProductImage";
import RecentlyReleased from "./components/dashboard/RecentlyReleased";
import {
  getCachedExchangeRate,
  getCachedMarketProductSummaries,
} from "./lib/serverMarketData";
import { Product } from "./components/ProductPrices/types";

function sevenDayReturn(product: Product): number | null {
  return product.returns?.["7D"] ?? null;
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function getProductLabel(product: Product): string {
  return (
    product.product_types?.label ||
    product.product_types?.name ||
    "Unknown Product"
  );
}

// Booster packs are low-value items where a big % swing on a $5–10 pack
// isn't meaningful — exclude them from Top Movers.
function isBoosterPack(product: Product): boolean {
  const type = (
    product.product_types?.label ||
    product.product_types?.name ||
    ""
  ).toLowerCase();
  return type.includes("booster pack");
}

function MoverCard({ product }: { product: Product }) {
  const change = sevenDayReturn(product);
  const label = getProductLabel(product);
  const setName = product.sets?.name ?? "";
  const isUp = change !== null && change > 0;

  return (
    <Link
      href={`/product/${product.id}`}
      className="group w-[180px] flex-shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
    >
      <ProductImage
        imageUrl={product.image_url}
        productName={`${setName} ${label}`}
        className="w-full h-28"
      />
      <div className="mt-2 text-xs font-semibold text-slate-900 leading-tight line-clamp-2 group-hover:text-[var(--pf-pokeball)] transition-colors">
        {label}
      </div>
      <div className="text-[11px] text-slate-500 truncate">{setName}</div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-900 tabular-nums">
          {formatUsd(product.usd_price)}
        </span>
        <span
          className={`text-xs font-bold tabular-nums ${
            change === null
              ? "text-slate-400"
              : isUp
              ? "text-[var(--pf-gain)]"
              : "text-[var(--pf-loss)]"
          }`}
        >
          {change === null
            ? "--"
            : `${isUp ? "+" : ""}${change.toFixed(1)}%`}
        </span>
      </div>
    </Link>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-slate-900 tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 truncate">{sub}</div>}
    </div>
  );
}

export default async function Home() {
  const [products, exchangeRate] = await Promise.all([
    getCachedMarketProductSummaries(),
    getCachedExchangeRate(),
  ]);

  // Top Movers (7D) — biggest gainers and losers, excluding low-value packs
  const withReturns = products.filter(
    (p) => sevenDayReturn(p) !== null && !isBoosterPack(p)
  );
  const gainers = [...withReturns]
    .sort((a, b) => (sevenDayReturn(b) ?? 0) - (sevenDayReturn(a) ?? 0))
    .slice(0, 3);
  const losers = [...withReturns]
    .sort((a, b) => (sevenDayReturn(a) ?? 0) - (sevenDayReturn(b) ?? 0))
    .slice(0, 3);

  // Recently Released — products from the 1–2 most recent sets
  const setMap = new Map<string, { releaseDate: string; products: Product[] }>();
  for (const p of products) {
    if (!p.sets) continue;
    const key = String(p.sets.id ?? `${p.sets.code}:${p.sets.name}`);
    const existing = setMap.get(key);
    if (existing) {
      existing.products.push(p);
    } else {
      setMap.set(key, {
        releaseDate: p.sets.release_date || "",
        products: [p],
      });
    }
  }
  const recentSets = Array.from(setMap.values())
    .filter((s) => s.releaseDate)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, 2);
  const recentProducts = recentSets.flatMap((s) => s.products);

  // Quick Stats
  const oneMonthReturns = products
    .map((p) => p.returns?.["1M"])
    .filter((v): v is number => v !== null && v !== undefined);
  const avgOneMonth =
    oneMonthReturns.length > 0
      ? oneMonthReturns.reduce((sum, v) => sum + v, 0) / oneMonthReturns.length
      : null;

  const mostExpensive = products.reduce<Product | null>(
    (max, p) => (p.usd_price > (max?.usd_price ?? -1) ? p : max),
    null
  );

  const latestUpdateRaw = products.reduce<string>((latest, p) => {
    if (!p.last_updated) return latest;
    return !latest || p.last_updated > latest ? p.last_updated : latest;
  }, "");
  let latestUpdateLabel = "Unknown";
  if (latestUpdateRaw) {
    const hasTz =
      latestUpdateRaw.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(latestUpdateRaw);
    const parsed = new Date(
      hasTz ? latestUpdateRaw : `${latestUpdateRaw.replace(" ", "T")}Z`
    );
    if (!Number.isNaN(parsed.getTime())) {
      latestUpdateLabel = parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  return (
    <main className="p-3 md:p-6 space-y-8">
      {/* Hero */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 md:p-10 shadow-sm">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-pokeball)]">
            Pokéfin
          </p>
          <h1 className="mt-1 text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
            Pokémon Sealed Product Price Tracker
          </h1>
          <p className="mt-2 text-slate-600">
            Track market prices, returns, and trends across{" "}
            {products.length} sealed Pokémon TCG products — refreshed hourly
            from TCGPlayer.
          </p>

          <form
            action="/prices"
            method="get"
            className="mt-5 flex gap-2 max-w-md"
          >
            <input
              type="text"
              name="q"
              placeholder="Search sealed products…"
              aria-label="Search sealed products"
              className="flex-1 min-h-[42px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--pf-pokeblue)] focus:border-[var(--pf-pokeblue)] transition-colors"
            />
            <button
              type="submit"
              className="rounded-lg bg-[var(--pf-pokeball)] hover:bg-[var(--pf-pokeball-strong)] text-white px-5 text-sm font-semibold transition-colors shadow-sm"
            >
              Search
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href="/prices"
              className="rounded-lg bg-[var(--pf-pokeblue)] hover:bg-[var(--pf-pokeblue-strong)] text-white px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            >
              Browse All Products
            </Link>
            <Link
              href="/market"
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 text-sm font-semibold transition-colors"
            >
              Market View
            </Link>
          </div>
        </div>
      </section>

      {/* Top Movers */}
      {withReturns.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              Top Movers
              <span className="ml-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                7-Day
              </span>
            </h2>
            <Link
              href="/market"
              className="text-sm font-semibold text-[var(--pf-pokeblue)] hover:text-[var(--pf-pokeblue-strong)]"
            >
              View all →
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {gainers.map((product) => (
              <MoverCard key={`gain-${product.id}`} product={product} />
            ))}
            {losers.map((product) => (
              <MoverCard key={`lose-${product.id}`} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* Recently Released */}
      {recentProducts.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold tracking-tight text-slate-900">
            Recently Released
          </h2>
          <RecentlyReleased
            initialProducts={recentProducts}
            initialExchangeRate={exchangeRate.rate}
          />
        </section>
      )}

      {/* Quick Stats */}
      <section>
        <h2 className="mb-3 text-lg font-bold tracking-tight text-slate-900">
          Quick Stats
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Products Tracked"
            value={products.length.toLocaleString()}
          />
          <StatCard
            label="Avg 1M Return"
            value={
              avgOneMonth === null
                ? "--"
                : `${avgOneMonth > 0 ? "+" : ""}${avgOneMonth.toFixed(2)}%`
            }
          />
          <StatCard
            label="Most Expensive"
            value={formatUsd(mostExpensive?.usd_price)}
            sub={
              mostExpensive
                ? `${mostExpensive.sets?.name ?? ""} ${getProductLabel(
                    mostExpensive
                  )}`.trim()
                : undefined
            }
          />
          <StatCard label="Last Refreshed" value={latestUpdateLabel} />
        </div>
      </section>

      <CardRinkPromo variant="footer" />
    </main>
  );
}
