import express from "express";
import cors from "cors";

const app = express();

const allowedOrigins = [
  "https://www.simoncurwood.com.au",
  "https://simon-curwood-jewellers.myshopify.com",
];

// Allow Shopify theme + editor to call the API
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // theme editor / server-side
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json({ limit: "1mb" }));

// Simple health check
app.get("/ping", (req, res) => {
  res.json({ ok: true });
});

// --- STUB ENDPOINTS ---
// These just return fake data so your UI works.
// Once this is all wired we can replace with real Nivoda + Shopify logic.

app.post("/diamonds", (req, res) => {
  const { shape, carat } = req.body || {};

  const items = [
    {
      id: "D1",
      priceCents: 500000, // $5,000
      certificate: {
        carats: 1.0,
        shape: shape || "Brilliant Round",
        color: "G",
        clarity: "VS1",
        cut: "Excellent",
        certNumber: "STUB-001",
      },
    },
    {
      id: "D2",
      priceCents: 750000, // $7,500
      certificate: {
        carats: 1.2,
        shape: shape || "Brilliant Round",
        color: "F",
        clarity: "VS1",
        cut: "Excellent",
        certNumber: "STUB-002",
      },
    },
    {
      id: "D3",
      priceCents: 1200000, // $12,000
      certificate: {
        carats: 1.5,
        shape: shape || "Brilliant Round",
        color: "E",
        clarity: "VVS2",
        cut: "Excellent",
        certNumber: "STUB-003",
      },
    },
  ];

  res.json({
    items,
    total: items.length,
    // echo back what the client asked for – just for debugging
    debug: { shape, carat },
  });
});

app.post("/checkout", (req, res) => {
  // In future: create draft order via Shopify Admin API using your shpat_ token
  // For now, just send them to the cart page as a placeholder.
  res.json({
    url: "https://www.simoncurwood.com.au/cart",
  });
});

// --- start server ---
const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Ring builder server listening on ${port}`);
});