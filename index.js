require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Nivoda credentials + endpoint
const NIVODA_ENDPOINT =
  process.env.NIVODA_ENDPOINT ||
  "https://intg-customer-staging.nivodaapi.net/api/diamonds";

const NIVODA_USERNAME = process.env.NIVODA_USERNAME || "";
const NIVODA_PASSWORD = process.env.NIVODA_PASSWORD || "";

// GraphQL query – this is the part that must match Nivoda's schema.
const DIAMOND_QUERY = `
  query DiamondSearch($params: DiamondParams) {
    diamondList(params: $params) {
      items {
        id
        price
        imageUrl
        certificate {
          carats
          shape
          color
          clarity
          cut
          certNumber
        }
      }
      total
    }
  }
`;

// Utility to call Nivoda
async function callNivoda(query, variables) {
  if (!NIVODA_USERNAME || !NIVODA_PASSWORD) {
    throw new Error("Missing NIVODA_USERNAME or NIVODA_PASSWORD");
  }

  const authHeader =
    "Basic " +
    Buffer.from(`${NIVODA_USERNAME}:${NIVODA_PASSWORD}`).toString("base64");

  const resp = await fetch(NIVODA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await resp.json();

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

/**
 * POST /diamonds
 * Body shape (from Shopify JS):
 * {
 *   shape: "Brilliant Round",
 *   carat: { min: 0.45, max: 0.55 },
 *   sort: "RELEVANCE" | "PRICE_ASC" | "PRICE_DESC" | "CARAT_DESC",
 *   limit: 50
 * }
 */
app.post("/diamonds", async (req, res) => {
  try {
    const { shape, carat, sort, limit } = req.body || {};

    // ⚠️ IMPORTANT:
    // The structure of `params` MUST match Nivoda's DiamondParams type.
    // Open the GraphiQL explorer at:
    //   https://intg-customer-staging.nivodaapi.net/api/diamonds-graphiql
    // and adjust the fields below (carats, shape, sort, etc.) to match.
    const params = {
      // Commonly you'll have fields like:
      // shapes: [ "ROUND" ] or shape: "ROUND"
      shape,
      // or sometimes caratsFrom / caratsTo, or caratFrom / caratTo:
      caratsFrom: carat?.min ?? null,
      caratsTo: carat?.max ?? null,
      // A simple example sort (you may need to adjust name / enum):
      orderBy: sort || "RELEVANCE",
      // Limit / pagination:
      first: limit || 50
    };

    const data = await callNivoda(DIAMOND_QUERY, { params });

    // Normalise to { items, total } for the Shopify frontend
    const list = data?.diamondList || { items: [], total: 0 };

    res.json({
      items: list.items || [],
      total: list.total || 0
    });
  } catch (err) {
    console.error("Error in /diamonds:", err.message);
    res.status(500).json({ error: "Could not load diamonds" });
  }
});

/**
 * POST /checkout
 * Body shape (from Shopify JS):
 * {
 *   baseVariantId: "1234567890",
 *   ringConfig: { ... },
 *   diamond: { ... }
 * }
 *
 * For now, just send them to the Shopify cart with the selected base variant.
 * You can extend this later to create a draft order or encode more info.
 */
app.post("/checkout", async (req, res) => {
  try {
    const { baseVariantId } = req.body || {};

    if (!baseVariantId) {
      return res.status(400).json({ error: "Missing baseVariantId" });
    }

    // Simple cart URL: /cart/{variant_id}:1
    const url = `/cart/${baseVariantId}:1`;

    res.json({ url });
  } catch (err) {
    console.error("Error in /checkout:", err.message);
    res.status(500).json({ error: "Checkout error" });
  }
});

app.get("/", (req, res) => {
  res.send("Plattar Ring Builder server is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});