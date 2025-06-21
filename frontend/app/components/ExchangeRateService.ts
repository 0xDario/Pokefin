// exchangeRateService.ts

interface ExchangeRateCache {
  rate: number;
  timestamp: number;
  date: string;
}

const CACHE_DURATION = 1000 * 60 * 60; // 1 hour cache
const FALLBACK_RATE = 1.3728; // Updated to current rate from Bank of Canada
let exchangeRateCache: ExchangeRateCache | null = null;

export async function fetchUSDToCADRate(): Promise<{ rate: number; date?: string; cached: boolean }> {
  // Check if we have a valid cached rate
  if (exchangeRateCache && Date.now() - exchangeRateCache.timestamp < CACHE_DURATION) {
    console.log('[Exchange Rate] Using cached rate:', exchangeRateCache.rate);
    return { 
      rate: exchangeRateCache.rate, 
      date: exchangeRateCache.date,
      cached: true 
    };
  }

  console.log('[Exchange Rate] Fetching fresh rate...');

  // Try reliable, CORS-friendly APIs
  const sources = [
    {
      name: 'ExchangeRate-API (Free)',
      fetch: async () => {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await response.json();
        if (data.rates?.CAD) {
          return {
            rate: data.rates.CAD,
            date: data.date || new Date().toISOString().split('T')[0],
            source: 'ExchangeRate-API'
          };
        }
        throw new Error('No CAD rate found');
      }
    },
    {
      name: 'Fixer.io (Free)',
      fetch: async () => {
        // Fixer.io free tier endpoint
        const response = await fetch('https://api.fixer.io/latest?base=USD&symbols=CAD');
        const data = await response.json();
        if (data.rates?.CAD) {
          return {
            rate: data.rates.CAD,
            date: data.date || new Date().toISOString().split('T')[0],
            source: 'Fixer.io'
          };
        }
        throw new Error('No CAD rate found');
      }
    },
    {
      name: 'CurrencyAPI (Free)',
      fetch: async () => {
        const response = await fetch('https://api.currencyapi.com/v3/latest?base_currency=USD&currencies=CAD');
        const data = await response.json();
        if (data.data?.CAD?.value) {
          return {
            rate: data.data.CAD.value,
            date: new Date().toISOString().split('T')[0],
            source: 'CurrencyAPI'
          };
        }
        throw new Error('No CAD rate found');
      }
    },
    {
      name: 'Bank of Canada (CORS Proxy)',
      fetch: async () => {
        const proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent('https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/');
        const response = await fetch(proxyUrl);
        const data = await response.json();
        
        if (!data.contents) {
          throw new Error('No content from proxy');
        }
        
        const result = parseUSDRate(data.contents);
        return {
          rate: result.rate,
          date: result.date,
          source: 'Bank of Canada'
        };
      }
    }
  ];

  // Try each source
  for (const source of sources) {
    try {
      console.log(`[Exchange Rate] Trying ${source.name}...`);
      
      const result = await source.fetch();
      
      if (result && result.rate && result.rate > 0) {
        // Cache the successful result
        exchangeRateCache = {
          rate: result.rate,
          timestamp: Date.now(),
          date: result.date
        };
        
        console.log(`[Exchange Rate] ✅ Success from ${source.name}: ${result.rate} (${result.date})`);
        return { rate: result.rate, date: result.date, cached: false };
      }
      
    } catch (error) {
      console.warn(`[Exchange Rate] ❌ ${source.name} failed:`, error.message);
    }
  }

  // All sources failed
  console.error('[Exchange Rate] All sources failed');
  
  // Return cached rate if available, even if expired
  if (exchangeRateCache) {
    console.log('[Exchange Rate] Using expired cached rate');
    return { 
      rate: exchangeRateCache.rate, 
      date: exchangeRateCache.date,
      cached: true 
    };
  }
  
  // Final fallback - use a reasonable current rate
  const fallbackRate = 1.3728; // Current approximate rate
  console.log('[Exchange Rate] Using fallback rate:', fallbackRate);
  return { 
    rate: fallbackRate, 
    date: new Date().toISOString().split('T')[0],
    cached: false 
  };
}



function parseUSDRate(html: string): { rate: number; date: string } {
  try {
    // Look for the specific table with id="table_daily_1" or the bocss-table class
    const tableMatch = html.match(/<table[^>]*(?:id="table_daily_1"|class="[^"]*bocss-table[^"]*")[\s\S]*?<\/table>/) 
                      || html.match(/<table[\s\S]*?<\/table>/);
    
    if (!tableMatch) {
      throw new Error('Could not find exchange rate table');
    }
    
    const tableHtml = tableMatch[0];
    console.log('[Exchange Rate] Found table with length:', tableHtml.length);
    
    // Find the table header to get all the dates
    const headerMatch = tableHtml.match(/<thead>[\s\S]*?<\/thead>/);
    if (!headerMatch) {
      throw new Error('Could not find table header');
    }
    
    const headerHtml = headerMatch[0];
    console.log('[Exchange Rate] Header HTML:', headerHtml);
    
    // Extract all dates from the header - match the exact format from your HTML: 2025‑06‑20
    const dateMatches = headerHtml.match(/\d{4}‑\d{2}‑\d{2}/g);
    if (!dateMatches || dateMatches.length === 0) {
      throw new Error('Could not find dates in header');
    }
    
    console.log('[Exchange Rate] All dates found:', dateMatches);
    
    // The latest date is the last one in the array
    const latestDate = dateMatches[dateMatches.length - 1];
    console.log('[Exchange Rate] Latest date found:', latestDate);
    
    // Find the US dollar row using the exact structure from your HTML
    const usdRowMatch = tableHtml.match(/<tr><th scope="row"[^>]*>US dollar<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/);
    
    if (!usdRowMatch) {
      // Fallback to more flexible matching
      const fallbackMatch = tableHtml.match(/<tr[\s\S]*?US dollar[\s\S]*?<\/tr>/i);
      if (!fallbackMatch) {
        throw new Error('Could not find US dollar row');
      }
      
      const usdRowHtml = fallbackMatch[0];
      console.log('[Exchange Rate] USD Row HTML (fallback):', usdRowHtml);
      
      // Extract rates using general td matching
      const rateMatches = usdRowHtml.match(/<td[^>]*>([0-9]+\.[0-9]+)<\/td>/g);
      if (!rateMatches || rateMatches.length === 0) {
        throw new Error('Could not find rate values in US dollar row');
      }
      
      const rates = rateMatches.map(match => {
        const valueMatch = match.match(/>([0-9]+\.[0-9]+)</);
        return valueMatch ? parseFloat(valueMatch[1]) : null;
      }).filter(rate => rate !== null) as number[];
      
      if (rates.length === 0) {
        throw new Error('Could not parse any numeric rates');
      }
      
      console.log('[Exchange Rate] All parsed rates (fallback):', rates);
      const latestRate = rates[rates.length - 1];
      
      return {
        rate: latestRate,
        date: latestDate
      };
    }
    
    // Extract rates from the specific match groups
    const rates = [
      parseFloat(usdRowMatch[1]), // 2025‑06‑16: 1.3558
      parseFloat(usdRowMatch[2]), // 2025‑06‑17: 1.3603  
      parseFloat(usdRowMatch[3]), // 2025‑06‑18: 1.3673
      parseFloat(usdRowMatch[4]), // 2025‑06‑19: 1.3724
      parseFloat(usdRowMatch[5])  // 2025‑06‑20: 1.3728
    ].filter(rate => !isNaN(rate));
    
    if (rates.length === 0) {
      throw new Error('Could not parse any numeric rates');
    }
    
    console.log('[Exchange Rate] All parsed rates:', rates);
    console.log('[Exchange Rate] Dates count:', dateMatches.length, 'Rates count:', rates.length);
    
    // The latest rate corresponds to the latest date (rightmost column)
    const latestRate = rates[rates.length - 1];
    
    console.log('[Exchange Rate] Selected latest rate:', latestRate, 'for date:', latestDate);
    
    return {
      rate: latestRate,
      date: latestDate
    };
    
  } catch (error) {
    console.error('[Exchange Rate] Error parsing HTML:', error);
    throw error;
  }
}

// Clear cache function (useful for testing or manual refresh)
export function clearExchangeRateCache(): void {
  exchangeRateCache = null;
  console.log('[Exchange Rate] Cache cleared');
}