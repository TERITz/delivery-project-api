import { HttpErrorResponse } from '@angular/common/http';

// ดึงข้อความ error จาก backend (รูปแบบ { error: "..." }) มาแสดงให้ผู้ใช้
export function getApiError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า backend เปิดอยู่และ API_ENDPOINT ถูกต้อง';
    }
    const body = err.error;
    if (body && typeof body === 'object' && typeof body.error === 'string') {
      return body.error;
    }
    return `เกิดข้อผิดพลาด (${err.status})`;
  }
  return 'เกิดข้อผิดพลาดที่ไม่คาดคิด';
}

// HTTP status ของ error (0 = ต่อเซิร์ฟเวอร์ไม่ได้)
export function getApiStatus(err: unknown): number | null {
  return err instanceof HttpErrorResponse ? err.status : null;
}
