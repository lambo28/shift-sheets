FROM python:3.11-slim

WORKDIR /app

# Install certificates and build tools so pip can fetch packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN python -m pip install --upgrade pip setuptools wheel

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
