"""Measure real process RSS while running the fixed 18-run smoke check."""
import subprocess
import sys
import time
import psutil

child = subprocess.Popen([sys.executable, "run_research.py", "--smoke"])
process = psutil.Process(child.pid)
peak = 0
while child.poll() is None:
    try:
        peak = max(peak, process.memory_info().rss)
    except psutil.NoSuchProcess:
        break
    time.sleep(.1)
print(f"Peak measured Python RSS: {peak / 1024**2:.1f} MiB", flush=True)
raise SystemExit(child.wait())
