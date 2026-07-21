# Hive install-flow developer entry points. See docs/install-flow-implementation-plan.md 7.6.
.PHONY: provision-build provision-docker provision-docker-chaos provision-docker-reprovision provision-contract

provision-build:
	bash scripts/provision/build.sh $(or $(VERSION),0.0.0-dev)

# Tier-1: full install + idempotency inside a systemd container (fast, offline).
provision-docker:
	bash test/e2e/provision-docker.sh install

# Chaos harness: kill after representative steps, resume, assert convergence.
provision-docker-chaos:
	bash test/e2e/provision-docker.sh chaos

# Re-provision harness: install, then re-run at a bumped version; assert the
# update path resumes (no EXISTING_INSTALL) and stays healthy.
provision-docker-reprovision:
	bash test/e2e/provision-docker.sh reprovision

# Assert the bash error taxonomy matches shared/setup-errors.ts.
provision-contract:
	bash test/provision/contract.sh

# Build a backend release tarball (feeds provision.sh --release-file and the
# OrbStack dev flow via HIVE_DEV_RELEASE_TARBALL).
release-tarball:
	bash scripts/release/build-backend-tarball.sh $(or $(VERSION),0.0.0-dev)
