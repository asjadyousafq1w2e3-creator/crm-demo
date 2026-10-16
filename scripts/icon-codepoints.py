"""Prints the codepoints referenced by components/icon.tsx, as a pyftsubset --unicodes list.

Keeping this out of the shell script avoids three layers of quoting around a regex whose whole
job is to match a backslash.
"""
import pathlib
import re
import sys

src = pathlib.Path("components/icon.tsx").read_text()
codes = re.findall(r"\\u([0-9a-fA-F]{4,5})", src)
if not codes:
    sys.exit("no codepoints found in components/icon.tsx")
print(",".join("U+" + c for c in sorted(set(codes))))
