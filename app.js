require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 80;

const {
  DB_HOST,
  DB_PORT = 3306,
  DB_NAME = "hospital_booking",
  DB_USER,
  DB_PASSWORD,
  SESSION_SECRET = "lab-secret",
  ADMIN_USERNAME = "admin",
  ADMIN_PASSWORD = "Admin@123456"
} = process.env;

let pool;

async function initDb() {
  pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS appointments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      contact VARCHAR(100) NOT NULL,
      doctor_or_department VARCHAR(200) NOT NULL,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await pool.query(createTableSql);
  console.log("Database connected and table ready.");
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect("/admin-login");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use("/public", express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60
    }
  })
);

app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

app.get("/", (req, res) => {
  const success = req.query.success || "";
  res.render("index", { success });
});

app.get("/book", (req, res) => {
  res.render("book", {
    error: "",
    formData: {}
  });
});

app.post("/book", async (req, res) => {
  const {
    full_name,
    contact,
    doctor_or_department,
    appointment_date,
    appointment_time,
    note
  } = req.body;

  const formData = {
    full_name,
    contact,
    doctor_or_department,
    appointment_date,
    appointment_time,
    note
  };

  if (
    !full_name ||
    !contact ||
    !doctor_or_department ||
    !appointment_date ||
    !appointment_time
  ) {
    return res.status(400).render("book", {
      error: "Vui lòng nhập đầy đủ các trường bắt buộc.",
      formData
    });
  }

  try {
    const sql = `
      INSERT INTO appointments
      (full_name, contact, doctor_or_department, appointment_date, appointment_time, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await pool.execute(sql, [
      full_name,
      contact,
      doctor_or_department,
      appointment_date,
      appointment_time,
      note || null
    ]);

    return res.redirect("/?success=Đặt lịch thành công");
  } catch (error) {
    console.error("Insert appointment error:", error);
    return res.status(500).render("book", {
      error: "Không thể lưu lịch hẹn. Vui lòng thử lại.",
      formData
    });
  }
});

app.get("/admin-login", (req, res) => {
  res.render("admin-login", { error: "" });
});

app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect("/appointments");
  }

  return res.status(401).render("admin-login", {
    error: "Sai tài khoản hoặc mật khẩu quản trị."
  });
});

app.get("/appointments", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, full_name, contact, doctor_or_department,
             appointment_date, appointment_time, note, created_at
      FROM appointments
      ORDER BY appointment_date DESC, appointment_time DESC, id DESC
    `);

    res.render("appointments", { appointments: rows });
  } catch (error) {
    console.error("Fetch appointments error:", error);
    res.status(500).send("Không thể tải danh sách lịch hẹn.");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.use((req, res) => {
  res.status(404).send("Không tìm thấy trang.");
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`App running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize app:", err);
    process.exit(1);
  });