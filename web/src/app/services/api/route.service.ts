import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_ENDPOINT } from '../../config/api';
import {
  RoutePlan,
  RoutePlanCreateResponse,
  RoutePlanDeleteResponse,
  RoutePlanDetail,
  RoutePlanRequest,
} from '../../model/route';

// เรียก API ของ /routes
@Injectable({ providedIn: 'root' })
export class RouteService {
  private http = inject(HttpClient);
  private url = `${API_ENDPOINT}/routes`;

  // POST /routes/plan  จัดเส้นทางให้ไรเดอร์จากออเดอร์ที่ยัง pending
  plan(body: RoutePlanRequest = {}): Promise<RoutePlanCreateResponse> {
    return firstValueFrom(this.http.post<RoutePlanCreateResponse>(`${this.url}/plan`, body));
  }

  // GET /routes
  getAll(): Promise<RoutePlan[]> {
    return firstValueFrom(this.http.get<RoutePlan[]>(this.url));
  }

  // GET /routes/:plan_id  (ไรเดอร์ทุกคน + จุดส่งเรียงลำดับ + พิกัด)
  getById(planId: number): Promise<RoutePlanDetail> {
    return firstValueFrom(this.http.get<RoutePlanDetail>(`${this.url}/${planId}`));
  }

  // DELETE /routes/:plan_id
  delete(planId: number): Promise<RoutePlanDeleteResponse> {
    return firstValueFrom(this.http.delete<RoutePlanDeleteResponse>(`${this.url}/${planId}`));
  }
}
