const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PASSWORD = process.env.ADMIN_PASSWORD;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!PASSWORD) {
  console.error("ADMIN_PASSWORD is not set.");
  process.exit(1);
}

const sessions = new Set();

async function setupDatabase() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      code TEXT PRIMARY KEY,
      customer TEXT DEFAULT '',
      email TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      item_name TEXT DEFAULT '',
      item_description TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      origin TEXT DEFAULT '',
      destination TEXT DEFAULT '',
      status TEXT DEFAULT 'Order received',
      location TEXT DEFAULT '',
      estimated_delivery TEXT DEFAULT '',
      note TEXT DEFAULT '',
      updated TEXT NOT NULL
    )
  `);

  const columns = [
    ["customer", "TEXT DEFAULT ''"],
    ["email", "TEXT DEFAULT ''"],
    ["whatsapp", "TEXT DEFAULT ''"],
    ["item_name", "TEXT DEFAULT ''"],
    ["item_description", "TEXT DEFAULT ''"],
    ["image_url", "TEXT DEFAULT ''"],
    ["origin", "TEXT DEFAULT ''"],
    ["destination", "TEXT DEFAULT ''"],
    ["status", "TEXT DEFAULT 'Order received'"],
    ["location", "TEXT DEFAULT ''"],
    ["estimated_delivery", "TEXT DEFAULT ''"],
    ["note", "TEXT DEFAULT ''"],
    ["updated", "TEXT"]
  ];

  for (const [name, definition] of columns) {
    await pool.query(`
      ALTER TABLE shipments
      ADD COLUMN IF NOT EXISTS ${name} ${definition}
    `);
  }

  console.log("Database ready.");
}


async function sendShipmentEmail(shipment) {

  if (!RESEND_API_KEY || !shipment.email) {
    return;
  }

  try {

    const response = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          from:
            "JESTILO Delivery Service <onboarding@resend.dev>",

          to: [shipment.email],

          subject:
            `Shipment update - ${shipment.code}`,

          html: `

            <h2>JESTILO Delivery Service</h2>

            <p>
              Hello ${escapeHtml(
                shipment.customer || "Customer"
              )},
            </p>

            <p>
              Your shipment information has been updated.
            </p>

            <p>
              <strong>Tracking:</strong>
              ${escapeHtml(shipment.code)}
            </p>

            ${
              shipment.item_name
              ? `
                <p>
                  <strong>Item:</strong>
                  ${escapeHtml(shipment.item_name)}
                </p>
              `
              : ""
            }

            <p>
              <strong>Status:</strong>
              ${escapeHtml(shipment.status)}
            </p>

            ${
              shipment.origin
              ? `
                <p>
                  <strong>Origin:</strong>
                  ${escapeHtml(shipment.origin)}
                </p>
              `
              : ""
            }

            ${
              shipment.destination
              ? `
                <p>
                  <strong>Destination:</strong>
                  ${escapeHtml(shipment.destination)}
                </p>
              `
              : ""
            }

            ${
              shipment.location
              ? `
                <p>
                  <strong>Current location:</strong>
                  ${escapeHtml(shipment.location)}
                </p>
              `
              : ""
            }

            ${
              shipment.estimated_delivery
              ? `
                <p>
                  <strong>Estimated delivery:</strong>
                  ${escapeHtml(
                    shipment.estimated_delivery
                  )}
                </p>
              `
              : ""
            }

            ${
              shipment.note
              ? `
                <p>
                  <strong>Update:</strong>
                  ${escapeHtml(shipment.note)}
                </p>
              `
              : ""
            }

            <p>
              Please use your tracking number on the
              JESTILO Delivery Service website to view
              the latest available shipment information.
            </p>

          `
        })
      }
    );


    if (!response.ok) {

      const errorText =
        await response.text();

      console.error(
        "Resend email failed:",
        errorText
      );

      return;
    }

    console.log(
      "Shipment notification email sent."
    );

  } catch (error) {

    console.error(
      "Email notification error:",
      error
    );
  }
}


function escapeHtml(value) {

  return String(value || "").replace(
    /[&<>"']/g,

    m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m])
  );
}


function auth(req, res, next) {

  const token =
    (req.headers.authorization || "")
      .replace("Bearer ", "");

  if (!sessions.has(token)) {

    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}


app.post(
  "/api/admin/login",
  (req, res) => {

    if (req.body.password !== PASSWORD) {

      return res.status(401).json({
        error: "Invalid password"
      });
    }

    const token =
      crypto.randomBytes(32).toString("hex");

    sessions.add(token);

    res.json({ token });
  }
);


app.get(
  "/api/shipments/:code",
  async (req, res) => {

    try {

      const code =
        req.params.code.toUpperCase();

      const result =
        await pool.query(
          "SELECT * FROM shipments WHERE code = $1",
          [code]
        );

      if (result.rows.length === 0) {

        return res.sendStatus(404);
      }

      res.json(result.rows[0]);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Server error"
      });
    }
  }
);


app.get(
  "/api/admin/shipments",
  auth,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          "SELECT * FROM shipments ORDER BY updated DESC"
        );

      res.json(result.rows);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error: "Server error"
      });
    }
  }
);


app.post(
  "/api/admin/shipments",
  auth,
  async (req, res) => {

    try {

      const data =
        req.body || {};

      const code =
        String(data.code || "")
          .trim()
          .toUpperCase();


      if (!code) {

        return res.status(400).json({
          error: "Tracking number required"
        });
      }


      const shipment = {

        code,

        customer:
          String(data.customer || ""),

        email:
          String(data.email || "").trim(),

        whatsapp:
          String(data.whatsapp || "").trim(),

        item_name:
          String(data.item_name || "").trim(),

        item_description:
          String(data.item_description || "").trim(),

        image_url:
          String(data.image_url || "").trim(),

        origin:
          String(data.origin || "").trim(),

        destination:
          String(data.destination || "").trim(),

        status:
          String(
            data.status ||
            "Order received"
          ),

        location:
          String(data.location || "").trim(),

        estimated_delivery:
          String(
            data.estimated_delivery || ""
          ).trim(),

        note:
          String(data.note || "").trim(),

        updated:
          new Date().toISOString()
      };


      await pool.query(

        `
        INSERT INTO shipments
        (
          code,
          customer,
          email,
          whatsapp,
          item_name,
          item_description,
          image_url,
          origin,
          destination,
          status,
          location,
          estimated_delivery,
          note,
          updated
        )

        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13,$14
        )

        ON CONFLICT (code)

        DO UPDATE SET

          customer =
            EXCLUDED.customer,

          email =
            EXCLUDED.email,

          whatsapp =
            EXCLUDED.whatsapp,

          item_name =
            EXCLUDED.item_name,

          item_description =
            EXCLUDED.item_description,

          image_url =
            EXCLUDED.image_url,

          origin =
            EXCLUDED.origin,

          destination =
            EXCLUDED.destination,

          status =
            EXCLUDED.status,

          location =
            EXCLUDED.location,

          estimated_delivery =
            EXCLUDED.estimated_delivery,

          note =
            EXCLUDED.note,

          updated =
            EXCLUDED.updated
        `,

        [
          shipment.code,
          shipment.customer,
          shipment.email,
          shipment.whatsapp,
          shipment.item_name,
          shipment.item_description,
          shipment.image_url,
          shipment.origin,
          shipment.destination,
          shipment.status,
          shipment.location,
          shipment.estimated_delivery,
          shipment.note,
          shipment.updated
        ]
      );


      await sendShipmentEmail(
        shipment
      );


      res.json(shipment);


    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not save shipment"
      });
    }
  }
);


app.delete(
  "/api/admin/shipments/:code",
  auth,
  async (req, res) => {

    try {

      await pool.query(
        "DELETE FROM shipments WHERE code = $1",
        [req.params.code.toUpperCase()]
      );

      res.sendStatus(204);

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not delete shipment"
      });
    }
  }
);


app.get(
  "/admin",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "admin.html"
      )
    );
  }
);


const port =
  process.env.PORT || 3000;


setupDatabase()

  .then(() => {

    app.listen(
      port,
      () => {

        console.log(
          `JESTILO Delivery Service running on port ${port}`
        );

      }
    );

  })

  .catch(error => {

    console.error(
      "Database setup failed:",
      error
    );

    process.exit(1);
  });
