import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

// เมนูของทุกหน้า — เพิ่มเมนูใหม่ที่ array links ด้านล่าง
@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
})
export class Navbar {
  links = [
    { path: '/customers', label: 'ลูกค้า' },
    { path: '/orders', label: 'ออเดอร์' },
    { path: '/routes', label: 'แผนเส้นทาง' },
    { path: '/jobs', label: 'ใบงานไรเดอร์' },
  ];

  // เมนูพับบนมือถือ
  menuOpen = signal(false);

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }
}
