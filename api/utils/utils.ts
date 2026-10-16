// ฟังก์ชันช่วยทั่วไป

// คำนวณระยะทางเส้นตรงระหว่าง 2 พิกัด (กิโลเมตร) สูตร Haversine
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// SQL คำนวณระยะทาง (กม.) จากพิกัดที่ส่งมา ไปยังลูกค้า (ตาราง customer ต้องตั้งชื่อ alias ว่า c)
// ใส่ค่า ? ตามลำดับ: lat, lng, lat
export const DISTANCE_SQL =
  "(6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(c.latitude)) * COS(RADIANS(c.longitude) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(c.latitude)))))";

// วันที่วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD
export function todayString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

// เช็กว่าเป็นวันที่รูปแบบ YYYY-MM-DD หรือไม่
export function isDateString(s: any): boolean {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// แปลง "นาทีนับจากเที่ยงคืน" เป็นข้อความ DATETIME เช่น (2026-10-08, 705.5) => "2026-10-08 11:45:30"
export function toDateTime(date: string, minutes: number): string {
  const total = Math.round(minutes * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${date} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// สลับลำดับสมาชิกใน array แบบสุ่ม
export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
