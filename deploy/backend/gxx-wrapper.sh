#!/bin/sh
# /usr/bin/g++ in the compile-service image (backend/Dockerfile).
#
# isolate starts every box with an empty environment, so `/usr/bin/env g++`
# searches the default path /bin:/usr/bin and runs g++ as /bin/g++. Inside a
# box /bin is a bind mount rather than the usual symlink to /usr/bin, and
# GCC derives its installation prefix from its own path: as /bin/g++ it
# looks for the C++ headers under /include/c++ ("iostream: No such file")
# and, with no PATH, collect2 cannot find ld. Running the real driver by
# its /usr path with a PATH fixes both. exec keeps the process count (the
# box's pid cap) unchanged.
PATH=/usr/bin:/bin
export PATH
exec /usr/bin/g++-12 "$@"
