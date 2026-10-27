import { DeliveryJob, JobStopDetail } from './job';

// ตรงกับตาราง route_plan และ /routes ของ backend
export interface RoutePlan {
  plan_id: number;
  plan_date: string; // YYYY-MM-DD
  plan_status: 'planned' | 'in_progress' | 'completed' | 'cancelled' | string;
  total_distance_km: number;
  total_fuel_cost: number;
}

// body ของ POST /routes/plan (ไม่ส่งก็ได้ backend จะใช้วันนี้)
export interface RoutePlanRequest {
  plan_date?: string;
  replace_plan_id?: number; // คำนวณใหม่: ลบแผนเดิมนี้แล้วจัดใหม่
  variant?: number; // 0 = วิธีเดิม, 1+ = ทางเลือกอื่น
}

// จุดส่งในผลลัพธ์ของ POST /routes/plan
export interface PlannedStop {
  order_id: number;
  stop_sequence: number;
  arrival_time: string;
  is_late: boolean;
  distance_from_prev: number;
  latitude: number;
  longitude: number;
  google_maps_url: string;
  google_maps_link: string;
}

export interface PlannedJob {
  rider_name: string;
  access_code: string;
  route_color: string;
  total_boxes: number;
  distance_km: number;
  fuel_cost: number;
  stops: PlannedStop[];
}

// ผลของ POST /routes/plan
export interface RoutePlanCreateResponse {
  message: string;
  plan_id: number;
  plan_date: string;
  total_distance_km: number;
  total_fuel_cost: number;
  riders_count: number;
  orders_count: number;
  jobs: PlannedJob[];
}

// ไรเดอร์ 1 คนในแผน พร้อมจุดส่งเรียงลำดับ
export interface RoutePlanJobDetail extends DeliveryJob {
  stops: JobStopDetail[];
}

// ผลของ GET /routes/:plan_id
export interface RoutePlanDetail extends RoutePlan {
  shop: { name: string; latitude: number; longitude: number };
  jobs: RoutePlanJobDetail[];
}

// ผลของ DELETE /routes/:plan_id
export interface RoutePlanDeleteResponse {
  message: string;
  affected_rows: number;
}