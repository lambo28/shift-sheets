#!/usr/bin/env python3
"""
Database migration script.

Migrations included:
  1. Add pause/resume tracking columns to DriverAssignment table.
  2. Make start_time and end_time nullable in DriverCustomTiming table so that
     users can leave timing fields blank (falling back to the default shift time).

Run this script to update your existing database with these changes.
"""

import sqlite3
import os

# Path to your database file
DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'shift-sheets.db')

def migrate_database():
    """Run all pending database migrations"""
    
    if not os.path.exists(DB_PATH):
        print(f"❌ Database not found at {DB_PATH}")
        print("Please make sure you're running this from the shift-sheets directory.")
        return False
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(driver_assignment)")
        columns = [row[1] for row in cursor.fetchall()]
        
        changes_made = False
        
        # Add paused_by_assignment_id column if it doesn't exist
        if 'paused_by_assignment_id' not in columns:
            print("Adding paused_by_assignment_id column...")
            cursor.execute("""
                ALTER TABLE driver_assignment 
                ADD COLUMN paused_by_assignment_id INTEGER 
                REFERENCES driver_assignment(id)
            """)
            changes_made = True
            print("✓ Added paused_by_assignment_id column")
        else:
            print("✓ paused_by_assignment_id column already exists")
        
        # Add resumes_assignment_id column if it doesn't exist
        if 'resumes_assignment_id' not in columns:
            print("Adding resumes_assignment_id column...")
            cursor.execute("""
                ALTER TABLE driver_assignment 
                ADD COLUMN resumes_assignment_id INTEGER 
                REFERENCES driver_assignment(id)
            """)
            changes_made = True
            print("✓ Added resumes_assignment_id column")
        else:
            print("✓ resumes_assignment_id column already exists")
        
        # Add original_end_date column if it doesn't exist
        if 'original_end_date' not in columns:
            print("Adding original_end_date column...")
            cursor.execute("""
                ALTER TABLE driver_assignment 
                ADD COLUMN original_end_date DATE
            """)
            changes_made = True
            print("✓ Added original_end_date column")
        else:
            print("✓ original_end_date column already exists")
        
        if changes_made:
            conn.commit()
            print("\n✅ Phase 1 migrations completed successfully!")
        else:
            print("\n✅ Phase 1: Database already up to date!")

        # ---------------------------------------------------------------
        # Phase 2: Make start_time / end_time nullable in DriverCustomTiming
        # SQLite doesn't support ALTER COLUMN, so we recreate the table.
        # ---------------------------------------------------------------
        changes_made = False

        cursor.execute("PRAGMA table_info(driver_custom_timing)")
        ct_columns = {row[1]: row for row in cursor.fetchall()}

        # Detect whether the columns are still NOT NULL (notnull == 1)
        start_notnull = ct_columns.get('start_time', (None, None, None, 0))[3]
        end_notnull   = ct_columns.get('end_time',   (None, None, None, 0))[3]

        if start_notnull or end_notnull:
            print("Making start_time / end_time nullable in driver_custom_timing...")
            cursor.executescript("""
                BEGIN;

                CREATE TABLE driver_custom_timing_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    driver_id INTEGER NOT NULL REFERENCES driver(id),
                    assignment_id INTEGER REFERENCES driver_assignment(id),
                    shift_type VARCHAR(50),
                    day_of_cycle INTEGER,
                    day_of_week INTEGER,
                    start_time TIME,
                    end_time TIME,
                    priority INTEGER,
                    notes TEXT,
                    created_at DATETIME
                );

                INSERT INTO driver_custom_timing_new
                    SELECT id, driver_id, assignment_id, shift_type,
                           day_of_cycle, day_of_week, start_time, end_time,
                           priority, notes, created_at
                    FROM driver_custom_timing;

                DROP TABLE driver_custom_timing;

                ALTER TABLE driver_custom_timing_new
                    RENAME TO driver_custom_timing;

                COMMIT;
            """)
            changes_made = True
            print("✓ start_time and end_time are now nullable in driver_custom_timing")
        else:
            print("✓ driver_custom_timing columns already nullable")

        if changes_made:
            conn.commit()
            print("\n✅ Phase 2 migrations completed successfully!")
            print("\nThe system now supports:")
            print("  • Leaving start_time or end_time blank in custom timings")
            print("  • Blank timing fields fall back to the default shift times")
        else:
            print("\n✅ Phase 2: Database already up to date!")
        
        conn.close()
        return True
        
    except sqlite3.Error as e:
        print(f"\n❌ Error during migration: {e}")
        return False
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Shift Sheets - Database Migration")
    print("=" * 60)
    print()
    
    success = migrate_database()
    
    if success:
        print("\nYou can now restart your shift-sheets application.")
    else:
        print("\nPlease fix the errors and try again.")
        print("If you need help, check the database path and permissions.")
