/**
 * 打卡日历：月视图（周一起始），打卡成功日打勾，今天高亮，可翻月
 */
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { DailyCheckIn } from '@application/ports';
import { formatLocalDate } from '@application/shared/utils';

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface Props {
  yearMonth: string;
  records: Record<string, DailyCheckIn>;
  loading: boolean;
  onShift: (delta: number) => void;
}

export function CheckInCalendar({ yearMonth, records, loading, onShift }: Props) {
  const [year, month] = yearMonth.split('-').map(Number);
  const todayStr = formatLocalDate(new Date());
  const daysInMonth = new Date(year, month, 0).getDate();
  // 周一为一周第一天
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: ({ day: number; dateStr: string; record?: DailyCheckIn } | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${yearMonth}-${String(day).padStart(2, '0')}`;
      return { day, dateStr, record: records[dateStr] };
    }),
  ];

  return (
    <div className="checkin-cal">
      <div className="checkin-cal__head">
        <span className="checkin-cal__month">
          {year}年{month}月
        </span>
        <div className="checkin-cal__nav">
          <button
            type="button"
            aria-label="上个月"
            disabled={loading}
            onClick={() => onShift(-1)}
          >
            <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="下个月"
            disabled={loading}
            onClick={() => onShift(1)}
          >
            <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="checkin-cal__week">
        {WEEK_LABELS.map((label) => (
          <span key={label} className="checkin-cal__weekday">
            {label}
          </span>
        ))}
      </div>
      <div className="checkin-cal__grid">
        {cells.map((cell, index) =>
          cell ? (
            <div
              key={cell.dateStr}
              className="checkin-cal__cell"
              data-done={cell.record?.checkInDone}
              data-today={cell.dateStr === todayStr}
              title={cell.record?.checkInDone ? `${cell.dateStr} 已学习` : cell.dateStr}
            >
              {cell.record?.checkInDone ? (
                <Check size={12} strokeWidth={3} aria-hidden="true" />
              ) : (
                cell.day
              )}
            </div>
          ) : (
            <div key={`blank-${index}`} className="checkin-cal__cell checkin-cal__cell--blank" />
          )
        )}
      </div>
    </div>
  );
}
