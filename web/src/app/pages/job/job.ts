import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { SHOP } from '../../config/shop';
import { DeliveryJob, JobStatus, JobStopDetail, RiderJobResponse } from '../../model/job';
import { getApiError } from '../../services/api/api-error';
import { JobService } from '../../services/api/job.service';

@Component({
  selector: 'app-job',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './job.html',
})
export class JobPage implements OnInit {
  private jobService = inject(JobService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // ---------- State ----------
  accessCodeInput = signal<string>('');
  currentAccessCode = signal<string | null>(null);
  jobData = signal<RiderJobResponse | null>(null);

  loading = signal<boolean>(false);
  actionLoading = signal<string | number | null>(null);
  errorMessage = signal<string>('');
  toastMessage = signal<string | null>(null);

  recentJobs = signal<DeliveryJob[]>([]);
  loadingRecentJobs = signal<boolean>(false);
  simulating = signal<boolean>(false);

  // ยืนยันการส่งจุด
  confirmingStopId = signal<number | null>(null);
  confirmingStop = computed<JobStopDetail | null>(() => {
    const id = this.confirmingStopId();
    if (id == null) return null;
    return this.stops().find((s) => s.stop_id === id) ?? null;
  });

  // ---------- Computed Properties ----------
  job = computed(() => this.jobData()?.job ?? null);
  summary = computed(() => this.jobData()?.summary ?? null);

  // รายการจุดส่งเรียงตามลำดับ stop_sequence
  stops = computed<JobStopDetail[]>(() => {
    const list = this.jobData()?.stops;
    if (!list) return [];
    return [...list].sort((a, b) => (a.stop_sequence ?? 0) - (b.stop_sequence ?? 0));
  });

  // จำนวนกล่องรวมทั้งหมด
  totalBoxes = computed<number>(() => {
    return this.summary()?.total_boxes ?? this.job()?.total_boxes ?? 0;
  });

  // สถานะใบงาน
  jobStatus = computed<string>(() => {
    return this.job()?.job_status ?? '';
  });

  isWaitingPickup = computed<boolean>(() => {
    const status = (this.jobStatus() || '').toLowerCase();
    return status !== 'delivering' && status !== 'in_progress' && status !== 'completed' && status !== 'done';
  });

  isDelivering = computed<boolean>(() => {
    const status = (this.jobStatus() || '').toLowerCase();
    return status === 'delivering' || status === 'in_progress';
  });

  isCompleted = computed<boolean>(() => {
    const status = (this.jobStatus() || '').toLowerCase();
    return status === 'completed' || status === 'done';
  });

  // ตรวจสอบว่าส่งครบทุกจุดหรือยัง
  allStopsDelivered = computed<boolean>(() => {
    const s = this.stops();
    if (s.length === 0) return false;
    return s.every((stop) => stop.delivered_at != null || stop.order_status === 'delivered');
  });

  // จุดส่งปัจจุบันที่ต้องส่งลำดับถัดไป (จุดแรกที่ยังไม่ได้ส่ง และต้องรับอาหารแล้วเท่านั้น)
  currentActiveStop = computed<JobStopDetail | null>(() => {
    if (this.isWaitingPickup()) return null;
    return this.stops().find((s) => s.delivered_at == null && s.order_status !== 'delivered') ?? null;
  });

  // ตรวจสอบว่าจุดนี้สามารถกดส่งได้หรือไม่ (ต้องรับอาหารก่อน และต้องเรียงตามลำดับจากอันแรกก่อนเสมอ)
  canDeliverStop(stop: JobStopDetail): boolean {
    if (this.isWaitingPickup()) return false;
    if (stop.delivered_at != null || stop.order_status === 'delivered') return false;
    return this.currentActiveStop()?.stop_id === stop.stop_id;
  }

  // เปอร์เซ็นต์ความคืบหน้าในการส่ง
  progressPercentage = computed<number>(() => {
    const sum = this.summary();
    if (!sum || sum.total_stops === 0) return 0;
    return Math.round((sum.delivered_stops / sum.total_stops) * 100);
  });

  // URL แผนที่ Google Maps ทั้งเส้นทาง
  routeMapUrl = computed<string>(() => {
    const rawUrl = this.jobData()?.google_maps_route_url;
    if (rawUrl && rawUrl.trim() !== '') {
      return rawUrl;
    }

    // กรณี backend ไม่ได้ส่ง google_maps_route_url มา ให้ประกอบลิงก์เส้นทาง Google Maps Directions
    const sortedStops = this.stops();
    if (sortedStops.length === 0) return '';

    const origin = `${SHOP.latitude},${SHOP.longitude}`;
    const destinationStop = sortedStops[sortedStops.length - 1];
    const destination = `${destinationStop.latitude},${destinationStop.longitude}`;

    // waypoints จุดส่งตรงกลาง (ถ้ามี)
    if (sortedStops.length > 1) {
      const waypoints = sortedStops
        .slice(0, sortedStops.length - 1)
        .map((s) => `${s.latitude},${s.longitude}`)
        .join('|');
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypoints)}&travelmode=motorcycle`;
    }

    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=motorcycle`;
  });

  ngOnInit(): void {
    // 1. ตรวจสอบ query param (เช่น /jobs?access_code=RIDE-01)
    const codeFromQuery = this.route.snapshot.queryParamMap.get('access_code') || this.route.snapshot.queryParamMap.get('code');
    // 2. ตรวจสอบ localStorage
    const savedCode = localStorage.getItem('rider_access_code');

    const targetCode = codeFromQuery?.trim() || savedCode?.trim();
    if (targetCode) {
      this.accessCodeInput.set(targetCode);
      this.loadJob(targetCode);
    } else {
      this.loadRecentJobs();
    }
  }

  // โหลดรายชื่อใบงานทั้งหมดเพื่อให้เลือกทดสอบได้ง่ายบนมือถือ
  async loadRecentJobs(): Promise<void> {
    try {
      this.loadingRecentJobs.set(true);
      const jobs = await this.jobService.getAll();
      this.recentJobs.set(jobs || []);
    } catch {
      // ไม่แสดง error ขัดจังหวะถ้า backend ยังไม่มีใบงาน
      this.recentJobs.set([]);
    } finally {
      this.loadingRecentJobs.set(false);
    }
  }

  // ล็อกอินเข้าดูใบงานด้วย access_code
  async login(): Promise<void> {
    const code = this.accessCodeInput().trim();
    if (!code) {
      this.errorMessage.set('กรุณาระบุรหัสใบงาน (Access Code)');
      return;
    }
    await this.loadJob(code);
  }

  // เลือกใบงานจากรายการทดสอบ
  async selectJob(job: DeliveryJob): Promise<void> {
    this.accessCodeInput.set(job.access_code);
    await this.loadJob(job.access_code);
  }

  // โหลดข้อมูลใบงานจาก API
  async loadJob(code: string): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      // เรียก POST /jobs/login หรือ GET /jobs/:access_code
      let data: RiderJobResponse;
      try {
        data = await this.jobService.login(code);
      } catch {
        // หาก login endpoint มีปัญหา ลองใช้ getByAccessCode แทน
        data = await this.jobService.getByAccessCode(code);
      }

      this.jobData.set(data);
      this.currentAccessCode.set(code);
      localStorage.setItem('rider_access_code', code);

      // อัปเดต query params ใน URL แบบไม่ reload หน้า
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { access_code: code },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });

      this.showToast(`เข้าสู่ระบบใบงานเรียบร้อย (${data.job?.rider_name || 'ไรเดอร์'})`);
    } catch (err) {
      this.errorMessage.set(getApiError(err));
      this.jobData.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  // รีเฟรชข้อมูลใบงานล่าสุด
  async refreshJob(): Promise<void> {
    const code = this.currentAccessCode();
    if (!code) return;
    await this.loadJob(code);
  }

  // ปุ่มรับอาหาร: เปลี่ยนสถานะเป็น delivering
  async acceptPickup(): Promise<void> {
    const code = this.currentAccessCode();
    if (!code) return;

    this.actionLoading.set('pickup');
    this.errorMessage.set('');

    try {
      const res = await this.jobService.updateStatus(code, 'delivering' as JobStatus);

      // อัปเดตหน้าทันที
      this.jobData.update((data) => {
        if (!data) return null;
        return {
          ...data,
          job: {
            ...data.job,
            job_status: res.job_status || 'delivering',
          },
        };
      });

      this.showToast('รับอาหารเรียบร้อยแล้ว เริ่มออกเดินทางจัดส่งได้เลย!');
    } catch (err) {
      this.errorMessage.set(getApiError(err));
    } finally {
      this.actionLoading.set(null);
    }
  }

  // เปิด modal ยืนยันก่อนกดส่ง
  promptDeliverStop(stopId: number): void {
    const stop = this.stops().find((s) => s.stop_id === stopId);
    if (!stop) return;

    if (this.isWaitingPickup()) {
      this.errorMessage.set('กรุณากดรับอาหารก่อนเริ่มส่งออเดอร์');
      return;
    }

    if (!this.canDeliverStop(stop)) {
      const active = this.currentActiveStop();
      if (active) {
        this.errorMessage.set(`กรุณาส่งจุดที่ #${active.stop_sequence} (${active.first_name}) ให้เรียบร้อยก่อน`);
      } else {
        this.errorMessage.set('ไม่สามารถส่งจุดนี้ได้ในขณะนี้');
      }
      return;
    }

    this.confirmingStopId.set(stopId);
  }

  cancelConfirm(): void {
    this.confirmingStopId.set(null);
  }

  // ปุ่มกด "ส่งแล้ว" แต่ละจุด แล้วอัปเดตหน้าทันที
  async confirmDeliverStop(stop: JobStopDetail): Promise<void> {
    const code = this.currentAccessCode();
    if (!code) return;

    if (this.isWaitingPickup()) {
      this.errorMessage.set('กรุณากดรับอาหารก่อนเริ่มส่งออเดอร์');
      return;
    }

    if (!this.canDeliverStop(stop)) {
      const active = this.currentActiveStop();
      if (active) {
        this.errorMessage.set(`กรุณาส่งจุดที่ #${active.stop_sequence} (${active.first_name}) ให้เรียบร้อยก่อน`);
      }
      return;
    }

    const stopId = stop.stop_id;
    this.actionLoading.set(stopId);
    this.errorMessage.set('');
    this.confirmingStopId.set(null);

    try {
      const res = await this.jobService.markDelivered(code, stopId);

      // อัปเดตหน้าจอทันที (อัปเดตสถานะจุดส่ง, เวลา, จำนวนจุดส่งที่เหลือ)
      this.jobData.update((prev) => {
        if (!prev) return null;

        const updatedStops = prev.stops.map((s) => {
          if (s.stop_id === stopId) {
            return {
              ...s,
              delivered_at: res.delivered_at || new Date().toISOString(),
              order_status: 'delivered',
              is_late: res.is_late ?? s.is_late,
            };
          }
          return s;
        });

        const deliveredCount = updatedStops.filter(
          (s) => s.delivered_at != null || s.order_status === 'delivered',
        ).length;
        const totalCount = updatedStops.length;
        const remainingCount = Math.max(0, totalCount - deliveredCount);

        const newJobStatus = res.job_status || (remainingCount === 0 ? 'completed' : prev.job.job_status);

        return {
          ...prev,
          stops: updatedStops,
          job: {
            ...prev.job,
            job_status: newJobStatus,
          },
          summary: {
            ...prev.summary,
            delivered_stops: deliveredCount,
            remaining_stops: remainingCount,
          },
        };
      });

      const penaltyText = res.penalty_baht && res.penalty_baht > 0 ? ` (ปรับล่าช้า ฿${res.penalty_baht})` : '';
      this.showToast(`จุดส่งที่ #${stop.stop_sequence} ส่งสำเร็จแล้ว!${penaltyText}`);
    } catch (err) {
      this.errorMessage.set(getApiError(err));
    } finally {
      this.actionLoading.set(null);
    }
  }

  // จำลองใบงานทดสอบผ่าน API เซิร์ฟเวอร์
  async simulateJob(): Promise<void> {
    this.simulating.set(true);
    this.errorMessage.set('');

    try {
      const res = await this.jobService.simulate();
      if (res.access_code) {
        this.accessCodeInput.set(res.access_code);
        await this.loadJob(res.access_code);
        this.showToast('สร้างใบงานทดสอบสำเร็จ!');
      } else {
        this.showToast(res.message || 'จำลองใบงานสำเร็จ');
        await this.loadRecentJobs();
      }
    } catch (err) {
      this.errorMessage.set(getApiError(err));
    } finally {
      this.simulating.set(false);
    }
  }

  // เปลี่ยนใบงาน / ออกจากระบบ
  logout(): void {
    localStorage.removeItem('rider_access_code');
    this.currentAccessCode.set(null);
    this.jobData.set(null);
    this.accessCodeInput.set('');
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { access_code: null, code: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.loadRecentJobs();
  }

  // ลิงก์แผนที่ Google Maps รายจุด
  getStopMapUrl(stop: JobStopDetail): string {
    if (stop.google_maps_url && stop.google_maps_url.trim() !== '') {
      return stop.google_maps_url;
    }
    if (stop.google_maps_link && stop.google_maps_link.trim() !== '') {
      return stop.google_maps_link;
    }
    if (stop.latitude && stop.longitude) {
      return `https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}&travelmode=motorcycle`;
    }
    if (stop.address) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`;
    }
    return '#';
  }

  // ข้อความและสีของสถานะงาน
  getStatusBadge(status: string): { text: string; cssClass: string } {
    switch (status) {
      case 'waiting_pickup':
      case 'assigned':
        return { text: 'รอรับอาหาร', cssClass: 'badge-warning text-warning-content' };
      case 'delivering':
      case 'in_progress':
        return { text: 'กำลังจัดส่ง', cssClass: 'badge-info text-info-content' };
      case 'completed':
      case 'done':
        return { text: 'จัดส่งสำเร็จครบถ้วน', cssClass: 'badge-success text-success-content' };
      default:
        return { text: status || 'ไม่ระบุ', cssClass: 'badge-neutral' };
    }
  }

  // แสดง toast ชั่วคราว 4 วินาที
  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => {
      if (this.toastMessage() === msg) {
        this.toastMessage.set(null);
      }
    }, 4000);
  }
}
