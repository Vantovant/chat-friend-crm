import { useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// value/onChange use the "datetime-local" string format: "YYYY-MM-DDTHH:mm"
export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick date & time',
  className,
  dateOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  dateOnly?: boolean;
}) {
  const date = useMemo(() => {
    if (!value) return undefined;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }, [value]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const toLocal = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const handleDay = (d: Date | undefined) => {
    if (!d) return;
    const base = date ?? new Date();
    const merged = new Date(d);
    merged.setHours(dateOnly ? 9 : base.getHours());
    merged.setMinutes(dateOnly ? 0 : base.getMinutes());
    merged.setSeconds(0);
    onChange(toLocal(merged));
  };

  const handleTime = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const base = date ?? new Date();
    const merged = new Date(base);
    merged.setHours(h || 0);
    merged.setMinutes(m || 0);
    merged.setSeconds(0);
    onChange(toLocal(merged));
  };

  const label = date
    ? dateOnly
      ? format(date, 'PP')
      : format(date, 'PP p')
    : placeholder;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 w-full bg-background/60 border border-border rounded-md px-2 py-1 text-[11px] text-left outline-none hover:border-primary/50 focus:border-primary/50',
            !date && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-50" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleDay}
          initialFocus
          className={cn('p-3 pointer-events-auto')}
        />
        {!dateOnly && (
          <div className="border-t border-border p-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Time</span>
            <input
              type="time"
              value={date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ''}
              onChange={handleTime}
              className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary/50"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
