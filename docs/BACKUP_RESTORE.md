# Backup And Restore

Runtime backups must be kept outside the application package. A package upgrade must not delete the runtime database, uploads, logs, or backups.

Minimum operator checks:

- confirm current runtime database path
- create a backup before upgrade
- verify backup file exists and is readable
- start the new package
- run health check
- run a login check
- verify recent orders, inventory, and finance records are still readable

Never copy an old package directory as a data backup. Use the backup workflow.
