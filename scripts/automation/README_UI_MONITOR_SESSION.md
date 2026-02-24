# UI Monitor + Repair Session Scripts

These scripts run monitor and repair loops continuously on a local Mac while keeping the system awake.

## Scripts

1. `scripts/automation/start-ui-monitor-session.sh`
2. `scripts/automation/start-ui-repair-session.sh`

## Monitor script behavior

1. Loads `.env` from `/Users/johnmichaell.benito/Desktop/client project/zmstore-pos-2/.env`
2. Starts `caffeinate -dims` to prevent sleep while session is active
3. Runs `UI_ROLE_SCOPE=all npm run ui:cycle`
4. Sleeps 3 hours (`10800s`) between runs and repeats
5. Appends logs to `docs/automation/logs/ui-monitor-session.log`
6. Continues looping even when a cycle fails
7. Uses lock dir `docs/automation/logs/ui-monitor-session.lock` so only one monitor session can run

## Repair script behavior

1. Watches `docs/automation/incidents/*.md` for new incidents
2. Triggers repair command on:
3. primary mismatch (`Rider Dashboard` / `Cashier Dashboard`), or
4. repeated secondary mismatch (same pattern in two consecutive incidents)
5. Uses `UI_REPAIR_COMMAND` when triggered
6. Appends logs to `docs/automation/logs/ui-repair-session.log`
7. Uses lock dir `docs/automation/logs/ui-repair-session.lock` so only one repair session can run
8. Rejects empty/placeholder `UI_REPAIR_COMMAND` by default

## Golden start commands

Use separate terminals for monitor and repair.

Monitor terminal:

```bash
cd /Users/johnmichaell.benito/.codex/worktrees/982b/zmstore-pos-2
scripts/automation/start-ui-monitor-session.sh
```

Repair terminal:

```bash
cd /Users/johnmichaell.benito/.codex/worktrees/982b/zmstore-pos-2
UI_REPAIR_INTERVAL_SECONDS=60 \
UI_REPAIR_REQUIRE_REPEAT_SECONDARY=0 \
UI_REPAIR_COMMAND='npm run ui:cycle' \
scripts/automation/start-ui-repair-session.sh
```

## Start monitor loop

```bash
cd /Users/johnmichaell.benito/.codex/worktrees/982b/zmstore-pos-2
scripts/automation/start-ui-monitor-session.sh
```

## Start repair loop

```bash
cd /Users/johnmichaell.benito/.codex/worktrees/982b/zmstore-pos-2
UI_REPAIR_COMMAND='npm run ui:cycle' scripts/automation/start-ui-repair-session.sh
```

## Stop loops

Use `Ctrl+C` in the terminal running the script.

## Manual resume after sleep/close

If the Mac sleeps or lid closes, local processes pause. Missed runs are not replayed.
After reopening, start each loop again with the same start commands.

## Optional interval override

Both defaults are 3 hours. To test faster:

```bash
UI_MONITOR_INTERVAL_SECONDS=300 scripts/automation/start-ui-monitor-session.sh
UI_REPAIR_INTERVAL_SECONDS=300 UI_REPAIR_COMMAND='npm run ui:cycle' scripts/automation/start-ui-repair-session.sh
```

## Troubleshooting

1. `command not found: Ctrl+C`:
Press `Control + C` on keyboard. Do not type `Ctrl+C` as text.

2. `Another session is already running`:
Stop old session first, or remove stale lock only when no process is active:
`rm -rf docs/automation/logs/ui-monitor-session.lock docs/automation/logs/ui-repair-session.lock`

3. `Refusing placeholder UI_REPAIR_COMMAND`:
Set a real command in `UI_REPAIR_COMMAND`, or set `UI_REPAIR_ALLOW_PLACEHOLDER=1` for dry runs.

4. `Incident has no [failed] samples` with known failures:
Restart repair loop so it re-reads latest incident and state:
`rm -f docs/automation/logs/ui-repair-session.state`
