# Snail schema-version-1 migration

`npm run migrate` reads **only `SNAIL_MONGO_URI`**. It does not connect to OwO Mongo, MySQL, Redis or Qdrant. Do not run the bot alongside the migration.

## Before running

1. **Stop every writer to the selected Snail database**, including all bot replicas, workers, scheduled jobs and administrative scripts. Keep them stopped through backup, migration and verification. This is a single-database dump without oplog capture; running writers can make the archive inconsistent. The script cannot enforce this operational prerequisite.
2. Install MongoDB Database Tools (`mongodump` and, for recovery, `mongorestore`; tools with `--config` support are required, 100.3.0+). Verify access to `mongodump` on the migration process's `PATH` and sufficient disk space. The bot Docker image does not install these tools automatically: use an operator-controlled migration environment with them installed.
3. Securely configure `SNAIL_MONGO_URI` using the normal private environment/`.env` mechanism. Its path **must explicitly name the Snail database**: `mongodb://HOST/snail_db?authSource=admin`, for example. Authentication credentials belong in the private configuration, not shell command arguments/history. `authSource` is not the backup target. An absent database, system database (`admin`, `config`, `local`), invalid name or mismatch with the connected database is rejected before migration writes. No fallback to a default or all-database dump exists.
4. Create an existing private backup directory **outside the repository**, on durable storage, and set its absolute path:

    ```sh
    install -d -m 700 /secure/snail-migration-backups
    export SNAIL_MIGRATION_BACKUP_DIR=/secure/snail-migration-backups
    npm run migrate
    ```

The schema version is read first. Version 1 skips migration and backup, even if the backup directory/tool is unavailable. Invalid or newer versions fail without backup or writes.

For version 0, the script creates a unique `snail-v0-*` directory (mode `0700`) under the configured directory. It writes a gzip-compressed Mongo archive (mode `0600`) using `mongodump --db <explicit Snail database> --archive --gzip`. The full URI is passed through a private temporary tool config, never through command arguments or logs. The child receives only `PATH`, not ambient application credentials. This means cloud authentication that depends on inherited environment variables is not supported; configure authentication explicitly in the URI or use a supported operator environment before proceeding.

The archive streams to `snail.archive.gz.partial`, is flushed to disk, and becomes `snail.archive.gz` only after successful tool completion. Each run gets a new directory; existing archives are not reused. Missing tools, failed dumps, empty output or backup filesystem errors abort before any migration mutation. Partial archives are retained, **not valid recovery backups**. The temporary credential config is removed on normal success/failure. If the process/host is forcibly killed, inspect the private run directory for a leftover `mongodump.yml` and securely remove that credential file yourself. Archives are never automatically restored or pruned.

Output deliberately suppresses raw driver/tool errors because they can contain credentials. On failure, keep writers stopped, check connectivity, URI database scope, tool availability and backup-directory permissions. Only `Snail Mongo backup complete: ...` confirms the backup gate passed. Failures after that point can leave a **partially migrated** database; the migration is not transactional. Preserve the pre-migration archive before considering a retry; a new retry backup could contain partially migrated state.

## Data changes

- Every user is retained. Targeted updates preserve friends, unrelated fields and modern preferences.
- Present legacy `reminders.luck`, `reminders.hunt` and singular `reminders.battle` objects with boolean `enabled` values become booleans. Both true and false survive; existing booleans and absent preferences are unchanged. Invalid/nonboolean legacy values are left untouched.
- Optout uses the first boolean of `supporterRoles.optout`, `supporterRoles.optedOut`, `supporterRoles.disabled`, then `snailRoles`. False is meaningful. The resulting `supporterRoles.optout` is set only when needed, and boolean legacy `snailRoles` is removed. Other supporter-role fields are retained.
- The User schema retains string references to `User` in `friends`, plus boolean hunt/battle preferences, without enabling those features. Absent hunt/battle preferences and friends do not receive invented defaults. The existing luck default remains false when a reminders subdocument is present; the migration itself does not create missing preferences.
- Existing tag migration semantics remain: v2 question caches are discarded (including excluded tags), the excluded flag survives, v3 questions are retained, and hash formulas are unchanged. `5m` becomes `fivemil`.
- `knowledgeterms` becomes `knowledgeTerms`; obsolete `channels`, `configs`, `knowledge`, and `quests` collections are dropped. The schema-version record is written last.

## Recovery / restore rehearsal

Keep the archive path from the success log and protect it as sensitive database content. Test recovery into a **fresh, isolated Mongo instance** before using a backup to recover a deployment. Put the restore destination URI in a mode-`0600` YAML config under a private directory (key `uri`, JSON-quoted string is valid YAML). Do not put credentials in CLI arguments. Then, substituting the exact source database name and archive path:

```sh
mongorestore --config /secure/restore-target.yml \
  --archive=/secure/snail-migration-backups/snail-v0-UNIQUE/snail.archive.gz \
  --gzip --nsInclude 'snail_db.*'
```

This restores only the source Snail namespace into that isolated target. Verify collection names, document counts and representative documents, especially all user preferences/friends, tags and obsolete collections from before migration. Confirm the old schema-version record (or its original absence). A clean restore must not include any unrelated database.

Do not restore blindly over the partially migrated database: ordinary restore does not remove all new collections/documents. For real rollback, an operator must choose a clean destination and deliberately switch Snail's connection to it, or separately authorize replacement of the existing Snail database while all writers remain stopped. Coordinate the application version with the restored schema. There is no automatic restore, database deletion or backup deletion.

## Local verification (no production configuration)

```sh
npm ci --ignore-scripts
node --test tests/migrate.test.js
RUN_MONGO_MIGRATION_INTEGRATION=1 node --test tests/migrate.integration.test.js
```

The opt-in integration test requires Docker and the `mongo:8.0` image. It creates two disposable, loopback-bound Mongo servers, copies their Database Tools into a temporary test directory, and supplies only its own fixture URI/environment. It never loads `.env`. It verifies failure gates, exact migrated users, accepted tag/collection behavior, permissions, version skipping, and a real dump/restore roundtrip of the complete pre-migration database. An unrelated database sentinel must not enter the archive. Containers are stopped in `finally`; test archives are retained at the printed scratch path. Without the opt-in environment variable, the integration test is explicitly skipped.
