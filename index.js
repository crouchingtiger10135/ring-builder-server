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

app.post("/diamonds", async (req, res) => {
  try {
    const { limit } = req.body || {};

    const query = {};

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
      return {
        id: d.id,
        priceCents: null,
        image: diamond.image || null,
        certificate: diamond.certificate || {}
      };
    });

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
