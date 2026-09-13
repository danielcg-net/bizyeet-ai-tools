import open from "open";

type BrowserOpener = (url: string) => Promise<unknown>;

const openDefaultBrowser: BrowserOpener = (url) => open(url, { wait: false });

/** Validate a browser target, then delegate platform escaping to the pinned opener. */
export const createBrowserLauncher = (openUrl: BrowserOpener = openDefaultBrowser): ((url: string) => Promise<void>) =>
  async (value: string): Promise<void> => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error("OAuth browser target must be an HTTPS URL without credentials or a fragment.");
    }
    await openUrl(url.toString());
  };

/** Open the default browser without forwarding OAuth URLs through cmd.exe. */
export const launchBrowser = createBrowserLauncher();
