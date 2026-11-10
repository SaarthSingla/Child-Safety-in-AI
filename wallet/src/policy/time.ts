// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import type { DecisionContext } from './types';

export const QUARTER_HOUR_MS = 15 * 60 * 1000;

export function parseTime(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function formatTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

// YYYY-MM-DDTHH:MM on the child's local clock, as minutes since 1970.
export function localMinutes(local: string): number {
  const [date, time] = local.split('T');
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 60000) + parseTime(time);
}

function localParts(instant: Date, timeZone: string): { year: number; month: number; day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), minute: get('hour') * 60 + get('minute') };
}

export function contextAt(instant: Date, timeZone: string): DecisionContext {
  const { year, month, day, minute } = localParts(instant, timeZone);
  const midnight = Math.floor(Date.UTC(year, month - 1, day) / 60000);
  // 1 January 1970 was a Thursday; Monday is day 0.
  const weekday = (Math.floor(midnight / 1440) + 3) % 7;
  return { minute, day: weekday, prev_day: (weekday + 6) % 7, now: midnight + minute };
}

// Rule times are on quarter hours, so answers can always expire at the next
// quarter hour. That way the expiry says nothing about the family's rules.
export function nextQuarterHour(instant: Date): Date {
  return new Date((Math.floor(instant.getTime() / QUARTER_HOUR_MS) + 1) * QUARTER_HOUR_MS);
}

// A child can wind the phone's clock back, but not past the last time a
// signed policy proved was real.
export function trustedNow(deviceNow: Date, lastSignedTime: string | null | undefined): Date {
  const floor = lastSignedTime ? Date.parse(lastSignedTime) : NaN;
  return Number.isFinite(floor) && floor > deviceNow.getTime() ? new Date(floor) : deviceNow;
}
