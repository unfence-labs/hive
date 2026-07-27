# Testing the install flow end-to-end with OrbStack

This walks through running the real installer wizard against a local Ubuntu VM
on your Mac: wizard → system `ssh` → `provision.sh` → a real Hive backend →
connect.

The repository is private, so there is no GitHub release to download. A **debug
build** of the desktop app closes that gap itself: it looks for a locally built
tarball, uploads it to the server over the same SSH connection, and installs
from the uploaded copy (`--release-file`). Release builds never do this.

## 1. Create an Ubuntu VM and allow root SSH

Use the 24.04 image — `probe_os` accepts only Ubuntu 22.04/24.04 and Debian
12/13 — and install openssh-server first: OrbStack machines do not ship a
running sshd (their own `ssh orb` path goes through a host-side proxy, not
port 22 in the VM).

```bash
orb create ubuntu:24.04 hive-test
orb -m hive-test sudo bash -c '
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server &&
  systemctl enable --now ssh'
orb -m hive-test sudo bash -c 'mkdir -p /root/.ssh && chmod 700 /root/.ssh'
orb -m hive-test sudo tee -a /root/.ssh/authorized_keys < ~/.ssh/id_ed25519.pub
orb -m hive-test ip a | grep 'inet '     # note the VM's IP, e.g. 198.19.x.x
```

Confirm root SSH works from your Mac:

```bash
ssh -o StrictHostKeyChecking=accept-new root@<VM_IP> uname -a
```

(You can also connect as a non-root sudo user; the wizard asks for the sudo
password on the connect screen if one is needed.)

## 2. Build a dev release tarball

The tarball must be built **on Linux, on the target architecture** (native
modules are compiled during the build and cannot be cross-compiled), against
Node 22. On a Mac, build it inside a Linux machine — the test VM itself works,
since OrbStack shares your Mac filesystem:

```bash
orb -m hive-test bash -c 'cd /path/to/hive && bash scripts/release/build-backend-tarball.sh 0.0.0-dev arm64'
# → dist-release/hive-backend-0.0.0-dev-linux-<arch>.tar.gz (+ .sha256)
```

That is all: the debug sidecar probes the server's `uname -m` and picks up the
matching `dist-release/hive-backend-0.0.0-dev-linux-<arch>.tar.gz`
automatically. `HIVE_DEV_RELEASE_TARBALL` is only needed to point at a tarball
somewhere else:

```bash
export HIVE_DEV_RELEASE_TARBALL="$PWD/dist-release/hive-backend-0.0.0-dev-linux-arm64.tar.gz"
```

## 3. Run the wizard

```bash
cd frontend
npm install
npm run tauri dev
```

The screens, in order: **welcome → network → SSH key → connect → install →
accounts → ready**.

1. **Network** — type the VM's IP. Hive takes no position on how the server is
   reached; a local VM IP is as good as any.
2. **SSH key** — pick the key whose public half you authorized on root.
3. **Connect** — approve the host fingerprint; the preflight report renders
   what the server looks like.
4. **Install** — the checklist streams `provision.sh`'s progress. The upload of
   the local tarball shows up as a log line before the release step. The run
   ends with a fresh access token; the backend listens on port **9420**.
5. **Accounts** — connect GitHub, Claude and Codex on the server.
6. **Ready** — the app lands in a working Hive at `http://<VM_IP>:9420`.

Without a tarball (nothing in `dist-release/`, no `HIVE_DEV_RELEASE_TARBALL`),
the install fails at the release step with `RELEASE_DOWNLOAD_FAILED` and a
message repeating the build command above — build the tarball and press Retry.

## Faster inner loop (no Tauri)

To iterate on the provisioning script alone:

```bash
bash test/provision/contract.sh    # second-fast contracts, no root or network
bash test/provision/e2e-docker.sh  # full install in a systemd container
```
