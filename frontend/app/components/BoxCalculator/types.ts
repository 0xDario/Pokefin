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
  userId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoosterPackPrice {
  setId: number;
  setName: string;
  usdPrice: number;
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
