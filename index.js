require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Nivoda config (set these in Railway env)
const NIVODA_GRAPHQL_URL =
  process.env.NIVODA_GRAPHQL_URL ||
  "https://intg-customer-staging.nivodaapi.net/api/diamonds";

const NIVODA_USER = process.env.NIVODA_USER || "testaccount@sample.com";
const NIVODA_PASS = process.env.NIVODA_PASS || "staging-nivoda-22";

function nivodaAuthHeader() {
  const token = Buffer.from(`${NIVODA_USER}:${NIVODA_PASS}`).toString("base64");
  return `Basic ${token}`;
}

const DIAMOND_SEARCH_QUERY = `
  query Diamonds($filters: DiamondSearchInput, $sort: DiamondSortInput, $first: Int) {
    diamonds(filters: $filters, sort: $sort, first: $first) {
      totalCount
      edges {
        node {
          id
          stockId
          shape
          color
          clarity
          carat
          price
          cut
          certificate {
            certNumber
          }
          images {
            url
          }
        }
      }
    }
  }
`;

function mapDiamond(node) {
  const firstImage =
    node.images && node.images.length ? node.images[0].url : null;

  return {
    id: node.id || node.stockId,
    priceCents:
      typeof node.price === "number" ? Math.round(node.price * 100) : null,
    certificate: {
      carats: node.carat,
      shape: node.shape,
      color: node.color,
      clarity: node.clarity,
      cut: node.cut || null,
      certNumber: node.certificate && node.certificate.certNumber
    },
    imageUrl: firstImage
  };
}

function mapSort(sortKey) {
  switch (sortKey) {
    case "PRICE_ASC":
      return { field: "PRICE", direction: "ASC" };
    case "PRICE_DESC":
      return { field: "PRICE", direction: "DESC" };
    case "CARAT_ASC":
      return { field: "CARAT", direction: "ASC" };
    case "CARAT_DESC":
      return { field: "CARAT", direction: "DESC" };
    case "RELEVANCE":
    default:
      return null;
  }
}

app.post("/diamonds", async (req, res) => {
  try {
    const { shape, carat, sort, limit } = req.body || {};

    const filters = {};
    if (shape) filters.shape = [shape];
    if (carat && carat.min && carat.max) {
      filters.carat = { from: carat.min, to: carat.max };
    }

    const sortInput = mapSort(sort);
    const variables = {
      filters,
      sort: sortInput,
      first: limit || 50
    };

    const gqlRes = await fetch(NIVODA_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: nivodaAuthHeader()
      },
      body: JSON.stringify({
        query: DIAMOND_SEARCH_QUERY,
        variables
      })
    });

    if (!gqlRes.ok) {
      const text = await gqlRes.text();
      console.error("Nivoda error:", gqlRes.status, text);
      return res.status(500).json({ error: "Nivoda request failed" });
    }

    const payload = await gqlRes.json();
    const edges =
      payload &&
      payload.data &&
      payload.data.diamonds &&
      payload.data.diamonds.edges
        ? payload.data.diamonds.edges
        : [];

    const items = edges.map((edge) => mapDiamond(edge.node));
    const total =
      payload &&
      payload.data &&
      payload.data.diamonds &&
      payload.data.diamonds.totalCount
        ? payload.data.diamonds.totalCount
        : items.length;

    res.json({ items, total });
  } catch (err) {
    console.error("Diamonds route error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Very simple checkout: redirects to cart with product + attributes
// You can enhance this later with Admin API if needed.
app.post("/checkout", async (req, res) => {
  try {
    const { baseVariantId, ringConfig, diamond } = req.body || {};
    if (!baseVariantId) {
      return res.status(400).json({ error: "Missing baseVariantId" });
    }

    const storeDomain =
      process.env.STORE_DOMAIN || "https://simoncurwood.com.au";

    const params = new URLSearchParams();
    params.append("id", String(baseVariantId));
    params.append("quantity", "1");

    if (ringConfig) {
      params.append("properties[Setting style]", ringConfig.settingStyle || "");
      params.append("properties[Stone shape]", ringConfig.stone || "");
      params.append("properties[Carat]", ringConfig.carat || "");
      params.append("properties[Metal]", ringConfig.metal || "");
      params.append("properties[Ring size]", ringConfig.size || "");
    }

    if (diamond && diamond.certificate) {
      const cert = diamond.certificate;
      if (cert.carats)
        params.append("properties[Diamond carat]", String(cert.carats));
      if (cert.shape)
        params.append("properties[Diamond shape]", String(cert.shape));
      if (cert.color)
        params.append("properties[Diamond colour]", String(cert.color));
      if (cert.clarity)
        params.append("properties[Diamond clarity]", String(cert.clarity));
      if (cert.certNumber)
        params.append("properties[Certificate]", String(cert.certNumber));
    }

    const url = `${storeDomain}/cart/add?${params.toString()}`;

    res.json({ url });
  } catch (err) {
    console.error("Checkout route error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.send("Ring builder server is running");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});