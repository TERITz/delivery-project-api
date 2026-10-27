import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { Customer, CustomerPostRequest } from "../model/customer";
import { SHOP } from "../config/config";
import { DISTANCE_SQL, randomInt } from "../utils/utils";

export const router = express.Router();

// แสดงลูกค้าทุกคน
router.get("/", async (req, res) => {
  try {
    const [rows] = await conn.query("SELECT * FROM customer ORDER BY customer_id");
    res.json(rows as Customer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ค้นหาจากบางส่วนของ ชื่อ / นามสกุล / เบอร์โทร
// ตัวอย่าง /customers/search?name=สม  หรือ  ?first_name=สม&last_name=ใจ  หรือ  ?phone=0812
router.get("/search", async (req, res) => {
  try {
    let sql = "SELECT * FROM customer WHERE 1=1";
    let params: string[] = [];

    if (req.query.name) {
      sql += " AND (first_name LIKE ? OR last_name LIKE ?)";
      params.push("%" + req.query.name + "%", "%" + req.query.name + "%");
    }
    if (req.query.first_name) {
      sql += " AND first_name LIKE ?";
      params.push("%" + req.query.first_name + "%");
    }
    if (req.query.last_name) {
      sql += " AND last_name LIKE ?";
      params.push("%" + req.query.last_name + "%");
    }
    if (req.query.phone) {
      sql += " AND phone LIKE ?";
      params.push("%" + req.query.phone + "%");
    }

    const [rows] = await conn.query(sql + " ORDER BY customer_id", params);
    res.json(rows as Customer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ค้นลูกค้าทั้งหมดในระยะ radius กิโลเมตร (ค่าเริ่มต้น 1 กม.) จากพิกัด lat, lng
// ตัวอย่าง /customers/nearby?lat=16.18&lng=103.30&radius=1
router.get("/nearby", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = req.query.radius ? Number(req.query.radius) : 1;

    if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
      res.status(400).json({ error: "lat, lng and radius must be numbers" });
      return;
    }

    const sql =
      "SELECT c.*, ROUND(" + DISTANCE_SQL + ", 3) AS distance_km " +
      "FROM customer c HAVING distance_km <= ? ORDER BY distance_km";
    const [rows] = await conn.query(sql, [lat, lng, lat, radius]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// สร้างลูกค้าจำลอง (ไว้ทดสอบ) ตัวอย่าง body: { "count": 30 }
router.post("/simulate", async (req, res) => {
  try {
    let count = 30;
    if (req.body && req.body.count !== undefined) {
      count = Number(req.body.count);
    }
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      res.status(400).json({ error: "count must be an integer between 1 and 50" });
      return;
    }

    const firstNames = ["สมชาย", "สมหญิง", "สมศักดิ์", "สมศรี", "วิชัย", "วิภา", "ประเสริฐ", "ประภา", "ธนากร", "ธนพร", "กิตติ", "กนกวรรณ", "อนุชา", "อรุณี", "ณัฐวุฒิ", "ณัฐธิดา", "พิชัย", "พิมพ์ใจ", "สุรชัย", "สุนิสา"];
    const lastNames = ["ใจดี", "รักเรียน", "มั่นคง", "สุขสันต์", "แก้วมณี", "ทองดี", "บุญมา", "ศรีสุข", "พงษ์พันธ์", "วงศ์ใหญ่"];

    // สุ่มพิกัดรอบร้าน (มมส.) ในรัศมี 3 กม. ตาม req (กระจายสม่ำเสมอในวงกลม)
    const RADIUS_KM = 3;
    const rows: any[] = [];
    for (let i = 0; i < count; i++) {
      const r = RADIUS_KM * Math.sqrt(Math.random()); // sqrt ทำให้จุดไม่กระจุกตรงกลาง
      const theta = Math.random() * 2 * Math.PI;
      const lat = SHOP.latitude + (r * Math.sin(theta)) / 111.32; // 1 องศาละติจูด ≈ 111.32 กม.
      const lng = SHOP.longitude + (r * Math.cos(theta)) / (111.32 * Math.cos((SHOP.latitude * Math.PI) / 180));
      const phone = "0" + randomInt(6, 9) + String(randomInt(0, 99999999)).padStart(8, "0");
      rows.push([
        firstNames[randomInt(0, firstNames.length - 1)],
        lastNames[randomInt(0, lastNames.length - 1)],
        phone,
        `${randomInt(1, 300)}/${randomInt(1, 50)} ซอย ${randomInt(1, 30)}`,
        Number(lat.toFixed(6)),
        Number(lng.toFixed(6)),
      ]);
    }

    // INSERT IGNORE = ถ้าเบอร์โทรซ้ำจะข้ามแถวนั้นไป
    const sql =
      "INSERT IGNORE INTO customer (first_name, last_name, phone, address, latitude, longitude) VALUES ?";
    const [result] = await conn.query(sql, [rows]);
    const insertResult = result as any;
    res.status(201).json({ affected_row: insertResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// แสดงลูกค้า 1 คน
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await conn.query("SELECT * FROM customer WHERE customer_id = ?", [req.params.id]);
    const customers = rows as Customer[];
    if (customers.length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(customers[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// เพิ่มลูกค้า
router.post("/", async (req, res) => {
  try {
    let customer: CustomerPostRequest = req.body;
    if (
      !customer ||
      !customer.first_name ||
      !customer.last_name ||
      !customer.phone ||
      isNaN(Number(customer.latitude)) ||
      isNaN(Number(customer.longitude)) ||
      customer.latitude === undefined ||
      customer.longitude === undefined
    ) {
      res.status(400).json({ error: "first_name, last_name, phone, latitude, longitude are required" });
      return;
    }

    let sql =
      "INSERT INTO `customer`(`first_name`, `last_name`, `phone`, `address`, `latitude`, `longitude`) VALUES (?,?,?,?,?,?)";
    const [result] = await conn.query(sql, [
      customer.first_name,
      customer.last_name,
      customer.phone,
      customer.address ?? null,
      customer.latitude,
      customer.longitude,
    ]);
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_id: insertResult.insertId,
    });
  } catch (error: any) {
    if (error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Phone number already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// แก้ไขลูกค้า (ส่งมาเฉพาะ field ที่อยากแก้ก็ได้ ที่ไม่ส่งจะใช้ค่าเดิม)
router.put("/:id", async (req, res) => {
  try {
    let id = +req.params.id;
    let customer: Partial<Customer> = req.body || {};

    let sql = mysql.format("SELECT * FROM customer WHERE customer_id = ?", [id]);
    let [response] = await conn.query(sql);
    let result = response as Customer[];

    if (result.length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    let updateCustomer = { ...result[0], ...customer };
    sql =
      "UPDATE `customer` SET `first_name`=?, `last_name`=?, `phone`=?, `address`=?, `latitude`=?, `longitude`=? WHERE `customer_id`=?";
    const [records] = await conn.query(sql, [
      updateCustomer.first_name,
      updateCustomer.last_name,
      updateCustomer.phone,
      updateCustomer.address,
      updateCustomer.latitude,
      updateCustomer.longitude,
      id,
    ]);
    const updateResult = records as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error: any) {
    if (error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Phone number already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// ลบลูกค้า (ออเดอร์ของลูกค้าคนนั้นจะถูกลบไปด้วย)
router.delete("/:id", async (req, res) => {
  try {
    let id = req.params.id;

    // ถ้ามีออเดอร์ที่ถูกจัดเข้าเส้นทางแล้ว ไม่ให้ลบ
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND order_status <> 'pending'",
      [id]
    );
    if (Number((rows as any[])[0].n) > 0) {
      res.status(409).json({ error: "Customer has orders in a route plan. Delete the plan first" });
      return;
    }

    const [result] = await conn.query("DELETE FROM customer WHERE customer_id = ?", [id]);
    const deleteResult = result as any;
    if (deleteResult.affectedRows === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});