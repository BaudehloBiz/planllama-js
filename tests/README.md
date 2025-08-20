# Test Suite Documentation

This document describes the comprehensive test suite for the Jobber library.

## Test Structure

### Core Tests (`client.test.ts`)

- **Constructor Tests**: Validates constructor overloading with string tokens and configuration objects
- **Connection Management**: Tests start/stop lifecycle, connection events, and error handling
- **Job Operations**: Tests sending immediate jobs, scheduling delayed jobs, and handling responses
- **Job Processing**: Tests work registration, job execution, and result handling
- **Batch Operations**: Tests sending multiple jobs efficiently
- **Event System**: Tests all EventEmitter functionality for job lifecycle events

### Integration Tests (`integration.test.ts`)

- **Complete Workflows**: End-to-end testing of job submission through completion
- **Retry Logic**: Tests job failure and retry mechanisms
- **Concurrent Processing**: Tests multiple simultaneous job handlers
- **Real-world Scenarios**: Complex job processing patterns and data flows

### Performance Tests (`performance.test.ts`)

- **High Volume**: Tests processing 1000+ jobs with throughput requirements (>200 jobs/sec)
- **Memory Efficiency**: Tests handling large payloads (1MB+) without memory leaks
- **Event Performance**: Tests high-frequency event emission (100+ events/sec)
- **Concurrent Connections**: Tests multiple simultaneous Jobber instances

### Edge Cases Tests (`edge-cases.test.ts`)

- **Connection Edge Cases**: Timeouts, immediate disconnections, malformed URLs
- **Job Data Edge Cases**: Null data, circular references, extremely large payloads
- **Error Handling**: Non-Error exceptions, hanging promises, malformed responses
- **Event System Edge Cases**: Listener errors, listener removal during emission
- **Graceful Shutdown**: Stop during active processing, multiple stop calls

## Mock System

### MockSocket (`__mocks__/socket.io-client.ts`)

Comprehensive mock implementation that simulates:

- Connection/disconnection events
- Server event emission
- Client-server communication with callbacks
- Connection state management
- Event listener management

## Test Configuration

### Jest Configuration (`jest.config.json`)

- TypeScript support with ts-jest
- Coverage reporting with lcov and html output
- 30-second timeout for async operations
- Setup file for global test configuration

### Test Setup (`setup.ts`)

- Socket.io mocking
- Console suppression during tests
- Global test utilities and cleanup

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests for CI (no watch, with coverage)
npm run test:ci
```

## Coverage Goals

The test suite aims for:

- **90%+ Line Coverage**: All critical code paths tested
- **85%+ Branch Coverage**: Most conditional logic tested
- **80%+ Function Coverage**: All public methods tested

## Test Categories

### Unit Tests

- Individual method testing
- Input validation
- Error condition testing
- State management verification

### Integration Tests

- Multi-component workflows
- Real-world usage patterns
- Cross-cutting concerns
- End-to-end scenarios

### Performance Tests

- Throughput benchmarks
- Memory usage validation
- Concurrent operation testing
- Scalability verification

### Edge Case Tests

- Boundary condition testing
- Error recovery validation
- Unusual input handling
- System resilience testing

## Best Practices Implemented

1. **Isolation**: Each test is independent with proper setup/teardown
2. **Mocking**: External dependencies (socket.io) are properly mocked
3. **Async Handling**: Proper async/await patterns and timeout management
4. **Error Testing**: Both happy path and error conditions tested
5. **Performance**: Actual performance benchmarks with measurable criteria
6. **Documentation**: Clear test descriptions and expectations

## Maintenance

### Adding New Tests

1. Identify the appropriate test file based on test type
2. Follow existing patterns for setup/teardown
3. Use descriptive test names explaining the scenario
4. Include both positive and negative test cases
5. Update this documentation if adding new test categories

### Debugging Failed Tests

1. Check mock implementations for correct behavior simulation
2. Verify async operation timing with appropriate delays
3. Ensure proper cleanup to prevent test interference
4. Use verbose Jest output for detailed error information

This comprehensive test suite ensures the Jobber library is reliable, performant, and handles edge cases gracefully.
