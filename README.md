# SQLStudio

**An open-source desktop database workspace for macOS and Windows.**

SQLStudio brings SQL databases, MongoDB collections, and Redis keys into one desktop application. Browse data, write queries, inspect schemas, import and export SQL, and compare or synchronize relational tables from a tabbed workspace.

Built with Electron, React, and TypeScript. Released under the [MIT License](LICENSE).

SQLStudio is in early development. The features below are implemented, with the current limits documented alongside them. Bug reports, testing, documentation improvements, and code contributions are welcome.

## Features

| Feature              | What you can do                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connections | Connect to MySQL / MariaDB, PostgreSQL, SQLite, MongoDB, and Redis using database drivers.                                                            |
| Object browser       | Browse tables, views, collections, and Redis keys; switch between list and icon views; search and inspect objects.                                    |
| Data browser         | Page through records, sort columns, search across fields, combine column filters with AND / OR, and filter MongoDB documents with JSON.               |
| Query editor         | Use syntax highlighting, SQL completion, selected-statement execution, query history, and saved queries.                                              |
| Record editing       | Edit relational fields directly in the grid, add blank rows, then save pending changes. Updates and deletes require the complete primary key.         |
| Database console     | Run SQL, MongoDB JSON commands, and Redis text commands or JSON argument arrays from the top toolbar.                                                 |
| Operation log        | Review the latest 1,000 database operations with commands, bound parameters, database, timing, and success or failure, persisted on this device.      |
| Schema inspection    | Inspect columns, primary keys, foreign keys, and indexes, and view database relationship diagrams.                                                    |
| Import and export    | Import and export relational SQL, import table data from CSV, export results as CSV / JSON, and back up SQLite files.                                 |
| Schema comparison    | Compare column types, nullability, defaults, primary keys, indexes, and foreign keys; preview SQL for new tables and columns.                         |
| Data synchronization | Review inserts, updates, and optional deletions between compatible tables, then apply changes in a transaction after checking for concurrent changes. |
| Localization         | Switch between English and Simplified Chinese without restarting, including desktop menus and file dialogs.                                           |

## Supported databases

| Database        | Connection                                                                 | Main workflows                                                                                                     |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| MySQL / MariaDB | Host, port, database, and credentials                                      | SQL queries, record editing, schema inspection, SQL import / export, comparison, and synchronization.              |
| PostgreSQL      | Host, port, database, and credentials                                      | SQL queries, record editing, schema inspection, SQL import / export, comparison, and synchronization.              |
| SQLite          | Local database file                                                        | SQL queries, record editing, schema inspection, SQL import / export, comparison, synchronization, and file backup. |
| MongoDB         | Host and credentials, or a connection URI                                  | Collection browsing, JSON filters, and supported JSON commands.                                                    |
| Redis           | Host and port, or a Redis URI; optional authentication and database number | Key browsing, logical database switching, and commands entered as text or JSON argument arrays.                    |

Connection presets include Amazon RDS, Supabase, Neon, MongoDB Atlas, and TiDB Cloud. These use the corresponding database protocols and connection details. TLS connections validate server certificates.

Redis connections support no authentication, password-only authentication, and ACL users, including users configured without a password. You can also enter a `redis://` or `rediss://` URI. Leave the database number blank to start in database 0; the sidebar lists all configured logical databases, including empty ones. If `CONFIG GET` is unavailable, SQLStudio discovers database numbers using a separate connection. Accounts that cannot read configuration or select databases see the current database with a permission notice.

## Quick start

### Install a desktop build

- **macOS:** choose the arm64 DMG for Apple Silicon or the x64 DMG for Intel, open it, and drag SQLStudio into Applications.
- **Windows:** run the x64 NSIS installer and follow the installation wizard.

Installers can be generated using the [desktop packaging commands](#desktop-packaging). The [CI workflow](.github/workflows/build.yml) also uploads them as build artifacts. Packaged applications include their runtime and do not require Node.js to be installed separately.

### Run from source

Requirements:

- Node.js **22.12 or newer**. The CI workflow uses Node.js 24.
- npm.
- macOS or Windows for the desktop application.

From a local clone of this repository:

```bash
npm ci
npm run desktop
```

The application starts with an empty connection list. Choose **Create your first connection** to connect your own database; no sample database is created or included.

To connect your own database, choose **Connections** in the toolbar, select a database engine, enter its connection details, and test the connection before saving it.

### Interface language

On first launch, the application currently defaults to Simplified Chinese. Open **系统设置** in the upper-right corner, then choose **English** under **界面语言 / Interface language**. Changes take effect immediately and are saved on the device.

Switching languages preserves open tabs, query text, and filters. Connection names, database identifiers, and stored data retain their original values. The desktop application and browser development preview store their language preferences separately.

## Everyday workflows

### Browse and filter data

Open a table or view and choose **Conditions** to combine up to 20 column conditions with AND or OR. Operators include equality, inequality, comparisons, contains, starts with, ends with, inclusive ranges, and NULL checks. Column filters can be combined with the search field.

Relational filters run in the database and apply to row counts, sorting, and pagination. Column names are validated against the schema, values are bound as parameters, and `%` / `_` are treated as literal characters in contains matching.

Right-click connections, databases, and tables for connection management, queries, schema inspection, import / export, comparison, synchronization, renaming, and deletion. The database menu includes **Delete database**, separately from **Delete connection profile** in the connection menu. Database deletion removes the database and all its data (the file for SQLite); the connection profile is retained. Redis uses **Empty database** to remove keys from the selected logical database. Deletion requires confirmation, and system databases are protected.

For MySQL and PostgreSQL, right-click a connection or database and choose **Create database**. Right-click a database and choose **Edit database** to change MySQL's default character set and collation, or rename a PostgreSQL database. MySQL defaults apply to newly created tables; existing table data is not converted. PostgreSQL renaming updates saved connection profiles and reconnects the active workspace; a server refusal restores the original sessions.

### Compare schemas and synchronize data

1. Add the source and target database connections.
2. Right-click a connection, database, or table and choose **Schema compare**, then choose the source and target connections and databases. MySQL and PostgreSQL support choosing different databases within the same connection.
3. Select any number of tables, or use **Select all**. Same-name tables are matched automatically; review or change each target mapping. Missing target tables can be created using the generated schema SQL.
4. Review per-table differences and the combined SQL. Use **Open all SQL in target query editor** to review and run the schema changes in the chosen target database.
5. Choose **Data sync** from the right-click menu, then select databases and tables using the same database engine with matching columns, types, and primary keys. Review each table's differences and confirm **Synchronize all selected tables**. Extra target records are retained unless deletion is explicitly enabled.

Synchronization supports up to **500 selected tables** per batch, with a limit of **10,000 rows / 8 MiB per table**. Plans expire after **10 minutes**. The application rechecks all selected tables' data and schema fingerprints before applying any writes and cancels if either side has changed. All target writes use one transaction. Parent tables are written before child tables, and child records are deleted before parent records. MySQL targets must use InnoDB. Constraint failures roll back the entire batch, including writes to earlier tables.

Schema SQL generation covers new tables and new ordinary columns. Dropping columns, altering types, or rebuilding indexes and foreign keys requires manual SQL. Cross-engine schema mapping produces a preliminary script that needs review for precision, length, time zones, generated values, defaults, and constraints. Data synchronization requires the same database engine. Cyclic dependencies and foreign keys crossing schemas or referring to unselected tables may need manual handling.

### Import and export SQL

Use the SQL import and export actions in the connection, database, or object context menu to transfer relational schema and data.

| Operation  | Current limits                          |
| ---------- | --------------------------------------- |
| SQL export | 10,000 rows per table; 20 MiB per file. |
| SQL import | 20 MiB per file; 50,000 statements.     |

SQLite exports support tables, data, views, indexes, and triggers. PostgreSQL exports support ordinary tables, column types, primary keys, constraints, indexes, serial / identity columns, and views. MySQL exports use `SHOW CREATE` for table and view definitions.

Database users, permissions, functions, procedures, extensions, custom types, and complex dependencies are outside the current export scope. Use native database backup tools when you need a complete backup.

SQLite and PostgreSQL imports run in transactions; SQLite checks foreign keys before committing. MySQL DDL can commit implicitly, so a failed import may leave completed schema changes in place. The import preview explains this behavior. The target must be empty or compatible with the script; imports do not automatically drop existing tables.

Manual transaction statements, database switching, and MySQL `DELIMITER` / procedure imports are not supported in SQL files. Transactions for imports and synchronization are managed by the application; the query editor also does not accept manual transaction control.

### MongoDB commands

Enter a JSON command in the query editor:

```json
{
  "collection": "customers",
  "operation": "find",
  "filter": { "status": "active" },
  "limit": 100
}
```

Supported operations are `find`, `count`, `aggregate`, `insertOne`, `updateOne`, and `deleteOne`. Aggregation does not support `$out` or `$merge`. For MongoDB Atlas, provide the connection URI and database name.

### Redis commands

Enter a command as text:

```text
GET customer:1
```

Or use a JSON argument array:

```json
["SET", "customer:1", "hello world"]
```

Subscription, transaction, connection-control, and full-database clearing commands are currently restricted. The key browser uses `SCAN` and lists up to 2,000 keys in a tree grouped by colon-separated namespaces. Selecting a key shows its value as collapsible JSON with type and expiration information; lists, sets, and sorted sets display up to 1,000 items and indicate when more remain. MongoDB and Redis writes use the query editor or **Database console** in the top toolbar.

### Edit records and review operations

Click any editable relational field and type its new value. **Add record** appends a blank row directly to the grid. Leave a new field at **Default value** to use its database default or generated value; choose **NULL** explicitly or enter an empty string. Click **Save** to write pending rows immediately. Errors appear in a dialog and failed rows retain their inputs. Each successful row is removed from the pending set, so retrying after a later failure does not duplicate earlier inserts. **Discard changes** clears pending edits. Existing rows require a primary key; generated columns remain read-only.

Right-click a data row to **Copy rows**, **Copy as INSERT statements**, or **Copy as UPDATE statements**. Right-clicking a selected row copies all selected rows; otherwise it uses the clicked row. UPDATE statements use the original primary key, including composite keys. Click row numbers to select rows (Shift for a range, Ctrl / ⌘ for multiple rows). With the grid focused, Ctrl / ⌘ + C copies selected rows and Ctrl / ⌘ + V pastes them as new pending records. **Paste as new rows** is also available in the grid's context menu, including an empty table. Review pasted values and adjust duplicate primary or unique keys before saving. SQL NULL, empty strings, multiline text, and default values remain distinct. Text from spreadsheets can be pasted as tab-separated rows in the table's column order, optionally with column headers.

The sidebar and object-list search boxes share their search text. Search matches any part of an object name without regard to case, trims surrounding whitespace, and accepts schema-qualified names such as `public.orders`. Matching nodes expand while searching; clearing the search restores the previous collapsed state. Searches cover the objects loaded for the selected database.

Open **Operation log** in the top toolbar to search commands, connection names, and databases, or filter by execution status. The database service retains the latest 1,000 user operations across restarts, including console and query commands, grid writes, SQL imports, and synchronization. Background metadata reads are excluded. Parameterized statements display their bound values alongside the SQL.

## Local storage and operating limits

- **Connection storage:** desktop configuration is stored in Electron's `userData` directory. When system encryption is available, configuration is encrypted with `safeStorage`. Otherwise, passwords and connection URIs are not persisted. Browser development mode never persists passwords or connection URIs.
- **Desktop isolation:** passwords and connection URIs are excluded from connection details returned to the renderer. Context isolation and sandboxing are enabled, renderer Node.js integration is disabled, and IPC calls are checked against the application window.
- **SQLite files:** SQLStudio uses `sql.js` to load a file into memory and persist changes through atomic replacement. Avoid concurrent writes from other applications. External file changes trigger fingerprint checks that block overwrites; nonempty WAL files block opening or overwriting until other writers are closed and a checkpoint is completed. A connection invalidated by a file conflict will not retry saving at shutdown.
- **Query results:** SQL results display up to 1,000 rows. Remote drivers may still fetch the full result into memory, so include an explicit `LIMIT` when querying large datasets.
- **Query storage:** history and saved queries remain in local renderer storage. Sensitive values written into query text are retained as part of that text.

## Development

The browser preview runs the same interface with a local database service:

```bash
npm run dev
# Open http://127.0.0.1:5173
```

The development service listens on `127.0.0.1:4321` and stores its data in `.sqlstudio/`. Desktop mode accesses the database service through Electron IPC and does not require an HTTP server. The browser preview is intended for local development.

### Project structure

```text
electron/       Desktop lifecycle, menus, IPC, and preload bridge
src/            React interface, components, styles, and client API
server/         Database drivers, connection storage, filters, SQL files, and comparison
shared/         Types, translations, and localization helpers
tests/          Database service, filtering, import, sync, and localization tests
scripts/        Development launcher and build helpers
docs/           Screenshots and branding documentation
public/         Application icon and static assets
```

### Validation

```bash
npm run check
npm test
npm run build
```

Tests use isolated temporary SQLite files and cover queries, pagination, filtering, primary-key checks, import rollback, persistence, backups, schema comparison, synchronization, rejection of concurrent changes, and failure rollback. Localization tests cover fallback behavior, parameter preservation, message translation, and placeholder consistency. Integration testing for the other drivers requires actual database instances.

### Application version

`package.json`'s `version` is the single source for the interface, Electron's About panel, and installers. To increment the patch version and synchronize `package-lock.json`, run:

```bash
npm version patch --no-git-tag-version
```

Use `minor`, `major`, or an explicit version instead of `patch` when needed, then rebuild or repackage the app. The fixed seed in `scripts/mac-identity.mjs` preserves macOS network permissions and stays unchanged during application version updates.

### Desktop packaging

On macOS, build the macOS and Windows installers together with one command:

```bash
npm run pack:all
```

This builds the app once, then produces macOS DMGs for Apple Silicon (`arm64`) and Intel (`x64`), plus a Windows NSIS installer (`x64`), in `release/`. It does not publish the installers. These combined commands require a macOS host; packaging tools and Electron binaries are downloaded as needed on the first run.

For local testing without an Apple signing certificate, use ad-hoc signing for the macOS apps while also building the Windows installer:

```bash
npm run pack:all:local
```

To build only one platform:

```bash
npm run pack:mac       # macOS DMG: Apple Silicon (arm64) and Intel (x64)
npm run pack:win       # Windows NSIS installer: x64
```

Build artifacts are written to `release/`. The [GitHub Actions workflow](.github/workflows/build.yml) tests, builds, and packages on macOS and Windows and uploads the installers as workflow artifacts.

Public distribution still requires release signing, macOS notarization, and validation on Windows hardware. Local packaging and CI artifacts should be treated as development builds.

The shared application icon is `public/app-icon.png`; electron-builder generates platform-specific icon formats. Design sources and generation notes are in [the branding documentation](docs/app-icon.md).

## Contributing

Contributions are welcome, including database compatibility reports, UI improvements, translations, documentation, and tests.

1. Open an issue describing the bug or proposed change. For bugs, include your operating system, database engine and version, reproduction steps, and expected behavior. Remove credentials and private data from logs or screenshots.
2. For substantial changes, discuss the scope in an issue before implementation.
3. Create a branch and keep the change focused. Add or update relevant tests for behavior changes.
4. Run `npm run check`, `npm test`, and `npm run build`, then submit a pull request describing the change and how you verified it.

## Roadmap

Areas for future work include:

- SSH tunnels and broader database integration testing.
- Visual table design, query building, and execution-plan visualization.
- Function and procedure management.
- Automatic migrations for column changes, indexes, foreign keys, and cyclic dependencies.
- Streaming synchronization for large tables and cross-engine data transfer.
- Broader backup / restore, automation, and BI workflows.

These capabilities are not implemented yet; related toolbar actions are disabled.

## License

SQLStudio is released under the [MIT License](LICENSE).

Copyright © 2026 SQLStudio contributors.
