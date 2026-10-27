import express from "express";
import { conn } from "../dbconnect";
import {
  SHOP,
  BOX_CAPACITY,
  COOK_DONE_MIN,
  DEADLINE_MIN,
  SPEED_KMH,
  SERVICE_MIN,
  ROAD_FACTOR,
  ROUTE_COLORS,
} from "../config/config";
import { distanceKm, round2, toDateTime, todayString } from "../utils/utils";
import { OrderWithCustomer } from "../model/order";

export const router = express.Router();

// =====================================================
// ค่าคงที่ตามโจทย์ (แนะนำให้ย้ายไป config/config.ts ภายหลัง)
// =====================================================
const MAX_ORDERS_PER_RIDER = 3; // ไรเดอร์รับไม่เกินคนละ 3 ออเดอร์
const RIDER_BASE_FEE = 15; // ค่าเรียกไรเดอร์ 15 บาท/เที่ยว
const RIDER_RATE_PER_BOX_KM = 2; // 2 บาท / กล่อง / กม.
const PRICE_PER_BOX = 65; // ราคาขายต่อกล่อง
const FOOD_COST_PER_BOX = 40; // ต้นทุนอาหารต่อกล่อง

// ค่าจ้างไรเดอร์ = 15 + (2 x จำนวนกล่อง x ระยะทางรวม กม.)
// เก็บลงคอลัมน์ fuel_cost เดิม (ความหมายจริงคือ "ค่าจ้างไรเดอร์")
function calcRiderFee(totalBoxes: number, distanceKmTotal: number): number {
  return round2(RIDER_BASE_FEE + RIDER_RATE_PER_BOX_KM * totalBoxes * distanceKmTotal);
}

// สรุปรายรับ / ต้นทุน / กำไรของทั้งแผน
function calcProfitSummary(totalBoxes: number, totalRiderFee: number) {
  const revenue = round2(totalBoxes * PRICE_PER_BOX);
  const foodCost = round2(totalBoxes * FOOD_COST_PER_BOX);
  const profit = round2(revenue - foodCost - totalRiderFee);
  return { revenue, food_cost: foodCost, rider_cost: round2(totalRiderFee), profit };
}

// หมุนลิสต์ที่เรียงตามมุมแล้ว ให้เริ่มต้นหลังช่องว่างมุมที่กว้างที่สุด
// แก้ปัญหารอยต่อที่ ±π (ลูกค้าทิศตะวันตกถูกแยกไปอยู่ปลายลิสต์ทั้งสองด้าน)
function rotateAtLargestGap<T extends { angle: number }>(sorted: T[]): T[] {
  const n = sorted.length;
  if (n < 2) return sorted;
  let maxGap = -1;
  let startIdx = 0;
  for (let i = 0; i < n; i++) {
    const next = sorted[(i + 1) % n].angle;
    let gap = next - sorted[i].angle;
    if (i === n - 1) gap += 2 * Math.PI;
    if (gap > maxGap) {
      maxGap = gap;
      startIdx = (i + 1) % n;
    }
  }
  return [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
}

// สร้าง access_code แบบสุ่ม (เช่น R1-1014) และเช็คไม่ให้ซ้ำทั้งในแผนนี้และใน DB
async function generateUniqueAccessCode(
  connection: any,
  riderIndex: number,
  usedInPlan: Set<string>
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    const code = `R${riderIndex + 1}-${rand}`;
    if (usedInPlan.has(code)) continue;
    const [rows] = await connection.query(
      "SELECT 1 FROM delivery_job WHERE access_code = ? LIMIT 1",
      [code]
    );
    if ((rows as any[]).length === 0) {
      usedInPlan.add(code);
      return code;
    }
  }
  throw new Error("Cannot generate unique access code");
}

// 1. POST /routes/plan - จัดเส้นทางให้ไรเดอร์ทุกคน
router.post("/plan", async (req, res) => {
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    const planDate = req.body?.plan_date || req.body?.date || todayString();

    // ---- คำนวณใหม่: ปลดออเดอร์ของแผนเดิมกลับเป็น pending แล้วลบแผนเดิมก่อนจัดใหม่ ----
    // (เดิมออเดอร์เป็น 'assigned' แล้ว จึงถูกกรองทิ้ง ทำให้คำนวณใหม่ไม่ได้)
    const replacePlanId = Number(req.body?.replace_plan_id) || 0;
    const variant = Math.max(0, Math.floor(Number(req.body?.variant) || 0)); // 0 = วิธีเดิม, 1+ = ทางเลือกอื่น

    if (replacePlanId > 0) {
      const [doneRows] = await connection.query(
        `SELECT COUNT(*) AS cnt
         FROM job_stop js
         JOIN delivery_job dj ON js.job_id = dj.job_id
         JOIN orders o ON js.order_id = o.order_id
         WHERE dj.plan_id = ? AND (js.delivered_at IS NOT NULL OR o.order_status = 'delivered')`,
        [replacePlanId]
      );
      if (Number((doneRows as any[])[0].cnt) > 0) {
        await connection.rollback();
        res.status(409).json({ error: "แผนนี้เริ่มส่งของแล้ว ไม่สามารถคำนวณใหม่ได้" });
        return;
      }

      await connection.query(
        `UPDATE orders o
         JOIN job_stop js ON js.order_id = o.order_id
         JOIN delivery_job dj ON js.job_id = dj.job_id
         SET o.order_status = 'pending'
         WHERE dj.plan_id = ? AND o.order_status <> 'delivered'`,
        [replacePlanId]
      );
      // CASCADE จะลบ delivery_job และ job_stop ของแผนนี้ให้อัตโนมัติ
      await connection.query("DELETE FROM route_plan WHERE plan_id = ?", [replacePlanId]);
    }

    // ดึงออเดอร์ที่ค้างส่ง (status = 'pending') และล็อกแถว กันสองคำขอแย่งออเดอร์เดียวกัน
    const [orderRows] = await connection.query(
      `SELECT 
        o.order_id, o.customer_id, o.order_date, o.box_count, 
        o.order_status, o.delivery_note, o.created_at,
        c.first_name, c.last_name, c.phone, c.address, c.latitude, c.longitude
      FROM orders o
      JOIN customer c ON o.customer_id = c.customer_id
      WHERE o.order_status = 'pending' AND o.order_date <= ?
      ORDER BY o.order_id ASC
      FOR UPDATE`,
      [planDate]
    );

    const pendingOrders = orderRows as OrderWithCustomer[];

    if (pendingOrders.length === 0) {
      await connection.rollback();
      res.status(400).json({ error: "No pending orders to plan" });
      return;
    }

    // คำนวณมุมองศาจากร้าน (atan2) เพื่อแบ่งโซนให้ไรเดอร์แต่ละคน
    const ordersWithAngle = pendingOrders.map((o) => {
      const angle = Math.atan2(o.latitude - SHOP.latitude, o.longitude - SHOP.longitude);
      const distFromShop = distanceKm(SHOP.latitude, SHOP.longitude, o.latitude, o.longitude);
      return {
        ...o,
        angle,
        distFromShop,
      };
    });

    // เรียงตามมุมรอบร้าน แล้วหมุนให้เริ่มหลังช่องว่างที่กว้างที่สุด
    ordersWithAngle.sort((a, b) => a.angle - b.angle);
    let sweepOrders = rotateAtLargestGap(ordersWithAngle);

    // ทางเลือกอื่น: เลื่อนจุดเริ่มตัดกลุ่ม (0-2 ตำแหน่ง) และสลับทิศการกวาดทุกๆ 3 ทางเลือก
    // ทำให้การแบ่งกลุ่มไรเดอร์ต่างจากเดิม จึงได้เส้นทาง/ต้นทุนที่ต่างกัน
    if (variant > 0 && sweepOrders.length > 1) {
      const shift = variant % 3;
      sweepOrders = [...sweepOrders.slice(shift), ...sweepOrders.slice(0, shift)];
      if (Math.floor(variant / 3) % 2 === 1) sweepOrders.reverse();
    }

    // แบ่งลงไรเดอร์: ไม่เกิน MAX_ORDERS_PER_RIDER ออเดอร์ และไม่เกิน BOX_CAPACITY กล่อง
    const riderBuckets: (typeof sweepOrders)[] = [];
    let currentBucket: typeof sweepOrders = [];
    let currentBoxes = 0;

    for (const order of sweepOrders) {
      if (
        currentBucket.length < MAX_ORDERS_PER_RIDER &&
        currentBoxes + order.box_count <= BOX_CAPACITY
      ) {
        currentBucket.push(order);
        currentBoxes += order.box_count;
      } else {
        if (currentBucket.length > 0) {
          riderBuckets.push(currentBucket);
        }
        currentBucket = [order];
        currentBoxes = order.box_count;
      }
    }
    if (currentBucket.length > 0) {
      riderBuckets.push(currentBucket);
    }

    // สำหรับแต่ละไรเดอร์: จัดลำดับการส่งด้วย Nearest Neighbor (เริ่มจากร้าน)
    interface PlannedJob {
      rider_name: string;
      access_code: string;
      route_color: string;
      total_boxes: number;
      distance_km: number;
      fuel_cost: number; // = ค่าจ้างไรเดอร์
      stops: {
        order_id: number;
        stop_sequence: number;
        arrival_time: string;
        is_late: number;
        distance_from_prev: number;
        latitude?: number;
        longitude?: number;
        google_maps_url?: string;
        google_maps_link?: string;
      }[];
    }

    const plannedJobs: PlannedJob[] = [];
    const usedCodes = new Set<string>();
    let totalPlanDistance = 0;
    let totalPlanFee = 0;
    let latestArrivalMin = 0; // เวลาถึงจุดส่งสุดท้ายที่ช้าที่สุดของทั้งแผน

    for (let i = 0; i < riderBuckets.length; i++) {
      const bucket = [...riderBuckets[i]];
      const riderName = `ไรเดอร์ ${i + 1}`;
      const accessCode = await generateUniqueAccessCode(connection, i, usedCodes);
      const routeColor = ROUTE_COLORS[i % ROUTE_COLORS.length];
      const totalBoxes = bucket.reduce((sum, o) => sum + o.box_count, 0);

      let curLat = SHOP.latitude;
      let curLng = SHOP.longitude;
      let currentTimeMin = COOK_DONE_MIN; // 11:30 = 690 นาที
      let jobDistance = 0;

      const stops: PlannedJob["stops"] = [];
      let sequence = 1;

      while (bucket.length > 0) {
        // หาจุดที่ใกล้ที่สุดจากตำแหน่งปัจจุบัน
        let nearestIdx = 0;
        let nearestDist = distanceKm(curLat, curLng, bucket[0].latitude, bucket[0].longitude);

        for (let j = 1; j < bucket.length; j++) {
          const d = distanceKm(curLat, curLng, bucket[j].latitude, bucket[j].longitude);
          if (d < nearestDist) {
            nearestDist = d;
            nearestIdx = j;
          }
        }

        const nextStop = bucket.splice(nearestIdx, 1)[0];
        const roadDist = nearestDist * ROAD_FACTOR;
        jobDistance += roadDist;

        // เวลาเดินทาง = (ระยะทางจริง / ความเร็ว 30 กม./ชม.) * 60 นาที
        const travelTimeMin = (roadDist / SPEED_KMH) * 60;
        currentTimeMin += travelTimeMin;

        // เลทถ้าเกิน 12:30 (750 นาที)
        const isLate = currentTimeMin > DEADLINE_MIN ? 1 : 0;
        const arrivalTimeStr = toDateTime(planDate, currentTimeMin);
        if (currentTimeMin > latestArrivalMin) latestArrivalMin = currentTimeMin;

        stops.push({
          order_id: nextStop.order_id,
          stop_sequence: sequence++,
          arrival_time: arrivalTimeStr,
          is_late: isLate,
          distance_from_prev: round2(roadDist),
          latitude: nextStop.latitude,
          longitude: nextStop.longitude,
          google_maps_url: `https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}`,
          google_maps_link: `https://www.google.com/maps/search/?api=1&query=${nextStop.latitude},${nextStop.longitude}`,
        });

        // เวลาบริการส่งของ ณ จุดนี้
        currentTimeMin += SERVICE_MIN;
        curLat = nextStop.latitude;
        curLng = nextStop.longitude;
      }

      // วิ่งกลับร้าน (นับรวมในระยะทางที่คิดค่าส่ง)
      const returnDist = distanceKm(curLat, curLng, SHOP.latitude, SHOP.longitude) * ROAD_FACTOR;
      jobDistance += returnDist;

      const finalDistance = round2(jobDistance);
      const riderFee = calcRiderFee(totalBoxes, finalDistance);

      totalPlanDistance += finalDistance;
      totalPlanFee += riderFee;

      plannedJobs.push({
        rider_name: riderName,
        access_code: accessCode,
        route_color: routeColor,
        total_boxes: totalBoxes,
        distance_km: finalDistance,
        fuel_cost: riderFee,
        stops,
      });
    }

    totalPlanDistance = round2(totalPlanDistance);
    totalPlanFee = round2(totalPlanFee);

    // บันทึกลงตาราง route_plan
    const [planResult] = await connection.query(
      `INSERT INTO route_plan (plan_date, plan_status, total_distance_km, total_fuel_cost) VALUES (?, 'planned', ?, ?)`,
      [planDate, totalPlanDistance, totalPlanFee]
    );
    const planId = (planResult as any).insertId;

    // บันทึกลง delivery_job และ job_stop พร้อมอัปเดต order_status = 'assigned'
    for (const job of plannedJobs) {
      const [jobResult] = await connection.query(
        `INSERT INTO delivery_job (plan_id, rider_name, access_code, route_color, total_boxes, distance_km, fuel_cost, job_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'assigned')`,
        [planId, job.rider_name, job.access_code, job.route_color, job.total_boxes, job.distance_km, job.fuel_cost]
      );
      const jobId = (jobResult as any).insertId;

      for (const stop of job.stops) {
        await connection.query(
          `INSERT INTO job_stop (job_id, order_id, stop_sequence, arrival_time, is_late, delivered_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [jobId, stop.order_id, stop.stop_sequence, stop.arrival_time, stop.is_late]
        );

        await connection.query(
          `UPDATE orders SET order_status = 'assigned' WHERE order_id = ?`,
          [stop.order_id]
        );
      }
    }

    await connection.commit();

    const totalBoxes = plannedJobs.reduce((sum, j) => sum + j.total_boxes, 0);
    const lateStopsCount = plannedJobs.reduce(
      (sum, j) => sum + j.stops.filter((s) => s.is_late === 1).length,
      0
    );

    res.status(201).json({
      message: "Route plan created successfully",
      plan_id: planId,
      plan_date: planDate,
      variant,
      total_distance_km: totalPlanDistance,
      total_fuel_cost: totalPlanFee, // = ค่าจ้างไรเดอร์รวม
      riders_count: plannedJobs.length,
      orders_count: pendingOrders.length,
      total_boxes: totalBoxes,
      late_stops_count: lateStopsCount,
      finish_time: toDateTime(planDate, latestArrivalMin),
      ...calcProfitSummary(totalBoxes, totalPlanFee),
      jobs: plannedJobs,
    });
  } catch (error: any) {
    await connection.rollback();
    res.status(500).json({ error: "Internal server error", details: error.message });
  } finally {
    connection.release();
  }
});

// 2. GET /routes - ดูรายการแผนทั้งหมด
router.get("/", async (req, res) => {
  try {
    const [rows] = await conn.query(
      "SELECT * FROM route_plan ORDER BY plan_id DESC"
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 3. GET /routes/:plan_id - ดูรายละเอียดแผน (ไรเดอร์ทุกคน + จุดส่งเรียงลำดับ + พิกัดไว้วาดแผนที่)
router.get("/:plan_id", async (req, res) => {
  try {
    const planId = req.params.plan_id;

    const [planRows] = await conn.query(
      "SELECT * FROM route_plan WHERE plan_id = ?",
      [planId]
    );
    const plans = planRows as any[];
    if (plans.length === 0) {
      res.status(404).json({ error: "Route plan not found" });
      return;
    }

    const plan = plans[0];

    // ดึง Jobs ภายใต้ Plan นี้
    const [jobRows] = await conn.query(
      "SELECT * FROM delivery_job WHERE plan_id = ? ORDER BY job_id ASC",
      [planId]
    );
    const jobs = jobRows as any[];

    // ดึง Job Stops ทั้งหมดของ Plan นี้ พร้อมพิกัดและรายละเอียดลูกค้า
    const [stopRows] = await conn.query(
      `SELECT 
        js.stop_id, js.job_id, js.order_id, js.stop_sequence, js.arrival_time, js.is_late, js.delivered_at,
        o.box_count, o.order_status, o.delivery_note,
        c.customer_id, c.first_name, c.last_name, c.phone, c.address, c.latitude, c.longitude
      FROM job_stop js
      JOIN delivery_job dj ON js.job_id = dj.job_id
      JOIN orders o ON js.order_id = o.order_id
      JOIN customer c ON o.customer_id = c.customer_id
      WHERE dj.plan_id = ?
      ORDER BY js.job_id ASC, js.stop_sequence ASC`,
      [planId]
    );
    const allStops = stopRows as any[];

    // จับคู่ stops ใส่ในแต่ละ job
    const jobsWithStops = jobs.map((job) => {
      const stops = allStops
        .filter((s) => s.job_id === job.job_id)
        .map((s) => ({
          ...s,
          is_late: Boolean(s.is_late),
          google_maps_url: `https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`,
          google_maps_link: `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`,
        }));
      return {
        ...job,
        stops,
      };
    });

    // สรุปภาพรวม: กล่อง / จุดเลท / เวลาถึงจุดสุดท้าย / กำไร
    const totalBoxes = jobs.reduce((sum, j) => sum + Number(j.total_boxes || 0), 0);
    const totalRiderFee = Number(plan.total_fuel_cost || 0);
    const lateStopsCount = allStops.filter((s) => Boolean(s.is_late)).length;

    let finishTime: any = null;
    for (const s of allStops) {
      if (!s.arrival_time) continue;
      if (finishTime === null || new Date(s.arrival_time) > new Date(finishTime)) {
        finishTime = s.arrival_time;
      }
    }

    res.json({
      ...plan,
      shop: SHOP,
      total_boxes: totalBoxes,
      late_stops_count: lateStopsCount,
      finish_time: finishTime,
      ...calcProfitSummary(totalBoxes, totalRiderFee),
      jobs: jobsWithStops,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. DELETE /routes/:plan_id - ลบแผนจัดเส้นทาง (และปลดออเดอร์กลับเป็น pending)
router.delete("/:plan_id", async (req, res) => {
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();
    const planId = req.params.plan_id;

    // หา order_id ทั้งหมดในแผนนี้
    const [ordersInPlan] = await connection.query(
      `SELECT js.order_id 
       FROM job_stop js
       JOIN delivery_job dj ON js.job_id = dj.job_id
       WHERE dj.plan_id = ?`,
      [planId]
    );
    const orderList = (ordersInPlan as any[]).map((r) => r.order_id);

    // ปรับสถานะ orders ที่ยังไม่ส่ง กลับเป็น pending
    if (orderList.length > 0) {
      await connection.query(
        `UPDATE orders SET order_status = 'pending' WHERE order_id IN (?) AND order_status <> 'delivered'`,
        [orderList]
      );
    }

    // ลบ route_plan (CASCADE DELETE จะลบ delivery_job และ job_stop ให้อัตโนมัติ)
    const [delResult] = await connection.query(
      "DELETE FROM route_plan WHERE plan_id = ?",
      [planId]
    );

    const result = delResult as any;
    if (result.affectedRows === 0) {
      await connection.rollback();
      res.status(404).json({ error: "Route plan not found" });
      return;
    }

    await connection.commit();
    res.json({ message: "Route plan deleted successfully", affected_rows: result.affectedRows });
  } catch (error: any) {
    await connection.rollback();
    res.status(500).json({ error: "Internal server error", details: error.message });
  } finally {
    connection.release();
  }
});