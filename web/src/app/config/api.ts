import { isDevMode } from '@angular/core';
// ที่อยู่ของ Web API (backend) — แก้ที่เดียวตรงนี้
// - รัน backend ในเครื่อง (npm run dev)  => http://localhost:3000
// - ใช้ตัวที่ deploy บน Vercel         => ใส่ URL ของ Vercel แทน (ไม่ต้องมี / ท้าย)
export const API_ENDPOINT = isDevMode() ? 'https://delivery-project-api-sepia.vercel.app' : '';
