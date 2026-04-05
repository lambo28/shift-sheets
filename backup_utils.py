from datetime import datetime, timedelta
from pathlib import Path
import os
import shutil
import sqlite3
import tempfile


AUTO_BACKUP_HOUR = 2
AUTO_BACKUP_RETENTION_DAYS = 45


def get_sqlite_database_path(config):
    """Return configured SQLite database path as Path, or None if unsupported."""
    uri = config.get('SQLALCHEMY_DATABASE_URI', '')
    if not str(uri).startswith('sqlite:///'):
        return None
    db_path = config.get('DATABASE_PATH')
    if db_path is None:
        return None
    return Path(db_path)


def looks_like_sqlite_db(file_path):
    """Basic validation that file is a readable SQLite database."""
    try:
        with open(file_path, 'rb') as fh:
            header = fh.read(16)
        if header != b'SQLite format 3\x00':
            return False

        conn = sqlite3.connect(str(file_path))
        try:
            conn.execute('PRAGMA schema_version').fetchone()
            table_names = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            required_tables = {'driver', 'shift_pattern', 'shift_timing'}
            return required_tables.issubset(table_names)
        finally:
            conn.close()
    except Exception:
        return False


def get_auto_backup_dir(db_path):
    """Return folder used for persistent automatic backups."""
    return db_path.parent / 'backups'


def get_auto_backup_filename(db_path, backup_dt):
    """Return deterministic nightly backup filename for the given date."""
    return f"{db_path.stem}.auto-backup-{backup_dt.strftime('%Y%m%d')}{db_path.suffix}"


def get_auto_backup_path(db_path, backup_dt):
    """Return full path for the automatic backup file for backup_dt."""
    return get_auto_backup_dir(db_path) / get_auto_backup_filename(db_path, backup_dt)


def list_auto_backups(db_path):
    """Return available automatic backup files, newest first."""
    if db_path is None:
        return []

    backup_dir = get_auto_backup_dir(db_path)
    if not backup_dir.exists():
        return []

    pattern = f"{db_path.stem}.auto-backup-*{db_path.suffix}"
    backups = []
    for backup_path in backup_dir.glob(pattern):
        try:
            stat = backup_path.stat()
        except OSError:
            continue

        backups.append({
            'name': backup_path.name,
            'path': backup_path,
            'modified_at': datetime.fromtimestamp(stat.st_mtime),
            'size_bytes': stat.st_size,
        })

    backups.sort(key=lambda item: item['modified_at'], reverse=True)
    return backups


def resolve_auto_backup_path(db_path, backup_name):
    """Resolve an automatic backup filename safely within the backup folder."""
    if db_path is None or not backup_name:
        return None
    if '/' in backup_name or '\\' in backup_name:
        return None

    expected_prefix = f"{db_path.stem}.auto-backup-"
    if not backup_name.startswith(expected_prefix) or not backup_name.endswith(db_path.suffix):
        return None

    backup_dir = get_auto_backup_dir(db_path).resolve()
    backup_path = (backup_dir / backup_name).resolve()
    if backup_path.parent != backup_dir:
        return None
    if not backup_path.exists() or not backup_path.is_file():
        return None
    return backup_path


def prune_auto_backups(db_path, retention_days=AUTO_BACKUP_RETENTION_DAYS):
    """Keep only the newest retention_days automatic backups."""
    backups = list_auto_backups(db_path)
    removed_count = 0
    for backup in backups[retention_days:]:
        try:
            backup['path'].unlink()
            removed_count += 1
        except OSError:
            pass
    return removed_count


def create_auto_backup(db_path, backup_dt=None, retention_days=AUTO_BACKUP_RETENTION_DAYS):
    """Create or refresh the automatic backup file for backup_dt and prune old backups."""
    backup_dt = backup_dt or datetime.now()
    backup_dir = get_auto_backup_dir(db_path)
    backup_dir.mkdir(parents=True, exist_ok=True)

    backup_path = get_auto_backup_path(db_path, backup_dt)
    shutil.copy2(db_path, backup_path)
    timestamp = backup_dt.timestamp()
    os.utime(backup_path, (timestamp, timestamp))
    prune_auto_backups(db_path, retention_days=retention_days)
    return backup_path


def create_temp_backup_copy(db_path):
    """Create a temporary database copy for download outside the project data folder."""
    suffix = db_path.suffix or '.db'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copy2(db_path, tmp.name)
        return Path(tmp.name)


def next_auto_backup_time(now=None):
    """Return the next scheduled automatic backup time."""
    now = now or datetime.now()
    next_run = now.replace(hour=AUTO_BACKUP_HOUR, minute=0, second=0, microsecond=0)
    if now >= next_run:
        next_run += timedelta(days=1)
    return next_run