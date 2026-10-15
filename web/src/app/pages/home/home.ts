import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RULES } from '../../config/shop';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
})
export class HomePage {
  rules = RULES;

  menus = [
    { path: '/customers', title: 'ลูกค้า', desc: 'รายชื่อ เบอร์โทร และพิกัดจัดส่ง' },
    { path: '/orders', title: 'ออเดอร์', desc: 'ออเดอร์อาหารกล่องของแต่ละวัน' },
    { path: '/routes', title: 'แผนเส้นทาง', desc: 'จัดคิวและแบ่งงานให้ไรเดอร์' },
    { path: '/jobs', title: 'ใบงานไรเดอร์', desc: 'จุดส่งและสถานะการส่งของไรเดอร์' },
  ];
}
