/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  testPathIgnorePatterns: process.env.RUN_INTEGRATION_TESTS
    ? []
    : ['integration\\.spec\\.ts$'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
};
