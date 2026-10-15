import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_ENDPOINT } from '../../config/api';
import {
  DeliveredResponse,
  DeliveryJob,
  JobSimulateResponse,
  JobStatus,
  JobStatusResponse,
  RiderJobResponse,
} from '../../model/job';

// เรียก API ของ /jobs
@Injectable({ providedIn: 'root' })
export class JobService {
  private http = inject(HttpClient);
  private url = `${API_ENDPOINT}/jobs`;

  // GET /jobs  ใบงานทั้งหมด
  getAll(): Promise<DeliveryJob[]> {
    return firstValueFrom(this.http.get<DeliveryJob[]>(this.url));
  }

  // POST /jobs/login  { access_code }
  login(accessCode: string): Promise<RiderJobResponse> {
    return firstValueFrom(this.http.post<RiderJobResponse>(`${this.url}/login`, { access_code: accessCode }));
  }

  // GET /jobs/:access_code
  getByAccessCode(accessCode: string): Promise<RiderJobResponse> {
    return firstValueFrom(this.http.get<RiderJobResponse>(`${this.url}/${encodeURIComponent(accessCode)}`));
  }

  // PUT /jobs/:access_code/stops/:stop_id/delivered
  markDelivered(accessCode: string, stopId: number): Promise<DeliveredResponse> {
    return firstValueFrom(
      this.http.put<DeliveredResponse>(`${this.url}/${encodeURIComponent(accessCode)}/stops/${stopId}/delivered`, {}),
    );
  }

  // PUT /jobs/:access_code/status  { job_status }
  updateStatus(accessCode: string, jobStatus: JobStatus): Promise<JobStatusResponse> {
    return firstValueFrom(
      this.http.put<JobStatusResponse>(`${this.url}/${encodeURIComponent(accessCode)}/status`, { job_status: jobStatus }),
    );
  }

  // POST /jobs/simulate  จำลองใบงานไรเดอร์ (ไว้ทดสอบ)
  simulate(): Promise<JobSimulateResponse> {
    return firstValueFrom(this.http.post<JobSimulateResponse>(`${this.url}/simulate`, {}));
  }
}
