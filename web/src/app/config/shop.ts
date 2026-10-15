// พิกัดร้าน — ต้องตรงกับ SHOP ใน backend (config/config.ts)
// ใช้เป็นค่าเริ่มต้นของแผนที่/ช่องกรอกพิกัดในหน้าต่าง ๆ
export const SHOP = {
  name: 'ส่งด่วนมื้อเที่ยง',
  latitude: 16.1832,
  longitude: 103.3,
};

// กติกาเดียวกับ backend (config/config.ts) — ถ้าฝั่ง backend แก้ ให้แก้ตรงนี้ตาม
export const MAX_BOX_PER_ORDER = 3; // 1 ออเดอร์สั่งได้ไม่เกิน 3 กล่อง
export const RULES = {
  cookDone: '11:30', // อาหารเสร็จ
  deadline: '12:30', // ต้องส่งถึงก่อนเวลานี้
  boxCapacity: 10, // ไรเดอร์ 1 คนขนได้สูงสุดกี่กล่อง
  latePenaltyBaht: 20, // ค่าปรับต่อออเดอร์ที่ส่งเลท
};
