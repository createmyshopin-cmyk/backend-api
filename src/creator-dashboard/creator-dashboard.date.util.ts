const TZ = 'Asia/Kolkata';

/** YYYY-MM-DD in Asia/Kolkata */
export function istDateString(at: Date = new Date()): string {
  return at.toLocaleDateString('en-CA', { timeZone: TZ });
}

export function istDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return istDateString(d);
}

export function fillChart7Days(series: Array<{ date: string }>, endDate: string): string[] {
  const dates: string[] = [];
  const end = new Date(`${endDate}T12:00:00`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(istDateString(d));
  }
  return dates;
}
