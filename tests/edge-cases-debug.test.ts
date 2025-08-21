import { Jobber } from "../src/client";

describe("Edge Cases Debug", () => {
	let jobber: Jobber;

	it("should create instance", () => {
		jobber = new Jobber({
			customerToken: "test-token",
			serverUrl: "http://localhost:3000",
		});
		expect(jobber).toBeInstanceOf(Jobber);
	});

	it("should handle connection timeout", async () => {
		jobber = new Jobber({
			customerToken: "test-token",
			serverUrl: "http://localhost:3000",
		});

		const connectPromise = jobber.start();

		// Don't trigger connect event (simulates timeout)
		await expect(connectPromise).rejects.toThrow();
	});
});
