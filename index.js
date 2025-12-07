require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------------------
// Nivoda config (unchanged)
// --------------------- //

const NIVODA_ENDPOINT =
  process.env.NIVODA_ENDPOINT ||
  "https://intg-customer-staging.nivodaapi.net/api/diamonds";

const NIVODA_USERNAME = process.env.NIVODA_USERNAME || "";
const NIVODA_PASSWORD = process.env.NIVODA_PASSWORD || "";

const AUTH_QUERY = `
  query Auth($username: String!, $password: String!) {
    authenticate {
      username_and_password(username: $username, password: $password) {
        token
      }
    }
  }
`;

const DIAMOND_QUERY = `
  query DiamondsByQuery($offset: Int, $limit: Int, $query: DiamondQuery) {
    diamonds_by_query(offset: $offset, limit: $limit, query: $query) {
      items {
        id
        price
        diamond {
          image
          certificate {
            carats
            shape
            color
            clarity
            cut
            certNumber
          }
        }
      }
    }
  }
`;

let cachedToken = null;
let cachedTokenExpiry = 0;
const TOKEN_TTL_MS = 5.5 * 60 * 60 * 1000;

// map UI labels -> Nivoda shapes
const SHAPE_MAP = {
  "Brilliant Round": "ROUND",
  Asscher: "ASSCHER",
  Baguette: "BAGUETTE",
  Cushion: "CUSHION",
  Emerald: "EMERALD",
  Heart: "HEART",
  Marquise: "MARQUISE",
  Oval: "OVAL",
  Pear: "PEAR",
  Princess: "PRINCESS",
  Radiant: "RADIANT"
};

async function getNivodaToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  if (!NIVODA_USERNAME || !NIVODA_PASSWORD) {
    throw new Error("Missing NIVODA_USERNAME or NIVODA_PASSWORD");
  }

  const resp = await fetch(NIVODA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      query: AUTH_QUERY,
      variables: {
        username: NIVODA_USERNAME,
        password: NIVODA_PASSWORD
      }
    })
  });

  const json = await resp.json().catch(() => ({}));

  if (!resp.ok || json.errors) {
    console.error("Nivoda auth error:", resp.status, JSON.stringify(json));
    throw new Error(
      `Nivoda auth error: ${resp.status} ${
        json.errors ? JSON.stringify(json.errors) : ""
      }`
    );
  }

  const token =
    json &&
    json.data &&
    json.data.authenticate &&
    json.data.authenticate.username_and_password &&
    json.data.authenticate.username_and_password.token;

  if (!token) {
    throw new Error("Nivoda auth error: no token in response");
  }

  cachedToken = token;
  cachedTokenExpiry = Date.now() + TOKEN_TTL_MS;

  return token;
}

async function callNivoda(query, variables) {
  const token = await getNivodaToken();

  const resp = await fetch(NIVODA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await resp.json().catch(() => ({}));

  if (!resp.ok || json.errors) {
    console.error("Nivoda error:", resp.status, JSON.stringify(json));
    throw new Error(
      `Nivoda error: ${resp.status} ${
        json.errors ? JSON.stringify(json.errors) : ""
      }`
    );
  }

  return json.data;
}

// ---------------------
// Shopify config (your env names)
// --------------------- //

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // e.g. "simon-curwood-jewellers.myshopify.com"
const SHOPIFY_ADMIN_ACCESS_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
const SHOPIFY_APP_PROXY_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET || ""; // not used yet, but fine to keep
const DIAMOND_PRODUCT_ID = process.env.DIAMOND_PRODUCT_ID; // numeric id of your hidden "Custom Nivoda Diamond" product

if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
  console.warn(
    "[RingBuilder] WARNING: SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN not set. /checkout will fall back to simple cart URL."
  );
}

// small helper to call Shopify Admin REST
async function shopifyRequest(path, method = "GET", body) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error("Shopify Admin API not configured");
  }

  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error("Shopify API error:", resp.status, text);
    throw new Error(`Shopify ${method} ${path} failed: ${resp.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

// Create a one-off diamond variant on the hidden product
async function createDiamondVariant(diamond, diamondPriceCents) {
  if (!DIAMOND_PRODUCT_ID) {
    throw new Error("Missing DIAMOND_PRODUCT_ID env var");
  }

  const cert = (diamond && diamond.certificate) || {};

  const titleBits = [];
  if (cert.carats) titleBits.push(`${cert.carats}ct`);
  if (cert.shape) titleBits.push(cert.shape);
  const title = titleBits.length ? `Diamond ${titleBits.join(" ")}` : "Diamond";

  const sku = cert.certNumber || (diamond && diamond.id && `NIV-${diamond.id}`);

  const variantPayload = {
    variant: {
      product_id: Number(DIAMOND_PRODUCT_ID),
      title,
      price: (Number(diamondPriceCents || 0) / 100).toFixed(2),
      sku: sku || undefined,
      inventory_management: "not_managed",
      taxable: true
    }
  };

  const resp = await shopifyRequest("/variants.json", "POST", variantPayload);
  if (!resp || !resp.variant || !resp.variant.id) {
    throw new Error("Failed to create diamond variant");
  }

  console.log("[RingBuilder] Created diamond variant", resp.variant.id);
  return resp.variant.id;
}

// Create a checkout with given line_items
async function createCheckout(lineItems) {
  const resp = await shopifyRequest("/checkouts.json", "POST", {
    checkout: { line_items: lineItems }
  });

  const url = resp && resp.checkout && resp.checkout.web_url;
  if (!url) {
    throw new Error("Shopify checkout response missing web_url");
  }

  console.log("[RingBuilder] Created checkout", url);
  return url;
}

// ---------------------
// Nivoda diamonds endpoint (unchanged)
// --------------------- //

app.post("/diamonds", async (req, res) => {
  try {
    const { shape, carat, limit } = req.body || {};

    const cMin =
      carat && typeof carat.min === "number" ? Number(carat.min) : null;
    const cMax =
      carat && typeof carat.max === "number" ? Number(carat.max) : null;

    const query = {
      search_on_markup_price: true
    };

    const mappedShape = shape && SHAPE_MAP[shape] ? SHAPE_MAP[shape] : null;
    if (mappedShape) {
      query.shapes = [mappedShape];
    }

    if (cMin !== null || cMax !== null) {
      query.sizes = [
        {
          from: cMin,
          to: cMax
        }
      ];
    }

    const variables = {
      offset: 0,
      limit: limit || 24,
      query
    };

    const data = await callNivoda(DIAMOND_QUERY, variables);

    const result = data && data.diamonds_by_query;
    const rawItems = Array.isArray(result?.items) ? result.items : [];

    const items = rawItems.map((d) => {
      const diamond = d.diamond || {};
      const cert = diamond.certificate || {};
      const priceRaw = d.price;
      const priceCents =
        typeof priceRaw === "number"
          ? Math.round(priceRaw * 100)
          : priceRaw
          ? Math.round(Number(priceRaw) * 100)
          : null;

      return {
        id: d.id,
        priceCents,
        image: diamond.image || null,
        certificate: {
          carats: cert.carats || null,
          shape: cert.shape || null,
          color: cert.color || null,
          clarity: cert.clarity || null,
          cut: cert.cut || null,
          certNumber: cert.certNumber || null
        }
      };
    });

    const total = items.length;

    res.json({ items, total });
  } catch (err) {
    console.error("Error in /diamonds:", err.message);
    res.status(500).json({ error: "Could not load diamonds" });
  }
});

// ---------------------
// NEW checkout endpoint (matches theme payload)
// --------------------- //

app.post("/checkout", async (req, res) => {
  try {
    const {
      ringVariantId,
      quantity = 1,
      ringConfig,
      diamond,
      diamondPriceCents = 0,
      lineItemProperties = {}
    } = req.body || {};

    if (!ringVariantId) {
      return res.status(400).json({ error: "Missing ringVariantId" });
    }

    // If Shopify isn't configured yet, fall back to simple cart URL
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      console.warn(
        "[RingBuilder] Shopify env missing, falling back to cart URL"
      );
      const fallbackUrl = `/cart/${ringVariantId}:${quantity}`;
      return res.json({ cartUrl: fallbackUrl });
    }

    // Build line_items starting with the ring
    const lineItems = [
      {
        variant_id: Number(ringVariantId),
        quantity: Number(quantity) || 1,
        properties: lineItemProperties
      }
    ];

    // If we have a diamond and a price, create a diamond variant + add as second line item
    if (diamond && diamondPriceCents > 0) {
      const diamondVariantId = await createDiamondVariant(
        diamond,
        diamondPriceCents
      );

      lineItems.push({
        variant_id: Number(diamondVariantId),
        quantity: 1,
        properties: {
          Diamond: JSON.stringify(diamond),
          "Diamond price (cents)": String(diamondPriceCents)
        }
      });
    }

    const checkoutUrl = await createCheckout(lineItems);
    return res.json({ checkoutUrl });
  } catch (err) {
    console.error("Error in /checkout:", err.message, err.stack);
    res.status(500).json({ error: "Checkout error" });
  }
});

// ---------------------
// Healthcheck
// --------------------- //

app.get("/", (req, res) => {
  res.send("Plattar Ring Builder server is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
