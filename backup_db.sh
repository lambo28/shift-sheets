#!/bin/bash
# Database backup script for shift-sheets

DB_FILE="/home/lambertnet/projects/shift-sheets/data/shift-sheets.db"
BACKUP_DIR="/home/lambertnet/projects/shift-sheets/data/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/shift-sheets_$TIMESTAMP.db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Create backup
if [ -f "$DB_FILE" ]; then
    cp "$DB_FILE" "$BACKUP_FILE"
    echo "✓ Backup created: $BACKUP_FILE"
    
    # Keep only last 10 backups
    ls -t "$BACKUP_DIR"/shift-sheets_*.db | tail -n +11 | xargs -r rm
    echo "✓ Old backups cleaned (keeping last 10)"
else
    echo "✗ Database file not found: $DB_FILE"
    exit 1
fi
