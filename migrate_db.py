#!/usr/bin/env python3
"""
Database migration script to add pause/resume tracking columns to DriverAssignment table.
Run this script to update your existing database with the new columns.
"""

import sqlite3
import os

# Path to your database file
DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'shift-sheets.db')

def migrate_database():
    """Add new columns to DriverAssignment table"""
    
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
            print("\n✅ Database migration completed successfully!")
            print("\nThe system now supports:")
            print("  • Temporary assignments that pause ongoing patterns")
            print("  • Automatic resumption of paused patterns after temporary ones end")
            print("  • Seamless editing of assignment dates with smart pause/resume handling")
        else:
            print("\n✅ Database is already up to date!")
        
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
    print("Adding Pause/Resume Assignment Tracking")
    print("=" * 60)
    print()
    
    success = migrate_database()
    
    if success:
        print("\nYou can now restart your shift-sheets application.")
        print("The new pause/resume logic will automatically handle:")
        print("  1. Pattern A ongoing + Pattern B temporary → A pauses, resumes after B")
        print("  2. Pattern A ongoing + Pattern B ongoing → A ends at switchover")
        print("  3. Edit dates → Pause/resume relationships update automatically")
    else:
        print("\nPlease fix the errors and try again.")
        print("If you need help, check the database path and permissions.")
