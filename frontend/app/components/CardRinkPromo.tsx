import Link from 'next/link';
import Image from 'next/image';

type PromoVariant = 'header' | 'banner' | 'card' | 'footer';

interface CardRinkPromoProps {
  variant: PromoVariant;
}

export default function CardRinkPromo({ variant }: CardRinkPromoProps) {
  // Header variant - announcement bar style
  if (variant === 'header') {
    return (
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-6 mb-6 rounded-lg shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-sm sm:text-base font-medium text-center sm:text-left">
            🎴 Looking for sealed products, singles, or slabs?
          </p>
          <Link
            href="https://cardrinktcg.ca"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-blue-600 hover:bg-blue-50 px-6 py-2 rounded-md font-semibold text-sm transition-colors whitespace-nowrap"
          >
            Shop CardRinkTCG.ca →
          </Link>
        </div>
      </div>
    );
  }

  // Banner variant - prominent section between controls and products
  if (variant === 'banner') {
    return (
      <div className="my-6 bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800 dark:to-blue-900 border-2 border-blue-200 dark:border-blue-700 rounded-xl p-6 shadow-md">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="flex-shrink-0">
            <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-4xl">
              🎴
            </div>
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Ready to Buy Pokémon Cards?
            </h3>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              Shop our full selection of sealed products, singles, and graded slabs at CardRinkTCG.ca
            </p>
            <div className="flex flex-wrap gap-2 justify-center md:justify-start text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                ✓ Sealed Booster Boxes
              </span>
              <span className="flex items-center gap-1">
                ✓ Single Cards
              </span>
              <span className="flex items-center gap-1">
                ✓ Graded Slabs
              </span>
            </div>
          </div>
          <div className="flex-shrink-0">
            <Link
              href="https://cardrinktcg.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold text-lg transition-colors shadow-lg hover:shadow-xl whitespace-nowrap"
            >
              Visit Store →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Card variant - compact link within product cards
  if (variant === 'card') {
    return (
      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
        <Link
          href="https://cardrinktcg.ca"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
        >
          🛒 Shop at CardRinkTCG.ca
        </Link>
      </div>
    );
  }

  // Footer variant - comprehensive footer section
  if (variant === 'footer') {
    return (
      <footer className="mt-12 pt-8 border-t-2 border-slate-200 dark:border-slate-700">
        <div className="bg-gradient-to-r from-slate-100 to-blue-100 dark:from-slate-800 dark:to-blue-900 rounded-xl p-8">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                Ready to Start Collecting?
              </h2>
              <p className="text-slate-600 dark:text-slate-300 text-lg">
                Visit <strong>CardRinkTCG.ca</strong> for Pokémon sealed products, singles, and graded slabs
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="text-center p-4 bg-white/50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-3xl mb-2">📦</div>
                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Sealed Products</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Booster boxes, ETBs, bundles & more
                </p>
              </div>

              <div className="text-center p-4 bg-white/50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-3xl mb-2">🎴</div>
                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Single Cards</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Find the exact cards you need
                </p>
              </div>

              <div className="text-center p-4 bg-white/50 dark:bg-slate-700/50 rounded-lg">
                <div className="text-3xl mb-2">⭐</div>
                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Graded Slabs</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  PSA, CGC, BGS certified cards
                </p>
              </div>
            </div>

            <div className="text-center">
              <Link
                href="https://cardrinktcg.ca"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-lg font-bold text-lg transition-colors shadow-lg hover:shadow-xl"
              >
                Shop CardRinkTCG.ca Now →
              </Link>
            </div>

            <div className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              <p>Powered by Pokefin.ca - Track prices, shop smart 💎</p>
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return null;
}
