// ข้อมูลใบงานจากตาราง delivery_job
export interface DeliveryJob {
  job_id: number;
  plan_id: number;
  rider_name: string;
  access_code: string;
  route_color: string;
  total_boxes: number;
  distance_km: number;
  fuel_cost: number;
  job_status: "waiting_pickup" | "delivering" | "completed" | "assigned" | "in_progress" | "done" | string;
}

// ข้อมูลจุดส่งจากตาราง job_stop
export interface JobStop {
  stop_id: number;
  job_id: number;
  order_id: number;
  stop_sequence: number;
  arrival_time: string | null;
  is_late: number;
  delivered_at: string | null;
}

// ข้อมูลจุดส่งที่ JOIN กับ orders และ customer
export interface JobStopDetail extends JobStop {
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

// ข้อมูลสรุปของใบงานที่ส่งให้ Frontend ฝั่งไรเดอร์
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
