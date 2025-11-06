/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type { Socket } from "socket.io-client";
import { io } from "socket.io-client";
import { debuglog, DebugLogger } from "node:util";

let log = debuglog("planllama", (debug) => {
  log = debug as DebugLogger;
});

export interface PlanLlamaOptions {
  apiToken: string;
  serverUrl?: string;
}

export type SingleStep = (result?: StepResult) => Promise<any>;
export type StepResult = Record<string, any>;
export type DependantStep = [...string[], (result: StepResult) => Promise<any>];
export type StepInstance = SingleStep | DependantStep;
export type Steps = Record<string, StepInstance>;

export interface JobOptions {
  id?: string;
  priority?: number;
  startAfter?: Date | string | number;
  expireInSeconds?: number;
  expireInMinutes?: number;
  expireInHours?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retentionSeconds?: number;
  retentionMinutes?: number;
  retentionHours?: number;
  retentionDays?: number;
  singletonKey?: string;
  singletonSeconds?: number;
  singletonMinutes?: number;
  singletonHours?: number;
  singletonNextSlot?: boolean;
  deadLetter?: string;
  await?: boolean;
}

export interface ScheduleOptions extends JobOptions {
  key?: string;
  tz?: string;
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
  expireInSeconds: number;
}

export interface BatchJob<T = unknown> {
  name: string;
  data: T;
  options?: JobOptions;
}

interface SocketResponse<T = unknown> {
  status: "ok" | "error";
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

export class PlanLlama extends EventEmitter {
  private apiToken: string;
  private serverUrl: string;
  private socket: Socket | null = null;
  private isStarted = false;
  private reconnecting = false;
  private jobHandlers = new Map<string, HandlerInfo>();
  // private reconnectAttempts = 0;
  // private maxReconnectAttempts = 10;

  constructor(apiToken: string);
  constructor(options: PlanLlamaOptions);
  constructor(apiTokenOrOptions: string | PlanLlamaOptions) {
    super();

    if (typeof apiTokenOrOptions === "string") {
      if (!apiTokenOrOptions) {
        throw new Error("Customer token is required");
      }
      this.apiToken = apiTokenOrOptions;
      this.serverUrl =
        process.env.PLANLLAMA_SERVER_URL || "http://localhost:3000";
    } else {
      if (!apiTokenOrOptions || !apiTokenOrOptions.apiToken) {
        throw new Error("Customer options with token are required");
      }
      this.apiToken = apiTokenOrOptions.apiToken;
      this.serverUrl =
        apiTokenOrOptions.serverUrl ||
        process.env.PLANLLAMA_SERVER_URL ||
        "http://localhost:3000";
    }
  }

  /**
   * Starts the PlanLlama client and connects to the server.
   * @returns {Promise<void>} Resolves when the client is ready.
   * @throws {Error} If connection fails or times out.
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    const { version } = JSON.parse(await readFile("package.json", "utf-8")) as {
      version: string;
      name: string;
      description: string;
    };

    return new Promise((resolve, reject) => {
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000); // 10 second timeout

      this.socket = io(this.serverUrl, {
        path: "/ws",
        auth: {
          apiToken: this.apiToken,
        },
        transports: ["websocket", "polling"],
        tryAllTransports: true,
        withCredentials: true,
        extraHeaders: {
          "User-Agent": `planllama-client/${version}`,
        },
      });

      this.socket.on("connect", () => {
        clearTimeout(connectionTimeout);
        log("Connected to PlanLlama server");
        this.isStarted = true;
        // this.reconnectAttempts = 0;
      });

      this.socket.on("client_ready", () => {
        if (this.reconnecting) {
          for (const [jobName, handlerInfo] of this.jobHandlers) {
            log(`Re-registering worker for job: ${jobName}`);
            this.socket?.emit(
              "register_worker",
              {
                jobName: jobName,
                options: handlerInfo.options,
              },
              (response: any) => {
                log("Register worker response:", response);
              }
            );
          }
        } else {
          this.setupEventHandlers();
        }

        this.reconnecting = true;
        resolve();
      });

      this.socket.on("connect_error", (error) => {
        clearTimeout(connectionTimeout);
        console.error(
          "Failed to connect to PlanLlama server:",
          JSON.stringify(error)
        );
        reject(new Error(`Failed to connect: ${error.message}`));
      });

      this.socket.on("disconnect", (reason) => {
        log("Disconnected from PlanLlama server:", reason);
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
    log("Setting up event handlers");

    // Handle incoming work requests
    this.socket.on("work_request", (job: Job, callback) => {
      log(`Received work request for job '${job.name}' with ID: ${job.id}`);
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
        // console.log(`Starting job '${job.name}' with ID: ${job.id}`);
        this.socket?.emit("job_started", { jobName: job.name, jobId: job.id });
        super.emit("active", job);

        // Execute the job handler
        job.expireInSeconds ||= 900; // Default timeout of 15 minutes
        let isCancelled = false;
        const timeoutId = setTimeout(() => {
          isCancelled = true;
          callback?.({
            status: "error",
            error: `Job '${job.name}' timed out after ${job.expireInSeconds}s`,
          });
          super.emit("failed", job, "Job timed out");
        }, job.expireInSeconds * 1000);

        handlerInfo
          .handler(job)
          .then((result) => {
            if (isCancelled) return;
            clearTimeout(timeoutId);
            // console.log(`Job '${job.name}' completed with result:`, result);
            this.socket?.emit("job_completed", {
              jobName: job.name,
              jobId: job.id,
              result,
            });
            super.emit("completed", job, result);
            callback?.({ status: "ok", result: result });
          })
          .catch((error) => {
            if (isCancelled) return;
            clearTimeout(timeoutId);
            // console.log(`Job '${job.name}' failed with error:`, error);
            callback?.({
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            });
            super.emit("failed", job, error);
          });
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

  /**
   * Stops the PlanLlama client and disconnects from the server.
   * @returns {Promise<void>} Resolves when the client is stopped.
   */
  async stop(): Promise<void> {
    if (!this.isStarted || !this.socket) {
      return;
    }

    return new Promise((resolve) => {
      this.socket?.disconnect();
      this.isStarted = false;
      this.socket = null;
      log("PlanLlama stopped");
      resolve();
    });
  }

  /**
   * Sends a job to the server for processing.
   * @template T
   * @param {string} name - The name of the job.
   * @param {T} data - The job data.
   * @param {JobOptions} [options] - Optional job configuration.
   * @returns {Promise<string>} Resolves with the job ID.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async publish<T = unknown>(
    name: string,
    data: T,
    options?: JobOptions
  ): Promise<string> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
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
        }
      );
    });
  }

  /**
   * Sends a job to the server for processing and wait for response.
   * @template T
   * @template R
   * @param {string} name - The name of the job.
   * @param {T} data - The job data.
   * @param {JobOptions} [options] - Optional job configuration.
   * @returns {Promise<R>} Resolves with the return value of the job worker.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async request<T = unknown, R = unknown>(
    name: string,
    data?: T,
    options?: JobOptions
  ): Promise<R> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

    return new Promise((resolve, reject) => {
      this.socket?.emit(
        "send_job",
        { name, data, options: { ...options, await: true } },
        (response: SocketResponse) => {
          log("Request response:", response);
          if (response.status === "error") {
            reject(new Error(response.error));
          } else if (response.status === "ok" && response.jobId) {
            // eslint-disable-next-line prefer-const
            let jobFailed: (data: any) => void;
            const jobSuccess = (data: R) => {
              this.socket?.removeListener(
                `job_failed_${response.jobId}`,
                jobFailed
              );
              resolve(data);
            };
            jobFailed = (data: any) => {
              this.socket?.removeListener(
                `job_completed_${response.jobId}`,
                jobSuccess
              );
              reject(new Error(data.error || "Job failed"));
            };
            this.socket?.once(`job_completed_${response.jobId}`, jobSuccess);
            this.socket?.once(`job_failed_${response.jobId}`, jobFailed);
          } else {
            reject(
              new Error("Invalid response from server", { cause: response })
            );
          }
        }
      );
    });
  }

  /**
   * Schedules a recurring job using a cron pattern.
   * @template T
   * @param {string} name - The name of the job.
   * @param {string} cronPattern - The cron pattern for scheduling.
   * @param {T} data - The job data.
   * @param {ScheduleOptions} [options] - Optional job configuration.
   * @returns {Promise<void>} Resolves when the job is scheduled.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async schedule<T = unknown>(
    name: string,
    cronPattern: string,
    data: T,
    options?: ScheduleOptions
  ): Promise<void> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
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
        }
      );
    });
  }

  /**
   * Registers a job handler for processing jobs of a given name.
   * @template T, R
   * @param {string} name - The name of the job to handle.
   * @param {WorkOptions|JobHandler<T, R>} optionsOrHandler - Work options or the handler function.
   * @param {JobHandler<T, R>} [handler] - The handler function (if options are provided).
   * @throws {Error} If no handler function is provided.
   */
  work<T = unknown, R = unknown>(name: string, handler: JobHandler<T, R>): void;
  work<T = unknown, R = unknown>(
    name: string,
    options: WorkOptions,
    handler: JobHandler<T, R>
  ): void;
  work<T = unknown, R = unknown>(
    name: string,
    optionsOrHandler: WorkOptions | JobHandler<T, R>,
    handler?: JobHandler<T, R>
  ): void {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

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

    this.socket.emit("register_worker", {
      jobName: name,
      options: finalOptions,
    });
  }

  /**
   * Sends a batch of jobs to the server for processing.
   * @param {BatchJob[]} jobs - Array of jobs to publish in batch.
   * @returns {Promise<string>} Resolves with the batch ID.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async publishBatch(jobs: BatchJob[]): Promise<string> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
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

  /**
   * Waits for a batch of jobs to complete.
   * @param {string} batchId - The batch ID to wait for.
   * @returns {Promise<void>} Resolves when the batch is complete.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async waitForBatch(batchId: string): Promise<void> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
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
        }
      );
    });
  }

  /**
   * Retrieves a job by its ID.
   * @template T
   * @param {string} jobId - The job ID to retrieve.
   * @returns {Promise<Job<T>|undefined>} Resolves with the job or undefined if not found.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async getJobById<T = unknown>(jobId: string): Promise<Job<T> | undefined> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
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
              `Invalid response from server: ${JSON.stringify(response)}`
            )
          );
        }
      });
    });
  }

  /**
   * Cancels a job by its ID.
   * @param {string} jobId - The job ID to cancel.
   * @returns {Promise<void>} Resolves when the job is cancelled.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async cancel(jobId: string): Promise<void> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
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

  /**
   * Gets the size of the job queue for a given job name.
   * @param {string} jobName - The name of the job queue.
   * @returns {Promise<number>} Resolves with the queue size.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async getQueueSize(jobName: string): Promise<number> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

    return new Promise((resolve, reject) => {
      this.socket?.emit(
        "get_queue_size",
        { jobName },
        (response: SocketResponse) => {
          if (response.status === "error") {
            reject(new Error(response.error));
          } else if (response.status === "ok") {
            resolve(response.queueSize || 0);
          } else {
            reject(new Error("Invalid response from server"));
          }
        }
      );
    });
  }

  /**
   * Requests a temporary token for browser access.
   * @param {number} [durationSeconds] - Optional duration in seconds for the token validity.
   * @returns {Promise<{token: string, expiresAt: string, durationSeconds: number}>} Resolves with the temporary token information.
   * @throws {Error} If the client is not started or server returns an error.
   */
  async getTemporaryToken(durationSeconds?: number): Promise<{
    token: string;
    expiresAt: string;
    durationSeconds: number;
  }> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

    return new Promise((resolve, reject) => {
      this.socket?.emit(
        "request_browser_token",
        { ...(durationSeconds && { durationSeconds }) },
        (
          response: SocketResponse & {
            token?: string;
            expiresAt?: string;
            durationSeconds?: number;
          }
        ) => {
          if (response.status === "error") {
            reject(new Error(response.error));
          } else if (
            response.status === "ok" &&
            response.token &&
            response.expiresAt &&
            response.durationSeconds !== undefined
          ) {
            resolve({
              token: response.token,
              expiresAt: response.expiresAt,
              durationSeconds: response.durationSeconds,
            });
          } else {
            reject(new Error("Invalid response from server"));
          }
        }
      );
    });
  }

  private async fetchCurrentStepResults(jobId: string): Promise<StepResult> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

    log(`Fetching current step results for job ID: ${jobId}`);
    return new Promise((resolve, reject) => {
      this.socket?.emit(
        "fetch_step_results",
        { jobId },
        (response: SocketResponse & { stepResults?: StepResult }) => {
          if (response.status === "error") {
            reject(new Error(response.error));
          } else if (response.status === "ok" && response.stepResults) {
            resolve(new Map(Object.entries(response.stepResults)));
          } else {
            reject(new Error("Invalid response from server"));
          }
        }
      );
    });
  }

  private async storeStepResult(
    jobId: string,
    stepName: string,
    result: any
  ): Promise<void> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

    log(`Storing result for step '${stepName}' of job ID: ${jobId}`);
    return new Promise((resolve, reject) => {
      this.socket?.emit(
        "store_step_result",
        { jobId, stepName, result },
        (response: SocketResponse) => {
          if (response.status === "error") {
            reject(new Error(response.error));
          } else if (response.status === "ok") {
            resolve();
          } else {
            reject(new Error("Invalid response from server"));
          }
        }
      );
    });
  }

  /**
   * Defines and runs a workflow with multiple dependent steps.
   * @param {string} name - The name of the workflow.
   * @param {Steps} steps - A map of step names to step functions or dependant steps.
   * @returns {Promise<void>} Resolves when the workflow is defined.
   * @throws {Error} If the client is not started or step definitions are invalid.
   */
  async workflow(name: string, steps: Steps): Promise<void> {
    if (!this.isStarted || !this.socket) {
      throw new Error("PlanLlama not started. Call start() first.");
    }

    // Setup each step as its own job handler
    for (const [stepName, step] of Object.entries(steps)) {
      if (typeof step !== "function" && !Array.isArray(step)) {
        throw new Error("Invalid step definition");
      }
      const func = typeof step === "function" ? step : step[step.length - 1];
      if (typeof func !== "function") {
        throw new Error(
          "Step must be a function or an array ending with a function"
        );
      }
      this.work(`${name}/${stepName}`, async (job: Job) => {
        return func(job.data as StepResult);
      });
    }

    // Now setup the workflow runner
    this.work(name, async (job) => {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      const numTasks = Object.keys(steps).length;
      const stepResults = await this.fetchCurrentStepResults(job.id);

      let nextSteps: string[] = [];
      let pendingSteps: Record<string, DependantStep> = {};

      cycleCheck();
      getNextSteps(steps);
      return runSteps();

      function getNextSteps(_steps: Steps) {
        nextSteps = [];
        pendingSteps = {};

        for (const [stepName, step] of Object.entries(_steps)) {
          if (stepResults.has(stepName)) {
            // console.log(`Step '${stepName}' already completed, skipping`);
            continue;
          }
          // Sort into nextSteps based on dependencies
          if (typeof step === "function") {
            nextSteps.push(stepName);
          } else if (Array.isArray(step)) {
            const dependencies = step.slice(0, -1) as string[];
            const allDepsMet = dependencies.every((dep) => dep in stepResults);
            if (allDepsMet) {
              nextSteps.push(stepName);
            } else {
              pendingSteps[stepName] = step;
            }
          }
        }
      }

      function cycleCheck() {
        // Build in-degree map and dependents graph for Kahn's algorithm
        const inDegree: Record<string, number> = {};
        const dependents: Record<string, string[]> = {};

        // Initialize all steps with in-degree 0 and empty dependents
        for (const stepName of Object.keys(steps)) {
          inDegree[stepName] = 0;
          dependents[stepName] = [];
        }

        // Calculate in-degrees and build dependents map
        for (const [stepName, step] of Object.entries(steps)) {
          if (Array.isArray(step)) {
            const dependencies = step.slice(0, -1) as string[];
            inDegree[stepName] = dependencies.length;

            // For each dependency, add this step as a dependent
            for (const dep of dependencies) {
              if (!steps[dep]) {
                throw new Error(
                  `Step '${stepName}' depends on undefined step '${dep}'`
                );
              }
              if (!dependents[dep]) {
                dependents[dep] = [];
              }
              dependents[dep].push(stepName);
            }
          }
        }

        // Kahn's algorithm: start with nodes that have no dependencies
        const queue: string[] = [];
        for (const [stepName, degree] of Object.entries(inDegree)) {
          if (degree === 0) {
            queue.push(stepName);
          }
        }

        let processedCount = 0;

        while (queue.length > 0) {
          const currentStep = queue.shift() as string;
          processedCount++;

          // Process all steps that depend on this step
          for (const dependent of dependents[currentStep] || []) {
            if (inDegree[dependent] !== undefined) {
              inDegree[dependent]--;
              if (inDegree[dependent] === 0) {
                queue.push(dependent);
              }
            }
          }
        }

        // If we didn't process all steps, there's a cycle
        if (processedCount !== numTasks) {
          throw new Error(
            "workflow() cannot execute steps due to a recursive dependency"
          );
        }
      }

      async function runSteps() {
        if (nextSteps.length === 0) {
          return stepResults;
        }

        const stepPromises = nextSteps.map((s) => runStep(s));

        await Promise.all(stepPromises);

        getNextSteps(pendingSteps);
        return runSteps();
      }

      async function runStep(stepName: string) {
        const result = await self.request<StepResult, any>(
          `${name}/${stepName}`,
          stepResults
        );
        stepResults[stepName] = result;
        self.storeStepResult(job.id, stepName, result);
      }
    });
  }
}
