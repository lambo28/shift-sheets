# Driver Shift Sheets 🚛

A comprehensive web application for managing driver shift sheets with printable functionality, built with Flask and SQLite.

## Features

- **Driver Management**: Add, edit, and manage driver information
- **Shift Sheet Creation**: Create weekly shift sheets with daily entries
- **Data Entry**: Track start/end times, breaks, mileage, routes, and notes
- **Automatic Calculations**: Hours worked and miles driven calculated automatically
- **Print-Friendly**: Professional printable shift sheets for physical documentation
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Docker Support**: Easy deployment with Docker containers

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone <your-repo-url>
cd shift_app

# Build and run with Docker Compose
docker-compose up -d

# Access the application
open http://localhost:5000
```

### Option 2: Local Development

```bash
# Clone the repository
git clone <your-repo-url>
cd shift_app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env with your settings

# Run the application
python app.py

# Access the application
open http://localhost:5000
```

## Screenshots

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Shift Sheet Entry
![Shift Entry](docs/screenshots/shift-entry.png)

### Print View
![Print View](docs/screenshots/print-view.png)

## Usage

### 1. Add Drivers
1. Navigate to "Drivers" in the main menu
2. Click "Add New Driver"
3. Fill in driver information (number, name, phone, email)
4. Save the driver

### 2. Create Shift Sheet
1. Click "New Shift" from the dashboard or menu
2. Select a driver and week starting date
3. The system creates a 7-day shift sheet (Monday-Sunday)

### 3. Fill Out Daily Entries
1. Click "Edit" on any shift sheet
2. Enter daily information:
   - Start/End times (24-hour format)
   - Break time in minutes
   - Starting/Ending mileage
   - Route or location information
   - Notes for the day
3. Save changes (totals calculate automatically)

### 4. Print Shift Sheets
1. View any completed shift sheet
2. Click the "Print" button
3. The sheet opens in a print-optimized format
4. Print or save as PDF

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Flask Configuration
FLASK_CONFIG=production  # development, production, or testing
FLASK_HOST=0.0.0.0
FLASK_PORT=5000
FLASK_DEBUG=false

# Security
SECRET_KEY=your-super-secret-key-here

# Database (optional, defaults to SQLite)
DATABASE_URL=sqlite:///data/shifts.db

# Company Information
COMPANY_NAME=Your Company Name
```

### Database

The application uses SQLite by default, storing the database in the `data/` directory. For production, you can configure PostgreSQL or other databases via the `DATABASE_URL` environment variable.

## Docker Deployment

### Docker Compose (Production)

```yaml
version: '3.8'
services:
  shift_app:
    build: .
    container_name: shift_app
    ports:
      - "5000:5000"
    volumes:
      - ./data:/app/data
    environment:
      - FLASK_CONFIG=production
      - SECRET_KEY=your-production-secret-key
      - COMPANY_NAME=Your Company Name
    restart: unless-stopped
```

### Standalone Docker

```bash
# Build image
docker build -t shift-app .

# Run container
docker run -d \
  --name shift-app \
  -p 5000:5000 \
  -v $(pwd)/data:/app/data \
  -e FLASK_CONFIG=production \
  -e SECRET_KEY=your-secret-key \
  -e COMPANY_NAME="Your Company" \
  shift-app
```

## Development

### Project Structure

```
shift_app/
├── app.py                 # Main Flask application
├── config.py             # Configuration settings
├── requirements.txt      # Python dependencies
├── Dockerfile           # Docker container definition
├── docker-compose.yml   # Docker Compose configuration
├── .env.example         # Environment variables template
├── data/               # Database storage (SQLite)
│   └── .gitkeep
├── static/             # Static assets (CSS, JS, images)
│   └── css/
│       └── style.css
└── templates/          # HTML templates
    ├── base.html       # Base template
    ├── index.html      # Dashboard
    ├── drivers.html    # Driver management
    ├── add_driver.html # Add driver form
    ├── new_shift.html  # New shift form
    ├── view_shift.html # View shift sheet
    ├── edit_shift.html # Edit shift sheet
    └── print_shift.html # Print-friendly sheet
```

### Database Schema

```python
# Driver information
Driver:
  - id (Primary Key)
  - driver_number (Unique)
  - name
  - phone
  - email
  - created_at

# Weekly shift sheet
ShiftSheet:
  - id (Primary Key)
  - driver_id (Foreign Key)
  - week_starting (Date)
  - week_ending (Date)
  - total_hours (Calculated)
  - total_miles (Calculated)
  - notes
  - created_at

# Daily entries within a shift sheet
DailyEntry:
  - id (Primary Key)
  - shift_sheet_id (Foreign Key)
  - date
  - start_time
  - end_time
  - break_time (minutes)
  - hours_worked (Calculated)
  - mileage_start
  - mileage_end
  - miles_driven (Calculated)
  - route
  - notes
```

### Adding Features

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature-name`
3. **Make changes** and test thoroughly
4. **Commit changes**: `git commit -m "Add feature description"`
5. **Push to branch**: `git push origin feature-name`
6. **Create Pull Request**

## API Documentation

The application includes basic API endpoints:

### Drivers
- `GET /drivers` - List all drivers
- `POST /driver/add` - Add new driver
- `DELETE /driver/{id}/delete` - Delete driver

### Shifts
- `GET /` - Dashboard with recent shifts
- `GET /shift/new` - New shift form
- `POST /shift/create` - Create shift sheet
- `GET /shift/{id}` - View shift sheet
- `GET /shift/{id}/edit` - Edit shift form
- `POST /shift/{id}/update` - Update shift sheet
- `GET /shift/{id}/print` - Print view
- `DELETE /shift/{id}/delete` - Delete shift sheet

## Troubleshooting

### Common Issues

1. **Database not creating**: Ensure the `data/` directory exists and has write permissions
2. **Static files not loading**: Check that Flask can access the `static/` directory
3. **Docker build fails**: Verify Docker is installed and you have internet connectivity
4. **Print formatting issues**: Use the dedicated print view (`/shift/{id}/print`)

### Logs

Check application logs:
```bash
# Docker
docker logs shift-app

# Local development
# Logs will appear in terminal
```

## Security Considerations

- **Change the SECRET_KEY** in production
- **Use HTTPS** in production environments
- **Backup your database** regularly
- **Restrict access** to the data directory
- **Update dependencies** regularly

## License

[MIT License](LICENSE) - Feel free to use this project for personal or commercial purposes.

## Support

For issues, questions, or contributions:

1. **GitHub Issues**: Create an issue for bugs or feature requests
2. **Documentation**: Check this README and inline code comments
3. **Email**: [your-email@example.com]

## Changelog

### Version 1.0.0 (Current)
- Initial release
- Driver management system
- Weekly shift sheet creation and editing
- Print-friendly output
- Docker support
- Responsive web interface

---

**Made with ❤️ for drivers and fleet managers**