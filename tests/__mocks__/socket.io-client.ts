// Mock for socket.io-client
import { EventEmitter } from "node:events";

export interface MockSocket extends EventEmitter {
	connected: boolean;
	disconnected: boolean;
	emit: jest.Mock;
	on: jest.Mock;
	off: jest.Mock;
	disconnect: jest.Mock;
	connect: jest.Mock;
}

export class MockSocketInstance extends EventEmitter implements MockSocket {
  connected = false;
  disconnected = true;
  emit = jest.fn();
  on = jest.fn();
  off = jest.fn();
  disconnect = jest.fn();
  connect = jest.fn();

  constructor() {
    super();
    // Override EventEmitter methods with jest mocks that call the original
    this.on = jest.fn().mockImplementation(super.on.bind(this));
    this.off = jest.fn().mockImplementation(super.off.bind(this));

    // For emit, we need special handling for socket.io emit pattern with callbacks
    this.emit = jest
      .fn()
      .mockImplementation((event: string, ...args: unknown[]) => {
        // If this is a client->server emit (not an event emission), don't call super.emit
        if (this.isClientServerEvent(event)) {
          return true; // socket.io emit returns true
        }
        // Otherwise it's an event emission, call super.emit
        return super.emit(event, ...args);
      });

    // Override disconnect to trigger mockDisconnect
    this.disconnect = jest.fn().mockImplementation(() => {
      this.mockDisconnect("client disconnect");
    });
  }

  private isClientServerEvent(event: string): boolean {
    // These are events sent from client to server, not event emissions
    const clientServerEvents = [
      "send_job",
      "schedule_job",
      "register_worker",
      "send_batch",
      "wait_for_batch",
      "get_job",
      "cancel_job",
      "get_queue_size",
      "job_started",
      "job_completed",
      "job_failed",
    ];
    return clientServerEvents.includes(event);
  }

  // Simulate connection
  async mockConnect() {
    // Wait for listeners to be set up by monitoring when they're added
    await new Promise<void>((resolve) => {
      const checkListeners = () => {
        // Check if the required listeners have been added
        if (
          mockSocket.listenerCount("connect") > 0 &&
          mockSocket.listenerCount("client_ready") > 0
        ) {
          resolve();
        } else {
          // Check again on next tick
          setImmediate(checkListeners);
        }
      };
      checkListeners();
    });

    this.connected = true;
    this.disconnected = false;
    // Use the original EventEmitter emit for event emission
    super.emit("connect");
    super.emit("client_ready", { id: "id", organizationId: "organizationId" });
  }

  // Simulate disconnection
  mockDisconnect(reason = "client disconnect") {
    this.connected = false;
    this.disconnected = true;
    super.emit("disconnect", reason);
  }

  // Simulate connection error
  async mockConnectError(error: Error) {
    // Wait for connect_error listener to be set up
    await new Promise<void>((resolve) => {
      const checkListeners = () => {
        if (mockSocket.listenerCount("connect_error") > 0) {
          resolve();
        } else {
          setImmediate(checkListeners);
        }
      };
      checkListeners();
    });

    super.emit("connect_error", error);
  }

  // Simulate server events
  mockServerEvent(event: string, ...args: unknown[]) {
    super.emit(event, ...args);
  }

  // Mock emit with callback support
  mockEmitWithCallback(
    event: string,
    data: unknown,
    callback?: (response: unknown) => void
  ) {
    this.emit(event, data, callback);
    return callback;
  }
}

export const mockSocket = new MockSocketInstance();

export const io = jest.fn().mockReturnValue(mockSocket);
export const connect = jest.fn().mockReturnValue(mockSocket);

// Mock the Manager and Socket classes as well
export class Manager {}
export class Socket {}

export default {
  io,
  connect,
  Manager,
  Socket,
  mockSocket,
  MockSocketInstance,
};
