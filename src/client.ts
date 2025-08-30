import { EventEmitter } from "node:events";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";

export interface CustomerOptions {
	customerToken: string;
	serverUrl?: string;
}

export interface JobOptions {
	id?: string;
	priority?: number;
	startAfter?: Date | string;
	expireIn?: string;
	retryLimit?: number;
	retryDelay?: number;
	retryBackoff?: boolean;
	singletonKey?: string;
}

export interface WorkOptions {
	teamSize?: number;
	teamConcurrency?: number;
}

export interface Job<T = unknown> {
	id: string;
	name: string;
	data: T;
	state:
		| "created"
		| "retry"
		| "active"
		| "completed"
		| "expired"
		| "cancelled"
		| "failed";
	retryCount: number;
	priority: number;
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	failedAt?: Date;
}

export interface BatchJob<T = unknown> {
	name: string;
	data: T;
	options?: JobOptions;
}

interface SocketResponse<T = unknown> {
	status: 'ok' | 'error';
	error?: string;
	jobId?: string;
	scheduleId?: string;
	batchId?: string;
	job?: Job<T>;
	queueSize?: number;
	result?: T;
}

type JobHandler<T = unknown, R = unknown> = (job: Job<T>) => Promise<R>;

interface HandlerInfo {
	handler: JobHandler<unknown, unknown>;
	options?: WorkOptions;
}

export class Jobber extends EventEmitter {
	private customerToken: string;
	private serverUrl: string;
	private socket: Socket | null = null;
	private isStarted = false;
	private jobHandlers = new Map<string, HandlerInfo>();
	// private reconnectAttempts = 0;
	// private maxReconnectAttempts = 10;

	constructor(customerToken: string);
	constructor(customerOptions: CustomerOptions);
	constructor(customerTokenOrOptions: string | CustomerOptions) {
		super();

		if (typeof customerTokenOrOptions === "string") {
			if (!customerTokenOrOptions) {
				throw new Error("Customer token is required");
			}
			this.customerToken = customerTokenOrOptions;
			this.serverUrl = process.env.JOBBER_SERVER_URL || "http://localhost:3000";
		} else {
			if (!customerTokenOrOptions || !customerTokenOrOptions.customerToken) {
				throw new Error("Customer options with token are required");
			}
			this.customerToken = customerTokenOrOptions.customerToken;
			this.serverUrl =
				customerTokenOrOptions.serverUrl ||
				process.env.JOBBER_SERVER_URL ||
				"http://localhost:3000";
		}
	}

	async start(): Promise<void> {
		if (this.isStarted) {
			return;
		}

		return new Promise((resolve, reject) => {
			// Set a connection timeout
			const connectionTimeout = setTimeout(() => {
				reject(new Error("Connection timeout"));
			}, 10000); // 10 second timeout

			this.socket = io(this.serverUrl, {
				path: "/ws",
				auth: {
					customerToken: this.customerToken,
				},
				transports: ["websocket"],
			});

			this.socket.on("connect", () => {
				clearTimeout(connectionTimeout);
				console.log("Connected to Jobber server");
				this.isStarted = true;
				// this.reconnectAttempts = 0;
				this.setupEventHandlers();
			});

			this.socket.on("client_ready", () => {
				resolve();
			});

			this.socket.on("connect_error", (error) => {
				clearTimeout(connectionTimeout);
				console.error("Failed to connect to Jobber server:", error.message);
				reject(new Error(`Failed to connect: ${error.message}`));
			});

			this.socket.on("disconnect", (reason) => {
				console.log("Disconnected from Jobber server:", reason);
				this.isStarted = false;

				// if (reason === "io server disconnect") {
				// 	// Server disconnected us, try to reconnect
				// 	this.handleReconnection();
				// }
			});

			this.socket.on("error", (error) => {
				console.error("Socket error:", error);
				super.emit("error", error);
			});
		});
	}

	private setupEventHandlers(): void {
		if (!this.socket) return;

		// Handle incoming work requests
		this.socket.on("work_request", async (job: Job) => {
			const handlerInfo = this.jobHandlers.get(job.name);

			if (!handlerInfo) {
				console.warn(`No handler registered for job: ${job.name}`);
				this.socket?.emit("job_failed", {
					jobId: job.id,
					error: `No handler registered for job: ${job.name}`,
				});
				return;
			}

			try {
				// Emit job started event
				this.socket?.emit("job_started", { jobName: job.name, jobId: job.id });
				super.emit("active", job);

				// Execute the job handler
				const result = await handlerInfo.handler(job);

				// Emit job completed event
				this.socket?.emit("job_completed", {
					jobId: job.id,
					result: result,
				});

				super.emit("completed", job, result);
			} catch (error) {
				// Emit job failed event
				this.socket?.emit("job_failed", {
					jobId: job.id,
					error: error instanceof Error ? error.message : String(error),
				});

				super.emit("failed", job, error);
			}
		});

		// Handle job events from server
		this.socket.on("job_retrying", (job: Job) => {
			super.emit("retrying", job);
		});

		this.socket.on("job_expired", (job: Job) => {
			super.emit("expired", job);
		});

		this.socket.on("job_cancelled", (job: Job) => {
			super.emit("cancelled", job);
		});
	}

	// private handleReconnection(): void {
	// 	if (this.reconnectAttempts >= this.maxReconnectAttempts) {
	// 		console.error("Max reconnection attempts reached");
	// 		super.emit("error", new Error("Unable to reconnect to server"));
	// 		return;
	// 	}

	// 	this.reconnectAttempts++;
	// 	const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);

	// 	console.log(
	// 		`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`,
	// 	);

	// 	setTimeout(() => {
	// 		this.start().catch((error) => {
	// 			console.error("Reconnection failed:", error);
	// 			this.handleReconnection();
	// 		});
	// 	}, delay);
	// }

	async stop(): Promise<void> {
		if (!this.isStarted || !this.socket) {
			return;
		}

		return new Promise((resolve) => {
			this.socket?.disconnect();
			this.isStarted = false;
			this.socket = null;
			console.log("Jobber stopped");
			resolve();
		});
	}

	async send<T = unknown>(
		name: string,
		data: T,
		options?: JobOptions,
	): Promise<string> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit(
				"send_job",
				{ name, data, options },
				(response: SocketResponse) => {
					if (response.status === "error") {
						reject(new Error(response.error));
					} else if (response.status === "ok" && response.jobId) {
						resolve(response.jobId);
					} else {
						reject(new Error("Invalid response from server"));
					}
				},
			);
		});
	}

	async schedule<T = unknown>(
		name: string,
		cronPattern: string,
		data: T,
		options?: JobOptions,
	): Promise<void> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit(
				"schedule_job",
				{ name, cronPattern, data, options },
				(response: SocketResponse) => {
					if (response.status === "error") {
						reject(new Error(response.error));
					} else if (response.status === "ok") {
						resolve();
					} else {
						reject(new Error("Invalid response from server"));
					}
				},
			);
		});
	}

	work<T = unknown, R = unknown>(name: string, handler: JobHandler<T, R>): void;
	work<T = unknown, R = unknown>(
		name: string,
		options: WorkOptions,
		handler: JobHandler<T, R>,
	): void;
	work<T = unknown, R = unknown>(
		name: string,
		optionsOrHandler: WorkOptions | JobHandler<T, R>,
		handler?: JobHandler<T, R>,
	): void {
		let finalHandler: JobHandler<unknown, unknown>;
		let finalOptions: WorkOptions | undefined;

		if (typeof optionsOrHandler === "function") {
			finalHandler = optionsOrHandler as JobHandler<unknown, unknown>;
			finalOptions = undefined;
		} else if (handler) {
			finalHandler = handler as JobHandler<unknown, unknown>;
			finalOptions = optionsOrHandler;
		} else {
			throw new Error("Handler function is required");
		}

		this.jobHandlers.set(name, {
			handler: finalHandler,
			...(finalOptions && { options: finalOptions }),
		});

		// Register worker with server
		if (this.isStarted && this.socket) {
			this.socket.emit("register_worker", {
				jobName: name,
				options: finalOptions,
			});
		}
	}

	async sendBatch(jobs: BatchJob[]): Promise<string> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit("send_batch", { jobs }, (response: SocketResponse) => {
				if (response.status === "error") {
					reject(new Error(response.error));
				} else if (response.status === "ok" && response.batchId) {
					resolve(response.batchId);
				} else {
					reject(new Error("Invalid response from server"));
				}
			});
		});
	}

	async waitForBatch(batchId: string): Promise<void> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit(
				"wait_for_batch",
				{ batchId },
				(response: SocketResponse) => {
					if (response.status === "error") {
						reject(new Error(response.error));
					} else {
						resolve();
					}
				},
			);
		});
	}

	async getJobById<T = unknown>(jobId: string): Promise<Job<T> | undefined> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit("get_job", { jobId }, (response: SocketResponse<T>) => {
				if (response.status === "error") {
					reject(new Error(response.error));
				} else if (response.status === "ok") {
					resolve(response.job);
				} else {
					reject(
						new Error(
							`Invalid response from server: ${JSON.stringify(response)}`,
						),
					);
				}
			});
		});
	}

	async cancel(jobId: string): Promise<void> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit("cancel_job", { jobId }, (response: SocketResponse) => {
				if (response.status === "error") {
					reject(new Error(response.error));
				} else {
					resolve();
				}
			});
		});
	}

	async getQueueSize(jobName: string): Promise<number> {
		if (!this.isStarted || !this.socket) {
			throw new Error("Jobber not started. Call start() first.");
		}

		return new Promise((resolve, reject) => {
			this.socket?.emit("get_queue_size", { jobName }, (response: SocketResponse) => {
				if (response.status === "error") {
					reject(new Error(response.error));
				} else if (response.status === "ok") {
					resolve(response.queueSize || 0);
				} else {
					reject(new Error("Invalid response from server"));
				}
			});
		});
	}
}
