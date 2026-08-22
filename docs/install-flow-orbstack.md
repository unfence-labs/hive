# Testing the install flow end-to-end with OrbStack

This walks through running the real installer wizard against a local Ubuntu VM
on your Mac: wizard → system `ssh` → `provision.sh` → a real Hive backend →
connect.

A **debug build** deliberately tests the current checkout instead of downloading an older
published release. It looks for a locally built tarball, uploads it to the server over the same SSH
connection, and installs from that copy (`--release-file`). Release builds never sideload a local
tarball.

OrbStack is a local development exception. Its private VM address is suitable
for this test, but it is not production transport guidance. A real server still
requires the encrypted private network described in
**[networking.md](networking.md)**.

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
password on the server screen if one is needed.)

## 2. Build a dev release tarball

The tarball must be built **on Linux, on the target architecture** (native
modules are compiled during the build and cannot be cross-compiled), against
Node 24 with a C++ toolchain. On a Mac the shortest path is a `node:24`
container — the same way the e2e harness builds it, and OrbStack ships Docker:

```bash
cd /path/to/hive                       # your clone, on the Mac
docker run --rm -v "$PWD":/repo -w /repo node:24 \
  bash scripts/release/build-backend-tarball.sh 0.0.0-dev arm64
# → dist-release/hive-backend-0.0.0-dev-linux-arm64.tar.gz (+ .sha256)
```

(Building inside an OrbStack Linux machine also works — your Mac filesystem is
mounted there at the same paths — but a bare VM first needs Node 24 and
`build-essential`, which the test VM deliberately does not have.)

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
npm ci
npm run tauri dev
```

The screens, in order: **welcome → server → review → install → accounts**.

1. **Server** — type the VM's IP (the key whose public half you authorized on
   root is auto-selected), then **Connect**: approve the host fingerprint, and
   the preflight report renders what the server looks like.
2. **Review** — the settled plan, restated; **Start the install**.
3. **Install** — the checklist streams `provision.sh`'s progress. The upload of
   the local tarball shows up as a log line before the release step. The run
   writes a non-secret identity manifest for its schema, port, install
   directory, and data directory, then ends with a fresh access token; the
   backend listens on port **9420**. If interrupted, Retry resumes only with
   those exact values. A completed install rejects another provisioning run
   unless `--update` is used; changing identity values requires uninstalling
   and starting fresh. The generated uninstaller keeps the data directory
   unless you pass `--purge`.
4. **Accounts** — copy the access token, connect GitHub, and authenticate at
   least one of Claude Code or Codex. Relaunching returns here until all three
   requirements are complete. Finishing lands the app in a working Hive at
   `http://<VM_IP>:9420`; these account controls remain available in Settings.

A prerelease (`0.0.0-dev`) install writes `HIVE_ALLOWED_ORIGINS` with the Vite
dev origins into `/etc/hive/hive.env`, so the dev app — whose webview origin is
`http://localhost:5173`, not `tauri://localhost` — passes the production
CORS and WebSocket origin allowlists. Stable installs never carry this.

Without a tarball (nothing in `dist-release/`, no `HIVE_DEV_RELEASE_TARBALL`),
the install fails at the release step with `RELEASE_DOWNLOAD_FAILED` and a
message repeating the build command above — build the tarball and press Retry.

## Faster inner loop (no Tauri)

To iterate on the provisioning script alone:

```bash
bash test/provision/contract.sh    # second-fast contracts, no root or network
bash test/provision/e2e-docker.sh  # full install in a systemd container
```
