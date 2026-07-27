# End-to-end provisioning target: a bare Ubuntu 24.04 server with systemd as
# PID 1 and nothing else Hive needs — no curl, no git, no jq, no GitHub CLI.
#
# It does carry Ubuntu's own Node.js (18.x). That is deliberate: the lane
# asserts provisioning leaves it exactly as it found it, and installs Hive's
# pinned runtime inside /opt/hive instead.
#
#   docker run --rm -d --privileged --cgroupns=host \
#     -v /sys/fs/cgroup:/sys/fs/cgroup hive-provision-e2e
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 # Remove units that fight running systemd inside a container.
 && rm -f /lib/systemd/system/multi-user.target.wants/* \
          /etc/systemd/system/*.wants/* \
          /lib/systemd/system/systemd-update-utmp*

STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
