import { useEffect, useState, type ComponentProps } from "react";
import { Form } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { SelectInput } from "~/components/ui/SelectInput";
import {
  EVENT_OPTIONS,
  OFF_DAY_PRESET_KEY,
  WORKER_SCHEDULE_EVENT_TYPE,
  type PlannerShiftPresetView,
  actorLabel,
  buildWorkerLabel,
  formatDateInput,
  formatDateLabel,
  formatDateTimeLabel,
  isOffSchedule,
  isWorkSchedule,
  scheduleEventLabel,
} from "~/services/workforce-schedule-planner-date-helpers";

type PlannerWorker = {
  id: number;
  label: string;
  role: string;
};

type PlannerSchedule = {
  id: number;
  workerId: number;
  status: string;
  entryType: string;
  scheduleDate: Date | string;
  startAt: Date | string;
  endAt: Date | string;
  note: string | null;
  templateAssignment: {
    template: {
      templateName: string;
    } | null;
  } | null;
};

type PlannerEvent = {
  id: number;
  scheduleId: number;
  eventType: string;
  effectiveAt: Date | string;
  note: string | null;
  actorUser: {
    email: string | null;
    employee: {
      firstName: string;
      lastName: string;
      alias: string | null;
    } | null;
  } | null;
  relatedWorker: {
    firstName: string;
    lastName: string;
    alias: string | null;
  } | null;
};

type WorkforceSchedulePlannerCellSheetProps = {
  open: boolean;
  onClose: () => void;
  selectedWorker: PlannerWorker | null;
  selectedDateKey: string | null;
  selectedDateLabel: string | null;
  selectedSchedule: PlannerSchedule | null;
  shiftPresets: PlannerShiftPresetView[];
  selectedPreset: PlannerShiftPresetView | null;
  selectedWorkStartTime: string | null;
  selectedWorkEndTime: string | null;
  customStartTimeOptions: Array<{ value: string; label: string }>;
  customEndTimeOptions: Array<{ value: string; label: string }>;
  shouldOpenCustomEditor: boolean;
  shouldOpenStaffingActivity: boolean;
  shouldOpenCellHistory: boolean;
  selectedEvents: PlannerEvent[];
  workers: PlannerWorker[];
  rangeStart: string;
  rangeEnd: string;
  selectedCellBadgeTone: ComponentProps<typeof SoTStatusBadge>["tone"];
  selectedCellBadgeLabel: string;
  selectedCellSummaryTitle: string;
  selectedCellSummaryDetail: string;
  modalSuccessMessage: string | null;
  showModalError: boolean;
  modalErrorMessage: string | undefined;
};

type CellEditMode = "preset" | "custom";

function resolveEditMode(shouldOpenCustomEditor: boolean): CellEditMode {
  if (shouldOpenCustomEditor) {
    return "custom";
  }
  return "preset";
}

export function WorkforceSchedulePlannerCellSheet({
  open,
  onClose,
  selectedWorker,
  selectedDateKey,
  selectedDateLabel,
  selectedSchedule,
  shiftPresets,
  selectedPreset,
  selectedWorkStartTime,
  selectedWorkEndTime,
  customStartTimeOptions,
  customEndTimeOptions,
  shouldOpenCustomEditor,
  shouldOpenStaffingActivity,
  shouldOpenCellHistory,
  selectedEvents,
  workers,
  rangeStart,
  rangeEnd,
  selectedCellBadgeTone,
  selectedCellBadgeLabel,
  selectedCellSummaryTitle,
  selectedCellSummaryDetail,
  modalSuccessMessage,
  showModalError,
  modalErrorMessage,
}: WorkforceSchedulePlannerCellSheetProps) {
  const [editMode, setEditMode] = useState<CellEditMode>(() =>
    resolveEditMode(shouldOpenCustomEditor),
  );

  useEffect(() => {
    setEditMode(resolveEditMode(shouldOpenCustomEditor));
  }, [selectedDateKey, selectedWorker?.id, shouldOpenCustomEditor]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close cell editor"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]"
      />

      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
        <div className="relative max-h-[calc(100vh-1rem)] w-full max-w-3xl overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-xl sm:max-h-[calc(100vh-2rem)] sm:rounded-[28px]">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-xl">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                  Cell editor
                </div>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">
                  {selectedWorker?.label} · {selectedDateLabel}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Choose one way to fill this worker-date slot.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <SoTStatusBadge tone={selectedCellBadgeTone}>
                  {selectedCellBadgeLabel}
                </SoTStatusBadge>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            {modalSuccessMessage ? (
              <div className="mt-4">
                <SoTAlert tone="success">{modalSuccessMessage}</SoTAlert>
              </div>
            ) : null}
            {showModalError ? (
              <div className="mt-4">
                <SoTAlert tone="warning">{modalErrorMessage}</SoTAlert>
              </div>
            ) : null}
          </div>

          <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-4">
            <div className="space-y-3">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedCellSummaryTitle}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {selectedCellSummaryDetail}
                    </div>
                  </div>
                </div>
              </div>

              <section className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Edit mode
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    { value: "preset", label: "Preset", disabled: false },
                    { value: "custom", label: "Custom", disabled: false },
                  ] as const).map((option) => {
                    const selected = option.value === editMode;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          if (!option.disabled) {
                            setEditMode(option.value);
                          }
                        }}
                        disabled={option.disabled}
                        className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                          selected
                            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                            : option.disabled
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {editMode === "preset" ? (
                <section className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Quick presets</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Use the fastest option first. OFF / Day off stays built in.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {shiftPresets.map((preset) => {
                      const isCurrentPreset =
                        selectedPreset != null && preset.key === selectedPreset.key;

                      return (
                        <Form method="post" key={preset.key}>
                          <input type="hidden" name="_intent" value="set-board-preset" />
                          <input
                            type="hidden"
                            name="workerId"
                            value={selectedWorker?.id ?? ""}
                          />
                          <input
                            type="hidden"
                            name="scheduleDate"
                            value={selectedDateKey ?? ""}
                          />
                          <input type="hidden" name="rangeStart" value={rangeStart} />
                          <input type="hidden" name="rangeEnd" value={rangeEnd} />
                          <input type="hidden" name="presetId" value={preset.id} />
                          <button
                            type="submit"
                            className={`w-full rounded-[18px] border px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                              isCurrentPreset
                                ? "border-indigo-300 bg-indigo-50"
                                : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {preset.timeWindowLabel}
                              </span>
                              {isCurrentPreset ? (
                                <SoTStatusBadge tone="info">Current</SoTStatusBadge>
                              ) : null}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              Saved work preset
                            </div>
                          </button>
                        </Form>
                      );
                    })}

                    <Form method="post">
                      <input type="hidden" name="_intent" value="set-board-preset" />
                      <input
                        type="hidden"
                        name="workerId"
                        value={selectedWorker?.id ?? ""}
                      />
                      <input
                        type="hidden"
                        name="scheduleDate"
                        value={selectedDateKey ?? ""}
                      />
                      <input type="hidden" name="rangeStart" value={rangeStart} />
                      <input type="hidden" name="rangeEnd" value={rangeEnd} />
                      <input type="hidden" name="presetId" value={OFF_DAY_PRESET_KEY} />
                      <button
                        type="submit"
                        className={`w-full rounded-[18px] border px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                          isOffSchedule(selectedSchedule)
                            ? "border-rose-300 bg-rose-50"
                            : "border-rose-200 bg-rose-50 hover:border-rose-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            OFF / Day off
                          </span>
                          {isOffSchedule(selectedSchedule) ? (
                            <SoTStatusBadge tone="warning">Current</SoTStatusBadge>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Mark this date as intentional day off.
                        </div>
                      </button>
                    </Form>
                  </div>
                </section>
              ) : null}

              {editMode === "custom" ? (
                <section className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Custom time</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Use this only when the preset choices do not fit.
                    </p>
                  </div>

                  <Form method="post" className="mt-4 space-y-3">
                    <input type="hidden" name="_intent" value="set-board-custom" />
                    <input type="hidden" name="workerId" value={selectedWorker?.id ?? ""} />
                    <input type="hidden" name="scheduleDate" value={selectedDateKey ?? ""} />
                    <input type="hidden" name="rangeStart" value={rangeStart} />
                    <input type="hidden" name="rangeEnd" value={rangeEnd} />

                    <div className="grid gap-3 md:grid-cols-2">
                      <SelectInput
                        label="Start time"
                        name="startTime"
                        defaultValue={selectedWorkStartTime ?? "06:00"}
                        options={customStartTimeOptions}
                      />
                      <SelectInput
                        label="End time"
                        name="endTime"
                        defaultValue={selectedWorkEndTime ?? "15:00"}
                        options={customEndTimeOptions}
                      />
                    </div>

                    <SoTFormField label="Manager note">
                      <SoTInput
                        name="note"
                        defaultValue={
                          selectedSchedule && isWorkSchedule(selectedSchedule)
                            ? (selectedSchedule.note ?? "")
                            : ""
                        }
                        placeholder="Optional reason for this custom timing"
                      />
                    </SoTFormField>

                    <div className="flex justify-end">
                      <SoTButton type="submit" variant="primary" size="compact">
                        Save custom cell
                      </SoTButton>
                    </div>
                  </Form>
                </section>
              ) : null}

              <details
                className="rounded-[20px] border border-slate-200 bg-white px-4 py-4"
                open={shouldOpenStaffingActivity || shouldOpenCellHistory}
              >
                <summary className="cursor-pointer list-none">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">More actions</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Open notes, history, and cleanup only when this cell needs extra
                      work.
                    </p>
                  </div>
                </summary>

                <div className="mt-4 space-y-3">
                  {selectedSchedule && isWorkSchedule(selectedSchedule) ? (
                    <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          Staffing activity
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Append replacement, on-call, or manager notes only when needed.
                        </p>
                      </div>

                      <Form method="post" className="mt-4 space-y-3">
                        <input type="hidden" name="_intent" value="append-event" />
                        <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                        <input
                          type="hidden"
                          name="workerId"
                          value={selectedSchedule.workerId}
                        />
                        <input
                          type="hidden"
                          name="scheduleDate"
                          value={
                            selectedDateKey ??
                            formatDateInput(selectedSchedule.scheduleDate)
                          }
                        />
                        <input type="hidden" name="rangeStart" value={rangeStart} />
                        <input type="hidden" name="rangeEnd" value={rangeEnd} />

                        <SelectInput
                          label="Event type"
                          name="eventType"
                          defaultValue={WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED}
                          options={EVENT_OPTIONS}
                        />

                        <SelectInput
                          label="Covering worker"
                          name="relatedWorkerId"
                          defaultValue=""
                          options={[
                            { value: "", label: "None" },
                            ...workers
                              .filter((worker) => worker.id !== selectedSchedule.workerId)
                              .map((worker) => ({
                                value: worker.id,
                                label: `${worker.label} · ${worker.role}`,
                              })),
                          ]}
                        />

                        <SoTFormField label="Event note">
                          <SoTInput
                            name="note"
                            placeholder="Explain the coverage or staffing note"
                            required
                          />
                        </SoTFormField>

                        <div className="flex justify-end">
                          <SoTButton type="submit" variant="primary" size="compact">
                            Append event
                          </SoTButton>
                        </div>
                      </Form>
                    </div>
                  ) : null}

                  {selectedSchedule ? (
                    <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            Cell history
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            {selectedWorker?.label} · {selectedDateLabel}
                          </p>
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          {selectedEvents.length} event
                          {selectedEvents.length === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="mt-4 space-y-2">
                        {selectedEvents.length === 0 ? (
                          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                            No staffing events yet.
                          </div>
                        ) : (
                          selectedEvents.map((event) => (
                            <div
                              key={event.id}
                              className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <SoTStatusBadge tone="info">
                                  {scheduleEventLabel(event.eventType)}
                                </SoTStatusBadge>
                                <span className="text-xs text-slate-500">
                                  {formatDateTimeLabel(event.effectiveAt)}
                                </span>
                              </div>
                              <div className="mt-2 text-sm font-medium text-slate-800">
                                {event.note ?? "No note provided."}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Actor: {actorLabel(event.actorUser)}
                                {event.relatedWorker
                                  ? ` · Covering worker: ${buildWorkerLabel(event.relatedWorker)}`
                                  : ""}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Return cell to blank
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Remove the saved row so this cell becomes unassigned again.
                      </div>
                    </div>

                    <Form method="post">
                      <input type="hidden" name="_intent" value="clear-board-cell" />
                      <input type="hidden" name="workerId" value={selectedWorker?.id ?? ""} />
                      <input
                        type="hidden"
                        name="scheduleDate"
                        value={selectedDateKey ?? ""}
                      />
                      <input type="hidden" name="rangeStart" value={rangeStart} />
                      <input type="hidden" name="rangeEnd" value={rangeEnd} />
                      <SoTButton
                        type="submit"
                        variant="secondary"
                        size="compact"
                        disabled={!selectedSchedule}
                      >
                        Clear to blank
                      </SoTButton>
                    </Form>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
