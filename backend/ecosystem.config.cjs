module.exports = {
  apps: [{
    name: "hive-backend",
    script: "dist/index.js",
    node_args: "--enable-source-maps",
    // Safety net: PM2 restarts the process if RSS exceeds this, before V8's
    // heap limit triggers a fatal OOM. Keep it below the Node heap limit.
    max_memory_restart: "3G",
    env_production: {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: 9420,
      DATA_DIR: "~/.hive",
      HIVE_AUTOMATION_TIMEOUT_SEC: 1800,
    },
    env_development: {
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      DATA_DIR: "~/.hive-dev",
      HIVE_AUTOMATION_TIMEOUT_SEC: 1800,
    },
  }],
};
