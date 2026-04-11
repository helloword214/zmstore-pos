import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useEffect, useState } from "react";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SelectInput } from "~/components/ui/SelectInput";
import { WorkforceSchedulePlannerCellSheet } from "~/components/ui/workforce-schedule-planner-cell-sheet";
import { WorkforceSchedulePlannerPresetsPanel } from "~/components/ui/workforce-schedule-planner-presets-panel";
import {
  OFF_DAY_PRESET_KEY,
  WORKER_SCHEDULE_EVENT_TYPE,
  WORKER_SCHEDULE_STATUS,
  addDays,
  buildCellKey,
  buildCustomTimeOptions,
  buildPlannerRedirect,
  buildShiftPresetView,
  buildWorkerLabel,
  enumerateDatesInclusive,
  findBoardShiftPreset,
  formatBoardDayLabel,
  formatDateInput,
  formatDateLabel,
  formatTimeValue,
  formatTimeWindow,
  isOffSchedule,
  isWorkSchedule,
  isWorkerScheduleEventTypeValue,
  minuteToTimeValue,
  parseOptionalInt,
  patternMatchesWorkerRole,
  plannerSavedMessage,
  resolvePlannerRange,
  statusTone,
} from "~/services/workforce-schedule-planner-date-helpers";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const [
    { listWorkerScheduleShiftPresets },
    { listWorkerScheduleEventsForSchedules },
    { listWorkerScheduleTemplatesForPlanner },
  ] = await Promise.all([
    import("~/services/worker-schedule-shift-preset.server"),
    import("~/services/worker-schedule-event.server"),
    import("~/services/worker-schedule-template.server"),
  ]);
  const url = new URL(request.url);
  const { rangeStart, rangeEnd, preset } = resolvePlannerRange(url);
  const saved = url.searchParams.get("saved");
  const dates = enumerateDatesInclusive(rangeStart, rangeEnd);
  const dateKeys = dates.map((date) => formatDateInput(date));
  const selectedWorkerId = parseOptionalInt(url.searchParams.get("workerId"));
  const selectedDateKeyParam = url.searchParams.get("scheduleDate");
  const selectedDateKey =
    selectedDateKeyParam && dateKeys.includes(selectedDateKeyParam)
      ? selectedDateKeyParam
      : null;

  const [
    schedules,
    workers,
    shiftPresets,
    plannerPatterns,
  ] =
    await Promise.all([
      db.workerSchedule.findMany({
        where: {
          scheduleDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        include: {
          worker: {
            include: {
              user: {
                select: { role: true },
              },
            },
          },
          attendanceDutyResult: true,
          templateAssignment: {
            include: {
              template: {
                select: { templateName: true },
              },
            },
          },
        },
        orderBy: [
          { scheduleDate: "asc" },
          { status: "asc" },
          { startAt: "asc" },
          { worker: { lastName: "asc" } },
        ],
      }),
      db.employee.findMany({
        where: {
          active: true,
          user: { is: { active: true } },
        },
        include: {
          user: {
            select: { role: true },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      listWorkerScheduleShiftPresets(),
      listWorkerScheduleTemplatesForPlanner({
        rangeStart,
        rangeEnd: addDays(rangeEnd, 28),
      }),
    ]);

  const workerDraftSummaryById = schedules.reduce<
    Record<string, { draftCount: number; generatedDraftCount: number }>
  >((summary, schedule) => {
    if (schedule.status !== WORKER_SCHEDULE_STATUS.DRAFT) {
      return summary;
    }

    const key = String(schedule.workerId);
    const existing = summary[key] ?? { draftCount: 0, generatedDraftCount: 0 };
    existing.draftCount += 1;
    if (schedule.templateAssignmentId != null) {
      existing.generatedDraftCount += 1;
    }
    summary[key] = existing;
    return summary;
  }, {});

  const scheduleByCell = new Map<string, (typeof schedules)[number]>();
  for (const schedule of schedules) {
    if (schedule.status === WORKER_SCHEDULE_STATUS.CANCELLED) {
      continue;
    }
    const cellKey = buildCellKey(
      schedule.workerId,
      formatDateInput(schedule.scheduleDate),
    );
    if (!scheduleByCell.has(cellKey)) {
      scheduleByCell.set(cellKey, schedule);
    }
  }

  const selectedWorker =
    selectedWorkerId == null
      ? null
      : workers.find((worker) => worker.id === selectedWorkerId) ?? null;

  const scheduleEvents = await listWorkerScheduleEventsForSchedules(
    schedules
      .filter((schedule) => schedule.status !== WORKER_SCHEDULE_STATUS.CANCELLED)
      .map((schedule) => schedule.id),
  );

  return json({
    boardDates: dates.map((date) => ({
      key: formatDateInput(date),
      label: formatBoardDayLabel(date),
      fullLabel: formatDateLabel(date),
    })),
    boardRows: workers.map((worker) => ({
      worker: {
        id: worker.id,
        label: buildWorkerLabel(worker),
        role: worker.user?.role ?? "UNASSIGNED",
      },
      cells: dateKeys.map((dateKey) => ({
        dateKey,
        schedule: scheduleByCell.get(buildCellKey(worker.id, dateKey)) ?? null,
      })),
    })),
    workers: workers.map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
    })),
    shiftPresets: shiftPresets.map(buildShiftPresetView),
    plannerPatterns: plannerPatterns.map((pattern) => ({
      id: pattern.id,
      templateName: pattern.templateName,
      role: pattern.role,
      days: pattern.days.map((day) => ({
        id: day.id,
        dayOfWeek: day.dayOfWeek,
        startMinute: day.startMinute,
        endMinute: day.endMinute,
      })),
    })),
    saved,
    preset,
    rangeStart: formatDateInput(rangeStart),
    rangeEnd: formatDateInput(rangeEnd),
    workerDraftSummaryById,
    initialSelectedWorkerId: selectedWorker?.id ?? null,
    initialSelectedDateKey: selectedDateKey,
    scheduleEvents,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const [
    {
      applyWorkerSchedulePatternToRange,
      clearWorkerDraftSchedulesInRange,
      generateWorkerSchedulesFromTemplateAssignments,
      publishWorkerSchedules,
      setWorkerScheduleBoardCell,
    },
    {
      createWorkerScheduleShiftPreset,
      deleteWorkerScheduleShiftPreset,
      updateWorkerScheduleShiftPreset,
    },
    { appendWorkerScheduleEvent },
  ] = await Promise.all([
    import("~/services/worker-schedule-publication.server"),
    import("~/services/worker-schedule-shift-preset.server"),
    import("~/services/worker-schedule-event.server"),
  ]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const rangeStart = String(fd.get("rangeStart") || "");
  const rangeEnd = String(fd.get("rangeEnd") || "");
  const workerId = parseOptionalInt(String(fd.get("workerId") || ""));
  const scheduleDate = String(fd.get("scheduleDate") || "");

  try {
    if (intent === "generate-range") {
      await generateWorkerSchedulesFromTemplateAssignments({
        rangeStart,
        rangeEnd,
        actorUserId: me.userId,
      });
      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "generated",
        }),
      );
    }

    if (intent === "publish-range") {
      await publishWorkerSchedules({
        actorUserId: me.userId,
        rangeStart,
        rangeEnd,
      });
      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "published",
        }),
      );
    }

    if (intent === "apply-worker-pattern" || intent === "apply-pattern") {
      const templateId = parseOptionalInt(String(fd.get("templateId") || ""));

      if (!workerId) {
        throw new Error("Select a worker first.");
      }
      if (!templateId) {
        throw new Error("Pick a named staffing pattern first.");
      }

      await applyWorkerSchedulePatternToRange({
        templateId,
        workerId,
        rangeStart,
        rangeEnd,
        actorUserId: me.userId,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "pattern-applied",
        }),
      );
    }

    if (intent === "set-board-preset") {
      if (!workerId || !scheduleDate) {
        throw new Error("Worker and duty date are required.");
      }

      const presetIdValue = String(fd.get("presetId") || "");
      if (presetIdValue === OFF_DAY_PRESET_KEY) {
        await setWorkerScheduleBoardCell({
          workerId,
          scheduleDate,
          actorUserId: me.userId,
          markOffDay: true,
        });
        return redirect(
          buildPlannerRedirect({
            rangeStart,
            rangeEnd,
            saved: "off-marked",
          }),
        );
      }

      const presetId = parseOptionalInt(presetIdValue);
      if (!presetId) {
        throw new Error("Select a saved work preset first.");
      }

      const preset = await db.workerScheduleShiftPreset.findUnique({
        where: { id: presetId },
        select: { startMinute: true, endMinute: true },
      });
      if (!preset) {
        throw new Error("Work preset not found.");
      }

      await setWorkerScheduleBoardCell({
        workerId,
        scheduleDate,
        actorUserId: me.userId,
        startTime: minuteToTimeValue(preset.startMinute),
        endTime: minuteToTimeValue(preset.endMinute),
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "preset-applied",
        }),
      );
    }

    if (intent === "create-shift-preset") {
      await createWorkerScheduleShiftPreset({
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        actorUserId: me.userId,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "shift-preset-created",
        }),
      );
    }

    if (intent === "update-shift-preset") {
      const presetId = parseOptionalInt(String(fd.get("presetId") || ""));
      if (!presetId) {
        throw new Error("Work preset is required.");
      }

      await updateWorkerScheduleShiftPreset({
        presetId,
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        actorUserId: me.userId,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "shift-preset-updated",
        }),
      );
    }

    if (intent === "delete-shift-preset") {
      const presetId = parseOptionalInt(String(fd.get("presetId") || ""));
      if (!presetId) {
        throw new Error("Work preset is required.");
      }

      await deleteWorkerScheduleShiftPreset({ presetId });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "shift-preset-deleted",
        }),
      );
    }

    if (intent === "clear-board-cell") {
      if (!workerId || !scheduleDate) {
        throw new Error("Worker and duty date are required.");
      }

      await setWorkerScheduleBoardCell({
        workerId,
        scheduleDate,
        actorUserId: me.userId,
        clearSchedule: true,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "cell-cleared",
        }),
      );
    }

    if (intent === "clear-worker-drafts") {
      if (!workerId) {
        throw new Error("Select a worker first.");
      }

      const result = await clearWorkerDraftSchedulesInRange({
        workerId,
        rangeStart,
        rangeEnd,
        actorUserId: me.userId,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved:
            result.clearedCount > 0
              ? "worker-drafts-cleared"
              : "worker-drafts-already-clear",
        }),
      );
    }

    if (intent === "set-board-custom") {
      if (!workerId || !scheduleDate) {
        throw new Error("Worker and duty date are required.");
      }

      await setWorkerScheduleBoardCell({
        workerId,
        scheduleDate,
        actorUserId: me.userId,
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        note: String(fd.get("note") || ""),
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "custom-saved",
        }),
      );
    }

    if (intent === "append-event") {
      const scheduleId = parseOptionalInt(String(fd.get("scheduleId") || ""));
      if (!scheduleId || !workerId || !scheduleDate) {
        throw new Error("Select a scheduled cell first.");
      }

      const eventType = String(fd.get("eventType") || "");
      const relatedWorkerId = parseOptionalInt(String(fd.get("relatedWorkerId") || ""));
      const note = String(fd.get("note") || "");

      if (!isWorkerScheduleEventTypeValue(eventType)) {
        throw new Error("Unsupported schedule event.");
      }

      if (
        (eventType === WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED ||
          eventType === WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED) &&
        !relatedWorkerId
      ) {
        throw new Error("Related worker is required for replacement/on-call events.");
      }

      await appendWorkerScheduleEvent({
        scheduleId,
        eventType,
        actorUserId: me.userId,
        subjectWorkerId: workerId,
        relatedWorkerId,
        note,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "event-added",
        }),
      );
    }

    return json<ActionData>(
      { ok: false, error: "Unsupported action.", action: intent },
      { status: 400 },
    );
  } catch (error) {
    return json<ActionData>(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save changes.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function WorkforceSchedulePlannerRoute() {
  const {
    boardDates,
    boardRows,
    workers,
    shiftPresets,
    plannerPatterns,
    saved,
    preset,
    rangeStart,
    rangeEnd,
    workerDraftSummaryById,
    initialSelectedWorkerId,
    initialSelectedDateKey,
    scheduleEvents,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const [activeCell, setActiveCell] = useState<{
    workerId: number;
    dateKey: string;
  } | null>(
    initialSelectedWorkerId && initialSelectedDateKey
      ? { workerId: initialSelectedWorkerId, dateKey: initialSelectedDateKey }
      : null,
  );
  const [activePatternWorkerId, setActivePatternWorkerId] = useState<number | null>(null);

  useEffect(() => {
    if (initialSelectedWorkerId && initialSelectedDateKey) {
      setActiveCell({
        workerId: initialSelectedWorkerId,
        dateKey: initialSelectedDateKey,
      });
      return;
    }

    if (
      saved === "preset-applied" ||
      saved === "off-marked" ||
      saved === "cell-cleared" ||
      saved === "published" ||
      saved === "generated"
    ) {
      setActiveCell(null);
    }
  }, [initialSelectedDateKey, initialSelectedWorkerId, saved]);
  useEffect(() => {
    if (saved === "pattern-applied") {
      setActivePatternWorkerId(null);
    }
  }, [saved]);

  const isDenseWindow = boardDates.length > 7;
  const isVeryDenseWindow = boardDates.length > 20;
  const selectedWorker =
    activeCell == null
      ? null
      : workers.find((worker) => worker.id === activeCell.workerId) ?? null;
  const selectedBoardRow =
    activeCell == null
      ? null
      : boardRows.find((row) => row.worker.id === activeCell.workerId) ?? null;
  const selectedCell =
    activeCell == null
      ? null
      : selectedBoardRow?.cells.find((cell) => cell.dateKey === activeCell.dateKey) ?? null;
  const selectedSchedule = selectedCell?.schedule ?? null;
  const selectedDateKey = activeCell?.dateKey ?? null;
  const selectedDateLabel = selectedDateKey ? formatDateLabel(selectedDateKey) : null;
  const selectedEvents =
    selectedSchedule == null
      ? []
      : scheduleEvents.filter((event) => event.scheduleId === selectedSchedule.id);
  const selectedPreset =
    selectedSchedule == null || !isWorkSchedule(selectedSchedule)
      ? null
      : findBoardShiftPreset(
          shiftPresets,
          selectedSchedule.startAt,
          selectedSchedule.endAt,
        );
  const selectedWorkStartTime =
    selectedSchedule && isWorkSchedule(selectedSchedule)
      ? formatTimeValue(selectedSchedule.startAt)
      : null;
  const selectedWorkEndTime =
    selectedSchedule && isWorkSchedule(selectedSchedule)
      ? formatTimeValue(selectedSchedule.endAt)
      : null;
  const selectedPatternWorker =
    activePatternWorkerId == null
      ? null
      : workers.find((worker) => worker.id === activePatternWorkerId) ?? null;
  const selectedWorkerPatterns =
    selectedPatternWorker == null
      ? []
      : plannerPatterns.filter((pattern) =>
          patternMatchesWorkerRole(pattern.role, selectedPatternWorker.role),
        );
  const customStartTimeOptions = buildCustomTimeOptions(selectedWorkStartTime);
  const customEndTimeOptions = buildCustomTimeOptions(selectedWorkEndTime);
  const selectedCellBadgeTone = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? "warning"
      : statusTone(selectedSchedule.status)
    : "neutral";
  const selectedCellBadgeLabel = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? "OFF"
      : selectedSchedule.status
    : "BLANK";
  const selectedCellSummaryTitle = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? "Intentional OFF day"
      : formatTimeWindow(selectedSchedule.startAt, selectedSchedule.endAt)
    : "No saved row yet";
  const selectedCellSummaryDetail = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? `${
          selectedSchedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
            ? "Published OFF row"
            : "Draft OFF row"
        }${selectedSchedule.note ? ` · ${selectedSchedule.note}` : ""}`
      : selectedSchedule.templateAssignment?.template?.templateName
        ? `Pattern source: ${selectedSchedule.templateAssignment.template.templateName}`
        : selectedSchedule.note
          ? `Source: direct board row · ${selectedSchedule.note}`
          : "Source: direct board row"
    : "Choose a preset or save a custom time to create one draft row for this worker-date cell.";
  const isCellModalOpen = Boolean(activeCell);
  const shouldOpenCustomEditor =
    actionData?.action === "set-board-custom" ||
    saved === "custom-saved" ||
    Boolean(
      selectedSchedule && isWorkSchedule(selectedSchedule) && selectedPreset == null,
    );
  const shouldOpenCellHistory = saved === "event-added";
  const shouldOpenStaffingActivity =
    actionData?.action === "append-event" || saved === "event-added";
  const shouldOpenPresetLibrary =
    actionData?.action === "create-shift-preset" ||
    actionData?.action === "update-shift-preset" ||
    actionData?.action === "delete-shift-preset" ||
    saved === "shift-preset-created" ||
    saved === "shift-preset-updated" ||
    saved === "shift-preset-deleted";
  const pageSuccessMessage =
    saved === "custom-saved" ||
    saved === "event-added" ||
    saved === "worker-drafts-cleared" ||
    saved === "worker-drafts-already-clear"
      ? null
      : plannerSavedMessage(saved);
  const modalSuccessMessage =
    saved === "custom-saved" ||
    saved === "event-added" ||
    saved === "worker-drafts-cleared" ||
    saved === "worker-drafts-already-clear"
      ? plannerSavedMessage(saved)
      : null;
  const isPatternModalOpen = Boolean(activePatternWorkerId);
  const showPageError = Boolean(actionData && !actionData.ok && !isCellModalOpen && !isPatternModalOpen);
  const showModalError = Boolean(actionData && !actionData.ok && isCellModalOpen);
  const showPatternModalError = Boolean(actionData && !actionData.ok && isPatternModalOpen);
  const plannerWindowLabel =
    preset === "next-week"
      ? "Next week"
      : preset === "next-two-weeks"
        ? "Next 2 weeks"
        : preset === "next-month"
          ? "Next month"
          : `${formatDateLabel(rangeStart)} - ${formatDateLabel(rangeEnd)}`;
  const workerPatternChoicesByRole = new Map<string, typeof plannerPatterns>();
  for (const worker of workers) {
    if (!workerPatternChoicesByRole.has(worker.role)) {
      workerPatternChoicesByRole.set(
        worker.role,
        plannerPatterns.filter((pattern) =>
          patternMatchesWorkerRole(pattern.role, worker.role),
        ),
      );
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Planner Board"
        subtitle="Build the week on one canvas, use presets for speed, and open one focused editor only when a cell needs detail."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        {pageSuccessMessage ? <SoTAlert tone="success">{pageSuccessMessage}</SoTAlert> : null}
        {showPageError ? <SoTAlert tone="warning">{actionData?.error}</SoTAlert> : null}

        <section className="rounded-[26px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                Planner canvas
              </div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                {plannerWindowLabel}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Apply a weekly pattern from the worker row, or edit one date at a time from the board.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Form method="get" className="flex flex-wrap items-end gap-2">
                <div className="w-[155px]">
                  <SoTFormField label="Start">
                    <SoTInput
                      type="date"
                      name="rangeStart"
                      defaultValue={rangeStart}
                      required
                    />
                  </SoTFormField>
                </div>
                <div className="w-[155px]">
                  <SoTFormField label="End">
                    <SoTInput
                      type="date"
                      name="rangeEnd"
                      defaultValue={rangeEnd}
                      required
                    />
                  </SoTFormField>
                </div>
                <div className="flex items-end">
                  <SoTButton type="submit" variant="primary">
                    Load
                  </SoTButton>
                </div>
              </Form>

              <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <Link
                  to="/store/workforce/schedule-planner?preset=next-week"
                  preventScrollReset
                  className={`inline-flex h-9 items-center px-3 text-sm font-medium ${
                    preset === "next-week"
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  Week
                </Link>
                <Link
                  to="/store/workforce/schedule-planner?preset=next-two-weeks"
                  preventScrollReset
                  className={`inline-flex h-9 items-center border-l border-slate-200 px-3 text-sm font-medium ${
                    preset === "next-two-weeks"
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  2 Weeks
                </Link>
                <Link
                  to="/store/workforce/schedule-planner?preset=next-month"
                  preventScrollReset
                  className={`inline-flex h-9 items-center border-l border-slate-200 px-3 text-sm font-medium ${
                    preset === "next-month"
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  Month
                </Link>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Link
                  to="/store/workforce/schedule-templates"
                  className="inline-flex h-9 items-center px-1 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Pattern library
                </Link>
                <Form method="post">
                  <input type="hidden" name="_intent" value="publish-range" />
                  <input type="hidden" name="rangeStart" value={rangeStart} />
                  <input type="hidden" name="rangeEnd" value={rangeEnd} />
                  <SoTButton type="submit" variant="primary" size="compact">
                    Publish
                  </SoTButton>
                </Form>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                Employee schedule board
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Click any cell to edit.
              </p>
            </div>
            <div className="text-xs text-slate-500">Preset cells save and close.</div>
          </div>

          <div className="overflow-x-auto">
            <table
              className={`w-full border-collapse text-sm ${
                isVeryDenseWindow
                  ? "min-w-[720px]"
                  : isDenseWindow
                    ? "min-w-[840px]"
                    : "min-w-[980px]"
              }`}
            >
              <thead className="bg-slate-50/90">
                <tr>
                  <th
                    className={`relative sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.28)] after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-slate-300 after:content-[''] ${
                      isDenseWindow ? "min-w-[170px]" : "min-w-[200px]"
                    }`}
                  >
                    Employee
                  </th>
                  {boardDates.map((date) => (
                    <th
                      key={date.key}
                      className={`border-b border-slate-200 px-3 py-3 text-left align-top ${
                        isVeryDenseWindow
                          ? "min-w-[96px]"
                          : isDenseWindow
                            ? "min-w-[112px]"
                            : "min-w-[138px]"
                      }`}
                    >
                      {isDenseWindow ? (
                        <>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {date.label.slice(0, 3)}
                          </div>
                          <div className="mt-1 text-xs font-medium text-slate-700">
                            {date.key.slice(-2)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {date.label}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {date.fullLabel}
                          </div>
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boardRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={boardDates.length + 1}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No active employees found for the planner board.
                    </td>
                  </tr>
                ) : (
                  boardRows.map((row) => {
                    const availablePatternsForWorker =
                      workerPatternChoicesByRole.get(row.worker.role) ?? [];
                    const rowDraftSummary = workerDraftSummaryById[String(row.worker.id)] ?? {
                      draftCount: 0,
                      generatedDraftCount: 0,
                    };

                    return (
                      <tr key={row.worker.id} className="align-top">
                      <th className="relative sticky left-0 z-10 border-r border-t border-slate-200 bg-white px-4 py-4 text-left shadow-[6px_0_12px_-10px_rgba(15,23,42,0.22)] after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-slate-300 after:content-['']">
                        <div className="space-y-1.5">
                          <div className="font-semibold text-slate-900">{row.worker.label}</div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setActivePatternWorkerId(row.worker.id)}
                              disabled={availablePatternsForWorker.length === 0}
                              className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-medium ${
                                availablePatternsForWorker.length === 0
                                  ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                                  : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
                              }`}
                            >
                              Apply pattern
                            </button>
                          </div>
                        </div>
                        {rowDraftSummary.draftCount > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Form
                              method="post"
                              onSubmit={(event) => {
                                const confirmed = window.confirm(
                                  `Clear ${rowDraftSummary.draftCount} draft row(s) for ${row.worker.label} in ${plannerWindowLabel}? Published rows will stay unchanged.`,
                                );
                                if (!confirmed) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input type="hidden" name="_intent" value="clear-worker-drafts" />
                              <input type="hidden" name="workerId" value={row.worker.id} />
                              <input type="hidden" name="rangeStart" value={rangeStart} />
                              <input type="hidden" name="rangeEnd" value={rangeEnd} />
                              <SoTButton
                                type="submit"
                                variant="secondary"
                                size="compact"
                                className="h-auto border-transparent bg-transparent px-0 py-0 text-[11px] text-amber-700 hover:bg-transparent hover:text-amber-800"
                              >
                                Clear drafts
                              </SoTButton>
                            </Form>
                          </div>
                        ) : null}
                      </th>
                      {row.cells.map((cell) => {
                        const isSelected =
                          activeCell?.workerId === row.worker.id &&
                          activeCell?.dateKey === cell.dateKey;
                        const offCell = isOffSchedule(cell.schedule);
                        const workCell = isWorkSchedule(cell.schedule);
                        const matchedPreset =
                          !workCell || cell.schedule == null
                            ? null
                            : findBoardShiftPreset(
                                shiftPresets,
                                cell.schedule.startAt,
                                cell.schedule.endAt,
                              );
                        const primaryLabel = offCell
                          ? "OFF"
                          : cell.schedule
                            ? matchedPreset
                              ? matchedPreset.timeWindowLabel
                              : formatTimeWindow(
                                  cell.schedule.startAt,
                                  cell.schedule.endAt,
                                )
                            : "Blank";
                        const supportingLabel = offCell
                          ? "Day off"
                          : cell.schedule
                            ? cell.schedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
                              ? "Published"
                              : "Draft"
                            : null;
                        const cellToneClass = offCell
                          ? "border-rose-100 bg-rose-50/70 hover:border-rose-200"
                          : cell.schedule
                            ? cell.schedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
                              ? "border-emerald-100 bg-emerald-50/70 hover:border-emerald-200"
                              : "border-amber-100 bg-amber-50/70 hover:border-amber-200"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50";

                        return (
                          <td
                            key={cell.dateKey}
                            className={`border-t border-slate-200 px-2 py-2 ${
                              isSelected ? "bg-indigo-50/40" : "bg-white"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setActiveCell({
                                  workerId: row.worker.id,
                                  dateKey: cell.dateKey,
                                })
                              }
                              className={`block min-h-[72px] w-full rounded-[20px] border px-3 py-3 text-left ${cellToneClass} ${
                                isSelected
                                  ? "border-indigo-300 ring-2 ring-indigo-100"
                                  : ""
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  {supportingLabel ?? ""}
                                </span>
                                {isSelected ? (
                                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                                ) : null}
                              </div>
                              <div
                                className={`mt-3 font-semibold text-slate-900 ${
                                  isVeryDenseWindow
                                    ? "text-xs"
                                    : isDenseWindow
                                      ? "text-[13px]"
                                      : "text-sm"
                                }`}
                              >
                                {primaryLabel}
                              </div>
                            </button>
                          </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <WorkforceSchedulePlannerPresetsPanel
          open={shouldOpenPresetLibrary}
          shiftPresets={shiftPresets}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
        />

        {isPatternModalOpen ? (
          <>
            <button
              type="button"
              aria-label="Close pattern apply"
              onClick={() => setActivePatternWorkerId(null)}
              className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]"
            />

            <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
              <div className="relative w-full max-w-xl overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-xl sm:rounded-[28px]">
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-lg">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                        Apply pattern
                      </div>
                      <h2 className="mt-1 text-xl font-semibold text-slate-900">
                        {selectedPatternWorker?.label}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Apply one named staffing pattern to {plannerWindowLabel}. Matching days
                        in this window will replace existing draft rows only. Published rows stay
                        as manual dates and can still be edited from the board one day at a time.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActivePatternWorkerId(null)}
                      className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>

                  {showPatternModalError ? (
                    <div className="mt-4">
                      <SoTAlert tone="warning">{actionData?.error}</SoTAlert>
                    </div>
                  ) : null}
                </div>

                <div className="px-5 py-4">
                  {selectedWorkerPatterns.length === 0 ? (
                    <SoTAlert tone="info">
                      No matching named staffing pattern is available for this worker.
                    </SoTAlert>
                  ) : (
                    <Form method="post" className="space-y-4">
                      <input type="hidden" name="_intent" value="apply-worker-pattern" />
                      <input
                        type="hidden"
                        name="workerId"
                        value={selectedPatternWorker?.id ?? ""}
                      />
                      <input type="hidden" name="rangeStart" value={rangeStart} />
                      <input type="hidden" name="rangeEnd" value={rangeEnd} />

                      <SelectInput
                        label="Named staffing pattern"
                        name="templateId"
                        defaultValue={String(selectedWorkerPatterns[0]?.id ?? "")}
                        options={selectedWorkerPatterns.map((pattern) => ({
                          value: String(pattern.id),
                          label: `${pattern.templateName} · ${pattern.days.length} day(s)`,
                        }))}
                      />

                      <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                        Visible scope: {plannerWindowLabel}
                        {selectedPatternWorker
                          ? ` · ${workerDraftSummaryById[String(selectedPatternWorker.id)]?.draftCount ?? 0} draft row(s) can be replaced`
                          : ""}
                      </div>

                      <div className="flex items-center justify-end gap-3">
                        <SoTButton type="submit" variant="secondary" size="compact">
                          Apply pattern to window
                        </SoTButton>
                      </div>
                    </Form>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}

        <WorkforceSchedulePlannerCellSheet
          open={isCellModalOpen}
          onClose={() => setActiveCell(null)}
          selectedWorker={selectedWorker}
          selectedDateKey={selectedDateKey}
          selectedDateLabel={selectedDateLabel}
          selectedSchedule={selectedSchedule}
          shiftPresets={shiftPresets}
          selectedPreset={selectedPreset}
          selectedWorkStartTime={selectedWorkStartTime}
          selectedWorkEndTime={selectedWorkEndTime}
          customStartTimeOptions={customStartTimeOptions}
          customEndTimeOptions={customEndTimeOptions}
          shouldOpenCustomEditor={shouldOpenCustomEditor}
          shouldOpenStaffingActivity={shouldOpenStaffingActivity}
          shouldOpenCellHistory={shouldOpenCellHistory}
          selectedEvents={selectedEvents}
          workers={workers}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          selectedCellBadgeTone={selectedCellBadgeTone}
          selectedCellBadgeLabel={selectedCellBadgeLabel}
          selectedCellSummaryTitle={selectedCellSummaryTitle}
          selectedCellSummaryDetail={selectedCellSummaryDetail}
          modalSuccessMessage={modalSuccessMessage}
          showModalError={showModalError}
          modalErrorMessage={actionData?.error}
        />
      </div>
    </main>
  );
}
