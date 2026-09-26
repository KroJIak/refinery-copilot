import sys

from refinery_core.cli import main

if __name__ == "__main__":
    raise SystemExit(main(["run", *sys.argv[1:]]))
