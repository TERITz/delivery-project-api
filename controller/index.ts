import express from "express";

export const router = express.Router();

// หน้าแรก บอกรายการ API ทั้งหมด
router.get("/", (req, res) => {
  res.json({
    message: "Lunch Rider API (ส่งด่วนมื้อเที่ยง)",
    endpoints: {
      customers: "GET/POST /customers, GET /customers/search, GET /customers/nearby, GET/PUT/DELETE /customers/:id, POST /customers/simulate",
      orders: "GET/POST /orders, GET /orders/nearby, GET/PUT/DELETE /orders/:id, POST /orders/simulate, DELETE /orders/all",
      routes: "POST /routes/plan, GET /routes, GET/DELETE /routes/:plan_id",
      jobs: "GET /jobs, POST /jobs/login, GET /jobs/:access_code, PUT /jobs/:access_code/stops/:stop_id/delivered, PUT /jobs/:access_code/status, POST /jobs/simulate",
    },
  });
});
