module.exports = {
  apps: [{
    name: "hive-backend",
    script: "dist/index.js",
    node_args: "--enable-source-maps",
    env_production: {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: 9420,
      DATA_DIR: "~/.hive",
    },
    env_development: {
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      DATA_DIR: "~/.hive-dev",
    },
  }],
};
