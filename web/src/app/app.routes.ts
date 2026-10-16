import { Routes } from '@angular/router';

// ไฟล์นี้ทุกคนต้องแตะ — เจ้าของไฟล์คือคนที่ 1
// ให้เพื่อนส่ง "บรรทัด route" มาให้ แล้วคนที่ 1 เอามาวางต่อในอาร์เรย์ด้านล่าง
// ทุก route ใช้ loadComponent (lazy) บรรทัดเดียวจบ ไม่ต้องแก้ import ด้านบน จึงไม่ชนกัน
export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'หน้าแรก', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage) },

  // ---- คนที่ 1: ลูกค้า ----
  { path: 'customers', title: 'ลูกค้า', loadComponent: () => import('./pages/customer/customer').then((m) => m.CustomerPage) },

  // ---- ออเดอร์ (เพื่อนทำต่อในไฟล์ pages/order/order.ts) ----
  { path: 'orders', title: 'ออเดอร์', loadComponent: () => import('./pages/order/order').then((m) => m.OrderPage) },

  // ---- แผนเส้นทาง (เพื่อนทำต่อในไฟล์ pages/route/route.ts) ----
  { path: 'routes', title: 'แผนเส้นทาง', loadComponent: () => import('./pages/route/route').then((m) => m.RoutePage) },

  // ---- ใบงานไรเดอร์ (เพื่อนทำต่อในไฟล์ pages/job/job.ts) ----
  { path: 'jobs', title: 'ใบงานไรเดอร์', loadComponent: () => import('./pages/job/job').then((m) => m.JobPage) },

  // path ที่ไม่มี => กลับหน้าแรก (ต้องอยู่ล่างสุดเสมอ)
  { path: '**', redirectTo: '' },
];
