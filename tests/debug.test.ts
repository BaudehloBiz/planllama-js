import { Jobber } from '../src/client';
import { mockSocket } from './__mocks__/socket.io-client';

describe('Debug Tests', () => {
  let jobber: Jobber;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket.removeAllListeners();
    mockSocket.connected = false;
    mockSocket.disconnected = true;
    jobber = new Jobber('test-token');
  });

  afterEach(async () => {
    // Simple cleanup without async operations
    if (jobber) {
      jobber = undefined as unknown as Jobber;
    }
  });

  it('should create instance', () => {
    expect(jobber).toBeInstanceOf(Jobber);
  });

  it('should start with immediate mock connection', async () => {
    const startPromise = jobber.start();
    
    // Immediately trigger connection
    mockSocket.mockConnect();
    
    await startPromise;
    
    expect(mockSocket.connected).toBe(true);
  });
});
