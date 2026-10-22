module.exports = {
    apps: [
        {
            name: "trello-backend",
            cwd: "./apps/backend",
            script: "bun",
            args: "run ./dist/index.js",
            instances: 1,
            exec_mode: "fork",
            env: {
                NODE_ENV: "production"
            }
        },
        {
            name: "trello-websockets",
            cwd: "./apps/websockets",
            script: "bun",
            args: "run ./dist/index.js",
            instances: 1,
            exec_mode: "fork",
            env: {
                NODE_ENV: "production"
            }
        },
        {
            name: "trello-frontend",
            cwd: "./apps/frontend",
            script: "bun",
            args: "run start --host 0.0.0.0",
            instances: 1,
            exec_mode: "fork"
        }
    ]
};
