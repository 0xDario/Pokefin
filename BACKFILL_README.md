# Historical Price Backfill Guide

## Summary

Your TCGPlayer scraper has been fixed and is now working! This guide explains how to backfill missing historical price data.

## What Was Fixed

1. **Updated price extraction** to match TCGPlayer's new HTML structure (December 2025)
2. **Fixed bot detection** by adding browser fingerprint evasion techniques
3. **Added WebDriverWait** to wait for Vue.js client-side rendering

## Missing Data

Based on the 1M chart data available from TCGPlayer:

- **Available data range**: November 8, 2025 - December 7, 2025 (30 days)
- **Missing from your database**: November 8 - December 6, 2025

Note: You mentioned wanting Nov 5-7, but TCGPlayer's 1M button only shows the last ~30 days, which starts from Nov 8.

## How to Backfill Historical Prices

### Step 1: Test on a Single Product

```bash
python test_backfill.py
```

This will:
- Load one product
- Click the 1M button
- Extract and display historical prices
- Verify the data extraction works

### Step 2: Run the Full Backfill

```bash
python backfill_historical_prices.py
```

This will:
- Process all products in your database
- Click the 1M button for each product
- Extract 30 days of historical price data
- Insert missing dates (Nov 8 - Dec 6) into `product_price_history` table
- Skip any dates that already exist

**Important**:
- The script is polite (2 second delay between products)
- It will take approximately 137 products × 2 seconds = ~4.5 minutes
- Data is inserted with a timestamp of noon UTC for each date

### Step 3: Verify the Data

After running, check your database:

```sql
SELECT
    DATE(created_at) as date,
    COUNT(*) as num_products
FROM product_price_history
WHERE created_at >= '2025-11-08'
  AND created_at <= '2025-12-06'
GROUP BY DATE(created_at)
ORDER BY date;
```

You should see ~137 entries for each date (one per product).

## For Earlier Historical Data (Nov 5-7)

The 1M button doesn't show Nov 5-7. To get that data, you would need to:

1. Click the **3M button** instead
2. Parse the 3-day aggregated data (format: "11/5 to 11/7" with average price)
3. Decide how to store aggregated data vs. daily data

Let me know if you want me to add 3M support!

## Files

- `main.py` - Your main scraper (now fixed!)
- `backfill_historical_prices.py` - Backfill script for historical data
- `test_backfill.py` - Test script to verify data extraction
- `test_scrape.py` - Debug script used during fixing

## Database Schema

The script inserts into `product_price_history`:
- `product_id` - Foreign key to products table
- `usd_price` - The market price for that day
- `created_at` - The date/time (set to noon UTC for each historical date)
