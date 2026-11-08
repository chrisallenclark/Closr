"""The preparation worker as its own process (production): `python -m closr_server.worker`.

Several can run at once: jobs are leased in the database, so each runs once, and a crashed
worker's job is picked up again when its lease expires.
"""

from __future__ import annotations

import signal
import time

from .config import Config
from .service import Service


def main() -> None:
    svc = Service(Config())
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True  # finish the current job, then exit

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print("worker ready", flush=True)
    while not stopping:
        try:
            if not svc.work_once():
                time.sleep(1.0)
        except Exception as err:  # keep running; the job's lease expires and it is retried
            print("worker error:", repr(err), flush=True)
            time.sleep(2.0)


if __name__ == "__main__":
    main()
