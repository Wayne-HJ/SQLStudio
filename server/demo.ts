import type { Database } from "sql.js";
export function seedDemo(db: Database) {
  db.run(`CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, company TEXT, status TEXT NOT NULL DEFAULT 'active', plan TEXT NOT NULL DEFAULT 'Pro', country TEXT, created_at TEXT NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price DECIMAL(10,2) NOT NULL, category TEXT, stock INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), total DECIMAL(10,2) NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price DECIMAL(10,2) NOT NULL);
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), amount DECIMAL(10,2) NOT NULL, method TEXT NOT NULL, paid_at TEXT);
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL, email TEXT NOT NULL);
    CREATE VIEW customer_summary AS SELECT c.id, c.name, c.company, COUNT(o.id) AS order_count, COALESCE(SUM(o.total), 0) AS total_spent FROM customers c LEFT JOIN orders o ON c.id=o.customer_id GROUP BY c.id;
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_customers_status ON customers(status);`);
  const people = [
    ["Olivia Chen", "olivia.chen", "Linear", "active", "Pro", "United States"],
    [
      "James Wilson",
      "james.w",
      "Vercel",
      "active",
      "Enterprise",
      "United Kingdom",
    ],
    ["Sophia Wang", "sophia.wang", "Notion", "active", "Pro", "Singapore"],
    ["Noah Kim", "noah.kim", "Figma", "active", "Enterprise", "South Korea"],
    ["Emma Davis", "emma.d", "Stripe", "inactive", "Starter", "United States"],
    ["Liam Zhang", "liam.zhang", "Arc", "active", "Pro", "China"],
    ["Ava Martinez", "ava.m", "Framer", "active", "Pro", "Spain"],
    ["Ethan Lee", "ethan.lee", "Raycast", "pending", "Starter", "Australia"],
    [
      "Isabella Brown",
      "isabella.b",
      "Webflow",
      "active",
      "Enterprise",
      "Canada",
    ],
    ["Lucas Taylor", "lucas.t", "Supabase", "active", "Pro", "Germany"],
    ["Mia Anderson", "mia.a", "Loom", "inactive", "Starter", "United States"],
    ["Benjamin Liu", "ben.liu", "Slack", "active", "Enterprise", "China"],
    ["Charlotte White", "charlotte.w", "Read.cv", "active", "Pro", "France"],
    ["Henry Park", "henry.p", "GitHub", "pending", "Starter", "Japan"],
    ["Amelia Lewis", "amelia.l", "Dropbox", "active", "Pro", "Australia"],
    ["Daniel Moore", "daniel.m", "Intercom", "active", "Enterprise", "Ireland"],
  ];
  const stmt = db.prepare(
    "INSERT INTO customers (name,email,company,status,plan,country,created_at) VALUES (?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 128; i++) {
    const p = people[i % people.length];
    stmt.run([
      p[0] + (i >= 16 ? ` ${Math.floor(i / 16) + 1}` : ""),
      `${p[1]}${i >= 16 ? i : ""}@${p[2].toLowerCase().replace(".", "")}.com`,
      p[2],
      p[3],
      p[4],
      p[5],
      `2026-09-${String(1 + (i % 28)).padStart(2, "0")} 09:${String(i % 60).padStart(2, "0")}:00`,
    ]);
  }
  stmt.free();
  for (let i = 1; i <= 12; i++)
    db.run(
      "INSERT INTO products (name,price,category,stock) VALUES (?,?,?,?)",
      [
        ["Studio keyboard", "Wireless mouse", "USB-C dock", "4K monitor"][
          i % 4
        ],
        49 + i * 20,
        ["Accessories", "Hardware"][i % 2],
        20 + i * 4,
      ],
    );
  for (let i = 1; i <= 96; i++) {
    db.run(
      "INSERT INTO orders (customer_id,total,status,created_at) VALUES (?,?,?,?)",
      [
        1 + (i % 128),
        49 + i * 7,
        ["completed", "processing", "completed", "cancelled"][i % 4],
        `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`,
      ],
    );
    db.run(
      "INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)",
      [i, 1 + (i % 12), 1 + (i % 3), 49 + i * 7],
    );
    db.run(
      "INSERT INTO payments (order_id,amount,method,paid_at) VALUES (?,?,?,?)",
      [i, 49 + i * 7, ["card", "bank_transfer"][i % 2], "2026-09-28"],
    );
  }
  db.run(
    "INSERT INTO categories (name,description) VALUES ('Hardware','Workspace essentials'),('Accessories','Made for your desk'); INSERT INTO team_members (name,role,email) VALUES ('Alex Morgan','Admin','alex@sqlstudio.dev'),('Sarah Chen','Developer','sarah@sqlstudio.dev');",
  );
}
