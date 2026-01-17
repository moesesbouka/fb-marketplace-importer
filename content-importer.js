/**
 * CrazyMoe FB Marketplace Importer — content-importer.js (v1.3.0)
 *
 * What this version fixes/improves:
 * - Much more reliable GraphQL capture (hooks BOTH fetch + XHR, parses JSON safely, scans deep)
 * - Better scrolling (adaptive, jittered, longer patience, detects real page growth)
 * - Won't stop early just because FB pauses briefly (empty-threshold is time-based + growth-based)
 * - Batches + upserts to Supabase (dedupe by account_tag + facebook_id)
 * - Clear on-page UI with start/stop + live counters + diagnostics
 *
 * IMPORTANT:
 * - Replace this file IN PLACE as content-importer.js, then reload the extension.
 * - Do NOT create a second file unless you also update manifest.json to load it.
 *
 * REQUIRED DB NOTE (for true dedupe):
 * - You should have a UNIQUE constraint or index on (account_tag, facebook_id).
 *   Example SQL:
 *     CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_identity
 *     ON public.marketplace_listings (account_tag, facebook_id);
 *
 * Supabase requirements:
 * - Table: public.marketplace_listings
 * - Columns recommended (this script can work if you only have some, but best if present):
 *   facebook_id (text), account_tag (text), title (text), price (numeric), currency (text),
 *   location (text), listing_url (text), photo_urls (jsonb/text), raw (jsonb/text),
 *   last_seen_at (timestamptz)
 *
 * Your Supabase:
 * - URL: https://sfheqjnxlkygjfohoybo.supabase.co
 * - Key: (eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaGVxam54bGt5Z2pmb2hveWJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzNTc3NjUsImV4cCI6MjA4MzkzMzc2NX0.oWEnB48w_k_hOtYM1Ls2AHj8j-THDs_43BBzXrqPyxY)
 */

(() => {
  "use strict";

  /**********************

   * 1) CONFIG — EDIT ME
   **********************/
  const SUPABASE_URL = "https://sfheqjnxlkygjfohoybo.supabase.co";
  const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_KEY_HERE"; // <-- required

  // Choose which FB account is currently logged in while importing:
  // You can also change it in the on-page UI dropdown.
  const DEFAULT_ACCOUNT_TAG = "CMFB"; // "MBFB" or "CMFB"

  // Table name (must exist)
  const TABLE = "marketplace_listings";

  // Upsert conflict target — note: we use resolution=ignore-duplicates to handle conflicts
  // The extension will check for duplicates client-side before sending to server

  // Import behavior
  const BATCH_SIZE = 25;
  const FLUSH_INTERVAL_MS = 2500;

  // Scrolling behavior (tuned for FB's lazy-loading)
  const SCROLL_STEP_PX = 1400;
  const SCROLL_JITTER_PX = 240;
  const MIN_DELAY_MS = 750;
  const MAX_DELAY_MS = 1700;

  // Stop conditions (time-based is more reliable than "empty rounds")
  const MAX_TOTAL_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes safety cap
  const NO_NEW_LISTINGS_GRACE_MS = 60 * 1000; // keep going up to 60s with no new IDs
  const NO_GROWTH_GRACE_MS = 75 * 1000; // keep going up to 75s with no scrollHeight growth

  // Diagnostics logging
  const DEBUG = true;

  /**********************/
  /* 2) INTERNAL STATE  */
  /**********************/
  const state = {
    running: false,
    accountTag: DEFAULT_ACCOUNT_TAG,

    // Listing identity set
    seenIds: new Set(), // `${accountTag}:${facebook_id}`
    pending: new Map(), // key -> normalized listing

    // Counters
    capturedCount: 0, // total normalized discoveries
    uniqueCount: 0, // unique keys
    savedCount: 0,
    saveErrors: 0,

    // Scrolling / stop logic
    startTs: 0,
    lastNewTs: 0,
    lastGrowthTs: 0,
    lastScrollHeight: 0,

    // For "No listings found" debugging
    lastGqlUrl: "",
    lastGqlAt: 0,
    gqlResponsesSeen: 0,
    gqlParsedOk: 0,
    gqlParsedFail: 0,

    flushTimer: null,
  };

  /**********************/
  /* 3) SMALL HELPERS   */
  /**********************/
  const log = (...args) => DEBUG && console.log("[CM Importer]", ...args);
  const warn = (...args) => console.warn("[CM Importer]", ...args);

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clampStr(v, maxLen) {
    if (typeof v !== "string") return v == null ? null : String(v);
    return v.length > maxLen ? v.slice(0, maxLen) : v;
  }

  function asNumber(v) {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function pickFirst(...vals) {
    for (const v of vals) {
      if (v === 0) return 0;
      if (v) return v;
    }
    return null;
  }

  function normalizePhotoUrls(x) {
    // Try to turn a bunch of possible FB shapes into an array of URL strings.
    const out = [];
    const pushUrl = (u) => {
      if (typeof u === "string" && u.startsWith("http")) out.push(u);
    };

    const walk = (v) => {
      if (!v) return;
      if (Array.isArray(v)) {
        for (const it of v) walk(it);
        return;
      }
      if (typeof v === "string") {
        pushUrl(v);
        return;
      }
      if (typeof v === "object") {
        // Common FB shapes: {uri, url, image, src, photo}
        pushUrl(v.uri);
        pushUrl(v.url);
        pushUrl(v.image);
        pushUrl(v.src);
        pushUrl(v.photo);
        // recurse into nested objects
        for (const key of Object.keys(v)) {
          walk(v[key]);
        }
      }
    };

    walk(x);
    return out;
  }

  /**********************/
  /* 4) SUPABASE CLIENT */
  /**********************/
  function supabaseRequest(method, path, body = null) {
    const url = `${SUPABASE_URL}${path}`;
    const headers = {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal,resolution=ignore-duplicates",
    };

    log(`Supabase ${method} ${path}`);

    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    })
      .then(async (res) => {
        if (!res.ok) {
          const txt = await res.text();
          warn(`Supabase error ${res.status}:`, txt);
          throw new Error(`Supabase ${res.status}: ${txt}`);
        }
        return res.json();
      });
  }

  async function upsertListings(listings) {
    if (listings.length === 0) return;

    log(`Upserting ${listings.length} listings...`);

    // Add account_tag and last_seen_at to all listings
    const enriched = listings.map((l) => ({
      ...l,
      account_tag: state.accountTag,
      last_seen_at: nowIso(),
    }));

    try {
      // Use resolution=ignore-duplicates to handle conflicts gracefully
      const result = await supabaseRequest("POST", `/rest/v1/${TABLE}`, enriched);
      log(`✓ Upserted ${listings.length} listings`);
      state.savedCount += listings.length;
      return result;
    } catch (err) {
      state.saveErrors++;
      warn("✗ Upsert failed:", err.message);
      throw err;
    }
  }

  /**********************/
  /* 5) GRAPHQL CAPTURE */
  /**********************/
  // We hook BOTH fetch and XHR to catch all GraphQL responses
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  function isGraphQLRequest(url) {
    if (!url) return false;
    return url.includes("/graphql") || url.includes("/api/graphql/");
  }

  // Deep scan for listing data in GraphQL response
  function scanGraphQLResponse(data) {
    if (!data || typeof data !== "object") return [];

    const listings = [];

    // Helper to extract from various FB response structures
    function scan(obj, depth = 0) {
      if (depth > 20) return; // prevent infinite recursion

      if (!obj || typeof obj !== "object") return;

      // Check if this looks like a listing
      if (obj.id && typeof obj.id === "string" && 
          (obj.listing_price || obj.price || obj.marketplace_listing)) {
        listings.push(obj);
        return;
      }

      // Recursively scan all properties
      for (const key of Object.keys(obj)) {
        // Skip known non-listing fields
        if (["__typename", "__module_operation", "extensions", "errors"].includes(key)) {
          continue;
        }
        scan(obj[key], depth + 1);
      }
    }

    // Handle different response shapes
    if (Array.isArray(data)) {
      data.forEach(item => scan(item));
    } else {
      scan(data);
    }

    return listings;
  }

  // Hook fetch
  window.fetch = function(...args) {
    const url = args[0];

    return originalFetch.apply(this, args).then(async (response) => {
      if (!state.running) return response;

      // Clone to read without affecting original
      const cloned = response.clone();

      if (isGraphQLRequest(url)) {
        state.lastGqlUrl = url;
        state.lastGqlAt = Date.now();
        state.gqlResponsesSeen++;

        try {
          const json = await cloned.json();
          const found = scanGraphQLResponse(json);
          
          if (found.length > 0) {
            state.gqlParsedOk++;
            log(`GraphQL fetch: captured ${found.length} listings`);
            found.forEach(l => processListing(l));
          } else {
            state.gqlParsedFail++;
            if (DEBUG && state.gqlResponsesSeen % 10 === 0) {
              log(`GraphQL fetch: no listings found in response (${state.gqlResponsesSeen} total)`);
            }
          }
        } catch (e) {
          if (DEBUG) log(`GraphQL fetch parse error:`, e);
        }
      }

      return response;
    });
  };

  // Hook XHR
  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    if (!state.running || !isGraphQLRequest(this._url)) {
      return originalXHRSend.apply(this, arguments);
    }

    this.addEventListener("load", function() {
      if (!state.running) return;

      state.lastGqlUrl = this._url;
      state.lastGqlAt = Date.now();
      state.gqlResponsesSeen++;

      try {
        const json = JSON.parse(this.responseText);
        const found = scanGraphQLResponse(json);
        
        if (found.length > 0) {
          state.gqlParsedOk++;
          log(`GraphQL XHR: captured ${found.length} listings`);
          found.forEach(l => processListing(l));
        } else {
          state.gqlParsedFail++;
          if (DEBUG && state.gqlResponsesSeen % 10 === 0) {
            log(`GraphQL XHR: no listings found in response (${state.gqlResponsesSeen} total)`);
          }
        }
      } catch (e) {
        if (DEBUG) log(`GraphQL XHR parse error:`, e);
      }
    });

    return originalXHRSend.apply(this, arguments);
  };

  /**********************/
  /* 6) LISTING PROCESSING */
  /**********************/
  function normalizeListing(raw) {
    // Extract facebook_id from various possible locations
    const facebook_id = raw.id || raw.listing_id || raw.marketplace_listing_id || "";
    if (!facebook_id) {
      warn("Listing without ID:", raw);
      return null;
    }

    // Extract title
    const title = pickFirst(
      raw.title,
      raw.name,
      raw.listing_title,
      raw.marketplace_listing_title
    );
    if (!title) {
      warn("Listing without title:", facebook_id);
      return null;
    }

    // Extract price
    let price = null;
    
    const priceObj = raw.listing_price || raw.price || raw.marketplace_listing_price;
    if (priceObj) {
      if (typeof priceObj === "object") {
        price = asNumber(priceObj.amount || priceObj.value);
      } else {
        price = asNumber(priceObj);
      }
    }

    // Extract description
    const description = pickFirst(
      raw.description,
      raw.listing_description,
      raw.marketplace_listing_description,
      raw.story,
      raw.message
    );

    // Extract condition
    const condition = pickFirst(
      raw.condition,
      raw.listing_condition,
      raw.marketplace_listing_condition
    );

    // Extract location
    const location = pickFirst(
      raw.location?.name,
      raw.location?.text,
      raw.marketplace_location?.name,
      raw.marketplace_location?.text,
      raw.seller_location?.name,
      raw.city
    );

    // Extract category
    const category = pickFirst(
      raw.category?.id,
      raw.category?.name,
      raw.marketplace_category?.id,
      raw.marketplace_category?.name
    );

    // Extract listing URL
    const listing_url = pickFirst(
      raw.url,
      raw.permalink_url,
      raw.share_url,
      raw.perma_link,
      raw.permalink
    );

    // Extract photos - store as JSON array in 'images' column
    const photos = normalizePhotoUrls(
      raw.primary_photo,
      raw.photos,
      raw.images,
      raw.attachments,
      raw.marketplace_listing_photos,
      raw.marketplace_listing_primary_photo
    );

    return {
      facebook_id: clampStr(facebook_id, 255),
      account_tag: state.accountTag,
      title: clampStr(title, 1000),
      description: description ? clampStr(description, 10000) : null,
      price: price,
      condition: condition ? clampStr(condition, 100) : null,
      location: location ? clampStr(location, 500) : null,
      category: category ? clampStr(category, 255) : null,
      listing_url: listing_url ? clampStr(listing_url, 2000) : null,
      images: photos.length > 0 ? photos : [],
      // Store raw data in description field if no description, or omit to save space
    };
  }

  function processListing(raw) {
    const normalized = normalizeListing(raw);
    if (!normalized) return;

    const key = `${state.accountTag}:${normalized.facebook_id}`;

    if (state.seenIds.has(key)) {
      // Already seen this listing
      return;
    }

    state.seenIds.add(key);
    state.pending.set(key, normalized);
    state.capturedCount++;
    state.uniqueCount++;
    state.lastNewTs = Date.now();

    log(`New listing: ${normalized.title} (${normalized.facebook_id})`);

    // Auto-flush if we have enough pending
    if (state.pending.size >= BATCH_SIZE) {
      flushPending();
    }
  }

  async function flushPending() {
    if (state.pending.size === 0) return;

    const listings = Array.from(state.pending.values());
    state.pending.clear();

    try {
      await upsertListings(listings);
    } catch (err) {
      warn("Failed to flush listings:", err);
    }
  }

  /**********************/
  /* 7) SCROLLING LOGIC */
  /**********************/
  async function scrollPage() {
    if (!state.running) return;

    const doc = document.documentElement;
    const currentScrollHeight = doc.scrollHeight;

    // Check if page grew
    if (currentScrollHeight > state.lastScrollHeight) {
      state.lastGrowthTs = Date.now();
      state.lastScrollHeight = currentScrollHeight;
      log(`Page grew to ${currentScrollHeight}px`);
    }

    // Calculate scroll position (add jitter to look natural)
    const step = SCROLL_STEP_PX + randInt(-SCROLL_JITTER_PX, SCROLL_JITTER_PX);
    const currentScroll = window.scrollY;
    const newScroll = currentScroll + step;

    // Scroll
    window.scrollTo({ top: newScroll, behavior: "smooth" });

    // Random delay
    const delay = randInt(MIN_DELAY_MS, MAX_DELAY_MS);
    await sleep(delay);

    // Check stop conditions
    const now = Date.now();
    const timeSinceNew = now - state.lastNewTs;
    const timeSinceGrowth = now - state.lastGrowthTs;
    const totalRuntime = now - state.startTs;

    // Stop if we've been running too long
    if (totalRuntime > MAX_TOTAL_RUNTIME_MS) {
      log("Max runtime reached, stopping");
      stop();
      return;
    }

    // Stop if no new listings for too long
    if (timeSinceNew > NO_NEW_LISTINGS_GRACE_MS) {
      log(`No new listings for ${timeSinceNew / 1000}s, stopping`);
      stop();
      return;
    }

    // Stop if no page growth for too long (but only if we've seen some listings)
    if (timeSinceGrowth > NO_GROWTH_GRACE_MS && state.uniqueCount > 0) {
      log(`No page growth for ${timeSinceGrowth / 1000}s, stopping`);
      stop();
      return;
    }

    // Continue scrolling
    if (state.running) {
      scrollPage();
    }
  }

  /**********************/
  /* 8) UI CONTROLS     */
  /**********************/
  function createUI() {
    // Remove existing UI if present
    const existing = document.getElementById("cm-importer-ui");
    if (existing) {
      existing.remove();
    }

    const container = document.createElement("div");
    container.id = "cm-importer-ui";
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      background: white;
      border: 2px solid #1877f2;
      border-radius: 8px;
      padding: 15px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      width: 300px;
    `;

    container.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 10px; color: #1877f2;">
        CrazyMoe FB Importer v1.3.0
      </div>
      
      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500;">
          Account:
        </label>
        <select id="cm-account-select" style="width: 100%; padding: 6px;">
          <option value="CMFB" ${state.accountTag === "CMFB" ? "selected" : ""}>
            CMFB
          </option>
          <option value="MBFB" ${state.accountTag === "MBFB" ? "selected" : ""}>
            MBFB
          </option>
        </select>
      </div>

      <div style="display: flex; gap: 8px; margin-bottom: 10px;">
        <button id="cm-start-btn" style="
          flex: 1;
          padding: 8px;
          background: #1877f2;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        ">
          Start Import
        </button>
        <button id="cm-stop-btn" style="
          flex: 1;
          padding: 8px;
          background: #dc3545;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        " disabled>
          Stop
        </button>
      </div>

      <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 12px;">
        <div style="margin-bottom: 4px;">
          <strong>Status:</strong> <span id="cm-status">Idle</span>
        </div>
        <div style="margin-bottom: 4px;">
          <strong>Unique:</strong> <span id="cm-unique">0</span>
        </div>
        <div style="margin-bottom: 4px;">
          <strong>Saved:</strong> <span id="cm-saved">0</span>
        </div>
        <div style="margin-bottom: 4px;">
          <strong>GraphQL:</strong> <span id="cm-gql">0/0</span>
        </div>
        <div style="margin-bottom: 4px;">
          <strong>Errors:</strong> <span id="cm-errors">0</span>
        </div>
      </div>

      <div style="margin-top: 10px; font-size: 11px; color: #666;">
        Last GraphQL: <span id="cm-last-gql">None</span>
      </div>
    `;

    document.body.appendChild(container);

    // Event listeners
    document.getElementById("cm-start-btn").addEventListener("click", start);
    document.getElementById("cm-stop-btn").addEventListener("click", stop);
    document.getElementById("cm-account-select").addEventListener("change", (e) => {
      state.accountTag = e.target.value;
      log(`Account tag changed to ${state.accountTag}`);
    });

    // Update UI periodically
    setInterval(updateUI, 500);
  }

  function updateUI() {
    document.getElementById("cm-status").textContent = state.running ? "Running" : "Idle";
    document.getElementById("cm-unique").textContent = state.uniqueCount;
    document.getElementById("cm-saved").textContent = state.savedCount;
    document.getElementById("cm-gql").textContent = `${state.gqlParsedOk}/${state.gqlResponsesSeen}`;
    document.getElementById("cm-errors").textContent = state.saveErrors;
    
    const lastGql = state.lastGqlAt > 0 ? `${Math.floor((Date.now() - state.lastGqlAt) / 1000)}s ago` : "None";
    document.getElementById("cm-last-gql").textContent = lastGql;

    const startBtn = document.getElementById("cm-start-btn");
    const stopBtn = document.getElementById("cm-stop-btn");
    
    if (startBtn) startBtn.disabled = state.running;
    if (stopBtn) stopBtn.disabled = !state.running;
  }

  /**********************/
  /* 9) MAIN CONTROL    */
  /**********************/
  function start() {
    if (state.running) {
      warn("Already running");
      return;
    }

    // Check for Supabase key
    if (SUPABASE_ANON_KEY === "PASTE_YOUR_SUPABASE_ANON_KEY_HERE") {
      alert("ERROR: You must edit content-importer.js and set SUPABASE_ANON_KEY!");
      return;
    }

    // Verify we're on a Marketplace page
    if (!location.href.includes("facebook.com/marketplace")) {
      alert("ERROR: Please navigate to a Facebook Marketplace page first!");
      return;
    }

    state.running = true;
    state.startTs = Date.now();
    state.lastNewTs = Date.now();
    state.lastGrowthTs = Date.now();
    state.lastScrollHeight = document.documentElement.scrollHeight;

    log("Starting import...");

    // Start periodic flush
    state.flushTimer = setInterval(() => {
      if (state.running) {
        flushPending();
      }
    }, FLUSH_INTERVAL_MS);

    // Start scrolling
    scrollPage();
  }

  function stop() {
    if (!state.running) return;

    log("Stopping import...");
    state.running = false;

    // Clear flush timer
    if (state.flushTimer) {
      clearInterval(state.flushTimer);
      state.flushTimer = null;
    }

    // Final flush
    flushPending().then(() => {
      log(`Import complete. Total: ${state.uniqueCount} unique, ${state.savedCount} saved, ${state.saveErrors} errors`);
      alert(`Import complete!\n\nUnique listings: ${state.uniqueCount}\nSaved to DB: ${state.savedCount}\nErrors: ${state.saveErrors}`);
    });
  }

  /**********************/
  /* 10) INITIALIZATION */
  /**********************/
  function init() {
    // Wait for page to load
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
      return;
    }

    log("CrazyMoe FB Importer initialized");
    createUI();
  }

  init();
})();
