# Hive install-flow developer entry points. See docs/install-flow-implementation-plan.md 7.6.
.PHONY: provision-build provision-docker provision-docker-chaos provision-contract

provision-build:
	bash scripts/provision/build.sh $(or $(VERSION),0.0.0-dev)

# Tier-1: full install + idempotency inside a systemd container (fast, offline).
provision-docker:
	bash test/e2e/provision-docker.sh install

# Chaos harness: kill after representative steps, resume, assert convergence.
provision-docker-chaos:
	bash test/e2e/provision-docker.sh chaos

# Assert the bash error taxonomy matches shared/setup-errors.ts.
provision-contract:
	bash test/provision/contract.sh
