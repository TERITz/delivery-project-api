// ตรงกับตาราง delivery_job / job_stop และ /jobs ของ backend
export type JobStatus = 'waiting_pickup' | 'delivering' | 'completed' | 'assigned' | 'in_progress' | 'done';

export interface DeliveryJob {
  job_id: number;
  plan_id: number;
  rider_name: string;
  access_code: string;
  route_color: string;
  total_boxes: number;
  distance_km: number;
  fuel_cost: number;
  job_status: JobStatus | string;
}

// จุดส่งที่ JOIN กับ orders และ customer แล้ว
// หมายเหตุ: backend แปลง is_late เป็น boolean ก่อนส่งออก
export interface JobStopDetail {
  stop_id: number;
  job_id: number;
  order_id: number;
  stop_sequence: number;
  arrival_time: string | null;
  is_late: boolean;
  delivered_at: string | null;
  box_count: number;
  order_status: string;
  delivery_note: string | null;
  customer_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  address: string | null;
  latitude: number;
  longitude: number;
  google_maps_url: string;
  google_maps_link?: string;
}

// ผลของ POST /jobs/login และ GET /jobs/:access_code
export interface RiderJobResponse {
  job: DeliveryJob;
  summary: {
    total_stops: number;
    delivered_stops: number;
    remaining_stops: number;
    total_boxes: number;
  };
  google_maps_route_url?: string;
  stops: JobStopDetail[];
}

// ผลของ PUT /jobs/:access_code/stops/:stop_id/delivered
export interface DeliveredResponse {
  success?: boolean;
  message: string;
  stop_id: number;
  order_id?: number;
  delivered_at: string;
  is_late: boolean;
  penalty_baht?: number;
  remaining_stops?: number;
  job_status: string;
}

// ผลของ PUT /jobs/:access_code/status
export interface JobStatusResponse {
  success: boolean;
  message: string;
  job_status: string;
}

// ผลของ POST /jobs/simulate
export interface JobSimulateResponse {
  message: string;
  access_code: string;
  job: RiderJobResponse | null;
}
