export interface PackEntry {
  id: string; // client-side unique key
  setId: number;
  setName: string;
  quantity: number;
}

export interface BoxRecipe {
  id?: number;
  name: string;
  retailPrice: number;
  promoValue: number;
  packs: PackEntry[];
  shareCode?: string | null;
  isPublic?: boolean;
  userId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoosterPackPrice {
  setId: number;
  setName: string;
  /**
   * Null when the freshness guard withheld this product's price. The entry is
   * still listed, so getPackPrice can tell "this set has no standard pack"
   * from "the standard pack exists but cannot be priced" — collapsing those
   * two makes it substitute a variant's price for the standard one.
   */
  usdPrice: number | null;
  variant: string | null;
}

export interface NavResult {
  totalPackValue: number;
  promoValue: number;
  nav: number;
  retailPrice: number;
  premiumDiscount: number; // positive = premium, negative = discount
  premiumDiscountPercent: number;
  signal: "buy" | "hold" | "avoid";
  packBreakdown: {
    setName: string;
    quantity: number;
    perPackPrice: number;
    totalValue: number;
  }[];
}

export interface SetOption {
  id: number;
  name: string;
  code: string;
  releaseDate: string;
}
