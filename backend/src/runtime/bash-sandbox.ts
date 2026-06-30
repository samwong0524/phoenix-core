/**
 * bash-sandbox.ts — Sandboxed command execution for the Bash tool (E-07)
 *
 * Provides two execution modes:
 *   - "docker": runs commands inside a resource-limited Docker container
 *   - "host":   runs commands on the host with enhanced restrictions
 *
 * When SANDBOX_ENABLED is not "true", the caller should fall back to the
 * original exec path so behaviour is identical to pre-sandbox builds.
 *
 * Environment variables
 * ---------------------
 * SANDBOX_ENABLED        true | false          (default false)
 * SANDBOX_MODE           docker | host         (default host)
 * SANDBOX_DOCKER_IMAGE   <image tag>           (default node:20-alpine)
 * SANDBOX_CPUS           <number>              (default 1)
 * SANDBOX_MEMORY_MB      <number>              (default 512)
 * SANDBOX_TIMEOUT_MS     <number>              (default 30000)
 * SANDBOX_NETWORK_NONE   true | false          (default true)
 * SANDBOX_ALLOWED_NETWORKS comma-separated list (empty = no whitelist)
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────────────

export interface SandboxConfig {
  enabled: boolean;
  mode: "docker" | "host";
  dockerImage: string;
  cpus: number;
  memoryMB: number;
  timeoutMs: number;
  networkNone: boolean;
  allowedNetworks: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getSandboxConfig(): SandboxConfig {
  const enabled = process.env.SANDBOX_ENABLED === "true";
  const mode = process.env.SANDBOX_MODE === "docker" ? "docker" : "host";
  return {
    enabled,
    mode,
    dockerImage: process.env.SANDBOX_DOCKER_IMAGE ?? "node:20-alpine",
    cpus: Number(process.env.SANDBOX_CPUS ?? "1"),
    memoryMB: Number(process.env.SANDBOX_MEMORY_MB ?? "512"),
    timeoutMs: Number(process.env.SANDBOX_TIMEOUT_MS ?? "30000"),
    networkNone: process.env.SANDBOX_NETWORK_NONE !== "false",
    allowedNetworks: (process.env.SANDBOX_ALLOWED_NETWORKS ?? "")
      .split(",")
      .filter(Boolean),
  };
}

// ── Docker availability probe ────────────────────────────────────────────────

/**
 * Check whether the Docker daemon is reachable.
 * Cached for the lifetime of the process to avoid repeated probes.
 */
let _dockerAvailable: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    await execAsync("docker info", { timeout: 5000 });
    _dockerAvailable = true;
  } catch {
    _dockerAvailable = false;
  }
  return _dockerAvailable;
}

// ── Docker sandbox execution ─────────────────────────────────────────────────

/**
 * Execute a command inside a Docker container with resource limits.
 *
 * The workspace directory is bind-mounted read-write at /workspace inside the
 * container, and the working directory is set accordingly.
 */
export async function execInSandbox(
  command: string,
  cwd: string,
  config: SandboxConfig,
): Promise<ExecResult> {
  const dockerArgs = [
    "run", "--rm",
    `--cpus=${config.cpus}`,
    `--memory=${config.memoryMB}m`,
    `--network=${config.networkNone ? "none" : "bridge"}`,
    "-v", `${cwd}:/workspace:rw`,
    "-w", "/workspace",
  ];

  const dockerCmd =
    `docker ${dockerArgs.join(" ")} ${config.dockerImage} sh -c ${JSON.stringify(command)}`;

  return new Promise<ExecResult>((resolve) => {
    exec(
      dockerCmd,
      {
        timeout: config.timeoutMs,
        maxBuffer: 1024 * 1024, // 1 MB
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({
            stdout: stdout ?? "",
            stderr: (stderr ?? "") +
              `\n[TIMEOUT: killed after ${config.timeoutMs}ms]`,
            exitCode: 124,
          });
        } else {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error
              ? (typeof (error as any).code === "number" ? (error as any).code : 1)
              : 0,
          });
        }
      },
    );
  });
}

// ── Host execution with enhanced restrictions ────────────────────────────────

/**
 * Execute a command on the host with tighter controls than the legacy path:
 *  - explicit timeout
 *  - bounded output buffer
 *  - SANDBOXED env-var set so child processes can detect containment
 *  - platform-appropriate shell (cmd.exe on Windows, /bin/bash on Linux)
 */
export async function execOnHost(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxOutputKB: number,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxOutputKB * 1024,
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
        windowsHide: true,
        env: {
          ...process.env,
          SANDBOXED: "true",
        },
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({
            stdout: stdout ?? "",
            stderr: (stderr ?? "") + "\n[TIMEOUT]",
            exitCode: 124,
          });
        } else {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error
              ? (typeof (error as any).code === "number" ? (error as any).code : 1)
              : 0,
          });
        }
      },
    );
  });
}
