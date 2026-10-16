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
  FUEL_BAHT_PER_KM,
  ROUTE_COLORS,
} from "../config/config";
import { distanceKm, round2, toDateTime, todayString } from "../utils/utils";
import { OrderWithCustomer } from "../model/order";

export const router = express.Router();

// ฟังก์ชันสร้าง access_code แบบสุ่ม (เช่น R1-1014, R2-9428)
function generateAccessCode(riderIndex: number): string {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `R${riderIndex + 1}-${rand}`;
}

// 1. POST /routes/plan - จัดเส้นทางให้ไรเดอร์ทุกคน
router.post("/plan", async (req, res) => {
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    const planDate = req.body?.plan_date || req.body?.date || todayString();

    // ดึงออเดอร์ที่ค้างส่ง (status = 'pending')
    const [orderRows] = await connection.query(
      `SELECT 
        o.order_id, o.customer_id, o.order_date, o.box_count, 
        o.order_status, o.delivery_note, o.created_at,
        c.first_name, c.last_name, c.phone, c.address, c.latitude, c.longitude
      FROM orders o
      JOIN customer c ON o.customer_id = c.customer_id
      WHERE o.order_status = 'pending' AND o.order_date <= ?
      ORDER BY o.order_id ASC`,
      [planDate]
    );

    const pendingOrders = orderRows as OrderWithCustomer[];

    if (pendingOrders.length === 0) {
      await connection.rollback();
      res.status(400).json({ error: "No pending orders to plan" });
      return;
    }

    // คำนวณระยะห่างจากร้านสำหรับแต่ละออเดอร์ เพื่อใช้จัดกลุ่มแบบ Polar Angle หรือ Proximity
    // ออเดอร์แต่ละตัวคำนวณมุมองศาจากร้าน (atan2) เพื่อแบ่ง cluster ให้ไรเดอร์แต่ละคนตามโซนได้อย่างเป็นธรรมชาติ
    const ordersWithAngle = pendingOrders.map((o) => {
      const angle = Math.atan2(o.latitude - SHOP.latitude, o.longitude - SHOP.longitude);
      const distFromShop = distanceKm(SHOP.latitude, SHOP.longitude, o.latitude, o.longitude);
      return {
        ...o,
        angle,
        distFromShop,
      };
    });

    // เรียงตามองศารอบร้าน (Angular sorting) เพื่อให้จุดที่อยู่ใกล้ๆ กันอยู่ในโซนเดียวกัน
    ordersWithAngle.sort((a, b) => a.angle - b.angle);

    // ทำ Bin Packing แบ่งลงไรเดอร์: ความจุต่อไรเดอร์ <= BOX_CAPACITY (10 กล่อง)
    const riderBuckets: (typeof ordersWithAngle)[] = [];
    let currentBucket: typeof ordersWithAngle = [];
    let currentBoxes = 0;

    for (const order of ordersWithAngle) {
      if (currentBoxes + order.box_count <= BOX_CAPACITY) {
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

    // สำหรับแต่ละ Bucket ของไรเดอร์: จัดลำดับการส่งด้วย Nearest Neighbor TSP (เริ่มจากร้าน SHOP)
    interface PlannedJob {
      rider_name: string;
      access_code: string;
      route_color: string;
      total_boxes: number;
      distance_km: number;
      fuel_cost: number;
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
    let totalPlanDistance = 0;
    let totalPlanFuel = 0;

    for (let i = 0; i < riderBuckets.length; i++) {
      const bucket = [...riderBuckets[i]];
      const riderName = `ไรเดอร์ ${i + 1}`;
      const accessCode = generateAccessCode(i);
      const routeColor = ROUTE_COLORS[i % ROUTE_COLORS.length];
      const totalBoxes = bucket.reduce((sum, o) => sum + o.box_count, 0);

      // เรียงลำดับจุดส่งแบบ Nearest Neighbor
      let curLat = SHOP.latitude;
      let curLng = SHOP.longitude;
      let currentTimeMin = COOK_DONE_MIN; // 11:30 = 690 min
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

        // คำนวณเวลาเดินทาง = (ระยะทางจริง / ความเร็ว 30 กม./ชม.) * 60 นาที
        const travelTimeMin = (roadDist / SPEED_KMH) * 60;
        currentTimeMin += travelTimeMin;

        // เช็คว่าส่งเลทหรือไม่ (หลัง 12:30 = 750 min)
        const isLate = currentTimeMin > DEADLINE_MIN ? 1 : 0;
        const arrivalTimeStr = toDateTime(planDate, currentTimeMin);

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

        // จุดส่งถัดไป + เวลาบริการส่งของ (3 นาที)
        currentTimeMin += SERVICE_MIN;
        curLat = nextStop.latitude;
        curLng = nextStop.longitude;
      }

      // วิ่งกลับร้าน
      const returnDist = distanceKm(curLat, curLng, SHOP.latitude, SHOP.longitude) * ROAD_FACTOR;
      jobDistance += returnDist;

      const finalDistance = round2(jobDistance);
      const fuelCost = round2(finalDistance * FUEL_BAHT_PER_KM);

      totalPlanDistance += finalDistance;
      totalPlanFuel += fuelCost;

      plannedJobs.push({
        rider_name: riderName,
        access_code: accessCode,
        route_color: routeColor,
        total_boxes: totalBoxes,
        distance_km: finalDistance,
        fuel_cost: fuelCost,
        stops,
      });
    }

    totalPlanDistance = round2(totalPlanDistance);
    totalPlanFuel = round2(totalPlanFuel);

    // บันทึกลงตาราง route_plan
    const [planResult] = await connection.query(
      `INSERT INTO route_plan (plan_date, plan_status, total_distance_km, total_fuel_cost) VALUES (?, 'planned', ?, ?)`,
      [planDate, totalPlanDistance, totalPlanFuel]
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

    res.status(201).json({
      message: "Route plan created successfully",
      plan_id: planId,
      plan_date: planDate,
      total_distance_km: totalPlanDistance,
      total_fuel_cost: totalPlanFuel,
      riders_count: plannedJobs.length,
      orders_count: pendingOrders.length,
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

    res.json({
      ...plan,
      shop: SHOP,
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

    // ปรับสถานะ orders ที่ยังไม่ส่ง (assigned) กลับเป็น pending
    if (orderList.length > 0) {
      await connection.query(
        `UPDATE orders SET order_status = 'pending' WHERE order_id IN (?) AND order_status <> 'delivered'`,
        [orderList]
      );
    }

    // ลบ route_plan (เนื่องจากมี CASCADE DELETE ใน DB จะลบ delivery_job และ job_stop ให้อัตโนมัติ)
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
