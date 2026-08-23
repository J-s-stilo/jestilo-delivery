const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const PASSWORD = process.env.ADMIN_PASSWORD;

if (!PASSWORD) {
  console.error("ADMIN_PASSWORD is not set.");
  process.exit(1);
}

const shipments = new Map();
const sessions = new Map();

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");

  if (!sessions.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

app.post("/api/admin/login", (req, res) => {
  if (req.body.password !== PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now());

  res.json({ token });
});

app.get("/api/shipments/:code", (req, res) => {
  const code = req.params.code.toUpperCase();
  const shipment = shipments.get(code);

  if (!shipment) {
    return res.sendStatus(404);
  }

  res.json(shipment);
});

app.get("/api/admin/shipments", auth, (req, res) => {
  res.json([...shipments.values()]);
});

app.post("/api/admin/shipments", auth, (req, res) => {
  const data = req.body || {};
  const code = String(data.code || "").trim().toUpperCase();

  if (!code) {
    return res.status(400).json({
      error: "Tracking number required"
    });
  }

  const shipment = {
    code,
    customer: String(data.customer || ""),
    status: String(data.status || "Order received"),
    location: String(data.location || ""),
    note: String(data.note || ""),
    updated: new Date().toLocaleString()
  };

  shipments.set(code, shipment);

  res.json(shipment);
});

app.delete("/api/admin/shipments/:code", auth, (req, res) => {
  shipments.delete(req.params.code.toUpperCase());
  res.sendStatus(204);
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.listen(process.env.PORT || 3000, () => {
  console.log("JESTILO Delivery Service is running");
});
