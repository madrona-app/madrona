import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPipelineSchedule, updatePipelineSchedule } from '../lib/api';
import type { PipelineSchedule } from '../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { ModalPortal } from './ModalPortal';

/**
 * Compute the next run time for a schedule based on current settings.
 * This is a client-side preview only - the actual next_run_at is computed server-side.
 */
function computeNextRunPreview(
  scheduleType: 'interval' | 'time',
  everyN: number,
  unit: 'minutes' | 'hours' | 'days',
  timeHour: number,
  timeMinute: number
): Date | null {
  try {
    const now = new Date();

    if (scheduleType === 'interval') {
      // For interval schedules, round up to the next boundary
      const minutesInterval = unit === 'minutes' ? everyN : unit === 'hours' ? everyN * 60 : everyN * 24 * 60;
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const nextBoundary = Math.ceil(nowMinutes / minutesInterval) * minutesInterval;

      const nextRun = new Date(now);
      nextRun.setUTCHours(0, nextBoundary, 0, 0);

      // If we went backwards, add the interval
      if (nextRun <= now) {
        nextRun.setUTCMinutes(nextRun.getUTCMinutes() + minutesInterval);
      }

      return nextRun;
    } else {
      // For time-based schedules, find the next occurrence of the specified time
      // Note: This is a simplified version - server handles timezone conversions properly
      const nextRun = new Date(now);
      nextRun.setUTCHours(timeHour, timeMinute, 0, 0);

      // If the time has passed today, schedule for tomorrow
      if (nextRun <= now) {
        nextRun.setUTCDate(nextRun.getUTCDate() + 1);
      }

      return nextRun;
    }
  } catch {
    // If any error occurs (invalid inputs, etc.), return null to hide preview
    return null;
  }
}

/**
 * Format a date for display in the next run preview
 */
function formatNextRun(date: Date | null): string | null {
  if (!date) return null;

  try {
    // Format: "Jan 13, 2026 at 10:45 UTC"
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    };

    const formatted = new Intl.DateTimeFormat('en-US', options).format(date);
    // Convert "Jan 13, 2026, 10:45" to "Jan 13, 2026 at 10:45 UTC"
    // The format is actually "Month Day, Year, HH:MM"
    const withAt = formatted.replace(/,\s*(\d{2}:\d{2})/, ' at $1');
    return withAt + ' UTC';
  } catch {
    return null;
  }
}

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  pipelineId: string;
  schedule?: PipelineSchedule | null;
  mode: 'create' | 'edit';
}

export default function ScheduleModal({
  isOpen,
  onClose,
  pipelineId,
  schedule,
  mode,
}: ScheduleModalProps) {
  const queryClient = useQueryClient();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'schedule-modal',
  });

  // Compute initial values based on mode and schedule
  const getInitialValues = () => {
    if (mode === 'edit' && schedule) {
      return {
        enabled: schedule.enabled,
        scheduleType: schedule.type,
        everyN: schedule.every_n || 15,
        unit: schedule.unit || 'minutes',
        timeHour: schedule.time_hour || 9,
        timeMinute: schedule.time_minute || 0,
        timezone: schedule.timezone,
      };
    }
    return {
      enabled: false,
      scheduleType: 'interval' as const,
      everyN: 15,
      unit: 'minutes' as const,
      timeHour: 9,
      timeMinute: 0,
      timezone: 'UTC',
    };
  };

  // Track the key for resetting form state
  const formKey = `${mode}-${schedule?.schedule_id || 'new'}-${isOpen}`;
  const [lastFormKey, setLastFormKey] = useState(formKey);

  // Get initial values (will be recalculated when formKey changes)
  const initialValues = getInitialValues();

  // Form state - initialize from props
  const [enabled, setEnabled] = useState(initialValues.enabled);
  const [scheduleType, setScheduleType] = useState<'interval' | 'time'>(initialValues.scheduleType);
  const [everyN, setEveryN] = useState(initialValues.everyN);
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>(initialValues.unit);
  const [timeHour, setTimeHour] = useState(initialValues.timeHour);
  const [timeMinute, setTimeMinute] = useState(initialValues.timeMinute);
  const [timezone, setTimezone] = useState(initialValues.timezone);
  const [error, setError] = useState<string | null>(null);

  // Reset form when mode/schedule changes (key-based reset pattern)
  if (formKey !== lastFormKey) {
    setLastFormKey(formKey);
    const newValues = getInitialValues();
    setEnabled(newValues.enabled);
    setScheduleType(newValues.scheduleType);
    setEveryN(newValues.everyN);
    setUnit(newValues.unit);
    setTimeHour(newValues.timeHour);
    setTimeMinute(newValues.timeMinute);
    setTimezone(newValues.timezone);
    setError(null);
  }

  // Compute next run preview dynamically
  const nextRunPreview = useMemo(() => {
    // Only show preview if inputs are valid
    if (scheduleType === 'interval' && everyN < 1) return null;
    if (scheduleType === 'time' && (timeHour < 0 || timeHour > 23 || timeMinute < 0 || timeMinute > 59)) return null;

    const nextRunDate = computeNextRunPreview(scheduleType, everyN, unit, timeHour, timeMinute);
    return formatNextRun(nextRunDate);
  }, [scheduleType, everyN, unit, timeHour, timeMinute]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      createPipelineSchedule(pipelineId, {
        type: scheduleType,
        every_n: scheduleType === 'interval' ? everyN : undefined,
        unit: scheduleType === 'interval' ? unit : undefined,
        time_hour: scheduleType === 'time' ? timeHour : undefined,
        time_minute: scheduleType === 'time' ? timeMinute : undefined,
        timezone,
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', pipelineId] });
      onClose();
    },
    onError: (err: any) => {
      setError(err?.message || 'Failed to create schedule');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      updatePipelineSchedule(pipelineId, {
        type: scheduleType,
        every_n: scheduleType === 'interval' ? everyN : undefined,
        unit: scheduleType === 'interval' ? unit : undefined,
        time_hour: scheduleType === 'time' ? timeHour : undefined,
        time_minute: scheduleType === 'time' ? timeMinute : undefined,
        timezone,
        enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', pipelineId] });
      onClose();
    },
    onError: (err: any) => {
      setError(err?.message || 'Failed to update schedule');
    },
  });

  const handleSave = () => {
    // Validate based on schedule type
    if (scheduleType === 'interval') {
      if (everyN < 1) {
        setError('Interval must be at least 1');
        return;
      }
    } else if (scheduleType === 'time') {
      if (timeHour < 0 || timeHour > 23) {
        setError('Hour must be between 0 and 23');
        return;
      }
      if (timeMinute < 0 || timeMinute > 59) {
        setError('Minute must be between 0 and 59');
        return;
      }
    }

    setError(null);

    if (mode === 'create') {
      createMutation.mutate();
    } else {
      updateMutation.mutate();
    }
  };

  const handleCancel = () => {
    setError(null);
    onClose();
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (!isOpen) return null;

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={handleCancel}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <h2
            id={titleId}
            className="m-0 text-lg font-semibold text-ink"
          >
            {mode === 'create' ? 'Create schedule' : 'Edit schedule'}
          </h2>
          <p
            id={descriptionId}
            className="mt-1 mb-0 text-sm text-archive"
          >
            Schedules create jobs, which create runs.
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Enabled toggle */}
          <div className="flex items-center gap-3 text-sm text-ink">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Enable schedule"
              onClick={() => setEnabled(!enabled)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEnabled(!enabled);
                }
              }}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer border-none p-0 ${
                enabled ? 'bg-bark' : 'bg-stone'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-parchment transition-[left] duration-200 ${
                  enabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
            <span id="schedule-enabled-label">Enabled</span>
          </div>

          {/* Schedule Type Selector */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Schedule Type
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleType === 'interval'}
                  onChange={() => setScheduleType('interval')}
                  className="cursor-pointer text-bark focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  aria-label="Interval schedule type"
                />
                <span className="text-sm text-ink">
                  Interval
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleType === 'time'}
                  onChange={() => setScheduleType('time')}
                  className="cursor-pointer text-bark focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  aria-label="Daily at specific time schedule type"
                />
                <span className="text-sm text-ink">
                  Daily at specific time
                </span>
              </label>
            </div>
          </div>

          {/* Conditional fields based on schedule type */}
          {scheduleType === 'interval' && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Frequency
              </label>
              <div className="flex gap-2 items-center">
                <label
                  htmlFor="schedule-interval"
                  className="text-sm text-archive"
                >
                  Run every
                </label>
                <input
                  id="schedule-interval"
                  type="number"
                  min="1"
                  value={everyN}
                  aria-label="Interval value"
                  aria-required="true"
                  aria-describedby={error ? 'schedule-error' : undefined}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 1;
                    setEveryN(val);
                    if (val >= 1) setError(null);
                  }}
                  className="w-20 px-3 py-2 border border-lichen rounded-sm text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
                <select
                  id="schedule-unit"
                  aria-label="Time unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                  className="px-3 py-2 border border-lichen rounded-sm text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>
            </div>
          )}

          {scheduleType === 'time' && (
            <div>
              <span
                id="time-label"
                className="block text-sm font-medium text-ink mb-1"
              >
                Time (24-hour format)
              </span>
              <div className="flex gap-2 items-center">
                <input
                  id="schedule-time-hour"
                  type="number"
                  min="0"
                  max="23"
                  value={timeHour}
                  aria-label="Hour (0-23)"
                  aria-describedby="time-label"
                  aria-required="true"
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 23) {
                      setTimeHour(val);
                      setError(null);
                    }
                  }}
                  className="w-[70px] px-3 py-2 border border-lichen rounded-sm text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  placeholder="HH"
                />
                <span aria-hidden="true" className="text-lg text-archive">:</span>
                <input
                  id="schedule-time-minute"
                  type="number"
                  min="0"
                  max="59"
                  value={timeMinute}
                  aria-label="Minute (0-59)"
                  aria-describedby="time-label"
                  aria-required="true"
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 59) {
                      setTimeMinute(val);
                      setError(null);
                    }
                  }}
                  className="w-[70px] px-3 py-2 border border-lichen rounded-sm text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  placeholder="MM"
                />
                <span aria-live="polite" className="text-sm text-archive">
                  {String(timeHour).padStart(2, '0')}:{String(timeMinute).padStart(2, '0')}
                </span>
              </div>
            </div>
          )}

          {/* Timezone */}
          <div>
            <label
              className="block text-sm font-medium text-ink mb-1"
              htmlFor="schedule-timezone"
            >
              Timezone
            </label>
            <input
              id="schedule-timezone"
              type="text"
              value={timezone}
              aria-label="Timezone"
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC"
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            <p className="mt-1 mb-0 text-xs text-archive">
              IANA timezone (e.g., America/New_York)
            </p>
          </div>

          {/* Next Run Preview */}
          {nextRunPreview && (
            <div className="px-3 py-2.5 bg-parchment border border-lichen rounded-sm text-sm text-ink">
              <span className="font-medium">Next run:</span>{' '}
              <span className="text-archive">{nextRunPreview}</span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              id="schedule-error"
              role="alert"
              aria-live="assertive"
              className="px-3 py-2.5 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error"
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            onClick={handleCancel}
            disabled={isPending}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink cursor-pointer hover:bg-stone/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || everyN < 1}
            className={`px-4 py-2 border-none rounded-sm text-sm text-parchment transition-colors ${
              isPending || everyN < 1
                ? 'bg-stone cursor-not-allowed'
                : 'bg-bark cursor-pointer hover:bg-bark/90'
            }`}
          >
            {isPending ? 'Saving schedule...' : 'Save schedule'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
