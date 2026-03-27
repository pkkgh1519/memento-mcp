export default {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      testMatch: [
        "<rootDir>/tests/*.test.js"
      ],
      testPathIgnorePatterns: [
        "/node_modules/",
        "/.worktrees/",
        "/tests/integration/",
        "/tests/e2e/",
        "/tests/unit/"
      ]
    },
    {
      displayName: "integration",
      testEnvironment: "node",
      testMatch: [
        "<rootDir>/tests/integration/**/*.jest.test.js"
      ],
      testPathIgnorePatterns: [
        "/node_modules/",
        "/.worktrees/"
      ]
    }
  ]
};
