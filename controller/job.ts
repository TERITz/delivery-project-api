import express from "express";
import mysql from "mysql2";
import { conn } from "../dbconnect";
import { DeliveryJob, JobStopDetail, RiderJobResponse } from "../model/job";
import { DEADLINE_MIN, SHOP, ROUTE_COLORS } from "../config/config";
import { todayString, randomInt, toDateTime } from "../utils/utils";

export const router = express.Router();

/**
 * Helper: คืนวันและเวลาปัจจุบันตามโซน Asia/Bangkok (YYYY-MM-DD HH:mm:ss)
 */
function getBangkokDateTime(): { dateTimeStr: string; minutesFromMidnight: number } {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // YYYY-MM-DD
  const timeStr = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour12: false }); // HH:mm:ss
  const [hours, minutes] = timeStr.split(":").map(Number);
  const minutesFromMidnight = hours * 60 + (minutes || 0);
  return {
    dateTimeStr: `${dateStr} ${timeStr}`,
    minutesFromMidnight,
  };
}

/**
 * Helper: สร้าง URL สำหรับเปิด Google Maps นำทาง
 */
function createGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * Helper: สร้าง URL นำทางหลายจุดสำหรับ Google Maps
 */
function createRouteGoogleMapsUrl(stops: { latitude: number; longitude: number }[]): string {
  if (stops.length === 0) return "";
  const origin = `${SHOP.latitude},${SHOP.longitude}`;
  const destination = `${stops[stops.length - 1].latitude},${stops[stops.length - 1].longitude}`;
  if (stops.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  }
  const waypoints = stops.slice(0, -1).map((s) => `${s.latitude},${s.longitude}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypoints)}`;
}

/**
 * 1. GET /jobs
 * แสดงรายการใบงานไรเดอร์ทั้งหมดในระบบ
 */
router.get("/", async (req, res) => {
  try {
    const [jobs] = await conn.query("SELECT * FROM delivery_job ORDER BY job_id DESC");
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 2. POST /jobs/login
 * ไรเดอร์ล็อกอินด้วย access_code เพื่อดึงข้อมูลใบงาน
 */
router.post("/login", async (req, res) => {
  try {
    const accessCode = req.body?.access_code?.toString().trim();
    if (!accessCode) {
      res.status(400).json({ error: "access_code is required" });
      return;
    }

    const jobData = await fetchJobByAccessCode(accessCode);
    if (!jobData) {
      res.status(404).json({ error: "ไม่พบใบงานสำหรับรหัสนี้ (Invalid access_code)" });
      return;
    }

    res.json(jobData);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 3. GET /jobs/:access_code
 * ดูใบงานของไรเดอร์ตาม access_code (พร้อมลำดับจุดส่ง พิกัด และลิงก์ Google Maps)
 */
router.get("/:access_code", async (req, res) => {
  try {
    const accessCode = req.params.access_code?.trim();
    if (!accessCode) {
      res.status(400).json({ error: "access_code is required" });
      return;
    }

    const jobData = await fetchJobByAccessCode(accessCode);
    if (!jobData) {
      res.status(404).json({ error: "ไม่พบใบงานสำหรับรหัสนี้ (Job not found)" });
      return;
    }

    res.json(jobData);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 4. PUT /jobs/:access_code/stops/:stop_id/delivered
 * ไรเดอร์กด "ส่งแล้ว" ที่แต่ละจุดส่ง
 * - บันทึก delivered_at ตามเวลาปัจจุบัน
 * - ตรวจสอบว่าส่งเลทเกิน 12:30 หรือไม่ (is_late)
 * - อัปเดตสถานะออเดอร์เป็น 'delivered'
 * - อัปเดตสถานะใบงาน ('delivering' หรือ 'completed' เมื่อส่งครบทุกจุด)
 */
router.put("/:access_code/stops/:stop_id/delivered", async (req, res) => {
  try {
    const accessCode = req.params.access_code?.trim();
    const stopId = Number(req.params.stop_id);

    if (!accessCode || isNaN(stopId)) {
      res.status(400).json({ error: "access_code and valid stop_id are required" });
      return;
    }

    // 1. ตรวจสอบใบงานว่ามีอยู่จริงหรือไม่
    const [jobRows] = await conn.query("SELECT * FROM delivery_job WHERE access_code = ?", [accessCode]);
    const jobs = jobRows as DeliveryJob[];
    if (jobs.length === 0) {
      res.status(404).json({ error: "ไม่พบใบงานสำหรับรหัสนี้ (Job not found)" });
      return;
    }
    const currentJob = jobs[0];

    // 2. ตรวจสอบจุดส่ง (job_stop) ว่าอยู่ในใบงานนี้จริงหรือไม่
    const [stopRows] = await conn.query(
      `SELECT js.*, o.order_status, o.customer_id 
       FROM job_stop js
       JOIN orders o ON js.order_id = o.order_id
       WHERE js.stop_id = ? AND js.job_id = ?`,
      [stopId, currentJob.job_id]
    );
    const stops = stopRows as any[];
    if (stops.length === 0) {
      res.status(404).json({ error: "ไม่พบจุดส่งนี้ในใบงานของคุณ" });
      return;
    }
    const stop = stops[0];

    // ถ้าจุดนี้เคยส่งแล้ว สามารถตอบกลับข้อมูลเดิมได้
    if (stop.delivered_at) {
      res.status(200).json({
        message: "จุดส่งนี้ถูกบันทึกว่าส่งแล้วก่อนหน้านี้แล้ว",
        stop_id: stopId,
        delivered_at: stop.delivered_at,
        is_late: Boolean(stop.is_late),
        job_status: currentJob.job_status,
      });
      return;
    }

    // 3. กำหนดเวลาส่งปัจจุบัน และตรวจสอบว่าส่งเลทหรือไม่ (เกิน 12:30 น.)
    const { dateTimeStr: deliveredAt, minutesFromMidnight } = getBangkokDateTime();
    const isLate = minutesFromMidnight > DEADLINE_MIN ? 1 : 0;

    // 4. บันทึกเวลาส่งและ is_late ลงตาราง job_stop
    await conn.query(
      "UPDATE job_stop SET delivered_at = ?, is_late = ? WHERE stop_id = ?",
      [deliveredAt, isLate, stopId]
    );

    // 5. อัปเดตสถานะออเดอร์ในตาราง orders เป็น 'delivered'
    await conn.query(
      "UPDATE orders SET order_status = 'delivered' WHERE order_id = ?",
      [stop.order_id]
    );

    // 6. ตรวจสอบจำนวนจุดส่งที่เหลือในใบงานนี้
    const [remainingRows] = await conn.query(
      "SELECT COUNT(*) as remaining FROM job_stop WHERE job_id = ? AND delivered_at IS NULL",
      [currentJob.job_id]
    );
    const remainingCount = (remainingRows as any[])[0]?.remaining || 0;

    // 7. อัปเดตสถานะใบงาน (job_status)
    // ถ้าส่งครบหมดแล้ว -> 'completed' มิฉะนั้น -> 'delivering'
    const newJobStatus = remainingCount === 0 ? "completed" : "delivering";
    await conn.query(
      "UPDATE delivery_job SET job_status = ? WHERE job_id = ?",
      [newJobStatus, currentJob.job_id]
    );

    res.status(200).json({
      success: true,
      message: remainingCount === 0 ? "ส่งครบทุกจุดเรียบร้อยแล้ว!" : "บันทึกการส่งจุดนี้เรียบร้อย",
      stop_id: stopId,
      order_id: stop.order_id,
      delivered_at: deliveredAt,
      is_late: Boolean(isLate),
      penalty_baht: isLate ? 20 : 0,
      remaining_stops: remainingCount,
      job_status: newJobStatus,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 5. PUT /jobs/:access_code/status
 * อัปเดตสถานะใบงาน เช่น ไรเดอร์กดรับอาหารแล้ว (waiting_pickup -> delivering)
 */
router.put("/:access_code/status", async (req, res) => {
  try {
    const accessCode = req.params.access_code?.trim();
    const { job_status } = req.body || {};

    const validStatuses = ["waiting_pickup", "delivering", "completed", "assigned", "in_progress", "done"];
    if (!job_status || !validStatuses.includes(job_status)) {
      res.status(400).json({
        error: `job_status must be one of: ${validStatuses.join(", ")}`,
      });
      return;
    }

    const [result] = await conn.query(
      "UPDATE delivery_job SET job_status = ? WHERE access_code = ?",
      [job_status, accessCode]
    );
    const updateResult = result as any;
    if (updateResult.affectedRows === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Updated job status to ${job_status}`,
      job_status,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 6. POST /jobs/simulate
 * จำลองสร้างใบงานและจุดส่งสำหรับทดสอบระบบฝั่งไรเดอร์
 * (สร้าง Route_Plan + Delivery_Job + Job_Stops จากออเดอร์ที่มีอยู่จริง)
 */
router.post("/simulate", async (req, res) => {
  try {
    // 1. ตรวจสอบออเดอร์ ถ้ายังไม่มีให้สร้างออเดอร์ mock ก่อน
    let [orderRows] = await conn.query("SELECT * FROM orders WHERE order_status = 'pending' LIMIT 15");
    let pendingOrders = orderRows as any[];

    if (pendingOrders.length < 3) {
      // ดึงลูกค้ามาสร้าง mock orders
      const [custRows] = await conn.query("SELECT customer_id FROM customer LIMIT 10");
      const customers = custRows as any[];
      if (customers.length === 0) {
        res.status(400).json({ error: "ไม่มีลูกค้าในระบบ กรุณาเพิ่มลูกค้าก่อน" });
        return;
      }

      const today = todayString();
      for (let i = 0; i < 5; i++) {
        const cust = customers[i % customers.length];
        await conn.query(
          "INSERT INTO orders (customer_id, order_date, box_count, order_status, delivery_note) VALUES (?, ?, ?, 'pending', ?)",
          [cust.customer_id, today, randomInt(1, 3), `จุดส่งทดสอบที่ ${i + 1}`]
        );
      }

      const [newOrderRows] = await conn.query("SELECT * FROM orders WHERE order_status = 'pending' LIMIT 15");
      pendingOrders = newOrderRows as any[];
    }

    // 2. สร้าง route_plan
    const today = todayString();
    const [planResult] = await conn.query(
      "INSERT INTO route_plan (plan_date, plan_status, total_distance_km, total_fuel_cost) VALUES (?, 'confirmed', 12.5, 18.75)",
      [today]
    );
    const planId = (planResult as any).insertId;

    // 3. สุ่ม access_code เช่น RD-101 หรือ RIDER1
    const randCode = "RD" + Math.floor(1000 + Math.random() * 9000);
    const color = ROUTE_COLORS[0];

    // คำนวณกล่องรวม (หยิบมา 3-4 ออเดอร์)
    const selectedOrders = pendingOrders.slice(0, 4);
    const totalBoxes = selectedOrders.reduce((sum, o) => sum + (o.box_count || 1), 0);

    const [jobResult] = await conn.query(
      `INSERT INTO delivery_job 
       (plan_id, rider_name, access_code, route_color, total_boxes, distance_km, fuel_cost, job_status) 
       VALUES (?, ?, ?, ?, ?, 8.4, 12.6, 'delivering')`,
      [planId, "สมชาย สายซิ่ง (Rider 1)", randCode, color, totalBoxes]
    );
    const jobId = (jobResult as any).insertId;

    // 4. สร้าง job_stops
    let seq = 1;
    for (const ord of selectedOrders) {
      const estimatedArrival = toDateTime(today, 11 * 60 + 30 + seq * 10);
      await conn.query(
        `INSERT INTO job_stop (job_id, order_id, stop_sequence, arrival_time, is_late, delivered_at)
         VALUES (?, ?, ?, ?, 0, NULL)`,
        [jobId, ord.order_id, seq, estimatedArrival]
      );
      // อัปเดตสถานะออเดอร์เป็น assigned
      await conn.query("UPDATE orders SET order_status = 'assigned' WHERE order_id = ?", [ord.order_id]);
      seq++;
    }

    const jobData = await fetchJobByAccessCode(randCode);
    res.status(201).json({
      message: "จำลองใบงานไรเดอร์สำเร็จ",
      access_code: randCode,
      job: jobData,
    });
  } catch (error) {
    res.status(500).json({ error: (error as any).message || "Internal server error" });
  }
});

/**
 * ดึงข้อมูลใบงานพร้อมจุดส่ง ข้อมูลลูกค้า และ Google Maps URL
 */
async function fetchJobByAccessCode(accessCode: string): Promise<RiderJobResponse | null> {
  const [jobRows] = await conn.query("SELECT * FROM delivery_job WHERE access_code = ?", [accessCode]);
  const jobs = jobRows as DeliveryJob[];
  if (jobs.length === 0) {
    return null;
  }
  const job = jobs[0];

  const sqlStops = `
    SELECT 
      js.stop_id,
      js.job_id,
      js.order_id,
      js.stop_sequence,
      js.arrival_time,
      js.is_late,
      js.delivered_at,
      o.box_count,
      o.order_status,
      o.delivery_note,
      c.customer_id,
      c.first_name,
      c.last_name,
      c.phone,
      c.address,
      c.latitude,
      c.longitude
    FROM job_stop js
    JOIN orders o ON js.order_id = o.order_id
    JOIN customer c ON o.customer_id = c.customer_id
    WHERE js.job_id = ?
    ORDER BY js.stop_sequence ASC
  `;

  const [stopRows] = await conn.query(sqlStops, [job.job_id]);
  const rawStops = stopRows as any[];

  const stops: JobStopDetail[] = rawStops.map((row) => ({
    ...row,
    is_late: Boolean(row.is_late),
    google_maps_url: createGoogleMapsUrl(row.latitude, row.longitude),
    google_maps_link: `https://www.google.com/maps/search/?api=1&query=${row.latitude},${row.longitude}`,
  }));

  const deliveredStops = stops.filter((s) => s.delivered_at !== null).length;
  const remainingStops = stops.length - deliveredStops;

  const routeUrl = createRouteGoogleMapsUrl(stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })));

  return {
    job,
    summary: {
      total_stops: stops.length,
      delivered_stops: deliveredStops,
      remaining_stops: remainingStops,
      total_boxes: job.total_boxes,
    },
    google_maps_route_url: routeUrl,
    stops,
  };
}
