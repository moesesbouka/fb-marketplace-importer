# CrazyMoe FB Marketplace Importer v1.3.0

## Overview
This Chrome extension imports Facebook Marketplace listings into a Supabase database for CrazyMoe's inventory system.

## What's New in v1.3.0
- **Much more reliable GraphQL capture** - Hooks both fetch and XHR to catch all API responses
- **Improved scrolling mechanism** - Adaptive with jittered delays, longer patience, detects real page growth
- **No early stopping** - Time-based + growth-based thresholds prevent premature stops
- **Batch upserts** - Efficient Supabase saves with duplicate resolution
- **Clear on-page UI** - Start/stop controls, live counters, and diagnostics
- **Better error handling** - Comprehensive logging and error recovery
- **Updated schema support** - Matches actual database schema with images, description, category fields

## Prerequisites

### 1. Supabase Database Setup
Run these SQL commands in your Supabase SQL editor:

```sql
-- Create the table (if not exists)
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id BIGSERIAL PRIMARY KEY,
  facebook_id TEXT NOT NULL,
  account_tag TEXT NOT NULL,
  title TEXT,
  price NUMERIC,
  currency TEXT,
  location TEXT,
  listing_url TEXT,
  photo_urls JSONB,
  raw JSONB,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Note: Unique constraint is handled via resolution=ignore-duplicates in the extension
-- No need to create a separate index for deduplication

-- Disable RLS for the extension (you can enable later if needed)
ALTER TABLE public.marketplace_listings DISABLE ROW LEVEL SECURITY;

-- Grant necessary permissions
GRANT ALL ON public.marketplace_listings TO anon;
GRANT ALL ON public.marketplace_listings TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
```

### 2. Get Your Supabase Credentials
- **URL**: `https://sfheqjnxlkygjfohoybo.supabase.co`
- **Anon Key**: Get from Supabase Dashboard → Settings → API

## Installation

### Step 1: Configure the Extension
1. Open `content-importer.js` in a text editor
2. Find this line near the top:
   ```javascript
   const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";
   ```
3. Replace `PASTE_YOUR_SUPABASE_ANON_KEY_HERE` with your actual Supabase anon key
4. Save the file

### Step 2: Load the Extension in Chrome
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `fb-marketplace-importer` folder containing:
   - `manifest.json`
   - `content-importer.js`

## Usage

### Step 1: Login to Facebook
1. Login to your Facebook account (MBFB or CMFB)
2. Navigate to a Facebook Marketplace page
   - Example: `https://www.facebook.com/marketplace`
   - Or a specific search/category page

### Step 2: Start the Import
1. You'll see a blue panel in the top-right corner
2. Select the account tag (CMFB or MBFB) matching your current FB login
3. Click **Start Import**
4. The extension will:
   - Begin scrolling down the page automatically
   - Capture listings from GraphQL API responses
   - Batch-save listings to Supabase every 2.5 seconds
   - Show live statistics in the panel

### Step 3: Monitor Progress
Watch the panel for:
- **Status**: Running or Idle
- **Unique**: Number of unique listings found
- **Saved**: Number of listings saved to Supabase
- **GraphQL**: Count of successful GraphQL captures
- **Errors**: Number of save errors
- **Last GraphQL**: Time since last GraphQL response

### Step 4: Stop the Import
- Click **Stop** to manually stop
- The extension will auto-stop when:
  - No new listings for 60 seconds
  - No page growth for 75 seconds (after seeing listings)
  - Maximum runtime of 15 minutes reached

## Troubleshooting

### "No listings found" or GraphQL count stays at 0
1. **Verify you're on a Marketplace page**: The extension only works on `facebook.com/marketplace/*`
2. **Check Supabase key**: Ensure the anon key is correctly set in `content-importer.js`
3. **Reload the extension**: Remove and re-add the extension after any code changes
4. **Check console**: Open Chrome DevTools (F12) and look for `[CM Importer]` log messages
5. **Wait a moment**: Facebook may take a few seconds to start loading listings

### Import stops early (~300 listings)
1. This version has improved scrolling logic with longer patience
2. If it still stops, try starting from the top of the page again
3. Facebook may have rate limiting - wait a few minutes and try again

### Duplicate listings
1. Ensure the unique constraint exists: `account_tag, facebook_id`
2. The extension uses upsert to prevent duplicates
3. If you see duplicates, check the `account_tag` is correct for each account

### Extension shows "Extension context invalidated"
1. This happens when you update the extension files
2. **Completely remove** the extension from `chrome://extensions/`
3. **Close and reopen** Chrome
4. **Re-add** the extension using "Load unpacked"

### Chrome caching issues
If changes to the code aren't taking effect:
1. Remove the extension
2. Close Chrome completely
3. Reopen Chrome
4. Reload the extension

## Data Model

Each listing stored in Supabase includes:

| Field | Type | Description |
|-------|------|-------------|
| `facebook_id` | TEXT | Unique Facebook listing ID |
| `account_tag` | TEXT | "MBFB" or "CMFB" to identify the source account |
| `title` | TEXT | Listing title |
| `price` | NUMERIC | Listing price |
| `currency` | TEXT | Currency code (e.g., "USD") |
| `location` | TEXT | Listing location |
| `listing_url` | TEXT | Direct URL to the listing |
| `images` | JSONB | Array of photo URLs |
| `category` | TEXT | Category ID or name |
| `condition` | TEXT | Item condition |
| `last_seen_at` | TIMESTAMPTZ | When this listing was last seen |
| `imported_at` | TIMESTAMPTZ | When this listing was first imported |
| `updated_at` | TIMESTAMPTZ | When this listing was last updated |

## Technical Details

### GraphQL Capture
The extension hooks both `window.fetch` and `XMLHttpRequest` to intercept all GraphQL API responses from Facebook. It:
- Scans responses deeply to find listing data
- Handles various Facebook response structures
- Logs capture statistics for debugging

### Scrolling Strategy
The extension uses adaptive scrolling with:
- Random jitter to appear more natural
- Time-based thresholds for stopping
- Page growth detection
- Configurable delays and step sizes

### Batch Processing
Listings are:
- Collected in memory as they're captured
- Flushed to Supabase every 2.5 seconds or when 25 pending
- Upserted using the unique constraint on `(account_tag, facebook_id)`

## Support

For issues or questions:
1. Check the Chrome DevTools console for `[CM Importer]` log messages
2. Verify your Supabase database setup
3. Ensure you're using the correct account_tag for each Facebook account
4. Check that the Supabase anon key is correctly configured

## Version History

### v1.3.0 (Current)
- Complete rewrite with improved GraphQL capture
- Better scrolling with adaptive delays
- Time-based stop conditions
- Batch upserts for efficiency
- Clear on-page UI with diagnostics

### v1.2.7 (Previous)
- Initial version with basic GraphQL capture
- Simple scrolling mechanism
- Direct inserts to Supabase