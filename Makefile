# Hive install-flow developer entry points.
.PHONY: provision-build provision-docker provision-docker-chaos provision-docker-rollback provision-docker-download provision-contract release-tarball

provision-build:
	bash scripts/provision/build.sh $(or $(VERSION),0.0.0-dev)

# Tier-1: full install + idempotency inside a systemd container. Needs network
# (apt + nodesource run inside the container).
provision-docker:
	bash test/e2e/provision-docker.sh install

# Chaos harness: kill after representative steps, resume, assert convergence.
provision-docker-chaos:
	bash test/e2e/provision-docker.sh chaos

# Release rollback harness: activate an unhealthy build and verify that the
# previous service is restored.
provision-docker-rollback:
	bash test/e2e/provision-docker.sh rollback

# Download harness: exercise the GitHub-download branch of install_release
# (404, bad checksum, tampered tarball, then a good install) via a local origin.
provision-docker-download:
	bash test/e2e/provision-docker.sh download

# Assert every bash-emitted error exists in the shared taxonomy.
provision-contract:
	bash test/provision/contract.sh

# Build a backend release tarball for the explicit OrbStack/debug upload path.
release-tarball:
	bash scripts/release/build-backend-tarball.sh $(or $(VERSION),0.0.0-dev)
