import type { ShipmentOccurrence } from './shipping.service';

const wallTime = (date: Date, timeZone: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

// Resolve a foreign wall clock independently of the browser/server zone. An
// autumn DST overlap returns both offsets; choosing one belongs to the user.
export function shipmentOccurrenceChoices(local: string, timeZone: string): ShipmentOccurrence[] {
    if (!local) return [];
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) throw new Error('实际时间格式无效');
    const normalized = local.length === 16 ? `${local}:00` : local;
    const naive = Date.parse(`${normalized}Z`);
    if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== normalized) throw new Error('实际日期无效');
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 12) {
        const probe = naive + hours * 3_600_000;
        offsets.add((Date.parse(`${wallTime(new Date(probe), timeZone)}Z`) - probe) / 60_000);
    }
    return [...offsets].sort((a, b) => b - a).flatMap(offset => {
        if (!Number.isInteger(offset) || wallTime(new Date(naive - offset * 60_000), timeZone) !== normalized) return [];
        const minutes = Math.abs(offset), sign = offset < 0 ? '-' : '+';
        const suffix = `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        return [{ occurredAt: normalized + suffix, timeZone }];
    });
}
