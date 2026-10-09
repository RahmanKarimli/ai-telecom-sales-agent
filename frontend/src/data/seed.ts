import type { Customer, Package, Recommendation, UsageData } from '../types';
import { initials, money } from '../lib/format';

export const packages: Package[] = [
  { id: 1, name: 'Starter', monthly_price_minor: 1200, currency: 'AZN', data_gb: 5, call_minutes: 100, extra_gb_price_minor: 100, extra_minute_price_minor: 5, active: true },
  { id: 2, name: 'Everyday', monthly_price_minor: 2000, currency: 'AZN', data_gb: 15, call_minutes: 300, extra_gb_price_minor: 100, extra_minute_price_minor: 5, active: true },
  { id: 3, name: 'Balanced', monthly_price_minor: 2800, currency: 'AZN', data_gb: 30, call_minutes: 500, extra_gb_price_minor: 100, extra_minute_price_minor: 5, active: true },
  { id: 4, name: 'Plus', monthly_price_minor: 4000, currency: 'AZN', data_gb: 50, call_minutes: 1000, extra_gb_price_minor: 100, extra_minute_price_minor: 5, active: true },
];
const people: [string, number, number, number, number, string][] = [
  ['Leyla Mammadova',2,25,28,30,'Personal'],
  ['Kamran Aliyev',1,11,13,14,'Personal'],
  ['Aysel Huseynova',2,33,37,39,'Business'],
  ['Murad Hasanov',1,14,14,15,'Personal'],
  ['Nigar Ismayilova',2,26,27,29,'Family'],
  ['Orkhan Karimov',2,37,42,46,'Business'],
  ['Sabina Ibrahimova',1,7,10,11,'Personal'],
  ['Elvin Rahimov',2,27,27,28,'Personal'],
  ['Gunel Abdullayeva',3,40,44,48,'Family'],
  ['Rashad Suleymanov',1,9,12,14,'Business'],
  ['Lala Agayeva',2,10,12,14,'Personal'],
  ['Tural Valiyev',3,24,28,29,'Personal'],
  ['Fidan Musayeva',2,28,30,34,'Family'],
  ['Emin Guliyev',1,11,12,13,'Personal'],
  ['Zahra Abbasova',2,32,35,37,'Business'],
  ['Farid Safarov',3,48,52,55,'Business'],
  ['Ulviya Jafarova',1,6,7,8,'Family'],
  ['Rena Ahmadova',2,21,23,25,'Personal'],
  ['Javid Babayev',1,13,15,16,'Personal'],
  ['Sona Hajiyeva',2,30,32,29,'Family'],
];
export const customers: Customer[] = people.map(([name, id, , , ,segment], index) => ({
  id: index + 1,
  name,
  initials: initials(name),
  email: `${name.toLowerCase().replace(/\s+/g,'.')}@example.test`,
  current_package_id: id,
  contact_allowed: index !== 15,
  do_not_contact: index === 15,
  segment,
}));
const months = ['2026-07', '2026-08', '2026-09'];
export const usages: UsageData[] = people.flatMap(([,currentId,d1,d2,d3], index) => {
  const current = packages.find(p => p.id === currentId)!;
  const datas = [d1,d2,d3];
  return months.map((month, i) => {
    const minutes = index === 0 ? [180,200,220][i]! : Math.round((current.call_minutes * (0.42 + (index % 4) * 0.13)) + 23 * i);
    const data_gb = datas[i]!;
    const extra_charges_minor = Math.max(0, data_gb - current.data_gb) * current.extra_gb_price_minor + Math.max(0, minutes - current.call_minutes) * current.extra_minute_price_minor;
    return { id: index * 3 + i + 1, customer_id: index + 1, month, data_gb, call_minutes: minutes, extra_charges_minor };
  });
});
export const recommendations: Recommendation[] = customers.flatMap(customer => {
  const current = packages.find(p => p.id === customer.current_package_id)!;
  const history = usages.filter(u => u.customer_id === customer.id);
  if (customer.do_not_contact || !customer.contact_allowed || history.length !== 3) return [];
  const count = history.filter(u => u.data_gb > current.data_gb || u.call_minutes > current.call_minutes).length;
  if (count < 2) return [];
  const peakGb = Math.max(...history.map(h => h.data_gb));
  const peakMins = Math.max(...history.map(h => h.call_minutes));
  const avgBill = current.monthly_price_minor + history.reduce((sum,h) => sum+h.extra_charges_minor,0)/3;
  const offer = packages.filter(p => p.active && p.id !== current.id && p.data_gb >= peakGb && p.call_minutes >= peakMins && avgBill - p.monthly_price_minor >= 200)
    .sort((a,b) => a.monthly_price_minor - b.monthly_price_minor || a.data_gb - b.data_gb || a.call_minutes - b.call_minutes || a.id - b.id)[0];
  if (!offer) return [];
  const saving = avgBill - offer.monthly_price_minor;
  const s = 45 * Math.min(1, (saving/avgBill)/0.25);
  const r = 30 * count/3;
  const f = 25 * Math.max(peakGb/offer.data_gb,peakMins/offer.call_minutes);
  return [{
    id: 100 + customer.id,
    customer_id: customer.id,
    package_id: offer.id,
    score: Math.round(s+r+f),
    average_bill_minor: Math.round(avgBill),
    estimated_savings_minor: Math.round(saving),
    score_breakdown: {savings:Math.round(s),recurrence:Math.round(r),fit:Math.round(f)},
    reason: `Data or minutes exceeded the ${current.name} allowance in ${count} of the last 3 months. ${offer.name} covers observed peak use up to ${peakGb} GB and ${peakMins} minutes and could reduce the observed average bill from ${money(avgBill)} to ${money(offer.monthly_price_minor)}.`,
    status:'pending' as const,
  }];
}).sort((a,b) => b.score-a.score || b.estimated_savings_minor-a.estimated_savings_minor || a.customer_id-b.customer_id);
