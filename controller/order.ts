import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { Order, OrderPostRequest, OrderWithCustomer } from "../model/order";
import { SHOP, MAX_BOX_PER_ORDER } from "../config/config";
import { DISTANCE_SQL, randomInt, todayString } from "../utils/utils";

export const router = express.Router();

// 1. แสดงออเดอร์ทั้งหมด พร้อมข้อมูลลูกค้า (JOIN customer)
router.get("/", async (req, res) => {
  try {
    const sql = `
      SELECT 
        o.order_id, o.customer_id, o.order_date, o.box_count, 
        o.order_status, o.delivery_note, o.created_at,
        c.first_name, c.last_name, c.phone, c.address, c.latitude, c.longitude
      FROM orders o
      JOIN customer c ON o.customer_id = c.customer_id
      ORDER BY o.order_id DESC
    `;
    const [rows] = await conn.query(sql);
    res.json(rows as OrderWithCustomer[]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. ค้นออเดอร์ที่รอจัดส่ง (pending) ในรัศมี radius กม. จากร้าน (ค่าเริ่มต้น 2 กม.)
// ตัวอย่าง: /orders/nearby หรือ /orders/nearby?lat=16.1832&lng=103.3&radius=2
router.get("/nearby", async (req, res) => {
  try {
    const lat = req.query.lat ? Number(req.query.lat) : SHOP.latitude;
    const lng = req.query.lng ? Number(req.query.lng) : SHOP.longitude;
    const radius = req.query.radius ? Number(req.query.radius) : 2;

    if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
      res.status(400).json({ error: "lat, lng and radius must be numbers" });
      return;
    }

    const sql = `
      SELECT 
        o.order_id, o.customer_id, o.order_date, o.box_count, 
        o.order_status, o.delivery_note, o.created_at,
        c.first_name, c.last_name, c.phone, c.address, c.latitude, c.longitude,
        ROUND(${DISTANCE_SQL}, 3) AS distance_km
      FROM orders o
      JOIN customer c ON o.customer_id = c.customer_id
      HAVING distance_km <= ?
      ORDER BY distance_km
    `;
    const [rows] = await conn.query(sql, [lat, lng, lat, radius]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. จำลองออเดอร์ 20–30 รายการ สุ่มจากลูกค้าจริงในระบบ
// ตัวอย่าง: POST /orders/simulate หรือส่ง body { "count": 25 }
router.post("/simulate", async (req, res) => {
  try {
    let count = randomInt(20, 30);
    if (req.body && req.body.count !== undefined) {
      count = Number(req.body.count);
    }
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      res.status(400).json({ error: "count must be an integer between 1 and 200" });
      return;
    }

    const [custRows] = await conn.query("SELECT customer_id FROM customer");
    const customers = custRows as any[];
    if (customers.length === 0) {
      res.status(400).json({ error: "No customers in database. Please simulate or add customers first" });
      return;
    }

    const mockNotes = [
      "ฝากไว้ที่ป้อม รปภ.",
      "โทรแจ้งล่วงหน้า 5 นาที",
      "วางไว้โต๊ะหน้าบ้าน",
      "ส่งก่อนเที่ยงตรงครับ",
      "ตึก 1 ชั้น 2 ห้อง 204",
      null,
    ];

    const today = todayString();
    const rows: any[] = [];

    for (let i = 0; i < count; i++) {
      const randomCust = customers[randomInt(0, customers.length - 1)].customer_id;
      const randomBoxes = randomInt(1, MAX_BOX_PER_ORDER);
      const randomNote = mockNotes[randomInt(0, mockNotes.length - 1)];
      rows.push([randomCust, today, randomBoxes, "pending", randomNote]);
    }

    const sql = "INSERT INTO orders (customer_id, order_date, box_count, order_status, delivery_note) VALUES ?";
    const [result] = await conn.query(sql, [rows]);
    const insertResult = result as any;
    res.status(201).json({ affected_row: insertResult.affectedRows, count });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. ล้างออเดอร์ทั้งหมด
router.delete("/all", async (req, res) => {
  try {
    const [result] = await conn.query("DELETE FROM orders");
    const deleteResult = result as any;
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 5. แสดงออเดอร์ 1 รายการ
router.get("/:id", async (req, res) => {
  try {
    const sql = `
      SELECT 
        o.order_id, o.customer_id, o.order_date, o.box_count, 
        o.order_status, o.delivery_note, o.created_at,
        c.first_name, c.last_name, c.phone, c.address, c.latitude, c.longitude
      FROM orders o
      JOIN customer c ON o.customer_id = c.customer_id
      WHERE o.order_id = ?
    `;
    const [rows] = await conn.query(sql, [req.params.id]);
    const orders = rows as OrderWithCustomer[];
    if (orders.length === 0) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(orders[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 6. เพิ่มออเดอร์ใหม่ (1-3 กล่อง)
router.post("/", async (req, res) => {
  try {
    const order: OrderPostRequest = req.body;
    if (!order || !order.customer_id || order.box_count === undefined) {
      res.status(400).json({ error: "customer_id and box_count are required" });
      return;
    }

    if (order.box_count < 1 || order.box_count > MAX_BOX_PER_ORDER) {
      res.status(400).json({ error: `box_count must be between 1 and ${MAX_BOX_PER_ORDER}` });
      return;
    }

    const [cust] = await conn.query("SELECT customer_id FROM customer WHERE customer_id = ?", [order.customer_id]);
    if ((cust as any[]).length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const orderDate = order.order_date || todayString();
    const sql = "INSERT INTO orders (customer_id, order_date, box_count, order_status, delivery_note) VALUES (?, ?, ?, 'pending', ?)";
    const [result] = await conn.query(sql, [
      order.customer_id,
      orderDate,
      order.box_count,
      order.delivery_note ?? null,
    ]);
    const insertResult = result as any;
    res.status(201).json({
      affected_row: insertResult.affectedRows,
      last_id: insertResult.insertId,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 7. แก้ไขออเดอร์ (จำนวนกล่อง, หมายเหตุ, หรือเปลี่ยนสถานะ pending -> assigned -> delivered)
router.put("/:id", async (req, res) => {
  try {
    const id = +req.params.id;
    const body: Partial<Order> = req.body || {};

    if (body.box_count !== undefined && (body.box_count < 1 || body.box_count > MAX_BOX_PER_ORDER)) {
      res.status(400).json({ error: `box_count must be between 1 and ${MAX_BOX_PER_ORDER}` });
      return;
    }

    const validStatuses = ["pending", "assigned", "delivered"];
    if (body.order_status && !validStatuses.includes(body.order_status)) {
      res.status(400).json({ error: "order_status must be pending, assigned, or delivered" });
      return;
    }

    const sqlSelect = mysql.format("SELECT * FROM orders WHERE order_id = ?", [id]);
    const [response] = await conn.query(sqlSelect);
    const result = response as Order[];

    if (result.length === 0) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const updateOrder = { ...result[0], ...body };
    const sqlUpdate = "UPDATE orders SET customer_id=?, order_date=?, box_count=?, order_status=?, delivery_note=? WHERE order_id=?";
    const [records] = await conn.query(sqlUpdate, [
      updateOrder.customer_id,
      updateOrder.order_date,
      updateOrder.box_count,
      updateOrder.order_status,
      updateOrder.delivery_note,
      id,
    ]);
    const updateResult = records as any;
    res.status(200).json({ affected_row: updateResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 8. ลบออเดอร์ (ต้องเป็นสถานะ pending เท่านั้น)
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const [checkRows] = await conn.query("SELECT order_status FROM orders WHERE order_id = ?", [id]);
    const orders = checkRows as Order[];
    if (orders.length === 0) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (orders[0].order_status !== "pending") {
      res.status(409).json({ error: "Cannot delete order that is already assigned or delivered" });
      return;
    }

    const [result] = await conn.query("DELETE FROM orders WHERE order_id = ?", [id]);
    const deleteResult = result as any;
    res.status(200).json({ affected_row: deleteResult.affectedRows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});