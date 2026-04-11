import { Form } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SelectInput } from "~/components/ui/SelectInput";
import {
  HALF_HOUR_TIME_OPTIONS,
  type PlannerShiftPresetView,
} from "~/services/workforce-schedule-planner-date-helpers";

type WorkforceSchedulePlannerPresetsPanelProps = {
  open: boolean;
  shiftPresets: PlannerShiftPresetView[];
  rangeStart: string;
  rangeEnd: string;
};

export function WorkforceSchedulePlannerPresetsPanel({
  open,
  shiftPresets,
  rangeStart,
  rangeEnd,
}: WorkforceSchedulePlannerPresetsPanelProps) {
  return (
    <details
      id="work-presets"
      className="rounded-[26px] border border-slate-200 bg-slate-50/60 px-5 py-4"
      open={open}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Work presets
            </div>
            <h2 className="mt-1 text-sm font-semibold text-slate-900">Reusable shift times</h2>
            <p className="mt-1 text-xs text-slate-500">
              Keep this drawer secondary. The planner board stays the main work surface.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500">
            {shiftPresets.length} preset{shiftPresets.length === 1 ? "" : "s"}
          </span>
        </div>
      </summary>

      <div className="mt-4 space-y-3">
        {shiftPresets.length === 0 ? (
          <SoTAlert tone="info">
            No saved work presets yet. Add one below to speed up scheduling.
          </SoTAlert>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {shiftPresets.map((preset) => (
              <div
                key={`page-manage-${preset.id}`}
                className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {preset.timeWindowLabel}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Reusable work preset
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {preset.shortLabel}
                  </span>
                </div>

                <Form method="post" className="mt-4 space-y-3">
                  <input type="hidden" name="_intent" value="update-shift-preset" />
                  <input type="hidden" name="presetId" value={preset.id} />
                  <input type="hidden" name="rangeStart" value={rangeStart} />
                  <input type="hidden" name="rangeEnd" value={rangeEnd} />

                  <div className="grid gap-3 md:grid-cols-2">
                    <SelectInput
                      label="Start"
                      name="startTime"
                      defaultValue={preset.startTime}
                      options={HALF_HOUR_TIME_OPTIONS}
                    />
                    <SelectInput
                      label="End"
                      name="endTime"
                      defaultValue={preset.endTime}
                      options={HALF_HOUR_TIME_OPTIONS}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <SoTButton type="submit" variant="primary" size="compact">
                      Save preset
                    </SoTButton>
                  </div>
                </Form>

                <Form method="post" className="mt-2 flex justify-end">
                  <input type="hidden" name="_intent" value="delete-shift-preset" />
                  <input type="hidden" name="presetId" value={preset.id} />
                  <input type="hidden" name="rangeStart" value={rangeStart} />
                  <input type="hidden" name="rangeEnd" value={rangeEnd} />
                  <SoTButton type="submit" variant="secondary" size="compact">
                    Remove preset
                  </SoTButton>
                </Form>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-[20px] border border-dashed border-slate-300 bg-white px-4 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Add work preset</h3>
            <p className="mt-1 text-xs text-slate-500">
              Save another common shift so managers can apply it with one click.
            </p>
          </div>

          <Form method="post" className="mt-4 space-y-3">
            <input type="hidden" name="_intent" value="create-shift-preset" />
            <input type="hidden" name="rangeStart" value={rangeStart} />
            <input type="hidden" name="rangeEnd" value={rangeEnd} />

            <div className="grid gap-3 md:grid-cols-2">
              <SelectInput
                label="Start"
                name="startTime"
                defaultValue="06:00"
                options={HALF_HOUR_TIME_OPTIONS}
              />
              <SelectInput
                label="End"
                name="endTime"
                defaultValue="15:00"
                options={HALF_HOUR_TIME_OPTIONS}
              />
            </div>

            <div className="flex justify-end">
              <SoTButton type="submit" variant="primary" size="compact">
                Add preset
              </SoTButton>
            </div>
          </Form>
        </div>
      </div>
    </details>
  );
}
