import React, { useState } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  formatDateKey,
  formatDisplayDate,
  formatInVisitorTime,
  getAvailableTimes,
  getHostTodayKey,
  getTimeLabel,
  MAX_DAYS_AHEAD,
  TIME_ZONE_LABEL,
  visitorIsInHostTimeZone
} from './booking.js';

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

// Month calendar + open times for one meeting length. Used by the booking page and the guest's
// reschedule screen. `cells` should already exclude the guest's own booking when rescheduling.
export default function SlotPicker({
  availability, cells, blocks, duration,
  selectedDate, selectedTime, onSelectDate, onSelectTime, onNext, nextLabel = 'Next'
}) {
  const [currentDate, setCurrentDate] = useState(() => selectedDate || new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const days = [];
    // Padding for first day
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} aria-hidden="true" />);
    }

    const now = Date.now();
    const hostTodayKey = getHostTodayKey(now);
    const thisMonth = new Date();
    const canGoBack = year > thisMonth.getFullYear() || (year === thisMonth.getFullYear() && month > thisMonth.getMonth());
    const canGoForward = new Date(year, month + 1, 1).getTime() <= now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;

    for (let day = 1; day <= daysInMonth; day++) {
      const iterDate = new Date(year, month, day);
      const dateKey = formatDateKey(iterDate);
      // Selectable only when the host's hours leave at least one open time (also covers past days,
      // days off, the booking window, full days and the notice period).
      const isSelectable = dateKey >= hostTodayKey
        && getAvailableTimes(dateKey, availability, cells, blocks, duration, now).length > 0;
      const isToday = dateKey === hostTodayKey;
      const isSelected = Boolean(selectedDate) && formatDateKey(selectedDate) === dateKey;

      days.push(
        <button
          key={`day-${day}`}
          onClick={() => isSelectable && onSelectDate(iterDate)}
          disabled={!isSelectable}
          aria-pressed={isSelected}
          aria-label={`${formatDisplayDate(iterDate)}${isSelectable ? '' : ', unavailable'}`}
          className={`relative mx-auto size-10 sm:size-11 rounded-full grid place-items-center text-sm transition-all duration-150
            ${isSelected
              ? 'bg-brand text-on-brand font-semibold shadow-[var(--shadow-pop)] scale-105'
              : isSelectable
                ? 'bg-brand-soft text-brand-ink font-semibold hover:bg-brand hover:text-on-brand cursor-pointer'
                : 'text-ink-3/60 cursor-not-allowed'}
          `}
        >
          {day}
          {isToday && (
            <span className={`absolute bottom-1 size-1 rounded-full ${isSelected ? 'bg-white' : 'bg-brand'}`} />
          )}
        </button>
      );
    }

    return (
      <div className="min-w-0">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-ink">
            {MONTH_NAMES[month]} <span className="text-ink-3 font-normal">{year}</span>
          </h3>
          <div className="flex gap-1">
            <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} disabled={!canGoBack} aria-label="Previous month" className="btn btn-ghost !p-2">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} disabled={!canGoForward} aria-label="Next month" className="btn btn-ghost !p-2">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-y-2 text-center mb-2">
          {DAY_NAMES.map(day => (
            <div key={day} className="text-[11px] font-semibold text-ink-3 tracking-widest">
              {day}
            </div>
          ))}
        </div>
        <div key={`${year}-${month}`} className="grid grid-cols-7 gap-y-1.5 animate-rise">
          {days}
        </div>
      </div>
    );
  };

  const renderTimeSlots = () => {
    if (!selectedDate) {
      return (
        <div className="hidden lg:flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-line p-6 text-ink-3">
          <CalendarDays size={28} className="mb-3" />
          <p className="text-sm">Pick a highlighted day to see open times.</p>
        </div>
      );
    }

    const dateString = formatDateKey(selectedDate);
    const availableSlots = getAvailableTimes(dateString, availability, cells, blocks, duration)
      .map(time => ({ id: time, label: getTimeLabel(time) }));
    const showVisitorTime = !visitorIsInHostTimeZone();

    return (
      <div key={dateString} className="min-w-0 animate-rise">
        <h3 className="text-base font-semibold text-ink">{formatDisplayDate(selectedDate)}</h3>
        <p className="text-xs text-ink-3 mt-0.5 mb-4">Times in {TIME_ZONE_LABEL}</p>
        <div className="flex flex-col gap-2 lg:max-h-[380px] lg:overflow-y-auto lg:pr-1 -mr-1">
          {availableSlots.map(slot => {
            const isSelected = selectedTime === slot.id;

            return (
              <div key={slot.id} className="flex gap-2">
                <button
                  onClick={() => onSelectTime(slot.id)}
                  aria-pressed={isSelected}
                  className={`min-h-12 rounded-xl border text-sm font-semibold transition-all duration-200
                    ${isSelected
                      ? 'flex-1 bg-ink text-surface border-ink'
                      : 'w-full bg-surface border-line text-ink hover:border-brand hover:text-brand'}
                  `}
                >
                  {slot.label}
                  {showVisitorTime && (
                    <span className={`block text-[11px] font-normal ${isSelected ? 'opacity-70' : 'text-ink-3'}`}>
                      {formatInVisitorTime(dateString, slot.id)} your time
                    </span>
                  )}
                </button>
                {isSelected && (
                  <button onClick={onNext} className="btn btn-primary flex-1 !rounded-xl animate-rise">
                    {nextLabel} <ArrowRight size={16} />
                  </button>
                )}
              </div>
            );
          })}
          {availableSlots.length === 0 && (
            <p className="text-ink-3 text-sm rounded-xl bg-muted px-4 py-6 text-center">No open times on this day.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
      {renderCalendar()}
      {renderTimeSlots()}
    </div>
  );
}
