# Tier-1 provision test target: Ubuntu 24.04 with systemd as PID 1.
# Node + curl + jq are baked in so the harness can use --test-skip-node;
# provision.sh exercises the full systemd spine (user, release, units,
# service, health). apt_baseline still hits the network. Run with:
#   docker run --rm --privileged --cgroupns=host \
#     -v /sys/fs/cgroup:/sys/fs/cgroup hive-provision-test
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
      systemd systemd-sysv ca-certificates curl jq iproute2 \
      procps sudo xz-utils \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 # Remove units that fight running systemd inside a container.
 && rm -f /lib/systemd/system/multi-user.target.wants/* \
          /etc/systemd/system/*.wants/* \
          /lib/systemd/system/systemd-update-utmp*

STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
