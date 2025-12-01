require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const NIVODA_ENDPOINT =
  process.env.NIVODA_ENDPOINT ||
  "https://intg-customer-staging.nivodaapi.net/api/diamonds";

const NIVODA_USERNAME = process.env.NIVODA_USERNAME || "";
const NIVODA_PASSWORD = process.env.NIVODA_PASSWORD || "";

// Minimal query: DiamondQuery + diamonds_by_query, only ask for id
const DIAMOND_QUERY = `
  query DiamondsByQuery($offset: Int, $limit: Int, $query: DiamondQuery) {
    diamonds_by_query(offset: $offset, limit: $limit, query: $query) {
      items {
        id
      }
    }
  }
`;

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
      Accept: "application/json",
      Authorization: authHeader
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

app.post("/diamonds", async (req, res) => {
  try {
    const { shape, carat, limit } = req.body || {};

    const cMin =
      carat && typeof carat.min === "number" ? Number(carat.min) : null;
    const cMax =
      carat && typeof carat.max === "number" ? Number(carat.max) : null;

    const query = {};

    if (shape) {
      query.shapes = [shape];
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

    const items = rawItems.map((d) => ({
      id: d.id,
      priceCents: null,
      image: null,
      certificate: {}
    }));

    const total = items.length;

    res.json({ items, total });
  } catch (err) {
    console.error("Error in /diamonds:", err.message);
    res.status(500).json({ error: "Could not load diamonds" });
  }
});

app.post("/checkout", async (req, res) => {
  try {
    const { baseVariantId } = req.body || {};

    if (!baseVariantId) {
      return res.status(400).json({ error: "Missing baseVariantId" });
    }

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
