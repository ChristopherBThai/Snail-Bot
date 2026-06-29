# Systems

Shared systems provide reusable infrastructure for commands, modules, and runtime composition. They should not own feature-specific policy unless the system itself is the feature boundary.

## Logger

`src/systems/logger/index.js` owns Snail's in-memory runtime logging.

The logger is meant for debugging live runtime behavior from inside Discord, especially when user feedback is vague or hard to reproduce. Logs are memory-only in this slice and disappear on restart.

### Logging System

Snail creates one shared logging system at startup. It keeps:

- A global timeline ring for all-log export.
- Per-source rings so one noisy module or system does not evict another source's own logs.
- A source-level table shared by all loggers with the same `sourceID`.

Each log entry uses this shape:

```js
{ time, sourceID, level, type, data }
```

`sourceID` is the source that wrote the log, such as `runtime`, `discord`, or `quest_list`.

The root startup logger uses `sourceID: "runtime"`. Other systems should use their own `sourceID` instead of sharing `runtime`.

Create source loggers from the shared logging system:

```js
const logger = logging.createLogger({ sourceID: 'runtime' });
```

Sources default to `info` logs unless a logger is created with an explicit level or a persisted level is loaded.

Loggers can read only their own source entries with `logger.getEntries()`. All-log export reads directly from the shared logging system.

Creating a logger registers its `sourceID` with the shared logging system. Changing a source level updates every existing logger for that source, and future loggers for the same source start with that shared level. Non-module source levels are persisted through Snail config by `/logs`; module source levels are persisted through the owning module's log-level config.

Managers can use `/logs` to view non-module sources, set non-module source log levels, export one source, or export the full timeline. Module-specific log exports stay in `/module`.

### Logger API

Use level-specific methods:

```js
logger.trace(type, data);
logger.debug(type, data);
logger.info(type, data);
logger.warn(type, data);
logger.error(type, data);
```

Use level-specific methods at call sites so severity is easy to scan.

Use child loggers to bind workflow context:

```js
const log = logger.child({ logID, userID, channelID });

log.info('tag.get.started', { tagName });
```

Use timers for measured work:

```js
const timer = logger.time('message_builder.panel_update', { blockCount });

timer.end({ fileCount });
timer.fail(error, { fileCount });
```

Timer durations are recorded in the `duration` field. Timings are assumed to be milliseconds unless a field explicitly says otherwise.

### Event Names

Use dot-separated event names:

```text
domain.object.action
```

Examples:

```text
tag.created
tag.get.started
tag.get.rendered
message_builder.panel_updated
discord.interaction.failed
```

Prefer these lifecycle suffixes:

- `.started`
- `.completed`
- `.failed`
- `.skipped`
- `.updated`

### Data Fields

Use stable, explicit data keys:

- `logID`: shared ID for one workflow or interaction path through the logs.
- `userID`
- `guildID`
- `channelID`
- `messageID`
- `interactionID`
- `sessionID`
- `duration`
- `error`

Avoid vague keys when a precise key exists. Prefer `tagName` over `name`, and prefer `targetType` over `type` inside `data` because `type` is already the log event name.

Pass real `Error` objects as `error`; the logger serializes them consistently.

### Module Config Logs

Base module config persistence should log only the storage operation, not raw values:

```text
module.config.updated
module.config.deleted
```

Use these logs for debugging whether a config write happened and how long it took. Owning modules should separately log semantic config changes with safe fields that explain what changed. For example, Quest List can log `quest_list.config_updated` with `setting: "channel"` and `channelID`.

### Console Behavior

Runtime logs print to console by default. System and module logs do not print to console by default.
