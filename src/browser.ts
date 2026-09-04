import { spawn } from "node:child_process";

export type BrowserCommand = Readonly<{ arguments: readonly string[]; executable: string }>;

const commands: Readonly<Record<NodeJS.Platform, BrowserCommand>> = {
  aix: { arguments: [], executable: "xdg-open" },
  android: { arguments: [], executable: "xdg-open" },
  darwin: { arguments: [], executable: "open" },
  freebsd: { arguments: [], executable: "xdg-open" },
  haiku: { arguments: [], executable: "xdg-open" },
  linux: { arguments: [], executable: "xdg-open" },
  openbsd: { arguments: [], executable: "xdg-open" },
  sunos: { arguments: [], executable: "xdg-open" },
  win32: { arguments: ["/d", "/s", "/c", "start", ""], executable: "cmd.exe" },
  cygwin: { arguments: ["/d", "/s", "/c", "start", ""], executable: "cmd.exe" },
  netbsd: { arguments: [], executable: "xdg-open" },
};

/** Selects a shell-free browser command; the OAuth URL is always passed as one argument. */
export const browserCommand = (platform: NodeJS.Platform, url: string): BrowserCommand => {
  const command = commands[platform];
  return { arguments: [...command.arguments, url], executable: command.executable };
};

/** Opens a browser without interpolating OAuth values into a shell command. */
export const launchBrowser = (url: string, platform: NodeJS.Platform = process.platform): Promise<void> => {
  const command = browserCommand(platform, url);
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.arguments, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};
