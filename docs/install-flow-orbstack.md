# Testing the install flow end-to-end with OrbStack

This walks through running the real wizard against a local Ubuntu VM on your Mac.
Unlike the project's dev VPS, your Mac can run real VMs, so this exercises the
whole path: wizard → system `ssh` → `provision.sh` → a real Hive backend →
connect.

## 0. One-time: system deps for the Tauri build

The Tauri app builds natively on macOS (Xcode command-line tools). No extra
system libraries are needed on a Mac.

## 1. Create an Ubuntu VM and allow root SSH

The v1 flow connects as **root** (the Hetzner/DO/OVH default). OrbStack machines
log in as your user, so enable root key login for the test:

Note: use the 24.04 image — `probe_os` rejects non-LTS releases — and install
openssh-server first: OrbStack machines do not ship a running sshd (its own
`ssh orb` path goes through a host-side proxy, not port 22 in the VM).

```bash
orb create ubuntu:24.04 hive-test
orb -m hive-test sudo bash -c '
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server &&
  systemctl enable --now ssh'
orb -m hive-test sudo bash -c '
  mkdir -p /root/.ssh &&
  cp ~/'"$USER"'/.ssh/authorized_keys /root/.ssh/authorized_keys 2>/dev/null || true'
# Add YOUR public key to root if the copy above found nothing:
orb -m hive-test sudo tee -a /root/.ssh/authorized_keys < ~/.ssh/id_ed25519.pub
orb -m hive-test ip a | grep 'inet '     # note the VM's IP, e.g. 198.19.x.x
```

Confirm root SSH works from your Mac:

```bash
ssh -o StrictHostKeyChecking=accept-new root@<VM_IP> uname -a
```

## 2. Build a backend release tarball (dev shortcut)

There is no published GitHub release yet, so build one locally and point the
sidecar at it. The Rust command will `scp` it to the VM and pass
`--release-file`:

```bash
make release-tarball                          # → dist-release/hive-backend-0.0.0-dev-linux-<arch>.tar.gz
export HIVE_DEV_RELEASE_TARBALL="$PWD/dist-release/hive-backend-0.0.0-dev-linux-arm64.tar.gz"
```

## 3. Run the wizard

```bash
cd frontend
npm install
HIVE_DEV_RELEASE_TARBALL="$HIVE_DEV_RELEASE_TARBALL" npm run tauri dev
```

In the wizard:
1. **Tailscale** — for a purely local test, leave the auth key **empty**; the
   sidecar then runs `provision.sh --skip-tailscale --host 0.0.0.0`, so the
   backend is reachable on the VM's IP without a tailnet. (To test the real
   tailnet path, paste a tagged auth key instead.)
2. **SSH key** — pick the key whose public half you added to root.
3. **Server IP** — the VM IP from step 1.
4. **Trust** — accept the host fingerprint.
5. **Provisioning** — watch the checklist; provision.sh installs Node, the
   firewall, the release, and the systemd service, then reports healthy.
6. The wizard connects to `http://<VM_IP>:3000` (token-less v1: access is
   gated by network reachability plus the backend's host-header guard).

## What works vs. what to expect

- **Works:** SSH connect + host-key TOFU, streaming provision with live NDJSON
  progress, crash-resume (kill the app mid-provision, relaunch, Retry), the real
  Hive backend running under systemd, the wizard connecting over HTTP.
- **Guided setup (Claude/Codex/GitHub, dev stacks):** the dev-stack installers
  (mise/uv) run for real; `gh`/`docker` run via the root helpers on the VM.
  **Claude** sign-in runs locally on your Mac (`claude setup-token`) — you need
  the `claude` CLI installed on the Mac, or use the manual token paste.
- **Not local-friendly:** the tailnet handoff and iOS QR assume Tailscale; skip
  them for a pure-Orb test.

## Faster inner loop (no Tauri)

To iterate on `provision.sh` alone without the desktop app:

```bash
make provision-docker        # full install + idempotency in a systemd container
make provision-docker-chaos  # crash-resume across kill points
```
