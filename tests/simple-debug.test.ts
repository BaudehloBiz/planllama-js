import { Jobber } from "../src/client";

describe("Simple Debug", () => {
	it("should create instance", () => {
		const jobber = new Jobber({
			customerToken: "test-token",
			serverUrl: "http://localhost:3000",
		});
		expect(jobber).toBeInstanceOf(Jobber);
	});
});
