import express from "express";

export const router = express.Router();

// หน้าแรก บอกรายการ API ทั้งหมด
router.get("/", (req, res) => {
  res.redirect("/index.html");
});
