import { DeliveryJob, JobStopDetail } from "./job";

export interface RoutePlan {
  plan_id: number;
  plan_date: string;
  plan_status: "planned" | "in_progress" | "completed" | "cancelled" | "draft" | "confirmed" | string;
  total_distance_km: number;
  total_fuel_cost: number;
}

export interface RoutePlanSummary extends RoutePlan {
  total_riders: number;
  total_orders: number;
  total_late: number;
}

export interface RoutePlanJobDetail extends DeliveryJob {
  stops: JobStopDetail[];
  late_stops_count?: number;
  google_maps_route_url?: string;
}

export interface RoutePlanWithDetails extends RoutePlan {
  shop?: {
    name: string;
    latitude: number;
    longitude: number;
  };
  jobs: DeliveryJob[];
}

export interface RoutePlanFullDetail extends RoutePlan {
  total_riders: number;
  total_orders: number;
  total_boxes: number;
  total_late: number;
  total_penalty_cost: number;
  jobs: RoutePlanJobDetail[];
}
