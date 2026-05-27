FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ngspice libngspice0 \
    && if [ -f /usr/lib/x86_64-linux-gnu/libngspice.so.0 ] && [ ! -f /usr/lib/x86_64-linux-gnu/libngspice.so ]; then \
        ln -s /usr/lib/x86_64-linux-gnu/libngspice.so.0 /usr/lib/x86_64-linux-gnu/libngspice.so; \
    fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
