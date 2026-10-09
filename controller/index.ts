import express from "express";

export const router = express.Router();

// หน้าแรก บอกรายการ API ทั้งหมด
router.get("/", (req, res) => {
  res.json({
    message: "Backend Project (ส่งด่วนมื้อเที่ยง)",
  });
});
