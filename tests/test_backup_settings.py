import sqlite3
from datetime import datetime, timedelta

from backup_utils import create_auto_backup, create_temp_backup_copy, list_auto_backups, prune_auto_backups


def _create_sample_sqlite_db(db_path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute('CREATE TABLE driver (id INTEGER PRIMARY KEY, name TEXT)')
        conn.execute('CREATE TABLE shift_pattern (id INTEGER PRIMARY KEY, name TEXT)')
        conn.execute('CREATE TABLE shift_timing (id INTEGER PRIMARY KEY, shift_type TEXT)')
        conn.commit()
    finally:
        conn.close()


def test_create_auto_backup_keeps_latest_28_days(tmp_path):
    db_path = tmp_path / 'data' / 'shift-sheets.db'
    _create_sample_sqlite_db(db_path)

    start_dt = datetime(2026, 1, 1, 2, 0, 0)
    for offset in range(30):
        create_auto_backup(db_path, backup_dt=start_dt + timedelta(days=offset), retention_days=28)

    backups = list_auto_backups(db_path)

    assert len(backups) == 28
    assert backups[0]['name'] == 'shift-sheets.auto-backup-20260130.db'
    assert backups[-1]['name'] == 'shift-sheets.auto-backup-20260103.db'


def test_prune_auto_backups_returns_removed_count(tmp_path):
    db_path = tmp_path / 'data' / 'shift-sheets.db'
    _create_sample_sqlite_db(db_path)

    start_dt = datetime(2026, 2, 1, 2, 0, 0)
    for offset in range(30):
        create_auto_backup(db_path, backup_dt=start_dt + timedelta(days=offset), retention_days=60)

    removed_count = prune_auto_backups(db_path, retention_days=28)
    backups = list_auto_backups(db_path)

    assert removed_count == 2
    assert len(backups) == 28


def test_create_temp_backup_copy_stays_outside_project_data_folder(tmp_path):
    db_path = tmp_path / 'data' / 'shift-sheets.db'
    _create_sample_sqlite_db(db_path)

    temp_backup = create_temp_backup_copy(db_path)
    try:
        assert temp_backup.exists()
        assert temp_backup.parent != db_path.parent
        assert temp_backup.read_bytes() == db_path.read_bytes()
    finally:
        temp_backup.unlink(missing_ok=True)


def test_settings_page_lists_available_auto_backups(client, app, tmp_path):
    db_path = tmp_path / 'data' / 'shift-sheets.db'
    _create_sample_sqlite_db(db_path)
    create_auto_backup(db_path, backup_dt=datetime(2026, 4, 5, 2, 0, 0))

    original_uri = app.config.get('SQLALCHEMY_DATABASE_URI')
    original_path = app.config.get('DATABASE_PATH')

    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['DATABASE_PATH'] = db_path

    try:
        response = client.get('/settings')
    finally:
        app.config['SQLALCHEMY_DATABASE_URI'] = original_uri
        app.config['DATABASE_PATH'] = original_path

    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert 'shift-sheets.auto-backup-20260405.db' in body
    assert 'Last backup completed:' in body